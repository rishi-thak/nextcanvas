const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transform, loadBindings } = require('next/dist/build/swc');
const { JSDOM } = require('jsdom');

const filename = path.join(__dirname, 'fixtures/restricted-text.tsx');
const wasm = path.resolve(__dirname, '../swc/nextcanvas_swc.wasm');
async function compile(source, instrument = true) {
  await loadBindings();
  const { code } = await transform(source, {
    filename,
    jsc: {
      target: 'es2022', parser: { syntax: 'typescript', tsx: true },
      transform: { react: { runtime: 'automatic', development: true } },
      experimental: { plugins: instrument ? [[wasm, {}]] : [] },
    },
    module: { type: 'commonjs' },
  });
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = module.paths;
  compiled._compile(code, filename);
  return { code, render: () => renderToStaticMarkup(React.createElement(compiled.exports.default)) };
}

test('shipped WASM preserves native option labels and selection for all fixture shapes', async () => {
  const source = fs.readFileSync(filename, 'utf8');
  const plain = await compile(source, false);
  const stamped = await compile(source);
  const actual = stamped.render();
  const expected = plain.render();
  // Compare raw SSR too: an HTML parser would silently discard invalid spans.
  const options = html => html.match(/<option\b[^>]*>[\s\S]*?<\/option>/g);
  assert.equal(options(actual).length, 16);
  assert.deepEqual(options(actual), options(expected));
  for (const option of options(actual)) {
    assert.doesNotMatch(option, /<span|data-nc-|data-loc/);
  }
  const doc = new JSDOM(actual).window.document;
  assert.equal(doc.querySelector('#dates').value, '30');
  assert.equal(doc.querySelector('#members').value, 'member&1');
  assert.equal(doc.querySelector('#members option:checked').textContent, 'A & <B> — Organization not set');
  assert.equal(doc.querySelector('#shapes').value, 'fragment');
  assert.equal(doc.querySelector('#shapes option:last-child').value, 'Implicit & value');
  assert.ok(doc.querySelector('#normal[data-loc] [data-nc-expr]'), 'normal interpolated text stays editable');
  assert.ok(doc.querySelector('td[data-loc] [data-nc-expr]'), 'table cell resets structural restrictions');
  assert.ok([...doc.querySelectorAll('span[data-loc]')].some(el => el.textContent === 'Editable component'));
});

test('text-only ancestry survives fragments, custom tags, expressions, and authored descendants', async () => {
  for (const tag of ['option', 'textarea', 'title', 'script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']) {
    const { code } = await compile(`import React from 'react'; export default function Test({ value }) {
      return <${tag}><><Pass>Last {value} days</Pass><span>Hi {value}!</span></></${tag}>;
    }`);
    assert.doesNotMatch(code, /data-loc|data-nc-/, tag);
  }
});

test('structural parents do not wrap pass-through children; valid child hosts resume editing', async () => {
  for (const [parent, child] of [['select', 'option'], ['optgroup', 'option'], ['table', 'caption'], ['tbody', 'td'], ['thead', 'th'], ['tfoot', 'td'], ['tr', 'td'], ['colgroup', 'col'], ['ul', 'li'], ['ol', 'li'], ['menu', 'li'], ['dl', 'dd'], ['picture', 'img'], ['html', 'body'], ['head', 'title']]) {
    const { code } = await compile(`import React from 'react'; export default function Test({ value }) {
      return <${parent}><Pass>Last {value} days</Pass></${parent}>;
    }`);
    assert.doesNotMatch(code, /data-loc|data-nc-/, parent);
    if (['caption', 'td', 'th', 'li', 'dd', 'body'].includes(child)) {
      const inner = await compile(`import React from 'react'; export default function Test({ value }) {
        return <${parent}><${child}>Last {value} days</${child}></${parent}>;
      }`);
      assert.match(inner.code, /data-nc-text-bound/, `${parent}/${child}`);
    }
  }
});

test('attributes and following siblings are independent of restricted child context', async () => {
  const { code } = await compile(`import React from 'react'; export default function Test({ value }) {
    return <><option title="Hint" label={<Pass>Hello {value}!</Pass>}>Last {value} days</option><p>Hello {value}!</p><Option>Normal {value} component</Option></>;
  }`);
  assert.match(code, /data-nc-attrs/);
  assert.equal((code.match(/data-nc-text-bound/g) || []).length, 3);
});
