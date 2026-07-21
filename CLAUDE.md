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

## Landing page voice (STRICT)

- **The landing page (`demo/app/page.tsx`) is written in all lowercase.** Nav
  links, headings, body copy, buttons, card titles, and the footer — including
  proper nouns and acronyms (`next.js`, `github`, `swc`, `ast`, `mit`). Keep new
  copy in that voice; do not "fix" it back to sentence case.
- **Exceptions that stay literal:** anything inside a `CodeWindow` (commands,
  config, output) and code identifiers in prose (`withCanvas`,
  `NextCanvasOverlay`, `next.config.ts`, `data-loc`, `.tsx`, `next/font`).
- **`demo/app/docs/*` is NOT lowercase** — docs stay in normal sentence case.
  The shared `ThemeToggle` uses lowercase labels, matching the landing page.
- Page `metadata` (title/description/OG) stays in normal case — it's for search
  and social cards, not page copy.

## Agent-facing setup surface (keep in sync)

The landing page ships a **copy-prompt control** (`demo/app/InstallPill.tsx`,
tabs: agent / skill / npm) and the site serves **`/skill.md`**
(`demo/app/skill.md/route.ts`) — a doc-only skill file with YAML frontmatter that
an agent can be pointed at to install nextcanvas.

- **All copy payloads live in `demo/app/agent-setup.ts`** — install command,
  agent prompt, skill prompt, tab hints. Add nothing inline in the component;
  the point is that the three tabs and `/skill.md` cannot drift apart.
- The skill's `version` is read from the **installed package's** `package.json`,
  so it tracks the published version automatically. Don't hardcode it.
- URLs come from `SITE_URL`, so they follow `NEXT_PUBLIC_SITE_URL`.
- **When package capabilities change, update `skill.md`'s "What you can edit"
  table and gotchas** alongside `demo/app/docs/` — an agent reading a stale
  skill file will wire up something wrong.
- `/skill.md` is served as `text/plain` so it renders in a browser rather than
  downloading, and is `force-static`.

## Maintaining docs (STRICT — do it unprompted)

- **When you add or change a user-facing feature, update `demo/app/docs/` in the
  same turn** — how-to pages (`text`, `bound-text`, `attributes`, `styles`,
  `toolbar`), the reference table (`what-works`), and Welcome if the feature is
  a top-level capability. Do not wait to be asked.
- Write for **operators using the overlay**, not for package internals (no SWC /
  ts-morph / stamp implementation detail unless it changes what they can click).
- Keep pages consistent: if a shape becomes editable, remove it from “won’t edit”
  lists; if a shape is newly blocked, add it. Stale docs are a bug.
- Docs live under the demo app (`/docs`); editing them is not a version-control
  action — same gate as CLAUDE.md (commit only when explicitly asked).

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
  the package (and host the public landing + `/docs` how-to). App code is
  `.tsx`; `next.config.js` stays JS. **Not** part of the package's published
  `files`. It consumes the **published** `@rishi-thak/nextcanvas` from npm, so it
  builds standalone on Vercel (root = `demo/`) — see "Deploying the demo".
  To exercise *local* package changes, temporarily swap that dep to
  `file:../nextcanvas` (npm symlinks it, resolving to `nextcanvas/dist/` + `swc/`)
  and rebuild `dist/` first — but don't commit the swap; it breaks the deploy.
  `demo dev` runs `next dev --webpack` (see the bundler/OS matrix below for why).
  Docs live at `demo/app/docs/*` — user-facing how-to (not package internals).

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
dependencies. npm (11.x) **does** attempt the package's `prepare` build for a
`file:` consumer, but it **fails** — `prepare` runs `tsc`, and `tsc` isn't on
PATH because the package's own devDependencies were never installed. Verified on
a fresh clone: `npm install` inside `demo/` dies with `code 127 / sh: tsc: not
found`. So after changing `nextcanvas/package.json` deps, run `npm install`
inside `nextcanvas/` (not just `demo/`) — that installs deps (`ts-morph`, the TS
toolchain) and builds `dist/`.

