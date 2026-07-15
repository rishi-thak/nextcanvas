/**
 * Golden-file tests for the reconciled bound-text write-back
 * (`applyBoundTextEdit`) plus the component-wrapped literal path (`applyEdit`).
 *
 * Like server.test.js these run against the COMPILED `dist/server.js`, so
 * `npm run build` must run first (the `test` script does that). Zero deps:
 * Node's built-in `node:test` + `node:assert`.
 *
 * The invariant under test is VALUE-MATCH targeting: among a `.map`'d array the
 * server rewrites the entry whose bound value currently equals `oldText`, never
 * a positional index — so a filtered/reordered list edits the right entry.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyBoundTextEdit, applyEdit } = require('../dist/server.js');

/**
 * Write a set of files into a fresh temp dir, run `applyBoundTextEdit` against
 * `entry` (the file the JSX lives in), and return the result plus the on-disk
 * contents of every file afterwards (keyed by basename).
 */
function boundEdit(files, entry, params) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-bt-'));
  const paths = {};
  for (const [name, src] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, src);
    paths[name] = p;
  }
  const result = applyBoundTextEdit({ fileName: paths[entry], ...params });
  const after = {};
  for (const name of Object.keys(files)) after[name] = fs.readFileSync(paths[name], 'utf8');
  return { result, after, paths };
}

// --- Member-chain over an array of objects (faceted-shock) --------------------

const SPEAKERS_SRC = [
  'const SPEAKERS = [',
  "  { name: 'Ada', role: 'Chair' },",
  "  { name: 'Linus', role: 'Speaker' },",
  "  { name: 'Grace', role: 'Speaker' },",
  '];',
  'export const List = () =>',
  '  SPEAKERS.map((s) => <h3>{s.name}</h3>);',
  '',
].join('\n');

test('member-chain: edits the unique matching array entry by value', () => {
  const { result, after } = boundEdit({ 'c.tsx': SPEAKERS_SRC }, 'c.tsx', {
    lineNumber: 7, // the <h3> line
    expr: 's.name',
    oldText: 'Linus',
    newText: 'Linus Torvalds',
  });
  assert.equal(result.ok, true, result.error);
  assert.match(after['c.tsx'], /name: 'Linus Torvalds'/);
  assert.match(after['c.tsx'], /name: 'Ada'/); // siblings untouched
  assert.match(after['c.tsx'], /name: 'Grace'/);
});

test('member-chain: targeting is by VALUE, not the DOM index the overlay sends', () => {
  // The overlay sends index=0 (Ada is first in the rendered/filtered DOM), but
  // oldText is "Linus" (array index 2 after a reorder). A positional impl would
  // rewrite Ada; value-match rewrites Linus. This is the reorder-independence.
  const { result, after } = boundEdit({ 'c.tsx': SPEAKERS_SRC }, 'c.tsx', {
    lineNumber: 7,
    expr: 's.name',
    index: 0,
    oldText: 'Linus',
    newText: 'Linus T.',
  });
  assert.equal(result.ok, true, result.error);
  assert.match(after['c.tsx'], /name: 'Linus T\.'/);
  assert.match(after['c.tsx'], /name: 'Ada'/); // index-0 entry is NOT touched
});

