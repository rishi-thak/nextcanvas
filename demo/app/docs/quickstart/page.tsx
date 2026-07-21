import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
  title: 'Quickstart',
};

export default function QuickstartPage() {
  return (
    <article>
      <p className="docs-kicker">Start here</p>
      <h1>Quickstart</h1>
      <p className="docs-lede">
        Two commands. Open your app. Double-click a headline. That&apos;s the
        whole loop.
      </p>

      <h2>Install</h2>
      <pre>
        <code>{`npm i -D @rishi-thak/nextcanvas
npx nextcanvas init`}</code>
      </pre>

      <div className="docs-callout tip">
        <strong>Rather have your agent do it?</strong> The setup control on the{' '}
        <a href="/">home page</a> has an <strong>agent</strong> tab that copies a
        ready-to-paste prompt for Claude Code, Cursor, or Codex. Or point your
        agent straight at <a href="/skill.md">/skill.md</a> — the canonical
        setup doc, covering wiring, what&apos;s editable, and the gotchas.
      </div>
      <p>
        <code>init</code> is idempotent — safe to re-run. It does two things for
        you:
      </p>
      <ul>
        <li>
          Wraps your <code>next.config</code> with <code>withCanvas()</code>{' '}
          (boots the write-back server and injects the source-mapping plugin in
          development)
        </li>
        <li>
          Mounts <code>{'<NextCanvasOverlay />'}</code> in your root layout,
          gated to development
        </li>
      </ul>

      <h2>Run and edit</h2>
      <div className="docs-steps">
        <div className="docs-step">
          <span className="docs-step-num">1</span>
          <div>
            <h3>Start the app</h3>
            <p>
              Run <code>npm run dev</code> as usual. nextcanvas boots a small
              local server on port <code>3131</code> alongside Next.
            </p>
          </div>
        </div>
        <div className="docs-step">
          <span className="docs-step-num">2</span>
          <div>
            <h3>Look for the toolbar</h3>
            <p>
              A floating nextcanvas bar appears in the corner. The master switch
              should be on. Leave <strong>Buttons</strong> off for edit mode —
              that&apos;s the default.
            </p>
          </div>
        </div>
        <div className="docs-step">
          <span className="docs-step-num">3</span>
          <div>
            <h3>Double-click any static text</h3>
            <p>
              Hover to see the outline on editable elements. Double-click, type,
              press <span className="docs-kbd">Enter</span> (or click away) to
              commit. Your <code>.tsx</code> file updates on disk.
            </p>
          </div>
        </div>
      </div>

      <div className="docs-callout tip">
        <strong>Psst.</strong> This docs site and the landing page are themselves
        a live demo when you run the nextcanvas repo locally. Try editing a
        headline on the home page.
      </div>

      <h2>Manual setup</h2>
      <p>
        Prefer to wire it by hand? <code>init</code> just performs these two
        edits:
      </p>
      <h3>1. Wrap your Next config</h3>
      <pre>
        <code>{`// next.config.js
const { withCanvas } = require('@rishi-thak/nextcanvas/next');
module.exports = withCanvas({
  // your existing config
});`}</code>
      </pre>
      <h3>2. Mount the overlay</h3>
      <pre>
        <code>{`// app/layout.tsx
import { NextCanvasOverlay } from '@rishi-thak/nextcanvas';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <NextCanvasOverlay />}
      </body>
    </html>
  );
}`}</code>
      </pre>

      <h2>Change the port</h2>
      <p>
        Set <code>NEXTCANVAS_PORT</code> if <code>3131</code> is taken. That
        single env var is enough — <code>withCanvas</code> inlines it for the
        overlay automatically.
      </p>
      <pre>
        <code>{`NEXTCANVAS_PORT=4001 npm run dev`}</code>
      </pre>

      <Pager
        prev={{ href: '/docs', label: 'Welcome' }}
        next={{ href: '/docs/text', label: 'Text editing' }}
      />
    </article>
  );
}
