# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Version control rules (STRICT — read first)

- **NEVER create branches, pull requests, tags, or releases** unless the user
  explicitly instructs it in that message.
- **NEVER run `git add`, `git commit`, `git push`** (or any equivalent that
  stages/records/publishes changes) unless the user explicitly instructs it in
  that message.
- **NEVER suggest, offer, or ask to** commit, push, branch, open a PR, or
  otherwise do any of the above. Do not end responses with prompts like "want me
  to commit this?" Just leave the working tree changed and stop.
- Explicit instruction means the user names the action ("commit this", "push",
  "open a PR"). Past permission does **not** carry over to later turns — each
  action needs its own explicit instruction.

## What this is

`nextcanvas` is a drop-in dev tool that turns a locally-running **Next.js App
Router** app into an editable canvas: double-click static text in the browser,
type a new value, and the change is written back into the source file. Next.js
Fast Refresh then re-renders. Everything is dev-only and a no-op in production.

## Layout

- `nextcanvas/` — the publishable package (the actual product). **TypeScript**:
  source in `nextcanvas/src/*.ts`, compiled by `tsc` to CommonJS + `.d.ts` in
  `nextcanvas/dist/`. The published `exports`/`files` point at `dist/`. There
  **is** a build step (`npm run build`); nothing runs raw `.ts`.
- `nextcanvas/swc-plugin/` — the **Rust** SWC plugin crate (the source-mapping
  mechanism; replaces the old Babel plugin). Built to `wasm32-wasip1` and copied
  to `nextcanvas/swc/nextcanvas_swc.wasm`, which is the **prebuilt artifact
  shipped in the package** (`files` includes `swc/`). Consumers need no Rust.
- `demo/` — a throwaway **Next 16 / React 19** App Router app used only to test
  the package. App code is `.tsx`; `next.config.js` stays JS. **Not** part of the
  package's published `files`. It consumes the package via a `file:../nextcanvas`
  dependency (npm symlinks it), resolving to `nextcanvas/dist/` + `swc/`.
  `demo dev` runs `next dev --webpack` (see the bundler/OS matrix below for why).

## Commands

Run from `demo/`:

- `npm run dev` — start the demo on :3000. This also boots the write-back server
  on :3131 (via `withCanvas` in `demo/next.config.js`).
- After changing anything in `nextcanvas/src/`, **rebuild the TS**
  (`npm run build` inside `nextcanvas/`, or `npm install` there — `prepare`
  runs the build). The demo consumes `dist/`, not `src/`; unbuilt `.ts` changes
  are invisible to it.
- After changing the Rust plugin (`nextcanvas/swc-plugin/src/`), run
  `npm run build:wasm` inside `nextcanvas/` — this needs the **Rust toolchain**
  (`rustup`, `wasm32-wasip1` target); it runs `cargo build` and copies the
  `.wasm` into `swc/`. The TS `build` does **not** rebuild the wasm (it's a
  prebuilt, checked-in artifact).
- Then **fully restart** `next dev` and `rm -rf demo/.next` — the symlinked
  package and the compiler/entry pipeline do not reliably hot-reload.
- Kill stray servers before restart (Windows): stop the PID listening on ports
  3000 and 3131 (`Get-NetTCPConnection -LocalPort 3000,3131`).

Dependency setup gotcha: `file:` deps do **not** install the package's own
dependencies, and npm does **not** run the package's `prepare` build for a
`file:` consumer. After changing `nextcanvas/package.json` deps, run
`npm install` inside `nextcanvas/` (not just `demo/`) — that installs deps
(`ts-morph`, the TS toolchain) and builds `dist/`.

### Testing (browser round-trip)

There is no unit-test suite. Verification is done by driving a real browser with
Playwright, because the core behavior (fiber/DOM reads, contentEditable,
file write-back) only exists at runtime. Playwright is installed at the project
root. A test script must set `NODE_PATH` to the root `node_modules` since scripts
run from `$CLAUDE_JOB_DIR/tmp`:

```
NODE_PATH="<root>/node_modules" node <script>.js
```

Two useful checks:
- The compiled `dist/server.js` `applyEdit()` can be `require`d and called
  directly in Node for a deterministic test of the AST write-back (no browser
  needed). Build first.
