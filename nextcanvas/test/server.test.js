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

// Path containment: edits must stay inside the project root (src/security.ts).
// These tests write throwaway files under the OS temp dir, so point the root
// there — the env var is read per call, so setting it here covers every case.
process.env.NEXTCANVAS_ROOT = require('os').tmpdir();

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyEdit,
  applyAttrEdit,
  parsesClean,
} = require('../dist/server.js');

/**
 * Write `src` to a throwaway .tsx file, run `applyEdit` against it, and return
 * both the result object and the file's contents on disk afterwards. Each call
 * gets its own temp dir so cases can't interfere with one another.
 */
function edit(src, params) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-test-'));
  const fileName = path.join(dir, 'component.tsx');
  fs.writeFileSync(fileName, src);
  // Default to applyEdit; a case can pass `fn` (e.g. applyAttrEdit) to exercise
  // another write path through the same fixture machinery.
  const { fn = applyEdit, ...rest } = params;
  const result = fn({ fileName, ...rest });
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

test('matches entity-encoded source against the decoded text the browser sends', () => {
  // The browser sends decoded textContent ("Tom & Jerry"); the source holds the
  // encoded form (`Tom &amp; Jerry`). Matching decodes the source so the two
  // line up, and the new value is re-encoded so the JSX stays valid.
  const { result, after } = edit('const x = <p>Tom &amp; Jerry</p>;\n', {
    lineNumber: 1,
    oldText: 'Tom & Jerry',
    newText: 'A & B',
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(after, 'const x = <p>A &amp; B</p>;\n');
});

test('decodes named and numeric entities when matching, encodes specials on write', () => {
  const { result, after } = edit('const x = <h2>we &mdash; you &#8230;</h2>;\n', {
    lineNumber: 1,
    // — is the em dash the browser renders for &mdash;, … for &#8230;.
    oldText: 'we — you …',
    newText: 'a < b & c > {d}',
  });

  assert.equal(result.ok, true, result.error);
  // Angle brackets, ampersand, and braces are all escaped so the JSX is valid.
  assert.equal(after, 'const x = <h2>a &lt; b &amp; c &gt; &#123;d&#125;</h2>;\n');
});

test('an entity edit round-trips (decode(encode(x)) === x)', () => {
  const first = edit('const x = <p>plain</p>;\n', {
    lineNumber: 1,
    oldText: 'plain',
    newText: 'Q & A',
  });
  assert.equal(first.after, 'const x = <p>Q &amp; A</p>;\n');
  // A second edit sees the decoded "Q & A" the browser would show.
  const second = edit(first.after, {
    lineNumber: 1,
    oldText: 'Q & A',
    newText: 'Q & A!',
  });
  assert.equal(second.result.ok, true, second.result.error);
  assert.equal(second.after, 'const x = <p>Q &amp; A!</p>;\n');
});

// --- Mixed children: the segmented protocol ----------------------------------

test('mixed children: rewrites text runs and preserves inline elements', () => {
  const { result, after } = edit(
    'const x = <p>Hello <strong>world</strong>!</p>;\n',
    {
      lineNumber: 1,
      segments: [
        { oldText: 'Hello ', newText: 'Howdy ' },
        { oldText: '!', newText: '?' },
      ],
    }
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(after, 'const x = <p>Howdy <strong>world</strong>?</p>;\n');
});

test('mixed children: only the changed run is touched', () => {
  const { result, after } = edit(
    'const x = <p>Keep <em>this</em> change me</p>;\n',
    {
      lineNumber: 1,
      segments: [
        { oldText: 'Keep ', newText: 'Keep ' },
        { oldText: ' change me', newText: ' changed' },
      ],
    }
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(after, 'const x = <p>Keep <em>this</em> changed</p>;\n');
});

test('mixed children: a run-count mismatch is refused, source untouched', () => {
  const src = 'const x = <p>Hi <b>x</b> there</p>;\n';
  const { result, after } = edit(src, {
    lineNumber: 1,
    segments: [{ oldText: 'Hi ', newText: 'Yo ' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Text structure changed/);
  assert.equal(after, src);
});

test('mixed children: entity-encoded runs match and re-encode on write', () => {
  const { result, after } = edit(
    'const x = <p>Tom &amp; <b>Jerry</b> &mdash; pals</p>;\n',
    {
      lineNumber: 1,
      segments: [
        { oldText: 'Tom & ', newText: 'A & ' },
        { oldText: ' — pals', newText: ' — friends & co' },
      ],
    }
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(
    after,
    'const x = <p>A &amp; <b>Jerry</b> — friends &amp; co</p>;\n'
  );
});

test('rejects an edit with no fileName', () => {
  const result = applyEdit({ oldText: 'a', newText: 'b' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing fileName');
});

// --- Corruption guard --------------------------------------------------------

test('parsesClean distinguishes valid from broken TSX', () => {
  assert.equal(parsesClean('/x.tsx', 'const x = <h1>ok</h1>;\n'), true);
  assert.equal(parsesClean('/x.tsx', 'const a = { b: <p>x { }</p> };\n'), true);
  assert.equal(parsesClean('/x.tsx', 'const x = <h1>oops'), false);
  assert.equal(parsesClean('/x.tsx', 'const x = <h1>a</h2>;'), false);
  assert.equal(parsesClean('/x.tsx', 'function (\n'), false);
});

test('a value with a double quote inlines as valid, re-parseable JSX (scope: one)', () => {
  // Regression: JSON.stringify would write href="a\"b" (invalid JSX). We now
  // encode as an entity so the result parses and round-trips.
  const src = "const G = 'x';\nconst L = () => <a href={G}>go</a>;\n";
  const { result, after } = edit(src, {
    lineNumber: 2,
    attrName: 'href',
    oldText: 'x',
    newText: 'a"b',
    bound: true,
    scope: 'one',
    fn: applyAttrEdit,
  });
  assert.equal(result.ok, true, result.error);
  assert.match(after, /href="a&quot;b"/);
  assert.equal(parsesClean('/x.tsx', after), true, 'output must be valid JSX');
});

// --- Long-tail formatting / nesting ------------------------------------------

test('deeply nested JSX: edits the target leaf, leaves the tree intact', () => {
  const src = [
    'export const V = () => (',
    '  <section>',
    '    <div>',
    '      <ul>',
    '        <li><span>Deep leaf</span></li>',
    '      </ul>',
    '    </div>',
    '  </section>',
    ');',
    '',
  ].join('\n');
  const { result, after } = edit(src, {
    lineNumber: 5,
    oldText: 'Deep leaf',
    newText: 'Deeper leaf',
  });
  assert.equal(result.ok, true, result.error);
  assert.match(after, /<li><span>Deeper leaf<\/span><\/li>/);
  assert.equal(parsesClean('/x.tsx', after), true);
  // Structure around the leaf is byte-preserved.
  assert.match(after, /<section>\n {4}<div>\n {6}<ul>/);
});

test('unusual indentation and a wrapped multi-line run are preserved', () => {
  const src = [
    'const X = (',
    '\t\t<p>',
    '\t\t\tThe quick brown',
    '\t\t\tfox jumps',
    '\t\t</p>',
    ');',
    '',
  ].join('\n');
  const { result, after } = edit(src, {
    lineNumber: 2,
    oldText: 'The quick brown fox jumps',
    newText: 'A lazy dog sleeps',
  });
  assert.equal(result.ok, true, result.error);
  assert.match(after, /A lazy dog sleeps/);
  assert.equal(parsesClean('/x.tsx', after), true);
  // Tabs on the surrounding lines are untouched.
  assert.match(after, /\n\t\t<p>/);
  assert.match(after, /\n\t\t<\/p>/);
});

test('sibling code and comments around the edit are untouched', () => {
  const src = [
    'const before = 1; // keep me',
    'const V = () => <h1>Title</h1>;',
    '/* trailing block comment */',
    'const after = 2;',
    '',
  ].join('\n');
  const { result, after } = edit(src, {
    lineNumber: 2,
    oldText: 'Title',
    newText: 'New Title',
  });
  assert.equal(result.ok, true, result.error);
  assert.match(after, /const before = 1; \/\/ keep me/);
  assert.match(after, /\/\* trailing block comment \*\//);
  assert.match(after, /const after = 2;/);
  assert.match(after, /<h1>New Title<\/h1>/);
});
