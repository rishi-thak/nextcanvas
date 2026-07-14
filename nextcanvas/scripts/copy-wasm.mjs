// Copies the freshly built SWC plugin .wasm into the package's shipped `swc/`
// folder. Run by `npm run build:wasm` after `cargo build`. Maintainer-only —
// consumers get the prebuilt artifact from the published package.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const src = resolve(
  pkgRoot,
  'swc-plugin/target/wasm32-wasip1/release/nextcanvas_swc.wasm'
);
const destDir = resolve(pkgRoot, 'swc');
const dest = resolve(destDir, 'nextcanvas_swc.wasm');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[nextcanvas] copied wasm -> ${dest}`);
