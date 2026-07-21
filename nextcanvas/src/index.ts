'use client';

/**
 * <NextCanvasOverlay /> — mounts the browser overlay. Drop it once in app/layout:
 *
 *   import { NextCanvasOverlay } from '@rishi-thak/nextcanvas';
 *   ...
 *   {process.env.NODE_ENV === 'development' && <NextCanvasOverlay />}
 *
 * It renders nothing. On mount it:
 *   1. installs a provisional Buttons-off event blocker (so Next `<Link>` /
 *      Motion taps can't race ahead of the async overlay script),
 *   2. appends a `<script>` that loads the overlay straight from the nextcanvas
 *      server as a raw classic script — so no bundler ever processes it.
 *
 * Works identically under webpack and Turbopack. Safe to include twice; the
 * overlay self-guards.
 */

import { useEffect } from 'react';

/**
 * Capture-phase blockers that run the moment the React effect fires — before
 * `overlay.js` has been fetched. Without this, a fast click on a `<Link>` or
 * Motion button can navigate/fire before the real overlay attaches.
 * Mirrors the overlay's Buttons-off defaults (enabled on, buttons off).
 */
function installBootBlockers(): () => void {
  const ls = (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };

  const shouldBlock = (e: Event): boolean => {
    if (ls('nextcanvas:enabled') === '0') return false;
    if (ls('nextcanvas:buttons') === 'on') return false;
    const el = e.target;
    if (!(el instanceof Element)) return true;
    if (el.closest('[data-nextcanvas-ui]')) return false;
    if (el instanceof HTMLElement && el.isContentEditable) return false;
    return true;
  };

  const stopOnly = (e: Event): void => {
    if (!shouldBlock(e)) return;
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const stopAndPrevent = (e: Event): void => {
    if (!shouldBlock(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  // window capture = earliest possible; covers Link soft-nav + Motion gestures.
  window.addEventListener('pointerdown', stopOnly, true);
  window.addEventListener('mousedown', stopOnly, true);
  window.addEventListener('click', stopAndPrevent, true);
  window.addEventListener('auxclick', stopAndPrevent, true);

  return () => {
    window.removeEventListener('pointerdown', stopOnly, true);
    window.removeEventListener('mousedown', stopOnly, true);
    window.removeEventListener('click', stopAndPrevent, true);
    window.removeEventListener('auxclick', stopAndPrevent, true);
  };
}

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

    // Block page interaction immediately; overlay.js replaces these on init.
    window.__nextCanvasBootCleanup?.();
    window.__nextCanvasBootCleanup = installBootBlockers();

    const s = document.createElement('script');
    s.id = 'nextcanvas-overlay-script';
    s.src = base + '/overlay.js';
    // Non-async so the script runs as soon as it downloads (still after this
    // effect, but without yielding to other deferred work first).
    s.async = false;
    document.head.appendChild(s);
  }, []);

  return null;
}
