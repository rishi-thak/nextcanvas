/**
 * Tests for Tailwind-mode style edits.
 *
 * Two layers are covered:
 *
 *  1. `classControls` / `rewriteClassList` — the pure classification logic. The
 *     hard part is that Tailwind's `text-` prefix serves three properties
 *     (`text-center` align, `text-lg` size, `text-red-500` colour), so setting a
 *     colour must strip the old colour and leave the size and alignment alone.
 *     Getting this wrong leaves two competing classes whose winner is decided by
 *     Tailwind's generated stylesheet order, which looks like a random no-op.
 *
 *  2. `applyStyleEdit` end to end, against a temp project whose package.json
 *     declares `tailwindcss` so detection fires. The same call in a project
 *     without Tailwind must still write an inline style.
 *
 * Runs against the COMPILED output — `npm run build` first (the `test` script
 * does it for you).
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

const { applyStyleEdit } = require('../dist/server.js');
const {
  classControls,
  rewriteClassList,
  toClass,
  usesTailwind,
  resetTailwindCache,
} = require('../dist/tailwind.js');

/**
 * Build a throwaway project containing one component file. `tailwind` controls
 * whether package.json declares the dependency, which is what detection reads.
 */
function project(src, { tailwind = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-tw-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(tailwind ? { devDependencies: { tailwindcss: '^4.0.0' } } : {})
  );
  const fileName = path.join(dir, 'component.tsx');
  fs.writeFileSync(fileName, src);
  resetTailwindCache();
  return fileName;
}

function styleEdit(src, params, opts) {
  const fileName = project(src, opts);
  const result = applyStyleEdit({ fileName, ...params });
  return { result, after: fs.readFileSync(fileName, 'utf8') };
}

// --- classification: the text-* three-way collision --------------------------

test('text- utilities are classified by suffix, not prefix', () => {
  assert.equal(classControls('text-center', 'textAlign'), true);
  assert.equal(classControls('text-center', 'color'), false);
  assert.equal(classControls('text-center', 'fontSize'), false);

  assert.equal(classControls('text-lg', 'fontSize'), true);
  assert.equal(classControls('text-lg', 'color'), false);
  assert.equal(classControls('text-lg', 'textAlign'), false);

  assert.equal(classControls('text-red-500', 'color'), true);
  assert.equal(classControls('text-red-500', 'fontSize'), false);
  assert.equal(classControls('text-red-500', 'textAlign'), false);
});

test('arbitrary text- values are split by their content', () => {
  assert.equal(classControls('text-[#ff0000]', 'color'), true);
  assert.equal(classControls('text-[#ff0000]', 'fontSize'), false);

  assert.equal(classControls('text-[17px]', 'fontSize'), true);
  assert.equal(classControls('text-[17px]', 'color'), false);

  // Explicit Tailwind type hints win over the heuristic.
  assert.equal(classControls('text-[length:2rem]', 'fontSize'), true);
  assert.equal(classControls('text-[length:2rem]', 'color'), false);
  assert.equal(classControls('text-[color:var(--x)]', 'color'), true);
  assert.equal(classControls('text-[color:var(--x)]', 'fontSize'), false);
});

test('font- separates weight from family', () => {
  assert.equal(classControls('font-bold', 'fontWeight'), true);
  assert.equal(classControls('font-normal', 'fontWeight'), true);
  // A family must survive a weight change.
  assert.equal(classControls('font-sans', 'fontWeight'), false);
  assert.equal(classControls('font-mono', 'fontWeight'), false);
});

test('bg- keywords that are not colours are left alone', () => {
  assert.equal(classControls('bg-red-500', 'backgroundColor'), true);
  assert.equal(classControls('bg-[#eee]', 'backgroundColor'), true);
  assert.equal(classControls('bg-cover', 'backgroundColor'), false);
  assert.equal(classControls('bg-no-repeat', 'backgroundColor'), false);
  assert.equal(classControls('bg-gradient-to-r', 'backgroundColor'), false);
});

test('variant-prefixed classes never count as conflicts', () => {
  assert.equal(classControls('hover:text-red-500', 'color'), false);
  assert.equal(classControls('md:text-center', 'textAlign'), false);
  assert.equal(classControls('dark:bg-black', 'backgroundColor'), false);
});

test('padding covers per-side and logical utilities', () => {
  for (const t of ['p-4', 'px-2', 'py-3', 'pt-1', 'pb-8', 'pl-2', 'pr-2', 'ps-4', 'pe-4']) {
    assert.equal(classControls(t, 'padding'), true, t);
  }
  assert.equal(classControls('m-4', 'padding'), false);
});

// --- rewriteClassList -------------------------------------------------------

test('setting a colour keeps size and alignment', () => {
  const out = rewriteClassList('text-lg text-center text-red-500 font-bold', 'color', '#0000ff');
  assert.equal(out, 'text-lg text-center font-bold text-[#0000ff]');
});

