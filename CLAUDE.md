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

## Communication rules (STRICT)

- **NEVER mention Babel** — its exclusion, removal, non-use, or non-existence — in
  any user-facing output (docs, README, code comments, commit messages, PR text,
  responses). Do not write phrases like "no Babel", "no `.babelrc`", "replaces the
  old Babel plugin", or "instead of Babel". Describe the source-mapping mechanism
  purely in terms of what it *is* (an SWC plugin), never in contrast to Babel.

## Maintaining this file (STRICT — do it unprompted)

- **Keep CLAUDE.md current as you work — without being asked.** When you learn
  something durable about this repo (a new constraint, a non-obvious gotcha, a
  changed workflow, a resolved TODO, a standing user preference, a rule the user
  states), **update the relevant section of CLAUDE.md in the same turn**, as part
  of the work. Do not wait for the user to say "add this to CLAUDE.md" — that they
  had to ask means the rule was already missed.
- This is editing a tracked file, **not** a version-control action — it is always
  allowed and never needs the explicit-instruction gate above. (Committing it
  still does; leave the edit in the working tree per the version-control rules.)
- Prefer editing the fitting existing section over appending a new one; keep the
  house style (terse, imperative, "do not re-learn this the hard way"). Fold new
  facts in rather than duplicating; delete guidance that a change makes wrong.
