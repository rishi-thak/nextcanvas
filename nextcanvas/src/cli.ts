#!/usr/bin/env node
/**
 * nextcanvas CLI — `npx nextcanvas init`.
 *
 * One-time setup for a Next.js App Router project:
 *   1. mounts <NextCanvasOverlay/> in the root layout (the fiddly manual step),
 *   2. checks next.config is wrapped with withCanvas and prints the snippet if not,
 *   3. flags a legacy .babelrc (the SWC plugin replaces it — Babel is no longer used).
 *
 * The layout edit is idempotent; re-running is safe.
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

function checkConfig(): void {
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
  const code = fs.readFileSync(cfg, 'utf8');
  if (code.includes('withCanvas')) {
    log(`${rel} already wraps withCanvas — good.`);
  } else {
    warn(
      `${rel} is not wrapped with withCanvas. Wrap your exported config:\n` +
        snippet
    );
  }
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
  checkConfig();
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