- A Playwright script that loads :3000, double-clicks an element, types, presses
  Enter, and asserts the source file changed on disk is the real end-to-end test.

## Architecture (the big picture)

Data flow:

```
double-click text ─▶ overlay reads element's data-loc ─▶ POST :3131/edit
       ▲                                                        │
       │                                                        ▼
  Fast Refresh  ◀──  file rewritten  ◀──  ts-morph AST edit (formatting-safe)
```

Pieces:

- **`swc-plugin/src/lib.rs`** (Rust → `swc/nextcanvas_swc.wasm`) — the
  source-mapping mechanism. An **SWC plugin** that stamps
  `data-loc="<absFile>:<line>:<col>"` onto every **host** (lowercase) JSX element
  at compile time. Because it runs *inside* SWC, it works under both the webpack
  (next-swc) and Turbopack pipelines — unlike a Babel plugin, which opts Next out
  of SWC. Injected via `experimental.swcPlugins` by `withCanvas` (no `.babelrc`).
- **`src/overlay.ts`** — vanilla-DOM client (no React). Highlights text elements,
  makes them `contentEditable` on double-click, reads `data-loc` off the DOM, and
  POSTs `{fileName, lineNumber, oldText, newText}` to the server on commit.
- **`src/server.ts`** — dev-only HTTP server on :3131. `applyEdit()` uses
  `ts-morph` to do a formatting-preserving edit of the JSX text node, then
  `saveSync()`. Also serves the compiled `overlay.js` raw at `/overlay.js`.
- **`src/next.ts`** (`withCanvas`) — wraps the user's Next config; in dev it
  boots the server AND injects the SWC plugin into `experimental.swcPlugins`.
  **`src/index.ts`** exports `<NextCanvasOverlay/>`, which injects a
  `<script src=:3131/overlay.js>` tag on mount.
- **`src/cli.ts`** (`npx nextcanvas init`) — codemod that mounts
  `<NextCanvasOverlay/>` in the root layout, and checks the config/`.babelrc`.

Consuming-app wiring is now two one-time steps (see `nextcanvas/README.md`):
`withCanvas()` in `next.config.js` (which auto-injects the SWC plugin + boots the
server), then `npx nextcanvas init` to mount the overlay. No `.babelrc`.

## Non-obvious constraints (do not re-learn these the hard way)

- **`fiber._debugSource` is NOT available** in current Next App Router / React
  dev builds. Do not try to resolve source location from React internals — that
  is why source mapping uses the compile-time `data-loc` stamp.
