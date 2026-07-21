import fs from 'node:fs';
import path from 'node:path';

/**
 * Serves the package's overlay script to the deployed demo.
 *
 * In dev the package's own :3131 server does this. In production that server
 * doesn't exist, so the demo serves the same file itself — read straight out of
 * node_modules, never bundled, exactly as the overlay expects (a raw classic
 * script). Static, so it's read once at build time.
 */
export const dynamic = 'force-static';

/**
 * Success copy inside the overlay assumes a dev server wrote to disk and Fast
 * Refresh will re-render. Neither happens here, so the strings are rewritten on
 * the way out. This is the one piece of the package we touch, and we only touch
 * the text — patching a served asset is the cost of leaving the package alone.
 */
const COPY_PATCHES: [string, string][] = [
  [
    'Saved — Fast Refresh will update the view',
    'Changed — this page only, reload to reset',
  ],
  [
    'Styled — Fast Refresh will update the view',
    'Styled — this page only, reload to reset',
  ],
  ['Staged — click Save to write to code', 'Staged — click Save to apply here'],
];

function loadOverlay(): string {
  const file = path.join(
    process.cwd(),
    'node_modules/@rishi-thak/nextcanvas/dist/overlay.js'
  );

  let code: string;
  try {
    code = fs.readFileSync(file, 'utf8');
  } catch {
    // Fail loudly in the build log rather than shipping a silently dead overlay.
    console.error(`[demo] nextcanvas overlay not found at ${file}`);
    return `console.error('[nextcanvas] overlay asset missing from this build');`;
  }

  for (const [from, to] of COPY_PATCHES) {
    if (!code.includes(from)) {
      // The upstream string moved. Serve it anyway — a slightly wrong toast
      // beats a broken overlay — but make the drift visible at build time.
      console.warn(
        `[demo] nextcanvas copy patch missed (package changed?): ${JSON.stringify(from)}`
      );
      continue;
    }
    code = code.split(from).join(to);
  }
  return code;
}

export function GET() {
  return new Response(loadOverlay(), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
