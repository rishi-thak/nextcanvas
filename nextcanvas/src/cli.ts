#!/usr/bin/env node
/**
 * nextcanvas CLI — `npx nextcanvas init`.
 *
 * One-time setup for a Next.js App Router project:
 *   1. mounts <NextCanvasOverlay/> in the root layout,
 *   2. wraps your next.config's exported config with withCanvas,
 *   3. flags a legacy .babelrc (the SWC plugin replaces it — Babel is no longer used).
 *
 * Both edits are idempotent; re-running is safe.
 */

import fs from 'fs';
import path from 'path';

const cwd = process.cwd();

function log(msg: string): void {
  console.log(`[nextcanvas] ${msg}`);
}
function warn(msg: string): void {
  console.warn(`[nextcanvas] ! ${msg}`);
}

function firstExisting(rels: string[]): string | null {
  for (const rel of rels) {
    const p = path.join(cwd, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const OVERLAY_SNIPPET =
  "{process.env.NODE_ENV === 'development' && <NextCanvasOverlay />}";

function patchLayout(): void {
  const layout = firstExisting([
    'app/layout.tsx',
    'app/layout.jsx',
    'app/layout.js',
    'src/app/layout.tsx',
    'src/app/layout.jsx',
    'src/app/layout.js',
  ]);
  const rel = layout && path.relative(cwd, layout);

  if (!layout) {
    warn(
      'No app/layout.{tsx,jsx,js} found. Add <NextCanvasOverlay/> to your root layout manually:\n' +
        `      import { NextCanvasOverlay } from '@rishi-thak/nextcanvas';\n` +
        `      ...\n      ${OVERLAY_SNIPPET}`
    );
    return;
  }

  let code = fs.readFileSync(layout, 'utf8');

  if (code.includes('NextCanvasOverlay')) {
    log(`overlay already mounted in ${rel} — nothing to do.`);
    return;
  }

  // Add the import just after the last existing import statement.
  const importLine = "import { NextCanvasOverlay } from '@rishi-thak/nextcanvas';";
  const importRe = /^import[^\n]*$/gm;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code)) !== null) lastEnd = m.index + m[0].length;
  code =
    lastEnd >= 0
      ? code.slice(0, lastEnd) + '\n' + importLine + code.slice(lastEnd)
      : importLine + '\n' + code;

  // Mount the overlay just before </body>.
  if (code.includes('</body>')) {
    code = code.replace('</body>', `  ${OVERLAY_SNIPPET}\n      </body>`);
    fs.writeFileSync(layout, code);
    log(`mounted <NextCanvasOverlay/> in ${rel}`);
  } else {
    fs.writeFileSync(layout, code); // keep the import we added
    warn(
      `Added the import to ${rel} but found no </body> to anchor to. ` +
        `Render this inside your layout manually:\n      ${OVERLAY_SNIPPET}`
    );
  }
}

/**
 * Find the end index of the JS/TS expression starting at `start`, tracking
 * bracket depth and skipping strings/comments. Stops at the first top-level `;`
 * or EOF. Handles identifiers, object literals, and call expressions.
 */
function scanExpressionEnd(code: string, start: number): number {
  let depth = 0;
  let i = start;
  let quote: string | null = null;
  for (; i < code.length; i++) {
    const c = code[i];
    const next = code[i + 1];
    if (quote) {
      if (c === '\\') i++; // skip escaped char
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if (c === '/' && next === '/') {
      const nl = code.indexOf('\n', i);
      i = nl === -1 ? code.length : nl;
    } else if (c === '/' && next === '*') {
      const close = code.indexOf('*/', i + 2);
      i = close === -1 ? code.length : close + 1;
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth--;
    } else if (c === ';' && depth === 0) {
      break;
    }
  }
  let end = i;
  while (end > start && /\s/.test(code[end - 1])) end--;
  return end;
}

/** Locate the exported config expression (CJS `module.exports =` or ESM `export default`). */
function findExport(
  code: string
): { start: number; end: number; kind: 'cjs' | 'esm' } | null {
  let kind: 'cjs' | 'esm' = 'cjs';
  let m = /module\.exports\s*=\s*/.exec(code);
  if (!m) {
    kind = 'esm';
    m = /export\s+default\s+/.exec(code);
  }
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = scanExpressionEnd(code, start);
  return end > start ? { start, end, kind } : null;
}

function patchConfig(): void {
  const cfg = firstExisting([
    'next.config.ts',
    'next.config.mjs',
    'next.config.js',
    'next.config.cjs',
  ]);
  const snippet =
    "  const { withCanvas } = require('@rishi-thak/nextcanvas/next');\n" +
    '  module.exports = withCanvas(nextConfig);';

  if (!cfg) {
    warn(
      'No next.config found. Create one that wraps your config with withCanvas:\n' +
        snippet
    );
    return;
  }
  const rel = path.relative(cwd, cfg);
  let code = fs.readFileSync(cfg, 'utf8');

  if (code.includes('withCanvas')) {
    log(`${rel} already wraps withCanvas — nothing to do.`);
    return;
  }

  const found = findExport(code);
  if (!found) {
    warn(
      `Could not locate an exported config in ${rel}. Wrap it manually:\n` +
        snippet
    );
    return;
  }

  const expr = code.slice(found.start, found.end);
  if (found.kind === 'cjs') {
    // Inline require needs no extra import line.
    const wrapped = `require('@rishi-thak/nextcanvas/next').withCanvas(${expr})`;
    code = code.slice(0, found.start) + wrapped + code.slice(found.end);
  } else {
    code =
      code.slice(0, found.start) + `withCanvas(${expr})` + code.slice(found.end);
    // ESM: add the import after the last existing import (or at the top).
    const importLine = "import { withCanvas } from '@rishi-thak/nextcanvas/next';";
    const importRe = /^import[^\n]*$/gm;
    let lastEnd = -1;
    let im: RegExpExecArray | null;
    while ((im = importRe.exec(code)) !== null) lastEnd = im.index + im[0].length;
    code =
      lastEnd >= 0
        ? code.slice(0, lastEnd) + '\n' + importLine + code.slice(lastEnd)
        : importLine + '\n' + code;
  }

  fs.writeFileSync(cfg, code);
  log(`wrapped the exported config in ${rel} with withCanvas`);
}

function checkBabel(): void {
  const babelrc = firstExisting(['.babelrc', '.babelrc.json', 'babel.config.js']);
  if (!babelrc) return;
  const code = fs.readFileSync(babelrc, 'utf8');
  if (code.includes('@rishi-thak/nextcanvas/babel')) {
    warn(
      `${path.relative(cwd, babelrc)} references the old "@rishi-thak/nextcanvas/babel" plugin. ` +
        'nextcanvas now uses an SWC plugin (works with webpack AND Turbopack), so ' +
        'remove that entry — and the .babelrc entirely if nothing else needs it.'
    );
  }
}

function init(): void {
  log('setting up nextcanvas…');
  patchLayout();
  patchConfig();
  checkBabel();
  log('done. Run `next dev`, open the app, and double-click any static text.');
}

const command = process.argv[2];
if (command === 'init') {
  init();
} else {
  console.log('nextcanvas — usage:\n  npx nextcanvas init');
  process.exit(command ? 1 : 0);
}