### Deploying the demo (Vercel)

`nextcanvas/dist/` is gitignored, so a **fresh clone cannot build `demo/` while
it depends on `file:../nextcanvas`** — the install fails as described above,
before `next build` ever runs. This bites any CI/host that starts from a clean
checkout.

So the demo depends on the **published** package (`"@rishi-thak/nextcanvas":
"^0.1.0"`), not `file:../nextcanvas`. With Vercel **root directory = `demo/`** it
then builds standalone — no parent directory, no "Include files outside the Root
Directory" toggle, no package prebuild step. Verified end-to-end on a fresh clone.

**Consequence:** a package change is only visible to the deployed demo after it's
**published to npm** and the dep range picks it up. Bump + release the package
first, then redeploy.

SEO/social assets live in `demo/app/`: `site.ts` (single source for the origin —
`NEXT_PUBLIC_SITE_URL`, else `VERCEL_PROJECT_PRODUCTION_URL`, else localhost),
`icon.svg`, `opengraph-image.tsx`, `sitemap.ts`, `robots.ts`. Two gotchas, both
hit for real:
- **Sitemap `<loc>` must be absolute.** Next does *not* resolve sitemap URLs
  against `metadataBase`; build them with `new URL(route, SITE_URL)`.
- **`opengraph-image.tsx` runs through satori**, which is stricter than the DOM:
  every element with >1 child needs an explicit `display`, and any non-ASCII glyph
  (e.g. the `◆` brand mark) triggers a dynamic font fetch that **fails the build**
  (`Failed to download dynamic font. Status: 400`). Draw shapes with CSS (the
  diamond is a rotated square), keep text ASCII.

Tradeoff: on the published dep, local `demo` dev no longer exercises local
`nextcanvas/src/` changes. To test package changes locally, temporarily swap the
dep back to `file:../nextcanvas` (rebuild `dist/` first) — just don't commit that
swap if the demo is what Vercel deploys.

Deploying is safe regardless: `withCanvas` early-returns unless
`NODE_ENV === 'development'`, and `app/layout.tsx` gates `<NextCanvasOverlay/>`
the same way, so a prod build emits **no** `data-loc` stamps, no overlay script,
and no `:3131` reference.

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

### Demo gotchas (landing page)

- **Interactive controls in the demo look broken in dev — that's the overlay, not
  the control.** With the Buttons toggle OFF (the default edit mode) nextcanvas
  blocks `pointerdown`/`click` page-wide, so an `onClick` on the landing page
  never fires. Verified with Playwright: the install-pill copy button copies
  nothing in dev with Buttons off, and copies correctly with Buttons on **and** in
  a production build (no overlay). Before "fixing" a dead control in the demo,
  toggle Buttons ON or test against `next build && next start`.
- **`turbopack.root` / `outputFileTracingRoot` are pinned to the REPO ROOT**, not
  to `demo/`, silencing the "multiple lockfiles" warning (the repo root has its
  own lock for Playwright). Pinning them to `__dirname` breaks the build with
  `Module not found: Can't resolve '@rishi-thak/nextcanvas'` whenever the dep is
  swapped to `file:../nextcanvas`, because that symlink target sits outside
  `demo/`. The repo root keeps both arrangements valid.
- **The lockfile is the source of truth for the dep, not `package.json` — this
  broke a Vercel deploy.** `demo/package.json` said `^0.1.0` while
  `demo/package-lock.json` still carried
  `"node_modules/@rishi-thak/nextcanvas": { "resolved": "../nextcanvas", "link":
  true }` left over from the `file:` days. npm follows the lockfile, so CI linked
  the local package and ran its `prepare` (`tsc`), which isn't installed for a
  linked dep → `npm error code 127 / sh: tsc: not found` at the **install** step,
  before any build ran. Editing `package.json` is not enough: `npm install` will
  happily keep an existing symlink when its version satisfies the range. After
  changing that dep, verify **both**:
  `grep -A3 '"node_modules/@rishi-thak/nextcanvas"' demo/package-lock.json`
  (want a `registry.npmjs.org` URL, not `"link": true`) and
  `ls -ld demo/node_modules/@rishi-thak/nextcanvas` (want a real directory).
  To force it: `rm -rf node_modules/@rishi-thak package-lock.json && npm install`.