test('enumerated properties use named utilities', () => {
  assert.equal(toClass('fontWeight', '700'), 'font-bold');
  assert.equal(toClass('textAlign', 'center'), 'text-center');
  assert.equal(toClass('color', '#fff'), 'text-[#fff]');
});

test('spaces in arbitrary values become underscores', () => {
  assert.equal(toClass('backgroundColor', 'rgb(1 2 3)'), 'bg-[rgb(1_2_3)]');
});

test('an empty value removes the controlling class and adds nothing', () => {
  assert.equal(rewriteClassList('text-lg text-red-500', 'color', ''), 'text-lg');
});

// --- end to end -------------------------------------------------------------

test('writes a Tailwind class when the project uses Tailwind', () => {
  const { result, after } = styleEdit('const x = <h1 className="text-lg">Hi</h1>;\n', {
    lineNumber: 1,
    property: 'color',
    value: '#ff0000',
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'class');
  assert.match(after, /className="text-lg text-\[#ff0000\]"/);
  assert.doesNotMatch(after, /style=/);
});

test('adds className when the element has none', () => {
  const { result, after } = styleEdit('const x = <h1>Hi</h1>;\n', {
    lineNumber: 1,
    property: 'textAlign',
    value: 'center',
  });
  assert.equal(result.ok, true);
  assert.match(after, /className="text-center"/);
});

test('replaces rather than stacks a conflicting class', () => {
  const { after } = styleEdit('const x = <h1 className="text-red-500">Hi</h1>;\n', {
    lineNumber: 1,
    property: 'color',
    value: '#00ff00',
  });
  assert.match(after, /className="text-\[#00ff00\]"/);
  assert.doesNotMatch(after, /text-red-500/);
});

test('an existing inline value for the same property is removed so the class applies', () => {
  const { result, after } = styleEdit(
    `const x = <h1 style={{ color: 'red', padding: '2px' }} className="a">Hi</h1>;\n`,
    { lineNumber: 1, property: 'color', value: '#123456' }
  );
  assert.equal(result.ok, true);
  assert.match(after, /text-\[#123456\]/);
  // color is gone from the inline object; the unrelated padding stays.
  assert.doesNotMatch(after, /color:/);
  assert.match(after, /padding: '2px'/);
});

test('removing the last class drops the className attribute', () => {
  const { after } = styleEdit('const x = <h1 className="text-red-500">Hi</h1>;\n', {
    lineNumber: 1,
    property: 'color',
    value: '',
  });
  assert.doesNotMatch(after, /className/);
});

test('refuses a dynamically-built className instead of guessing', () => {
  const { result, after } = styleEdit(
    `const x = <h1 className={cn('a', busy && 'b')}>Hi</h1>;\n`,
    { lineNumber: 1, property: 'color', value: '#fff' }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /dynamically/i);
  assert.match(after, /cn\('a', busy && 'b'\)/); // untouched
});

test('accepts a quoted expression and a substitution-free template', () => {
  const a = styleEdit(`const x = <h1 className={'text-lg'}>Hi</h1>;\n`, {
    lineNumber: 1,
    property: 'color',
    value: '#111',
  });
  assert.equal(a.result.ok, true);
  assert.match(a.after, /text-\[#111\]/);

  const b = styleEdit('const x = <h1 className={`text-lg`}>Hi</h1>;\n', {
    lineNumber: 1,
    property: 'color',
    value: '#222',
  });
  assert.equal(b.result.ok, true);
  assert.match(b.after, /text-\[#222\]/);
});

test('a hover variant survives a base-colour edit', () => {
  const { after } = styleEdit(
    'const x = <h1 className="text-black hover:text-blue-500">Hi</h1>;\n',
    { lineNumber: 1, property: 'color', value: '#ff0000' }
  );
  assert.match(after, /hover:text-blue-500/);
  assert.doesNotMatch(after, /text-black/);
});

// --- the non-Tailwind path must be unchanged --------------------------------

test('writes an inline style when the project does not use Tailwind', () => {
  const { result, after } = styleEdit(
    'const x = <h1>Hi</h1>;\n',
    { lineNumber: 1, property: 'color', value: '#ff0000' },
    { tailwind: false }
  );
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'inline');
  assert.match(after, /style=\{\{ color: '#ff0000' \}\}/);
  assert.doesNotMatch(after, /className/);
});

test('detection walks up to the nearest package.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-tw-nest-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: { tailwindcss: '^3.4.0' } })
  );
  const deep = path.join(dir, 'app', 'sections');
  fs.mkdirSync(deep, { recursive: true });
  const file = path.join(deep, 'hero.tsx');
  fs.writeFileSync(file, 'export const x = 1;\n');
  resetTailwindCache();
  assert.equal(usesTailwind(file), true);
});

test('a tailwind.config file alone is enough (v4 needs no dependency entry)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-tw-cfg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({}));
  fs.writeFileSync(path.join(dir, 'tailwind.config.ts'), 'export default {};\n');
  const file = path.join(dir, 'component.tsx');
  fs.writeFileSync(file, 'export const x = 1;\n');
  resetTailwindCache();
  assert.equal(usesTailwind(file), true);
});
