/**
 * Overlay behaviour tests (jsdom).
 *
 * The overlay is browser code served raw as a classic script, so it was
 * previously verified only by hand with Playwright. These tests load the REAL
 * compiled `dist/overlay.js` into a jsdom window — the exact bytes shipped to
 * users — mock `fetch`/`localStorage`, dispatch real events, and assert the
 * request payloads and DOM effects. That covers the client half of the tool
 * (init, gating, commit protocols, undo) that the server tests can't reach.
 *
 * jsdom has no layout engine, so element geometry (`getBoundingClientRect`) is
 * all zeros — irrelevant here, since we assert on payloads and state, not pixel
 * positions. jsdom also ships no `contentEditable`/`isContentEditable`; both are
 * polyfilled below to mirror a real browser (the overlay gates edit commits on
 * `isContentEditable`).
 *
 * Runs against the COMPILED output — `npm run build` first (the `test` script
 * does it for you).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const OVERLAY_JS = fs.readFileSync(
  path.join(__dirname, '..', 'dist', 'overlay.js'),
  'utf8'
);

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/**
 * Build a jsdom window, install the contentEditable polyfills and a recording
 * fetch mock, then run the real overlay inside it. Returns handles for driving
 * and asserting.
 */
async function mkOverlay(bodyHtml, opts = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`, {
    url: 'http://localhost:3000',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // jsdom lacks these; mirror a browser so the overlay's edit gating works.
  const proto = window.HTMLElement.prototype;
  Object.defineProperty(proto, 'contentEditable', {
    configurable: true,
    get() {
      return this.getAttribute('contenteditable') ?? 'inherit';
    },
    set(v) {
      this.setAttribute('contenteditable', String(v));
    },
  });
  Object.defineProperty(proto, 'isContentEditable', {
    configurable: true,
    get() {
      let el = this;
      while (el && el.getAttribute) {
        const ce = el.getAttribute('contenteditable');
        if (ce === 'true' || ce === '') return true;
        if (ce === 'false') return false;
        el = el.parentElement;
      }
      return false;
    },
  });

  for (const [k, v] of Object.entries(opts.localStorage || {})) {
    window.localStorage.setItem(k, v);
  }

  const warns = [];
  window.console = {
    log() {},
    info() {},
    warn: (...a) => warns.push(a.join(' ')),
    error: (...a) => warns.push(a.join(' ')),
  };

  // Record every request; answer by endpoint so init's /resolve probe and any
  // commit both resolve cleanly.
  const calls = [];
  window.fetch = async (url, init2) => {
    const body = init2 && init2.body ? JSON.parse(init2.body) : undefined;
    calls.push({ url: String(url), body });
    let payload = { ok: true };
    if (String(url).endsWith('/resolve')) payload = { ok: true, results: [] };
    return { json: async () => payload };
  };

  window.__NEXTCANVAS_SERVER__ = 'http://localhost:3131';

  // Indirect eval → runs in the window's global scope (function declarations
  // land on window, `document`/`fetch`/`localStorage` resolve to this window).
  window.eval(OVERLAY_JS);
  await tick(0); // let whenBodyReady's synchronous init settle

  const document = window.document;
  const editCalls = () => calls.filter((c) => c.url.endsWith('/edit'));

  return { dom, window, document, calls, editCalls, warns };
}

function fire(window, el, type, init2 = {}) {
  el.dispatchEvent(
    new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init2 })
  );
}
function key(window, el, k, init2 = {}) {
  el.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key: k,
      bubbles: true,
      cancelable: true,
      ...init2,
    })
  );
}

// --- init --------------------------------------------------------------------

test('warns once when the page has zero data-loc stamps', async () => {
  const { warns, dom } = await mkOverlay('<h1>no stamp here</h1>');
  assert.ok(
    warns.some((w) => /no data-loc stamps/.test(w)),
    'expected a zero-stamp warning'
  );
  dom.window.close();
});

test('no warning when stamps are present', async () => {
  const { warns, dom } = await mkOverlay(
    '<h1 data-loc="/x.tsx:1:1">Hi</h1>'
  );
  assert.ok(!warns.some((w) => /no data-loc stamps/.test(w)));
  dom.window.close();
});

// --- single-text commit ------------------------------------------------------

test('double-click + edit + blur posts the single-text payload', async () => {
  const { window, document, editCalls, dom } = await mkOverlay(
    '<h1 id="h" data-loc="/abs/page.tsx:3:5">Hello</h1>'
  );
  const h = document.getElementById('h');

  fire(window, h, 'dblclick');
  assert.equal(h.getAttribute('contenteditable'), 'true', 'should enter edit mode');

  h.textContent = 'Goodbye';
  h.dispatchEvent(new window.FocusEvent('blur'));
  await tick(0);

  const c = editCalls();
  assert.equal(c.length, 1, 'exactly one edit posted');
  assert.deepEqual(
    { f: c[0].body.fileName, l: c[0].body.lineNumber, cN: c[0].body.columnNumber },
    { f: '/abs/page.tsx', l: 3, cN: 5 },
    'source parsed from data-loc'
  );
  assert.equal(c[0].body.oldText, 'Hello');
  assert.equal(c[0].body.newText, 'Goodbye');
  assert.ok(!c[0].body.segments, 'plain element uses the legacy single-text shape');
  dom.window.close();
});

test('an unchanged edit posts nothing', async () => {
  const { window, document, editCalls, dom } = await mkOverlay(
    '<h1 id="h" data-loc="/x.tsx:1:1">Same</h1>'
  );
  const h = document.getElementById('h');
  fire(window, h, 'dblclick');
  h.dispatchEvent(new window.FocusEvent('blur'));
  await tick(0);
  assert.equal(editCalls().length, 0);
  dom.window.close();
});

// --- mixed-children commit ---------------------------------------------------

test('a mixed element posts the segmented payload and preserves inline tags', async () => {
  const { window, document, editCalls, dom } = await mkOverlay(
    '<p id="p" data-loc="/x.tsx:2:1">Hi <strong>there</strong>!</p>'
  );
  const p = document.getElementById('p');

  fire(window, p, 'dblclick');
  // The inline <strong> is locked so the caret can't enter it.
  assert.equal(
    p.querySelector('strong').getAttribute('contenteditable'),
    'false'
  );

  // Simulate editing the two text runs ("Hi " and "!").
  p.childNodes[0].nodeValue = 'Howdy ';
  p.childNodes[2].nodeValue = '?';
  p.dispatchEvent(new window.FocusEvent('blur'));
  await tick(0);

  const c = editCalls();
  assert.equal(c.length, 1);
  assert.ok(Array.isArray(c[0].body.segments), 'mixed element sends segments');
  assert.deepEqual(c[0].body.segments, [
    { oldText: 'Hi ', newText: 'Howdy ' },
    { oldText: '!', newText: '?' },
  ]);
  dom.window.close();
});

test('emptying a whole run in a mixed element is rejected and reverted', async () => {
  const { window, document, editCalls, dom } = await mkOverlay(
    '<p id="p" data-loc="/x.tsx:2:1">Keep <em>x</em> me</p>'
  );
  const p = document.getElementById('p');
  fire(window, p, 'dblclick');
  // Delete the <em> entirely — structural change the overlay must refuse.
  p.querySelector('em').remove();
  p.dispatchEvent(new window.FocusEvent('blur'));
  await tick(0);
  assert.equal(editCalls().length, 0, 'no write for a structural change');
  dom.window.close();
});

// --- bound text --------------------------------------------------------------

test('bound-text commit posts the textBound payload with expr + index', async () => {
  const { window, document, calls, editCalls, dom } = await mkOverlay(
    '<h3 id="b" data-loc="/x.tsx:9:3" data-nc-text-bound="s.name">Ada</h3>'
  );
  // Let the init /resolve probe run (empty results ⇒ nothing suppressed).
  await tick(300);
  const b = document.getElementById('b');
  fire(window, b, 'dblclick');
  b.textContent = 'Bob';
  b.dispatchEvent(new window.FocusEvent('blur'));
  await tick(0);

  const c = editCalls();
  assert.equal(c.length, 1);
  assert.equal(c[0].body.textBound, true);
  assert.equal(c[0].body.expr, 's.name');
  assert.equal(c[0].body.index, 0);
  assert.equal(c[0].body.oldText, 'Ada');
  assert.equal(c[0].body.newText, 'Bob');
  assert.ok(calls.some((c2) => c2.url.endsWith('/resolve')), 'probed writability');
  dom.window.close();
});

// --- master switch gating ----------------------------------------------------

test('when disabled, double-click does not enter edit mode', async () => {
  const { window, document, editCalls, dom } = await mkOverlay(
    '<h1 id="h" data-loc="/x.tsx:1:1">Hi</h1>',
    { localStorage: { 'nextcanvas:enabled': '0' } }
  );
  const h = document.getElementById('h');
  fire(window, h, 'dblclick');
  assert.notEqual(h.getAttribute('contenteditable'), 'true');
  h.dispatchEvent(new window.FocusEvent('blur'));
  await tick(0);
  assert.equal(editCalls().length, 0);
  dom.window.close();
});

// --- undo (autosave) ---------------------------------------------------------

test('undo after a commit writes the reverse edit', async () => {
  const { window, document, editCalls, dom } = await mkOverlay(
    '<h1 id="h" data-loc="/x.tsx:1:1">Hello</h1>'
  );
  const h = document.getElementById('h');
  fire(window, h, 'dblclick');
  h.textContent = 'Goodbye';
  h.dispatchEvent(new window.FocusEvent('blur'));
  await tick(0);
  assert.equal(editCalls().length, 1);

  // Ctrl+Z on the document (not while a field is focused).
  key(window, document.body, 'z', { ctrlKey: true });
  await tick(0);

  const c = editCalls();
  assert.equal(c.length, 2, 'undo issues a second write');
  assert.equal(c[1].body.oldText, 'Goodbye');
  assert.equal(c[1].body.newText, 'Hello', 'reverse of the original edit');
  dom.window.close();
});

// --- Buttons toggle: page interactivity --------------------------------------

test('Buttons off blocks page clicks; on lets them through', async () => {
  // Buttons OFF (default): a page click is stopped before it reaches handlers.
  {
    const { window, document, dom } = await mkOverlay(
      '<a id="lnk" href="/next" data-loc="/x.tsx:1:1">Go</a>'
    );
    let fired = false;
    document.getElementById('lnk').addEventListener('click', () => {
      fired = true;
    });
    fire(window, document.getElementById('lnk'), 'click');
    assert.equal(fired, false, 'Buttons off should swallow the click');
    dom.window.close();
  }
  // Buttons ON: the app behaves normally and the click reaches its handler.
  {
    const { window, document, dom } = await mkOverlay(
      '<a id="lnk" href="/next" data-loc="/x.tsx:1:1">Go</a>',
      { localStorage: { 'nextcanvas:buttons': 'on' } }
    );
    let fired = false;
    document.getElementById('lnk').addEventListener('click', () => {
      fired = true;
    });
    fire(window, document.getElementById('lnk'), 'click');
    assert.equal(fired, true, 'Buttons on should let the click through');
    dom.window.close();
  }
});
