import { VERSION } from '../agent-setup';
import { SITE_URL } from '../site';

/**
 * Serves /skill.md — the canonical agent-readable install guide.
 *
 * text/plain so it renders in a browser instead of downloading, while staying
 * trivially fetchable by an agent. Static, so it's baked at build time.
 */
export const dynamic = 'force-static';

const SKILL = `---
name: nextcanvas
version: ${VERSION}
description: Edit a locally-running Next.js App Router app from the browser — double-click text, and the change is written back to the source file. Dev-only.
homepage: ${SITE_URL}
user-invocable: true
---

# nextcanvas — setup guide for agents

This skill is **doc-only**. There is no API and no MCP server. It documents how to
install nextcanvas into a Next.js project and what it can edit once running.

nextcanvas is a **dev-only** tool for the **Next.js App Router**. In \`next dev\`,
double-clicking static text in the browser writes the change back into the real
source file via a formatting-preserving AST edit, and Fast Refresh re-renders it.
In a production build it compiles out completely.

## Requirements

- Next.js **16.2+**, App Router
- React 18+
- A local \`next dev\` session (webpack or Turbopack; on Windows prefer \`next dev --webpack\`)

## Setup

\`\`\`
npm i -D @rishi-thak/nextcanvas
npx nextcanvas init
\`\`\`

Keep it in **devDependencies**. \`init\` is idempotent — re-running is safe.

\`init\` does two things:

1. Wraps the exported config in \`next.config.*\` with \`withCanvas()\`.
2. Mounts \`<NextCanvasOverlay />\` in the root layout, guarded by \`NODE_ENV\`.

### Manual wiring

If \`init\` cannot patch the files, apply both edits by hand.

\`next.config.js\`:

\`\`\`js
const { withCanvas } = require('@rishi-thak/nextcanvas/next');

module.exports = withCanvas({
  // your existing config
});
\`\`\`

\`app/layout.tsx\`:

\`\`\`tsx
import { NextCanvasOverlay } from '@rishi-thak/nextcanvas';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <NextCanvasOverlay />}
      </body>
    </html>
  );
}
\`\`\`

### Verify

Run \`next dev\`, load the app, and confirm the nextcanvas toolbar appears in the
corner. Double-click a headline, type, press Enter, and check the source file
changed on disk.

## What you can edit

| Kind | Example | Notes |
|---|---|---|
| Static text | \`<h1>Hello</h1>\` | Also text mixed with inline tags: \`<p>Hi <strong>there</strong></p>\` |
| Component text | \`<Reveal as="h2">Title</Reveal>\`, \`<motion.h1>\` | Plain-identifier components and one-level member tags |
| Bound text | \`<h3>{speaker.name}</h3>\` | Member chains, \`{a ?? b}\`, string-literal ternaries, \`.map\` params, component props |
| Attributes | \`href\`, \`src\`, \`alt\`, \`title\`, \`placeholder\`, \`aria-label\` | Literal values, and bound identifiers like \`href={GITHUB}\` |
| Inline styles | \`style={{ color: 'red' }}\` | Colour, size, weight, alignment, padding |

Not editable: computed access (\`{items[i].x}\`), call results (\`{fn().y}\`), text
mixed with an expression (\`Hi {name}\`), namespaced tags, and \`className\` /
Tailwind classes.

## How it works

A compile-time SWC plugin stamps \`data-loc="<file>:<line>:<col>"\` onto elements
that have something editable. The browser overlay reads that stamp and POSTs the
change to a local write-back server, which applies it with ts-morph and saves.
Fast Refresh does the rest — there is no socket to maintain.

## Notes and gotchas

- \`withCanvas\` boots the write-back server on **port 3131** in dev. Override with
  \`NEXTCANVAS_PORT\`; that single variable also reaches the browser.
- The tool is a **complete no-op** when \`NODE_ENV\` is not \`development\`. Nothing
  is stamped and no overlay script is served in a production build.
- The toolbar has a **Buttons** toggle. Off (the default) makes the page inert so
  single-click selects an element for styling instead of triggering links and
  handlers. Turn it on to use the app normally.
- If a component **transforms** its children (uppercases them, wraps them), the
  DOM text will not match the source and the edit is rejected rather than
  guessed at.
- Bound text is matched **by value**, not by position, because a \`.map\` is
  routinely filtered and reordered. A value shared by several entries is
  ambiguous, so that edit is refused instead of risking the wrong one.

## Links

- Docs: ${SITE_URL}/docs
- Package: https://www.npmjs.com/package/@rishi-thak/nextcanvas
- Source: https://github.com/rishi-thak/nextcanvas
`;

export function GET() {
  return new Response(SKILL, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
