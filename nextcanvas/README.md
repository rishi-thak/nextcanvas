# nextcanvas

Turn a locally-running Next.js (App Router) app into an editable canvas.
Double-click any static text in the browser, type a new value, and the change is
written straight back into your source file. Next.js Fast Refresh does the rest.

**Dev-only.** Everything is gated behind `NODE_ENV === 'development'` and is a
complete no-op in production builds.

Requires **Next.js 15+** (App Router).

## Install

```bash
npm i -D nextcanvas
```

Then two one-time wiring steps:

**1. `next.config.js`** — boots the write-back server and injects the source-map
SWC plugin:

```js
const { withCanvas } = require('nextcanvas/next');
module.exports = withCanvas({ /* your existing config */ });
```

**2. Mount the overlay** — run the codemod, which adds `<NextCanvasOverlay/>` to your
root layout:

```bash
npx nextcanvas init
```

Or add it by hand in `app/layout.tsx`:

```tsx
import { NextCanvasOverlay } from 'nextcanvas';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <NextCanvasOverlay />}
      </body>
    </html>
  );
}
```

Run `npm run dev`, open the app, and double-click any static text. **No
`.babelrc`, no `@babel/runtime`** — the stamp is an SWC plugin now.

## How it works

```
double-click text ─▶ overlay reads element's data-loc ─▶ POST :3131/edit
       ▲                                                        │
       │                                                        ▼
  Fast Refresh  ◀──  file rewritten  ◀──  ts-morph AST edit (formatting-safe)
```

- **Source mapping** — an **SWC plugin** (shipped prebuilt as
  `swc/nextcanvas_swc.wasm`, injected via `experimental.swcPlugins` by
  `withCanvas`) stamps `data-loc="<absFile>:<line>:<col>"` onto every host JSX
  element at compile time. The overlay reads it straight off the DOM — no
  React-internal fiber reading (which is unreliable: `_debugSource` is not
  present in current Next/React App Router builds).
- **Overlay delivery** — served as a raw classic script from the write-back
  server (`:3131/overlay.js`) and injected by `<NextCanvasOverlay />`, so no bundler
  ever processes the overlay code.
- **Write-back** — `ts-morph` performs a formatting-preserving AST edit; your
  surrounding code and style are untouched.
- **No WebSocket** — edits are one-way POSTs; the browser update comes free from
  Fast Refresh.

## Bundler support

The stamp is an **SWC plugin**, so it runs inside Next's own compiler under both
bundlers — no `.babelrc`, so `next/font` and other SWC features keep working.

| Bundler   | Windows                    | macOS / Linux |
|-----------|----------------------------|---------------|
| webpack   | ✅                          | ✅             |
| Turbopack | ⚠️ not yet (see below)      | ✅             |

**Turbopack on Windows** can't execute Wasm SWC plugins yet (upstream:
[vercel/next.js#84972](https://github.com/vercel/next.js/issues/84972),
[#78156](https://github.com/vercel/next.js/issues/78156)). The app still runs,
but nothing gets stamped, so editing is inactive. On Windows, use
`next dev --webpack`. Turbopack works on macOS/Linux.

## Current scope (MVP)

- ✅ Static JSX text: `<h1>Hello</h1>`
- ❌ Bound values: `<h1>{title}</h1>` — rejected with an explanatory toast
- ❌ Elements with mixed children (text + nested elements) — not yet editable
- ⚠️ Repeated components (same source line via `.map`) edit the shared source,
  which changes all instances

## Roadmap

- Turbopack-on-Windows once the upstream Wasm-plugin gap closes
- className / inline-style editing
- Following variable/CMS bindings to their definition
- Element move / duplicate / delete
- Full pan-zoom canvas UI

## Config

- `NEXTCANVAS_PORT` — override the write-back server port (default `3131`).
  `withCanvas` inlines this into the client automatically, so setting the single
  env var is enough — no other changes needed.

## Development

The package is written in **TypeScript** (`src/*.ts`) and compiled with `tsc` to
CommonJS + type declarations in `dist/`, which is what's published and what the
`exports` map points at.

```bash
npm install     # installs deps and builds dist/ via the prepare script
npm run build   # recompile after editing src/
```

The browser overlay (`src/overlay.ts`) is deliberately module-free so it
compiles to a plain classic script; everything else compiles to normal CommonJS
modules.

### The SWC plugin (Rust)

The `data-loc` stamp lives in `swc-plugin/` (Rust) and ships **prebuilt** as
`swc/nextcanvas_swc.wasm` — consumers need no Rust. To rebuild it you need the
Rust toolchain and the `wasm32-wasip1` target:

```bash
rustup target add wasm32-wasip1
npm run build:wasm    # cargo build + copy the .wasm into swc/
```

`swc_core` is pinned to the version Next's runtime embeds (see the comment in
`swc-plugin/Cargo.toml`); bump it only when targeting a newer Next whose runtime
rejects the current ABI.