- **Simulate a Vercel build properly before trusting a deploy fix.** Copy the
  **working tree** (not a `git clone` of an older commit — that silently builds
  stale code and proves nothing), excluding `node_modules`, `.next`,
  `nextcanvas/dist`, then `cd demo && npm ci && npm run build`. This reproduces
  root = `demo/` with the sibling package present but `dist/` absent, which is
  exactly the failing shape.

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
  `data-loc="<absFile>:<line>:<col>"` at compile time onto **host** (lowercase)
  JSX elements, **plain-identifier components** (`<Reveal as="h2">…`, `<Link>…`),
  and **one-level member tags** (`motion.h1`, …). Component text/bound-text is
  wrapped in a stamped `<span>` so non-forwarding wrappers still expose a DOM
  stamp — see the component-stamping constraint. Because it runs *inside* SWC, it
  works under both the webpack (next-swc) and Turbopack pipelines. Injected via
  `experimental.swcPlugins` by `withCanvas`.
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

- **Components land text stamps via a synthetic `<span>` wrap; attrs still need
  forwarding.** The plugin stamps host elements, plain-identifier components
  (capitalized, `<Reveal as="h2">…`, `<Link>…`), **and one-level member tags**
  (`motion.h1`, `motion.p` — Motion forwards DOM attrs). For **text / bound-text
  on a capitalized component**, children are wrapped at compile time in
  `<span data-loc data-nc-text-bound? style={{display:'contents'}}>…</span>` so
  the stamp reaches the DOM even when the component swallows props (Reveal
  does — no `{...rest}`). `data-loc` still points at the *component's* source
  location so write-back finds the original JSX. **The wrapper's `style` must
  be the object form, not a string** — `style="display:contents"` in JSX makes
  React throw ("style prop expects a mapping... not a string") since `style` on
  a DOM element must be an object; build it as `Expr::Object`
  (`style_display_contents_attr()` in `lib.rs`), not `data_attr()`.
  `display: contents` keeps the span invisible to layout (it was breaking
  `flex items-center` by becoming the sole flex item, and forcing block-level
  children like `<img>` onto their own line) while staying in the DOM for
  `data-loc` lookup and `contentEditable`. Attr stamps (`data-nc-attrs` /
  `data-nc-bound`) stay on the component and still need forwarding. If a
  component *transforms* its children (uppercases, wraps) the DOM text won't
  match `oldText` and write-back error-toasts. **Namespaced tags (`ns:tag`) and
  nested members (`Foo.Bar.Baz`) are still NOT stamped.** An element still
  needs editable text, bound text, or an editable attribute to be stamped at
  all.
- **The overlay warns once (`console.warn`) if a page loads with zero
  `data-loc` stamps.** Checked in `initNextCanvas` right after the
  `__nextCanvasLoaded` guard, since a stampless page means the SWC plugin
  didn't run for this build (wrong bundler/OS combo, e.g. Turbopack on
  Windows) and the tool will otherwise look loaded but silently do nothing —
  this was previously indistinguishable from user error.
