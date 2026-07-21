'use client';

import { useEffect, useState } from 'react';

/** Same-origin stand-in for the package's :3131 dev server. */
const BASE = '/api/nextcanvas';
const NOTICE_KEY = 'nextcanvas:demo-notice';

/**
 * Mounts the real nextcanvas overlay on the DEPLOYED landing page.
 *
 * The package's own <NextCanvasOverlay /> hard-returns when NODE_ENV is not
 * 'development', so this repeats its handful of mount steps rather than
 * changing the package. Everything else — the toolbar, editing, undo/redo, the
 * style and attribute panels — is the genuine article; only the backend differs
 * (see app/api/nextcanvas/edit/route.ts).
 *
 * Renders nothing in dev: there the package mounts itself from the root layout
 * and edits really do write to source.
 */
export function DemoCanvas() {
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') return;
    if (document.getElementById('nextcanvas-overlay-script')) return;

    // Defaults for a first-time visitor, seeded before the overlay reads them.
    // The tool starts OFF so the site behaves like a normal site, and Buttons
    // starts ON so that when it is switched on, links and controls keep working
    // instead of the page going inert. Existing choices are never overwritten.
    try {
      if (localStorage.getItem('nextcanvas:enabled') === null) {
        localStorage.setItem('nextcanvas:enabled', '0');
      }
      if (localStorage.getItem('nextcanvas:buttons') === null) {
        localStorage.setItem('nextcanvas:buttons', 'on');
      }
      setShowNotice(localStorage.getItem(NOTICE_KEY) !== 'dismissed');
    } catch {
      setShowNotice(true);
    }

    window.__NEXTCANVAS_SERVER__ = BASE;

    const s = document.createElement('script');
    s.id = 'nextcanvas-overlay-script';
    s.src = `${BASE}/overlay.js`;
    s.async = false;
    document.head.appendChild(s);
  }, []);

  function dismiss() {
    setShowNotice(false);
    try {
      localStorage.setItem(NOTICE_KEY, 'dismissed');
    } catch {
      // Storage unavailable: the notice simply returns next visit.
    }
  }

  if (!showNotice) return null;

  return (
    // data-nextcanvas-ui keeps the overlay's own click-blocking off this card,
    // so it stays dismissible even with the tool switched on and Buttons off.
    <div className="demo-notice" data-nextcanvas-ui role="note">
      <p className="demo-notice-title">this page is editable</p>
      <p>
        flip the nextcanvas switch in the toolbar, then double-click any text.
        changes stay in your browser — reload to reset. nothing here writes to a
        file.
      </p>
      <button type="button" onClick={dismiss}>
        got it
      </button>
    </div>
  );
}