- When the user gives feedback or a preference that generalizes beyond the
  immediate task, capture it here (or in memory if it's cross-project) so it
  survives the session.

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

### Releasing (publish to npm)

Publishing is automated by `.github/workflows/npm-publish.yml`, which fires on
`release: [published]` — i.e. **only when a GitHub Release is published**, not on
ordinary pushes. The workflow runs `npm ci` + `npm publish` inside `nextcanvas/`
(`access: public` comes from `package.json` `publishConfig`; `prepublishOnly`
rebuilds `dist/`; the wasm is checked in, so CI needs no Rust). Auth uses the
`NPM_TOKEN` repo secret (Settings → Secrets and variables → Actions).

To cut a release (run from the repo root; **only when explicitly asked** — see the
version-control rules at the top of this file):

1. Bump the version in `nextcanvas/package.json` (npm rejects a duplicate version):
   `cd nextcanvas && npm version patch --no-git-tag-version` (or `minor`/`major`).
2. Commit the bump and push to `main`.
3. Create + publish the GitHub Release, which triggers the publish workflow:
   `gh release create v0.0.5 --title v0.0.5 --generate-notes`
   (tag must match the new version; `gh release create` publishes immediately —
   add `--draft` to stage it and publish later from the Releases page).

Verify the run under the repo's **Actions** tab, then confirm on npm:
`npm view @rishi-thak/nextcanvas version`.

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
- **The wasm swcPlugin MUST be a package specifier, not an absolute path.**
  `withCanvas` passes `"@rishi-thak/nextcanvas/swc/nextcanvas_swc.wasm"` (a
  resolvable specifier) to `experimental.swcPlugins` — NOT `path.resolve(...)`.
  **Turbopack cannot load a `.wasm` swcPlugin given as an absolute filesystem
  path**: it 500s with `Module not found: Can't resolve '…/nextcanvas_swc.wasm'`
  even though the file exists, and stamps nothing. webpack/next-swc accepts the
  specifier too, so one form works under both bundlers (verified end-to-end,
  macOS, Next 16.2.10). This is why the package `exports` map **must** expose
  `"./swc/*": "./swc/*"` — without it the specifier fails to resolve with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. (History: `withCanvas` used to pass the
  absolute path with forward slashes to dodge an old Turbopack backslash crash,
  vercel/next.js#78156; the specifier form supersedes that entirely.)
- **Turbopack stamps are project-RELATIVE; webpack stamps are ABSOLUTE.** Same
  plugin, different bundler path handling: Turbopack emits `data-loc="app/page.tsx:L:C"`,
  webpack emits `data-loc="/abs/app/page.tsx:L:C"`. Both round-trip correctly
  because the write-back server resolves the relative path against its cwd (the
  project root under `next dev`) via ts-morph `addSourceFileAtPath`.
- **Turbopack on Windows is still unverified / likely blocked.** Separate from
  the absolute-path issue above, there's an upstream gap "windows imports are
  not implemented yet" (vercel/next.js#84972) about wasm host-function imports
  at *execution* time — the specifier fix does not address that. On Windows,
  prefer **webpack** (`next dev --webpack`) until Turbopack-on-Windows is
  verified. Turbopack on macOS/Linux works with the fix (macOS verified).
- **Overlay must not be bundled.** It is served raw from the server and injected
  as a classic `<script>`; bundling would couple it to the app's toolchain.
- **The overlay defers init to `DOMContentLoaded`** — Next injects `main-app.js`
  as `async` in `<head>`, before `<body>` exists; touching `document.body` at load
  time throws and silently aborts the whole overlay.
- **The "Buttons" toolbar toggle gates all page interactivity.** OFF (the
  default, "edit mode") makes the page inert: the document-level capture click
  handler `preventDefault()`s **and** `stopPropagation()`s every non-UI click, so
  links don't navigate, in-page anchors don't scroll, and the app's own `onClick`
  handlers don't fire — this is what lets you single-click to select for styling
  and double-click to edit without a stamped `<a href="#anchor">` scrolling the
  element out from under you. ON ("live mode") makes the overlay passive for
  clicks (early `return` before `preventDefault`), so the app behaves normally and
  single-click does **not** select. Persisted as `nextcanvas:buttons` (`on`/`off`)
  in localStorage; toggling ON also drops any current style selection. Hover
  outlines, the attr chip, and double-click editing stay available in both modes.
  This is a **different** control from the master on/off switch (`enabled`,
  `.nc-switch`, `data-act="toggle"`, below): the master switch turns the *whole
  tool* off, the Buttons toggle only gates the *page's* interactivity while
  editing stays on. To avoid colliding with the master switch's `.nc-switch`
  styles, the Buttons control is its own toggle-switch markup namespaced
  `.nc-btnsw-*` (`data-act="buttons"`, state `buttonsEnabled`, `setButtons`).
- **Editable attributes come in two flavors, stamped separately.** The plugin
  emits `data-nc-attrs` for string-literal attrs (`href="/x"`) and `data-nc-bound`
  for bound *simple-identifier* attrs (`href={GITHUB}`). Both raise the attr chip;
  the panel tags bound rows with a `var` badge. A literal edit rewrites in place.
  Committing a **bound** edit prompts (a bar inside the panel) for scope: **all
  references** rewrites the variable's declaration (`const GITHUB = '…'`, via
  ts-morph `sourceFile.getVariableDeclaration`), affecting every element that uses
  it; **just this one** leaves the variable alone and inlines a literal on this
  element (`href={GITHUB}` → `href="new"`, via `JsxAttribute.setInitializer`). The
  choice rides the `AttrChange`/`StagedEdit` so it survives manual-mode Save. Only
  bare identifiers are offered — `href={cfg.url}` / `href={fn()}` aren't stamped
  (the server can't resolve them to one string decl); an identifier imported from
  another module fails "all" with a hint to use "just this one". **Undo of a
  "just this one" edit is best-effort:** it's a one-way bound→literal transform
  (the identifier is gone from source), so reversing it can't restore `{GITHUB}`
  and may just error-toast — the forward edit is the supported path.
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

| Bundler   | Windows                     | macOS / Linux                 |
|-----------|-----------------------------|-------------------------------|
| webpack   | ✅ works (verified)          | ✅ works (verified, macOS)     |
| Turbopack | ❓ unverified (see #84972)   | ✅ works (verified, macOS)     |

macOS webpack **and** Turbopack are now verified end-to-end (full edit
round-trip) after the specifier fix — see the swcPlugin-specifier constraint
above. webpack-on-Windows was verified previously (the original dev machine is
Windows). Turbopack-on-Windows remains unverified and may still be blocked by
the separate wasm-imports gap (vercel/next.js#84972), independent of the
specifier fix. Linux is expected to match macOS (same wasm, same config).

## Turbopack support — RESOLVED on macOS (was the standing TODO)

**Root cause (found on macOS, Next 16.2.10):** `withCanvas` passed the wasm to
`experimental.swcPlugins` as an **absolute filesystem path**. Turbopack cannot
load a `.wasm` swcPlugin by absolute path — it 500s with `Module not found`
(*not* the silent no-op previously assumed), so the app didn't even render and
nothing was stamped. webpack/next-swc loaded the same absolute path fine, which
is why only webpack worked.

**Fix (shipped in this repo):**
1. `src/next.ts` → `pluginSpecifier()` passes the **package specifier**
   `"@rishi-thak/nextcanvas/swc/nextcanvas_swc.wasm"` (derived from the package
   name in `package.json`) instead of `path.resolve(...)`.
2. `package.json` `exports` gained `"./swc/*": "./swc/*"` so that specifier
   resolves (else `ERR_PACKAGE_PATH_NOT_EXPORTED`).

One unified config now works under **both** bundlers — no bundler detection.
Verified end-to-end on macOS (overlay loads, `data-loc` stamped, double-click →
edit → Enter → source file rewritten on disk) under webpack **and** Turbopack,
using the stock demo `next.config.js`.

**Still open:**
- **Turbopack-on-Windows** is unverified and may still fail for a *different*
  upstream reason (wasm host-imports gap, vercel/next.js#84972). Keep `--webpack`
  on Windows until verified.
- **The demo still forces `--webpack`** (`demo/package.json` `dev` script) and
  currently installs the **published** `@rishi-thak/nextcanvas` (not `file:`),
  which predates this fix. To exercise Turbopack against the fixed package,
  point the demo at `file:../nextcanvas` (rebuild `dist/` first) or publish a new
  version, then flip `dev` to `next dev` / `--turbo`.

**Rebuild reminder:** `dist/` and `swc-plugin/target/` are gitignored. After
pulling, run `npm install` (or `npm run build`) inside `nextcanvas/` to rebuild
`dist/` before a `file:` consumer picks up source changes, then fully restart
`next dev` (`rm -rf <app>/.next`, kill any stray :3131 server).

## Current scope

Three edit kinds, all dev-only and written back through the :3131 server.

**Text editing.** Static JSX text (`<h1>Hello</h1>`) **and** text mixed with
inline child elements (`<p>Hello <strong>world</strong>!</p>`), where the
surrounding text runs are editable and the inline elements are locked +
preserved. Bound values (`<h1>{title}</h1>`) — any element with a direct
`{expression}` child — are left unstamped and not editable. Repeated components
sharing one source line (via `.map`) edit the shared source, affecting all
instances.

**Attribute editing.** Whitelisted JSX attributes (`src`, `href`, `alt`,
`title`, `placeholder`, `aria-label`) via a hover chip + attribute panel, in two
flavors the plugin stamps separately: `data-nc-attrs` for string literals
(`href="/x"`) and `data-nc-bound` for bound *simple-identifier* values
(`href={GITHUB}`). Literal edits rewrite in place (`applyAttrEdit`,
`setLiteralValue` preserves quoting). Bound edits prompt for scope — **all
references** rewrites the variable's `const` declaration; **just this one**
inlines a literal on that element only (`applyBoundAttrEdit`, `POST /edit` with
`attrName` + `bound` + `scope`). Bare identifiers only; member/call expressions
aren't offered. Both look identical in the DOM, so the split stamping is what
lets the overlay treat them correctly.

**Style editing.** Single-click selects any stamped element and opens the style
panel (color / background / font-size / font-weight / text-align / padding),
which rewrites the element's inline `style={{...}}` via `applyStyleEdit` in
`src/server.ts` (`POST /style`). Inline style only — no Tailwind/className
rewriting yet (the `applyStyleEdit` locate-then-set/remove contract is the seam a
Tailwind-class layer would plug into). Only a literal `style={{...}}` object is
editable; `style={someVar}` is rejected.

### Overlay lifecycle (unified Change model)

All three kinds ride one discriminated `Change` union in `src/overlay.ts`
(`kind: 'text' | 'attr' | 'style'`) and a shared undo/redo stack. Text and attr
edits share the autosave/manual-staging lifecycle (typed `EditChange`); style
edits always write immediately (see the TODO below). The `staged` map is
string-keyed by loc(+attr) so one element can stage its text AND several
attributes independently — `StagedEdit` carries `kind`, `attr?`, `oldRuns`
(text runs, or the single attr value in `oldRuns[0]`), and `mixed`. Kind-aware
helpers (`writeForward`/`writeReverse`, `applyChangeDom`, `keyFor`,
`stageChange`) branch on `kind`; `applyChange(change, to)` drives undo/redo.
**The attribute panel is namespaced `nc-attr-*` / `attrPanel`** to avoid
colliding with the style panel's `nc-*` / `panel` (both features independently
added a `.nc-panel` + `const panel`; keep them distinct).

**Master on/off switch (`enabled`).** A toggle switch in the toolbar (`.nc-switch`,
`data-act="toggle"`) gates the whole tool. `enabled` is persisted in
`localStorage` under `nextcanvas:enabled` (defaults on; only `'0'` is off). When
off, every interaction handler (`mousemove`/`click`/`dblclick` and the undo/redo
keydown) early-returns, so the page behaves like a plain dev server, and the
toolbar collapses — `refreshUI` hides `.nc-modes`, `.nc-actions`, the separator,
and the hide button, leaving just the brand + switch. `setEnabled(false)` also
tears down any live editing UI (outline, chip, style/attr panels, selection).
This is separate from `hidden` (collapse-to-FAB) and `dismissed` (✕ hides the
whole root until reload; also forces Buttons on so the page is interactive).

### Mixed-children edits (the segmented protocol)

The plugin stamps any host element with ≥1 non-whitespace `JSXText` direct child
and no direct `{expression}`/spread child (`has_editable_text` in `lib.rs`) — this
generalizes the old single-text rule (a strict subset). For a mixed element the
overlay sends a `segments` array (one `{oldText,newText}` per non-whitespace text
run, in source/DOM order) instead of the legacy `{oldText,newText}` pair; the
server (`applyEdit` in `server.ts`) positionally zips those runs against the
element's non-whitespace `JSXText` children and rewrites only the changed ones.
Non-obvious constraints learned building this — **do not re-learn the hard way**:

- **Server must use `getFullText()`/`getFullStart()` for the run nodes**, not
  `getText()`/`getStart()`: a `JSXText` node's leading whitespace is *trivia* to
  the trimmed getters, so those clip the run's leading boundary space and produce
  a double space (`Howdy  <strong>`). Match, span, and replace on the FULL text.
- **The browser already sends each run's full boundary spacing**, so the server
  writes segment `newText` **verbatim** (no `rewrap`). `rewrap` is only for the
  legacy single-text path.
- **Overlay locks inline children** (`contentEditable=false` + `data-nc-locked`)
  on dblclick so the caret can't enter them; `unlockChildren` undoes it on blur.
- **Structure must stay intact during a mixed edit.** On commit the overlay
  checks the inline child elements are the same nodes in the same order and the
  run count is unchanged; deleting an inline element or emptying a whole run is
  rejected and the element is reverted from an `innerHTML` snapshot.
- **`el.normalize()` before reading runs** so browser-split text nodes collapse to
  one node per run, keeping the run count stable/aligned with the source.

Legacy single-text payloads still work unchanged (overlay sends `oldText/newText`
when the element has no child elements; server falls through to the old path).

### TODO — wire style edits into Manual-mode staging

Style edits currently **always autosave** (write to source on every control
change), regardless of the Autosave/Manual toolbar mode — they do ride the shared
undo/redo stack, but they bypass the `staged` map that Manual mode uses to batch
text and attribute edits behind the Save button. So in Manual mode, text/attr
changes stage while style changes still write immediately, which is inconsistent.

To fix: extend the Manual-mode staging path (`staged` in `src/overlay.ts`, plus
`save()`) to also hold pending style changes so a `<h1>` re-color waits for Save
just like a text edit. Sketch:
- Add a `'style'` variant to `StagedEdit` (per element+property) — the `staged`
  map is already string-keyed via `stageKey`, so extend `stageKey`/`keyFor` to
  key style edits by `property` the way attr edits key by `attr`, and carry the
  before/after style value.
- `commitStyle` should branch on `mode` like `commit` does: autosave → write
  now; manual → stage + toast "Staged", and count toward `stagedDirtyCount()` /
  the Save badge (`stagedIsDirty` would need a style branch).
- `save()` must flush staged style changes through `writeStyle` (currently it
  only iterates text/attr edits), and `setMode('autosave')` must flush them too.
- `applyChange`'s style branch (undo/redo) already writes immediately; once
  staged, undo of an unsaved style change should just un-stage instead.