- **Bound text is editable in ONE unified path, value-matched.** Beyond literal
  text, the plugin stamps an element whose *only* non-whitespace child is a single
  bound expression, emitting `data-nc-text-bound="<expr>"`:
  (1) a `{member.chain}` of plain identifiers (`{speaker.name}`, `{cfg.title}`);
  (2) `{a ?? b}` / `{a || b}` of those same shapes **or string-literal
  fallbacks** (`{result.n ?? "—"}` stamps `path??#lit:—`);
  (2b) `{cond ? "A" : "B"}` (nested ok) when every arm is a string literal —
  stamped `#ternary`; server rewrites the arm matching `oldText`;
  (2c) optional chaining `{job?.service}` treated like `{job.service}`;
  (3) a bare `{identifier}` that names either a `.map`/`.flatMap` element param
  (`truths.map((t) => <p>{t}</p>)`, via `map_params`) **or** a param of an
  enclosing capitalized component (`function Row({ q }) { … <span>{q}</span> }`,
  via `component_params`) — the server prop-drills to the call site
  (`q={f.q}` inside `faqs.map`). Reserved names (`children`, `className`, `key`,
  `ref`, …) stay unstamped. Inert siblings `{cond && <el/>}` next to a bound
  expr are ignored for the sole-child check; a bound expr among other siblings
  is wrapped in a stamped `<span>` (dangling wrap). Computed `{items[i].x}`,
  calls `{fn().y}`, and text mixed with an expression (`Hi {name}`) stay
  unstamped. See the dedicated bound-text subsection.
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
  default, "edit mode") makes the page inert: capture-phase handlers on
  **`window`** for `pointerdown` / `mousedown` / `click` / `auxclick` call
  `stopPropagation` + `stopImmediatePropagation` (and `preventDefault` on
  `click`/`auxclick`) for every non-UI event, so Next `<Link>` soft-nav, in-page
  anchors, and the app's `onClick` / Motion gestures don't fire — `click` alone
  on `document` is not enough (Motion listens on `pointerdown`; a fast click can
  also race the async `overlay.js` fetch). `<NextCanvasOverlay/>` installs a
  matching provisional blocker in its `useEffect` *before* appending the script
  tag; `overlay.js` removes it on init and takes over. This is what lets you
  single-click to select for styling and double-click to edit without a stamped
  `<a href="#anchor">` / `<Link href="/chat">` navigating out from under you.
  ON ("live mode") makes the overlay passive for those events (early `return`
  before blocking), so the app behaves normally and single-click does **not**
  select. Persisted as `nextcanvas:buttons` (`on`/`off`) in localStorage;
  toggling ON also drops any current style selection. Hover outlines, the attr
  chip, and double-click editing stay available in both modes. This is a
  **different** control from the master on/off switch (`enabled`, `.nc-switch`,
  `data-act="toggle"`, below): the master switch turns the *whole tool* off, the
  Buttons toggle only gates the *page's* interactivity while editing stays on.
  To avoid colliding with the master switch's `.nc-switch` styles, the Buttons
  control is its own toggle-switch markup namespaced `.nc-btnsw-*`
  (`data-act="buttons"`, state `buttonsEnabled`, `setButtons`).
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
- **EADDRINUSE on the edit port is NOT terminal — `startServer` must keep
  retrying.** `withCanvas` binds :3131 at *config-load* time, and the process
  already holding the port may be on its way out (a previous `next dev` shutting
  down, or a process that binds and only then bails — Next logs
  `[nextcanvas] edit server listening` immediately followed by `⨯ Another next dev
  server is already running`). The original code treated the first EADDRINUSE as
  "another worker owns it; fine" and never rebound, which stranded users: **Next
  dev kept running normally while no edit server existed at all.** Symptoms —
  every edit toasts "Could not reach the nextcanvas server", and the toolbar
  *disappears* on the next reload because `<script src=:3131/overlay.js>` can no
  longer load. Only a full dev restart recovered it, and even that lost the race
  sometimes. Fix: an unref'd `setInterval` watchdog (`REBIND_INTERVAL_MS`, 2s)
  re-attempts `listen` whenever we're not listening, with a `binding` guard so a
  bind in flight isn't double-started. Whoever owns the port keeps it; if that
  owner dies, the next tick takes over (verified: sibling worker takes over ~2s
  after the owner is killed, and the idle worker logs nothing in the meantime).
  Do not "simplify" this back to a single `listen` call.
