import type { Metadata } from 'next';
import Link from 'next/link';
import { Pager } from './Pager';

export const metadata: Metadata = {
  title: 'Welcome',
};

export default function DocsWelcome() {
  return (
    <article>
      <p className="docs-kicker">Documentation</p>
      <h1>Edit your Next.js app in the browser.</h1>
      <p className="docs-lede">
        nextcanvas turns a locally-running App Router app into an editable
        canvas. Double-click text, tweak attributes, restyle elements — every
        change writes straight back into your source. Fast Refresh does the rest.
      </p>

      <div className="docs-callout tip">
        <strong>Dev-only.</strong> In your app, nothing from nextcanvas ships to
        production — the overlay, the write-back server, and the source stamps
        all gate on <code>NODE_ENV === &apos;development&apos;</code>.
      </div>

      <div className="docs-callout">
        <strong>Want to try it before installing?</strong> The{' '}
        <a href="/">home page</a> runs the real overlay so you can play with it
        in the browser. Flip the nextcanvas switch in the toolbar and
        double-click any text. Those edits are browser-only and a reload clears
        them — that page is wired to a stub backend rather than a write-back
        server.
      </div>

      <h2>Choose a path</h2>
      <div className="docs-cards">
        <Link className="docs-card" href="/docs/quickstart">
          <h3>Quickstart</h3>
          <p>Install, run init, and make your first edit in under two minutes.</p>
        </Link>
        <Link className="docs-card" href="/docs/text">
          <h3>Edit text</h3>
          <p>Headlines, paragraphs, mixed markup, and component-wrapped copy.</p>
        </Link>
        <Link className="docs-card" href="/docs/bound-text">
          <h3>Edit bound text</h3>
          <p>Change data-driven copy like {'{speaker.name}'} without hunting the file.</p>
        </Link>
        <Link className="docs-card" href="/docs/toolbar">
          <h3>Use the toolbar</h3>
          <p>Autosave vs Manual, Buttons mode, undo/redo, and the master switch.</p>
        </Link>
      </div>

      <h2>What you can do</h2>
      <ul>
        <li>
          <strong>Text</strong> — double-click static copy, including text mixed
          with inline elements and text inside wrappers like Reveal or{' '}
          <code>motion.h1</code>.
        </li>
        <li>
          <strong>Bound text</strong> — edit values that render from data (
          <code>{'{speaker.name}'}</code>, map items, config objects), string
          ternaries like loading CTAs, and <code>{'{x ?? "—"}'}</code>{" "}
          fallbacks.
        </li>
        <li>
          <strong>Attributes</strong> — hover the chip to change{' '}
          <code>href</code>, <code>src</code>, <code>alt</code>, and friends.
        </li>
        <li>
          <strong>Styles</strong> — single-click an element and tune color, size,
          weight, padding, and more via inline <code>style</code>.
        </li>
      </ul>

      <h2>Requirements</h2>
      <ul>
        <li>Next.js <strong>16.2+</strong> with the App Router</li>
        <li>A local <code>next dev</code> session (webpack or Turbopack on macOS/Linux)</li>
        <li>On Windows with Turbopack issues, use <code>next dev --webpack</code></li>
      </ul>

      <Pager next={{ href: '/docs/quickstart', label: 'Quickstart' }} />
    </article>
  );
}