- **The `swc_core` crate version is ABI-locked to the target Next runtime.**
  Pinned to `58.0.4` for **Next 16.2.x** (that's the swc_core current at Next
  16.2.0's release). Wasm plugins are backward-compatible from `swc_core >= 47`
  (@swc/core 1.15.0), so a plugin built against an *older* swc_core runs on
  *newer* runtimes — build older-or-equal, never newer. Symptom of a bad pin: a
  swc_core version-mismatch error at `next dev`/`build`. Verify a candidate with
  `plugins.swc.rs` or empirically (webpack build succeeds = ABI OK).
- **The wasm build needs `--allow-undefined`** (see `swc-plugin/build.rs`).
  `swc_plugin_proxy` declares its host functions (`__get_transform_context`,
  `__lookup_char_pos_source_map_proxy`, …) as plain `extern "C"` with no import-
  module attribute; current `wasm-ld` treats them as hard-undefined and fails the
  link unless told to emit them as imports. Also keep **LTO off** — cross-crate
  LTO drops those import attributes.
- **Turbopack + wasm swcPlugins path:** pass the wasm path with **forward
  slashes** (`withCanvas` normalizes it). Backslashes make Turbopack crash the
  app with a module-resolution error (upstream bug vercel/next.js#78156).
- **Turbopack on Windows silently does NOT run the wasm plugin** (upstream:
  "windows imports are not implemented yet", vercel/next.js#84972). The app
  renders but nothing is stamped → the overlay reports "no source info". Use
  **webpack** on Windows (`next dev --webpack`). Turbopack works on macOS/Linux.
- **Overlay must not be bundled.** It is served raw from the server and injected
  as a classic `<script>`; bundling would couple it to the app's toolchain.
- **The overlay defers init to `DOMContentLoaded`** — Next injects `main-app.js`
  as `async` in `<head>`, before `<body>` exists; touching `document.body` at load
  time throws and silently aborts the whole overlay.
- **Parse `data-loc` from the right** (`lastIndexOf(':')`) so Windows drive
  letters (`C:\...`) don't corrupt the split.
- **Port is single-sourced via `NEXTCANVAS_PORT`.** `src/server.ts` derives
  `PORT` from it; `withCanvas` inlines that same value into the client (`env`),
  and `<NextCanvasOverlay/>` publishes it as `window.__NEXTCANVAS_SERVER__` so the
  raw overlay script POSTs to the right place. Set only the one env var to
  change it.
- **`overlay.ts` must stay module-free** (no `import`/`export`). It is served
  raw and run as a classic browser `<script>`, where `exports`/`require` don't
  exist. tsconfig sets `"moduleDetection": "legacy"` so a file with no
  import/export compiles to a plain script (no `exports.__esModule` marker that
  would throw a `ReferenceError` in the browser). Shared browser globals live in
  `src/globals.d.ts`, not in an `import`.
- **`'use client'` must stay the first line of `src/index.ts`.** tsc preserves
  the directive prologue, so `dist/index.js` keeps `'use client'` ahead of the
  emitted `require`s — which is what marks `<NextCanvasOverlay/>` a client component.

## Bundler / OS support matrix

The stamp is an SWC plugin, so it's no longer webpack-only. Verified status:

| Bundler   | Windows                     | macOS / Linux            |
|-----------|-----------------------------|--------------------------|
| webpack   | ✅ works (verified)          | ✅ expected               |
| Turbopack | ❌ silent no-op (upstream)   | ✅ expected (unverified)  |

Only webpack-on-Windows is verified in this repo (the dev machine is Windows).
Turbopack-on-Windows is blocked upstream; the rest are expected to work because
only the bundler/OS differs — same wasm, same config.

## TODO — pick up here (Turbopack support)

**Problem:** nextcanvas does **not work under Turbopack** (`next dev --turbo`, and
`next dev` defaults to Turbopack in Next 16). Editing/overlay effectively don't
function. Everything works under **webpack** (`next dev --webpack`), which is why
`demo`'s `dev` script forces `--webpack`.

**What's known:**
- The `data-loc` SWC plugin (`swc/nextcanvas_swc.wasm`, injected via
  `experimental.swcPlugins`) is not executed by Turbopack on Windows — upstream
  gap: "windows imports are not implemented yet"
  (vercel/next.js#84972, #78156). No stamps ⇒ no source resolution ⇒ no editing.
- `withCanvas` already normalizes the wasm path to forward slashes so Turbopack
  at least doesn't hard-crash the app (it 200s, but the plugin silently no-ops).

**To investigate / do next:**
1. Reproduce on a non-Windows machine: does the wasm swcPlugin run under
   Turbopack on macOS/Linux? If yes, the failure is Windows-specific only.
2. Determine whether the **overlay/toolbar** loads under Turbopack independent of
   stamping (it's served from `:3131/overlay.js` and injected by
   `<NextCanvasOverlay/>`, so it *should* appear even with no stamps — confirm
   with `curl :3131/overlay.js | grep -c nc-root` and a browser).
3. Options if Turbopack wasm stays broken: (a) wait on upstream; (b) detect
   Turbopack and print a clear "use --webpack" warning from `withCanvas`;
   (c) explore a Turbopack-compatible source stamp (e.g. a Next-supported
   transform, or reading the dev JSX runtime's `__source` if/when available).
4. Update the bundler/OS matrix above once verified on other machines.

**Reminder for the other machine:** `dist/` and `swc-plugin/target/` are
gitignored. After pulling, run `npm install` (or `npm run build`) inside
`nextcanvas/` to rebuild `dist/` before the demo will pick up source changes,
then fully restart `next dev` (`rm -rf demo/.next`, kill any stray :3131 server).

## Current scope

Static JSX text only (`<h1>Hello</h1>`). Bound values (`<h1>{title}</h1>`) and
mixed-children elements are rejected. Repeated components sharing one source line
(via `.map`) edit the shared source, affecting all instances.
