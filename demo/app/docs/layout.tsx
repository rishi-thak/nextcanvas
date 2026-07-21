import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GITHUB } from './nav';
import { DocsSideNav } from './DocsSideNav';
import { ThemeToggle } from '../ThemeToggle';
import './docs.css';

export const metadata: Metadata = {
  title: {
    default: 'Docs — nextcanvas',
    template: '%s — nextcanvas docs',
  },
  description:
    'How to use nextcanvas: edit text, bound data, attributes, and styles in your Next.js app — right in the browser.',
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs">
      <header className="docs-top">
        <div className="docs-top-inner">
          <Link className="docs-brand" href="/">
            <span className="brand-mark">◆</span>
            <span>nextcanvas</span>
            <span className="docs-brand-sep">/</span>
            <span className="docs-brand-sub">docs</span>
          </Link>
          <div className="docs-top-links">
            <Link href="/">Home</Link>
            <a href={GITHUB}>GitHub</a>
            <Link className="btn btn-ghost docs-top-cta" href="/docs/quickstart">
              Quickstart
            </Link>
          </div>
        </div>
      </header>

      <div className="docs-shell">
        <aside className="docs-sidebar">
          <DocsSideNav />
        </aside>

        <main className="docs-main">{children}</main>
      </div>

      {/* Docs had no footer, which left no way to switch theme while reading. */}
      <footer className="docs-footer">
        <div className="docs-footer-inner">
          <p>© 2026 nextcanvas · MIT licensed</p>
          <ThemeToggle />
        </div>
      </footer>
    </div>
  );
}
