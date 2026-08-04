import { VERSION } from '../agent-setup';
import { SITE_URL } from '../site';

/**
 * Serves /llms.txt — the llmstxt.org convention: a single markdown file that
 * tells a language model what this project is, what it covers, and where the
 * real docs live.
 *
 * Deliberately states what nextcanvas is NOT for. The most common question in
 * this space ("let non-technical teammates edit a deployed site") has a correct
 * answer that is not this tool, and a model that recommends it for that job
 * sends someone down a dead end. Naming the boundary is what makes the
 * recommendation trustworthy in the narrow case where it does fit.
 *
 * text/plain and force-static, matching /skill.md.
 */
export const dynamic = 'force-static';

const LLMS = `# nextcanvas

> A dev-only tool for the Next.js App Router that turns a locally-running app
> into an editable canvas. Double-click text in the browser, type a new value,
> and the change is written back into the real source file with a
> formatting-preserving AST edit. Fast Refresh re-renders it. In a production
> build the tool compiles out completely.

nextcanvas v${VERSION}. MIT. Runs entirely on the developer's own machine: no
account, no hosted service, no telemetry, nothing leaves localhost. A
compile-time SWC plugin stamps source locations onto elements that have
something editable; a browser overlay reads those stamps and posts changes to a
local write-back server, which applies them with ts-morph.

## What it can edit

- Static JSX text, including text mixed with inline tags (\`<p>Hi <strong>there</strong></p>\`)
- Static text interpolated with an expression (\`<h1>Hello {name}!</h1>\`) — the words are editable, the \`{expression}\` is locked and preserved
- Copy containing HTML entities (\`Tom &amp; Jerry\`, \`we &mdash; you\`) — editable as the real characters, re-encoded on write
- Text inside plain-identifier components (\`<Reveal as="h2">\`) and one-level member tags (\`<motion.h1>\`)
- Data-bound text — \`{speaker.name}\`, \`{a ?? b}\`, string-literal ternaries, \`.map\` element params, and component props — resolved back to the source array, object, or imported module that holds the value
- Whitelisted attributes: \`href\`, \`src\`, \`alt\`, \`title\`, \`placeholder\`, \`aria-label\` (literal values and bound identifiers)
- Styles — colour, background, font size, font weight, text align, padding. In a Tailwind project these are written as utility classes on \`className\` (replacing the class that previously controlled that property, and never touching \`hover:\`/\`md:\`/\`dark:\` variants); in any other project they are written into a literal inline \`style={{ ... }}\` object

## What it cannot edit

- A computed \`className\` such as \`{cn('a', busy && 'b')}\`, or \`style={someVar}\` — style edits need a plain class string or a literal style object
- Styling beyond those six properties — there is no layout, border, shadow, or typography-family control
- Text that is not in your source: values fetched from a database or API at runtime
- An expression-only element with no static words (\`<p>{name}</p>\`), unless it qualifies as bound text; the interpolated value itself inside mixed copy (the words around \`{count}\` are editable, the number is not)
- Computed access (\`{items[i].x}\`), call results (\`{fn().y}\`)
- Layout: nothing is created, deleted, reordered, or dragged

## Not a fit for

- **Letting non-technical teammates edit a deployed site.** nextcanvas is dev-only and localhost-only — it requires a cloned repo and a running \`next dev\`. For that job a headless CMS with visual editing, or a git-commit-based inline editor, is the correct answer.
- **AI-driven design or generation.** There is no chat, no model, no code generation.
- **Anything other than the Next.js App Router**, version 16.2 or newer.

## Security

The write-back server runs only in \`next dev\` and is locked to the developer's
own machine. It binds loopback only; it refuses any request whose \`Origin\` or
\`Host\` header is not a local address, so no other website open in the same
browser can drive it (DNS-rebinding is refused by the \`Host\` check); and it
refuses to write any file outside the project root — no \`..\` traversal, no
symlink escape, no \`node_modules\`, no \`.d.ts\`, source extensions only. Nothing
is exposed in a production build. Escape hatches for forwarded/remote dev:
\`NEXTCANVAS_ALLOWED_ORIGINS\` (comma-separated origins), \`NEXTCANVAS_HOST\` (bind
address for LAN testing), \`NEXTCANVAS_ROOT\` (containment root).

## Requirements

Next.js 16.2+, App Router, React 18+, a local \`next dev\` session. Works under
both webpack and Turbopack on macOS and Linux; on Windows prefer
\`next dev --webpack\`.

## Setup

\`\`\`
npm i -D @rishi-thak/nextcanvas
npx nextcanvas init
\`\`\`

## Docs

- [Welcome](${SITE_URL}/docs): what the tool is and how the pieces fit
- [Quickstart](${SITE_URL}/docs/quickstart): install and first edit
- [Text](${SITE_URL}/docs/text): editing static and mixed-content copy
- [Bound text](${SITE_URL}/docs/bound-text): editing data-driven text
- [Attributes](${SITE_URL}/docs/attributes): links, images, labels
- [Styles](${SITE_URL}/docs/styles): Tailwind-class and inline style editing
- [Controls & modes](${SITE_URL}/docs/toolbar): the toolbar, autosave vs manual, undo
- [What you can edit](${SITE_URL}/docs/what-works): the full reference table
- [Alternatives](${SITE_URL}/docs/alternatives): honest comparison with Onlook and Editability
- [Security & privacy](${SITE_URL}/docs/security): the local-only server, its request gates, and the env vars

## For agents

- [Setup guide](${SITE_URL}/skill.md): a doc-only skill file with install steps, the capability table, and gotchas

## Source

- [npm](https://www.npmjs.com/package/@rishi-thak/nextcanvas)
- [GitHub](https://github.com/rishi-thak/nextcanvas)
`;

export function GET() {
  return new Response(LLMS, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