test('member-chain: duplicate value is refused as ambiguous (never guesses)', () => {
  const dup = [
    'const ITEMS = [',
    "  { track: 'AI', title: 'Keynote' },",
    "  { track: 'AI', title: 'Panel' },",
    '];',
    'export const L = () => ITEMS.map((it) => <span>{it.track}</span>);',
    '',
  ].join('\n');
  const { result, after } = boundEdit({ 'c.tsx': dup }, 'c.tsx', {
    lineNumber: 5,
    expr: 'it.track',
    oldText: 'AI',
    newText: 'ML',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /appears 2|can't tell|ambiguous/i);
  assert.equal(after['c.tsx'], dup); // file untouched on refusal
});

test('member-chain: no matching entry is rejected as stale', () => {
  const { result, after } = boundEdit({ 'c.tsx': SPEAKERS_SRC }, 'c.tsx', {
    lineNumber: 7,
    expr: 's.name',
    oldText: 'Someone Who Left',
    newText: 'X',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /No entry|reload/i);
  assert.equal(after['c.tsx'], SPEAKERS_SRC);
});

test('member-chain: a non-string leaf property is rejected', () => {
  const src = [
    'const DAYS = [{ label: 1 }, { label: 2 }];',
    'export const L = () => DAYS.map((d) => <b>{d.label}</b>);',
    '',
  ].join('\n');
  const { result, after } = boundEdit({ 'c.tsx': src }, 'c.tsx', {
    lineNumber: 2,
    expr: 'd.label',
    oldText: '1',
    newText: '9',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /not a string literal|No entry/i);
  assert.equal(after['c.tsx'], src);
});

// --- Bare identifier over an array of strings (battle-tune) -------------------

test('bare {t} in a .map over string literals: value-match edits the entry', () => {
  const src = [
    "const truths = ['First', 'Second', 'Third'];",
    'export const L = () => truths.map((t) => <p>{t}</p>);',
    '',
  ].join('\n');
  const { result, after } = boundEdit({ 'c.tsx': src }, 'c.tsx', {
    lineNumber: 2,
    expr: 't',
    oldText: 'Second',
    newText: '2nd',
  });
  assert.equal(result.ok, true, result.error);
  assert.match(after['c.tsx'], /'First', '2nd', 'Third'/);
});

test('bare {t}: duplicate string entries are refused as ambiguous', () => {
  const src = [
    "const tags = ['new', 'new', 'old'];",
    'export const L = () => tags.map((t) => <span>{t}</span>);',
    '',
  ].join('\n');
  const { result, after } = boundEdit({ 'c.tsx': src }, 'c.tsx', {
    lineNumber: 2,
    expr: 't',
    oldText: 'new',
    newText: 'fresh',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /appears 2|can't tell|ambiguous/i);
  assert.equal(after['c.tsx'], src);
});

// --- Direct object variable (cfg.title) --------------------------------------

test('direct-object binding rewrites the object property', () => {
  const src = [
    "const cfg = { title: 'Hello', subtitle: 'Sub' };",
    'export const H = () => <h1>{cfg.title}</h1>;',
    '',
  ].join('\n');
  const { result, after } = boundEdit({ 'c.tsx': src }, 'c.tsx', {
    lineNumber: 2,
    expr: 'cfg.title',
    oldText: 'Hello',
    newText: 'Hi there',
  });
  assert.equal(result.ok, true, result.error);
  assert.match(after['c.tsx'], /title: 'Hi there'/);
  assert.match(after['c.tsx'], /subtitle: 'Sub'/);
});

test('direct-object binding is stale-guarded', () => {
  const src = [
    "const cfg = { title: 'Hello' };",
    'export const H = () => <h1>{cfg.title}</h1>;',
    '',
  ].join('\n');
  const { result, after } = boundEdit({ 'c.tsx': src }, 'c.tsx', {
    lineNumber: 2,
    expr: 'cfg.title',
    oldText: 'Stale',
    newText: 'X',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /no longer matches|reload/i);
  assert.equal(after['c.tsx'], src);
});

test('nested member-chain (cfg.meta.title) walks into the nested object', () => {
  const src = [
    "const cfg = { meta: { title: 'Deep' } };",
    'export const H = () => <h1>{cfg.meta.title}</h1>;',
    '',
  ].join('\n');
  const { result, after } = boundEdit({ 'c.tsx': src }, 'c.tsx', {
    lineNumber: 2,
    expr: 'cfg.meta.title',
    oldText: 'Deep',
    newText: 'Deeper',
  });
  assert.equal(result.ok, true, result.error);
  assert.match(after['c.tsx'], /title: 'Deeper'/);
});

// --- Cross-file relative import ----------------------------------------------

test('cross-file: resolves a relatively-imported array and edits the DATA file', () => {
  const data = [
    'export const SPEAKERS = [',
    "  { name: 'Ada' },",
    "  { name: 'Linus' },",
    '];',
    '',
  ].join('\n');
  const page = [
    "import { SPEAKERS } from './data';",
    'export const L = () => SPEAKERS.map((s) => <h3>{s.name}</h3>);',
    '',
  ].join('\n');
  const { result, after, paths } = boundEdit(
    { 'data.ts': data, 'page.tsx': page },
    'page.tsx',
    { lineNumber: 2, expr: 's.name', oldText: 'Linus', newText: 'Linus T.' }
  );
  assert.equal(result.ok, true, result.error);
  assert.match(after['data.ts'], /name: 'Linus T\.'/); // data file rewritten
  assert.equal(after['page.tsx'], page); // page untouched
  assert.equal(result.fileName, paths['data.ts']); // owning file reported
});

test('cross-file: direct object imported from another module', () => {
  const data = ["export const cfg = { title: 'Hello' };", ''].join('\n');
  const page = [
    "import { cfg } from './cfg';",
    'export const H = () => <h1>{cfg.title}</h1>;',
    '',
  ].join('\n');
  const { result, after } = boundEdit(
    { 'cfg.ts': data, 'page.tsx': page },
    'page.tsx',
    { lineNumber: 2, expr: 'cfg.title', oldText: 'Hello', newText: 'Hey' }
  );
  assert.equal(result.ok, true, result.error);
  assert.match(after['cfg.ts'], /title: 'Hey'/);
  assert.equal(after['page.tsx'], page);
});

// --- Undo/redo re-value-matches on the current source ------------------------

test('forward then reverse edit round-trips via value-match', () => {
  const files = { 'c.tsx': SPEAKERS_SRC };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-bt-'));
  const p = path.join(dir, 'c.tsx');
  fs.writeFileSync(p, SPEAKERS_SRC);
  const fwd = applyBoundTextEdit({
    fileName: p,
    lineNumber: 7,
    expr: 's.name',
    oldText: 'Grace',
    newText: 'Grace Hopper',
  });
  assert.equal(fwd.ok, true, fwd.error);
  const rev = applyBoundTextEdit({
    fileName: p,
    lineNumber: 7,
    expr: 's.name',
    oldText: 'Grace Hopper',
    newText: 'Grace',
  });
  assert.equal(rev.ok, true, rev.error);
  assert.equal(fs.readFileSync(p, 'utf8'), SPEAKERS_SRC); // back to start
  void files;
});

// --- Component-wrapped literal text via applyEdit (erratic-tent, server side) -

test('applyEdit rewrites literal text inside a plain-identifier component', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-bt-'));
  const p = path.join(dir, 'c.tsx');
  fs.writeFileSync(p, 'const x = <Reveal as="h2">Here is what we know</Reveal>;\n');
  const result = applyEdit({
    fileName: p,
    lineNumber: 1,
    oldText: 'Here is what we know',
    newText: 'What we learned',
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(
    fs.readFileSync(p, 'utf8'),
    'const x = <Reveal as="h2">What we learned</Reveal>;\n'
  );
});
