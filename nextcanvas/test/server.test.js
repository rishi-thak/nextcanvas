/**
 * Golden-file tests for the AST write-back (`applyEdit`).
 *
 * `applyEdit()` is the one pure, browser-free part of the pipeline: given an
 * edit descriptor and a real file on disk, it rewrites the source with ts-morph
 * and returns a result. That makes it directly `require`-able and unit-testable
 * with no Next.js, no browser, and no server — which is exactly what we exercise
 * here so the matching / normalization / whitespace logic can be refactored with
 * a safety net.
 *
 * These run against the COMPILED output (`dist/server.js`), so `npm run build`
 * must run first — the `test` script in package.json does that for you.
 *
 * Zero test dependencies: this uses Node's built-in `node:test` runner
 * (`node --test`) and `node:assert`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyEdit } = require('../dist/server.js');

/**
 * Write `src` to a throwaway .tsx file, run `applyEdit` against it, and return
 * both the result object and the file's contents on disk afterwards. Each call
 * gets its own temp dir so cases can't interfere with one another.
 */
function edit(src, params) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-test-'));
  const fileName = path.join(dir, 'component.tsx');
  fs.writeFileSync(fileName, src);
  const result = applyEdit({ fileName, ...params });
  const after = fs.readFileSync(fileName, 'utf8');
  return { result, after };
}

// --- Happy path: formatting-preserving single-line edits ---------------------

test('rewrites single-line static JSX text in place', () => {
  const { result, after } = edit('const x = <h1>Hello</h1>;\n', {
    lineNumber: 1,
    oldText: 'Hello',
    newText: 'Goodbye',
  });

  assert.equal(result.ok, true);
  assert.equal(after, 'const x = <h1>Goodbye</h1>;\n');
  // The result echoes back the normalized oldText and the new text.
  assert.equal(result.oldText, 'Hello');
  assert.equal(result.newText, 'Goodbye');
});

test('leaves sibling elements and attributes untouched', () => {
  const src = [
    'const x = (',
    '  <div className="a">',
    '    <h1>Title</h1>',
    '    <p>Body</p>',
    '  </div>',
    ');',
    '',
  ].join('\n');

  const { result, after } = edit(src, {
    lineNumber: 3,
    oldText: 'Title',
    newText: 'New Title',
  });

  assert.equal(result.ok, true);
  assert.equal(
    after,
    [
      'const x = (',
      '  <div className="a">',
      '    <h1>New Title</h1>',
      '    <p>Body</p>',
      '  </div>',
      ');',
      '',
    ].join('\n')
  );
});

test('applies even when the reported line does not match (line is a hint, single candidate)', () => {
  const { result, after } = edit('const x = <h1>Hello</h1>;\n', {
    lineNumber: 42, // wrong on purpose; there is only one candidate
    oldText: 'Hello',
    newText: 'Hey',
  });

  assert.equal(result.ok, true);
  assert.equal(after, 'const x = <h1>Hey</h1>;\n');
});

// --- Whitespace normalization ------------------------------------------------

test('matches wrapped multi-line source when the browser sends collapsed text', () => {
  // The overlay hands us rendered textContent (interior whitespace collapsed to
  // single spaces), while the source wraps the text across indented lines.
  const src = ['const x = (', '  <p>', '    Hello    world', '    again', '  </p>', ');', ''].join('\n');

  const { result, after } = edit(src, {
    lineNumber: 2,
    oldText: 'Hello world again', // collapsed form
    newText: 'Bye',
  });

  assert.equal(result.ok, true);
  // The wrapped text collapses to the new value; the tags survive. We assert on
  // structure (not exact re-indentation) because ts-morph reflows the closing
  // tag's indentation on multi-line nodes — that's downstream of applyEdit.
  assert.doesNotMatch(after, /Hello/);
  assert.match(after, /Bye/);
  assert.match(after, /<p>/);
  assert.match(after, /<\/p>/);
});

// --- Disambiguation among duplicate texts ------------------------------------

test('picks the candidate on the reported line when text is duplicated', () => {
  const src = ['const x = (', '  <>', '    <span>Hi</span>', '    <span>Hi</span>', '  </>', ');', ''].join('\n');

  const { result, after } = edit(src, {
    lineNumber: 4, // the second span
    oldText: 'Hi',
    newText: 'Yo',
  });

  assert.equal(result.ok, true);
  assert.equal(
    after,
    ['const x = (', '  <>', '    <span>Hi</span>', '    <span>Yo</span>', '  </>', ');', ''].join('\n')
  );
});

test('rejects an ambiguous edit when text is duplicated and no line matches', () => {
  const { result, after } = edit('const x = (<><span>Hi</span><span>Hi</span></>);\n', {
    lineNumber: 999, // matches neither span
    oldText: 'Hi',
    newText: 'Yo',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Ambiguous/);
  // Rejected edits must not touch the file.
  assert.equal(after, 'const x = (<><span>Hi</span><span>Hi</span></>);\n');
});

// --- Rejections (scope / limitations, documented on purpose) -----------------

test('rejects a bound value / text that is not present as literal source', () => {
  const { result, after } = edit('const x = <h1>{title}</h1>;\n', {
    lineNumber: 1,
    oldText: 'Whatever the title is',
    newText: 'X',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Could not find static text/);
  assert.match(result.error, /bound value/);
  assert.equal(after, 'const x = <h1>{title}</h1>;\n');
});

test('does not decode JSX entities, so &amp; text is treated as not found (known limitation)', () => {
  // Documents current behavior: matching is on raw source text, not the decoded
  // DOM textContent, so "Tom & Jerry" won't match source "Tom &amp; Jerry".
  const { result, after } = edit('const x = <p>Tom &amp; Jerry</p>;\n', {
    lineNumber: 1,
    oldText: 'Tom & Jerry',
    newText: 'A & B',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Could not find static text/);
  assert.equal(after, 'const x = <p>Tom &amp; Jerry</p>;\n');
});

test('rejects an edit with no fileName', () => {
  const result = applyEdit({ oldText: 'a', newText: 'b' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing fileName');
});