- **Import resolution must honour tsconfig `paths`, not just relative specifiers.**
  `resolveModuleFile` used to bail on anything not starting with `.`, so alias
  imports — `@/lib/council`, the Next.js default — resolved to nothing and every
  bound value in an aliased module was uneditable (`unresolved import
  "@/lib/council"`). One real consumer was **88 aliased imports to 3 relative**,
  i.e. almost everything. It now falls through to `ts.resolveModuleName` (via
  ts-morph's re-exported `ts`) with the nearest tsconfig/jsconfig's options,
  memoised per directory; `parseJsonConfigFileContent` handles JSON-with-comments
  and `extends` for free. **Files under `node_modules` and any `.d.ts` are
  refused** — those are dependencies, and write-back must never touch them.
- **Unwrap `as const` / `satisfies` before checking for a literal.**
  `export const COUNCIL_COPY = { … } as const;` is an `AsExpression`, so a bare
  `Node.isObjectLiteralExpression` check refuses it — and `as const` is exactly
  the idiom used for the frozen config/data objects people most want to edit.
  `unwrapExpr()` peels `as` / `satisfies` / parens / type assertions and is
  applied at **every** literal-shape check (arrays too: `SPEAKERS = [...] as
  const` had the same problem). When adding a new check, narrow on the unwrapped
  node and keep using it downstream — TS won't catch you narrowing one variable
  and then reading the original.
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
- **The demo still forces `--webpack`** (`demo/package.json` `dev` script). It
  installs the **published** `@rishi-thak/nextcanvas@0.1.0`, which **does**
  contain this fix (verified: its `exports` map has `"./swc/*"`). So to exercise
  Turbopack, just run the existing `npm run dev:turbo` — no dep swap needed.

**Rebuild reminder:** `dist/` and `swc-plugin/target/` are gitignored. After
pulling, run `npm install` (or `npm run build`) inside `nextcanvas/` to rebuild
`dist/` before a `file:` consumer picks up source changes, then fully restart
`next dev` (`rm -rf <app>/.next`, kill any stray :3131 server).

## The deployed demo ships the overlay (browser-only edits)

The **landing page of the deployed site** runs the real overlay, with edits
applied in the browser and nothing written to disk. Reloading restores the
served HTML. **This is entirely demo-side — the package is untouched** and must
stay that way.

Why it works at all: the overlay is already **DOM-authoritative**. Text lands via
`contentEditable`, attributes via `setAttribute`, and `commitStyle` applies the
inline style *before* the fetch. The overlay only ever **reverts** the DOM when
the server rejects an edit. So a stub server that acknowledges everything leaves
the visitor's change standing, and no source is touched.

The pieces, all in `demo/`:

- **`next.config.js`** injects the SWC plugin when `NODE_ENV !== 'development'`.
  `withCanvas` deliberately no-ops outside dev, so without this there are no
  `data-loc` stamps in the production build and the overlay has nothing to grab.
  Guard it on NODE_ENV — injecting unconditionally would double-stamp in dev
  (verify with: exactly **one** entry in `experimental.swcPlugins` in both modes).
- **`app/api/nextcanvas/{edit,style}/route.ts`** — stub write-back. Always
  `{ok:true}`, writes nothing (`acknowledge.ts`).
- **`app/api/nextcanvas/overlay.js/route.ts`** — serves the package's
  `dist/overlay.js` (read from `node_modules` at build time; `force-static`) and
  **rewrites the success copy on the way out**, since the originals promise
  "Fast Refresh will update the view", which never happens here. A missed patch
  warns at build time rather than failing — check the build log after bumping the
  package, because those strings live upstream.
- **`app/DemoCanvas.tsx`** — mounts the script. Needed because the package's
  `<NextCanvasOverlay/>` **hard-returns when `NODE_ENV !== 'development'`**
  (`src/index.ts:76`), so it cannot be reused. Sets
  `window.__NEXTCANVAS_SERVER__ = '/api/nextcanvas'` (same-origin, so no CORS
  preflight) before appending the script, seeds first-visit defaults, and renders
  the dismissible notice.
- **`demo/global.d.ts`** declares `window.__NEXTCANVAS_SERVER__`; the package
  declares it internally but doesn't ship the type to consumers.

First-visit defaults (seeded only when the key is absent, so a returning
visitor's choice is never overwritten):

- `nextcanvas:enabled = '0'` — **the tool starts OFF**, so the site behaves like a
  normal site and the toolbar collapses to brand + switch.
- `nextcanvas:buttons = 'on'` — so that when someone switches it on, links and
  controls keep working instead of the page going inert.

Scope and costs:

- Mounted in **`app/page.tsx`, not the layout** — the landing page only. `/docs`
  stays a normal static site.
- The plugin is **build-wide**, so docs pages carry `data-loc` stamps too
  (~77–131 per page) even though no overlay mounts there. Inert attributes, a few
  KB. Accepted, not a bug.
- Visitors to `/` fetch the ~64 KB overlay script.
- Stamps under Turbopack are project-relative (`demo/app/page.tsx`), so no
  absolute build paths leak into public HTML.

**Dev is unaffected**: `DemoCanvas` returns null in development, the root layout
still mounts the package's own overlay, and edits still write to real files
through :3131.

## Current scope

Three edit kinds, all dev-only and written back through the :3131 server.

**Text editing.** Static JSX text (`<h1>Hello</h1>`) **and** text mixed with
inline child elements (`<p>Hello <strong>world</strong>!</p>`), where the
surrounding text runs are editable and the inline elements are locked +
preserved. Also editable: text on **`motion.*` member tags** (`<motion.h1>…`),
and text wrapped in a **plain-identifier component** (`<Reveal as="h2">…</Reveal>`,
`<Link>…`) — the plugin wraps component text children in a stamped `<span>` so
non-forwarding wrappers still expose a DOM stamp (see component-stamping
constraint). Repeated components sharing one source line (via `.map`) edit the
shared source, affecting all instances.

**Bound-text editing** (the third text flavor — see the dedicated subsection
below). An element whose *only* child is a bound expression IS editable when it's
a `{member.chain}` (`<h3>{speaker.name}</h3>`, `<h1>{cfg.title}</h1>`), a
`{a ?? b}` / `{a || b}` of those shapes (`{s.name ?? s.role}`), a bare
`.map`/`.flatMap` element param (`truths.map((t) => <p>{t}</p>)`), or a bare
**capitalized-component prop** (`function Row({ q }) { <span>{q}</span> }` —
server prop-drills to `q={f.q}`). The plugin stamps `data-nc-text-bound` and the
server resolves back to the source data (array / object / imported module) and
rewrites it. Computed/`[i]` access, calls, and mixed text+`{expr}` stay
unstamped.

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

### The overlay asks before it offers (`POST /resolve`)

**The plugin stamps on shape; only the server knows if an edit can land.** The
SWC plugin is syntactic and single-file — it cannot tell `speakers.map(s => …
{s.display_name})` over a literal array from the same code over rows fetched at
runtime. It stamped both, so the overlay outlined DB-backed text and every commit
error-toasted. Found in a real consumer whose speakers/council sections come from
Supabase.

Fix: `POST /resolve` dry-runs a batch of stamped locations through
**`applyBoundTextEdit` itself** (`dryRun: true` skips `setLiteralValue` +
`saveSync` at both write sites) and reports which are writable. The overlay calls
it after init and on a debounced `MutationObserver`, caches by
`"<data-loc>|<expr>"`, and `isEditableEl` refuses anything in the unwritable set —
no outline, no double-click.

- **Key by source LOCATION, not element.** A `.map` renders many elements from
  one line; in the consumer's app 38 unique locations covered every stamp, and 13
  came back unwritable. Sending one item per element would be ~3× the work for
  the same answer.
- **Reusing the real write path is the point** — a separate "can I edit this?"
  predicate would drift from what commit actually does.
- Failure is non-fatal: if the server is unreachable the overlay leaves
  everything editable and lets commit report the problem, as before.
- Elements are only suppressed *after* the round trip lands, so there is a brief
  window where a doomed edit is still offered. Measured at ~26ms server-side for
  38 locations (plus the 250ms debounce), so the window is far too short to click
  through in practice.
- **Results are re-verified on a throttle (`FULL_RECHECK_MS`, 3s), not cached
  forever.** A full pass is cheap, and caching permanently goes stale the moment
  someone refactors a component from a literal array to a fetch — Fast Refresh
  re-renders while the overlay keeps offering the old answer. Newly-seen
  locations are still sent immediately. Results clear entries too: a location
  that becomes writable again stops being suppressed.
- **Suppressed elements get a read-only hover hint**, not silence — a dashed
  outline plus "from your data — not editable". Without it the fields simply stop
  highlighting, which reads as broken rather than deliberate; the toast copy is
  now a backstop that most users will never see.
- `unwritableBoundAt()` checks the element, its ancestors, **and its direct
  children** — a component's text is wrapped in a `display:contents` span, which
  has no box and so is never the event target itself. `drawReadonly` falls back
  to the parent's rect for the same reason.

**Error copy must distinguish "never editable" from "stale".** `reload and try
again` is right when the source moved under a real literal, and a lie when the
value was never in the source at all. The two bound-text fallbacks are now split:
the **unresolved-collection** path (scanned every data array, found nothing —
i.e. runtime data) says *"Not editable — this text comes from your data, not your
code."*, while the **resolved-array** path (the array IS in source, the value
isn't in it) blames a changed source or text altered before display.

Keep `reload and try again` only where staleness is genuinely the likely cause
(mixed-run mismatch, ternary arm, direct-object value mismatch).

**Keep these short and non-technical.** A first pass explained literals, fetches
and APIs — accurate, and far too much to read in a toast. The operator wants the
verdict and the reason in one line, not the mechanism.

### Bound-text edits (`{member.chain}` / `??` / prop-drilled `{ident}` → data)

Makes data-driven text editable even though the JSX child is a `{expression}`,
not literal text — `<h3>{speaker.name}</h3>` inside `SPEAKERS.map((s) => …)`,
`<h3>{s.name ?? s.role}</h3>`, `<p>{t}</p>` inside `truths.map((t) => …)`,
`<span>{q}</span>` inside `function Row({ q })` called as `<Row q={f.q} />`,
`<h3>{session.title}</h3>` inside `SessionCard` fed from `visible.map`, or
`<h1>{cfg.title}</h1>` / `<Reveal>{COUNCIL_COPY.eyebrow}</Reveal>` from a config
object. **One code path**; targeting is **value-match**.

- **Plugin** (`editable_bound_text_expr` + `map_params` + `component_params` in
  `lib.rs`): stamps `data-nc-text-bound="<expr>"` for member chains, `a??b` /
  `a||b` of those shapes, bare `.map` element params, and bare params of
  capitalized components (prop-drill targets). See the bound-text constraint.
- **Overlay**: stamped bound text renders as a plain text node; commit is flagged
  `textBound` → `applyBoundTextEdit`. Threaded through undo/redo and Manual staging.
- **Server** (`applyBoundTextEdit`): walks JSX ancestors to classify the base —
  `.map`/`.flatMap` callback param (plain or destructured), **component prop**
  (find `<Comp prop={expr} />` and continue from `expr`), or **direct object**.
  `??`/`||` exprs try each operand. When a mapped collection isn't a direct array
  literal (`visible` from `useMemo` over `AGENDA`), value-match **falls back**
  across local/imported object arrays. Declarations may be relatively-imported;
  the owning file is `saveSync`'d. Only string-literal leaves are editable.

**Targeting is by VALUE, not position** — the deliberate design decision, and the
one thing that superseded an earlier positional-index draft. Among the array's
entries the server edits the one whose bound value currently equals `oldText`.
Rationale: a `.map`'s rendered output is routinely **filtered and reordered** (a
track filter, a pinned-items-first sort), so DOM order ≠ array order and a
positional index would rewrite the wrong entry. Consequences:
- A **unique** value (names, descriptions) edits cleanly regardless of order.
- A value **shared by several entries** is genuinely ambiguous — DOM position
  can't safely disambiguate under reordering — so the edit is **refused** with a
  "make it unique / edit the data file" message rather than risk mis-targeting.
- **No** matching entry ⇒ the source moved on ⇒ rejected as stale. A direct
  object is a single target but still value-guarded against a stale edit.
Undo/redo works because each direction re-values-matches the current source.

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
