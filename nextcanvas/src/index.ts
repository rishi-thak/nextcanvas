'use client';

/**
 * <NextCanvasOverlay /> — mounts the browser overlay. Drop it once in app/layout:
 *
 *   import { NextCanvasOverlay } from 'nextcanvas';
 *   ...
 *   {process.env.NODE_ENV === 'development' && <NextCanvasOverlay />}
 *
 * It renders nothing. On mount it appends a <script> that loads the overlay
 * straight from the nextcanvas server as a raw classic script — so no bundler
 * (webpack or Turbopack) ever processes the overlay code. Works identically
 * under both bundlers. Safe to include twice; the overlay self-guards.
 */

import { useEffect } from 'react';

export function NextCanvasOverlay(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (typeof document === 'undefined') return;
    if (document.getElementById('nextcanvas-overlay-script')) return;

    // Port is inlined by withCanvas() (env.NEXTCANVAS_PORT). Publish the base
    // URL on window so the overlay script reads the same value.
    const port = process.env.NEXTCANVAS_PORT || '3131';
    const base = window.__NEXTCANVAS_SERVER__ || 'http://localhost:' + port;
    window.__NEXTCANVAS_SERVER__ = base;

    const s = document.createElement('script');
    s.id = 'nextcanvas-overlay-script';
    s.src = base + '/overlay.js';
    s.async = true;
    document.head.appendChild(s);
  }, []);

  return null;
}
