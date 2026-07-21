import pkg from '@rishi-thak/nextcanvas/package.json';
import { SITE_URL } from './site';

/**
 * Single source for everything an agent or a human copies off the landing page.
 * The install command, the paste-into-your-agent prompt, and /skill.md all read
 * from here so they cannot drift apart.
 */

export const VERSION: string = pkg.version;
export const SKILL_URL = new URL('/skill.md', SITE_URL).href;

export const INSTALL_COMMAND = `npm i -D @rishi-thak/nextcanvas
npx nextcanvas init`;

/** Pasted straight into a coding agent. Self-contained — assumes no context. */
export const AGENT_PROMPT = `Set up nextcanvas in this project so I can edit text directly in the browser while developing.

nextcanvas is a dev-only tool for the Next.js App Router. Double-clicking static text in the running app writes the change back to the source file, and Fast Refresh re-renders it. It compiles out of production builds entirely.

Do this:

1. Install it as a DEV dependency:
   npm i -D @rishi-thak/nextcanvas

2. Run the setup codemod:
   npx nextcanvas init

   It wraps the exported Next config with withCanvas() and mounts <NextCanvasOverlay /> in the root layout. It is idempotent, so re-running is safe.

3. If the codemod cannot patch the files automatically, do it by hand:

   next.config.js (or .ts) — wrap the exported config:
     const { withCanvas } = require('@rishi-thak/nextcanvas/next');
     module.exports = withCanvas(nextConfig);

   app/layout.tsx — render the overlay inside <body>, guarded so it never ships to production:
     import { NextCanvasOverlay } from '@rishi-thak/nextcanvas';
     ...
     {process.env.NODE_ENV === 'development' && <NextCanvasOverlay />}

4. Start the dev server and confirm the nextcanvas toolbar appears in the corner of the page. Double-click a headline to check an edit round-trips to the source file.

Requirements and constraints:
- Next.js 16.2 or newer, App Router, React 18+.
- Keep it in devDependencies. Never move it to dependencies.
- withCanvas boots a local write-back server on port 3131 during dev, and is a complete no-op when NODE_ENV is not development.
- Works under both webpack and Turbopack. On Windows, prefer "next dev --webpack".
- Do not commit any generated .next output.

Full reference: ${new URL('/skill.md', SITE_URL).href}`;

export type CopyTab = {
  id: 'agent' | 'skill' | 'npm';
  label: string;
  /** Button text. Per-tab, because each tab copies a different KIND of thing —
   *  a prompt, a url, and shell commands are not interchangeable nouns. */
  action: string;
  /** One-line description shown under the control. */
  hint: string;
  payload: string;
};

export const COPY_TABS: CopyTab[] = [
  {
    id: 'agent',
    label: 'agent',
    action: 'copy prompt',
    hint: 'a ready-to-paste prompt for claude code, cursor, or codex',
    payload: AGENT_PROMPT,
  },
  {
    id: 'skill',
    label: 'skill',
    action: 'copy url',
    hint: 'point your agent at the canonical setup doc',
    payload: SKILL_URL,
  },
  {
    id: 'npm',
    label: 'npm',
    action: 'copy commands',
    hint: 'install and wire it up yourself',
    payload: INSTALL_COMMAND,
  },
];
