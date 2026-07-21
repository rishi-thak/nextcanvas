# Changelog

All notable changes to `@rishi-thak/nextcanvas` are documented here. Dates are
release-tag dates; versions match `package.json` / npm.

## Unreleased

## 0.2.0 — 2026-07-21

- Bound text that can't actually be written back is no longer offered for
  editing. The SWC plugin stamps on shape alone — it can't tell
  `speakers.map((s) => <h3>{s.display_name}</h3>)` over a literal array from the
  same code over rows fetched from a database — so it stamped both, and elements
  highlighted invitingly then error-toasted on commit. The overlay now asks the
  server first (`POST /resolve`), which dry-runs each stamped location through
  the real write path and reports which are writable. Unwritable ones get no
  outline and don't respond to double-click.
- Unwritable elements show a read-only hint on hover ("from your data — not
  editable") rather than silently doing nothing, so they read as deliberate
  rather than broken.
- Alias imports now resolve. Module resolution only handled relative specifiers,
  so anything imported through a tsconfig `paths` alias — `@/lib/council`, the
  Next.js default — failed with `unresolved import`, making every bound value in
  an aliased module uneditable. Resolution now honours the nearest
  tsconfig/jsconfig, including `extends` and JSON-with-comments. Files under
  `node_modules` and `.d.ts` files are refused: those are dependencies, not your
  source.
- `as const` and `satisfies` no longer block edits.
  `export const COUNCIL_COPY = { … } as const;` is an `AsExpression`, so the
  object-literal check refused it — which hit exactly the frozen config objects
  people most want to edit. Applies to arrays too (`SPEAKERS = [...] as const`).
- Better failure messages. "reload and try again" was misleading when the value
  was never in your source to begin with; that case now reads "Not editable —
  this text comes from your data, not your code." The wording is kept for cases
  where the source genuinely moved.
- SWC plugin: the synthetic `<span>` wrapper used to reach text on
  non-forwarding components (e.g. `<Reveal>`) now sets `style={{ display:
  'contents' }}`, so it no longer becomes a real box in the layout — it was
  breaking `flex items-center` (becoming the sole flex item) and forcing
  block-level children like `<img>` onto their own line.
- Overlay: warn once in the console when a page loads with zero `data-loc`
  stamps, instead of silently doing nothing. This is the signal that the SWC
  plugin isn't active for the current bundler/OS combo (e.g. Turbopack on
  Windows) rather than a user error.
- README: corrected the "current scope" section, which still described bound
  text (`{speaker.name}`, `{cfg.title}`, …) as unstamped/not editable — that
  shipped in 0.0.8–0.1.0. Also added inline style editing and attribute
  editing, which were likewise missing from that list.

## 0.1.1 — 2026-07-21

- Fixed the write-back server becoming unreachable during `next dev`.
  `startServer` treated the first `EADDRINUSE` on the edit port as "another
  worker owns it" and never rebound; if that other process was itself on its
  way out, nothing ever claimed the port. Every edit then toasted "Could not
  reach the nextcanvas server," and the toolbar disappeared on the next reload
  because `overlay.js` could no longer load. A 2s watchdog now re-attempts the
  bind whenever the server isn't listening, so whoever holds the port keeps
  it and a dead holder is replaced within ~2s — no full dev restart required.

## 0.1.0 — 2026-07-15

- String-literal ternaries (`{cond ? "A" : "B"}`, nested arms ok) are now
  editable bound text — the server rewrites the arm matching the current text.
- `??`/`||` bound text now also matches a string-literal fallback operand
  (`{result.n ?? "—"}`).
- Docs site (`/docs`) shipped: quickstart, text, bound-text, attributes,
  styles, toolbar, and a full what-works reference table.

## 0.0.9

- `motion.*` member-tag text (`<motion.h1>…</motion.h1>`) is stampable.
- Bound text on a plain-identifier component (`<Reveal>{COUNCIL_COPY.eyebrow}
  </Reveal>`) is editable.
- Bound text now prop-drills through capitalized-component params — a bare
  `{q}` inside `function Row({ q })` resolves to the call site (`q={f.q}`) and
  edits there, including when the mapped collection isn't a direct array
  literal (falls back across local/imported object arrays).

## 0.0.8

- Bound-text editing shipped: an element whose only child is a `{member.chain}`
  expression, or an `a ?? b` / `a || b` of such shapes, is now editable —
  value-matched against the source array/object rather than positionally, so
  filtered or reordered `.map` output still edits the right entry.
- Plain-identifier components (`<Reveal as="h2">…</Reveal>`, `<Link>…`) are
  stamped for text via a synthetic wrapper `<span>`, so components that don't
  forward props still expose a DOM stamp for write-back.

## 0.0.7

- Added a master on/off switch to the toolbar (`enabled`, persisted) that
  makes the whole tool inert and collapses the UI to just the switch.
- Added the "Buttons" toggle: OFF (default) makes the page inert so clicks
  don't navigate/fire handlers while editing; ON restores normal page
  behavior. Also made toolbar dismissal transient (a reload brings it back).
- Added bound-identifier attribute editing (`href={GITHUB}`), with a scope
  prompt — rewrite the variable everywhere it's used, or inline a literal on
  just this element.

## 0.0.6

- Added string-literal attribute editing (`src`, `href`, `alt`, `title`,
  `placeholder`, `aria-label`) via a hover chip + attribute panel.
- Added inline style editing via a right-side design panel (color, background,
  font-size, font-weight, text-align, padding).
- Added support for editing text mixed with inline child elements
  (`<p>Hello <strong>world</strong>!</p>`) — the surrounding text runs are
  editable; inline elements are locked in place and preserved.
- Added a golden-file test suite for `applyEdit()` write-back.

## 0.0.5

- Only stamp elements with genuinely editable static text — bound values are
  no longer outlined as if they were editable (later superseded by real
  bound-text support in 0.0.8).
- Added the npm publish GitHub Actions workflow.

## 0.0.4

- Documented the Turbopack gap and added the package.json `exports` map.

## 0.0.1 – 0.0.3

- Initial SWC-based editable canvas for Next.js App Router: static JSX text
  editing, the write-back server, the toolbar, and the landing page.
