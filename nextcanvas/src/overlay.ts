/**
 * nextcanvas browser overlay (vanilla DOM — no React coupling).
 *
 * Responsibilities:
 *   - highlight text-bearing elements on hover,
 *   - on double-click, make a static-text element editable,
 *   - on commit, resolve the element's source location from the compile-time
 *     `data-loc` stamp and POST the edit to the write-back server.
 *
 * Source mapping uses the `data-loc="<absFile>:<line>:<col>"` attribute stamped
 * by the nextcanvas Babel plugin — NOT React internals. (`fiber._debugSource`
 * is not populated in current Next App Router / React 18 dev builds.)
 *
 * IMPORTANT: this file is served raw to the browser as a classic script and is
 * never bundled, so it must stay module-free — no imports, no exports. tsc
 * compiles it to a plain script in dist/overlay.js.
 */

interface NextCanvasSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

function whenBodyReady(fn: () => void): void {
  if (typeof document === 'undefined') return;
  if (document.body) {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }
}

whenBodyReady(function initNextCanvas(): void {
  if (typeof window === 'undefined') return;
  if (window.__nextCanvasLoaded) return;
  window.__nextCanvasLoaded = true;

  const SERVER =
    (window.__NEXTCANVAS_SERVER__ || 'http://localhost:3131') + '/edit';

  // ---- source resolution ---------------------------------------------------

  // Read the compile-time `data-loc="<absFile>:<line>:<col>"` stamp off the
  // nearest element (self or ancestor). Parsed from the right so Windows drive
  // letters (C:\...) don't break on the path's own colon.
  function getSource(el: Element): NextCanvasSource | null {
    const node = el.closest ? el.closest('[data-loc]') : null;
    if (!node) return null;
    const raw = node.getAttribute('data-loc');
    if (!raw) return null;
    const iCol = raw.lastIndexOf(':');
    const iLine = raw.lastIndexOf(':', iCol - 1);
    if (iCol < 0 || iLine < 0) return null;
    return {
      fileName: raw.slice(0, iLine),
      lineNumber: Number(raw.slice(iLine + 1, iCol)),
      columnNumber: Number(raw.slice(iCol + 1)),
    };
  }

  // A DOM element is "editable static text" when its only child is a text node.
  function isStaticTextEl(el: EventTarget | null): el is HTMLElement {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return false;
    if (el.childNodes.length !== 1) return false;
    const only = el.childNodes[0];
    return only.nodeType === 3 && (el.textContent ?? '').trim().length > 0;
  }

  // ---- visual overlay ------------------------------------------------------

  const style = document.createElement('style');
  style.textContent = `
    .nextcanvas-outline {
      position: fixed; pointer-events: none; z-index: 2147483646;
      border: 1.5px solid #6d28d9; border-radius: 3px;
      background: rgba(109,40,217,0.06); transition: all .04s linear;
    }
    .nextcanvas-toast {
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647; font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
      background: #111; color: #fff; padding: 8px 12px; border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); max-width: 80vw;
    }
    .nextcanvas-toast.err { background: #7f1d1d; }
    [contenteditable].nextcanvas-active {
      outline: 2px solid #6d28d9; outline-offset: 2px; cursor: text;
    }
  `;
  document.head.appendChild(style);

  const outline = document.createElement('div');
  outline.className = 'nextcanvas-outline';
  outline.style.display = 'none';
  document.body.appendChild(outline);

  function drawOutline(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = r.left + 'px';
    outline.style.top = r.top + 'px';
    outline.style.width = r.width + 'px';
    outline.style.height = r.height + 'px';
  }
  function hideOutline(): void {
    outline.style.display = 'none';
  }

  function toast(msg: string, isErr?: boolean): void {
    const t = document.createElement('div');
    t.className = 'nextcanvas-toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), isErr ? 4000 : 2000);
  }

  // ---- interaction ---------------------------------------------------------

  let hovered: HTMLElement | null = null;

  document.addEventListener(
    'mousemove',
    (e) => {
      const el = e.target;
      if (el instanceof HTMLElement && el.isContentEditable) return;
      if (isStaticTextEl(el)) {
        hovered = el;
        drawOutline(el);
      } else {
        hovered = null;
        hideOutline();
      }
    },
    true
  );

  document.addEventListener('scroll', hideOutline, true);

  document.addEventListener(
    'dblclick',
    (e) => {
      const el = e.target;
      if (!isStaticTextEl(el)) return;

      const source = getSource(el);
      if (!source) {
        toast('No source info for this element (is it dev mode?)', true);
        return;
      }

      e.preventDefault();
      hideOutline();

      const oldText = el.textContent ?? '';
      el.dataset.nextCanvasOld = oldText;
      el.contentEditable = 'true';
      el.classList.add('nextcanvas-active');
      el.focus();

      // Select all text for quick replacement.
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.isContentEditable) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      } else if (e.key === 'Escape') {
        el.textContent = el.dataset.nextCanvasOld ?? el.textContent;
        el.blur();
      }
    },
    true
  );

  document.addEventListener(
    'blur',
    async (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.isContentEditable) return;

      el.contentEditable = 'false';
      el.classList.remove('nextcanvas-active');

      const oldText = el.dataset.nextCanvasOld ?? '';
      const newText = el.textContent ?? '';
      delete el.dataset.nextCanvasOld;

      if (newText === oldText || newText.trim() === '') {
        if (newText.trim() === '') el.textContent = oldText;
        return;
      }

      const source = getSource(el);
      if (!source) {
        el.textContent = oldText;
        toast('Lost source info; edit reverted', true);
        return;
      }

      try {
        const res = await fetch(SERVER, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: source.fileName,
            lineNumber: source.lineNumber,
            columnNumber: source.columnNumber,
            oldText,
            newText,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          toast('Saved — Fast Refresh will update the view');
        } else {
          el.textContent = oldText;
          toast(data.error || 'Edit rejected', true);
        }
      } catch (err) {
        el.textContent = oldText;
        toast('Could not reach the nextcanvas server', true);
      }
    },
    true
  );

  console.log('[nextcanvas] overlay active — double-click any text to edit');
});
