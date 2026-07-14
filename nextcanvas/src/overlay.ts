/**
 * nextcanvas browser overlay (vanilla DOM — no React coupling).
 *
 * Responsibilities:
 *   - highlight text-bearing elements on hover,
 *   - on double-click, make a static-text element editable,
 *   - track an undo/redo history of edits,
 *   - a bottom-right toolbar (like Next.js dev tools) with undo/redo, a mode
 *     switch (Autosave vs. Manual), a Save button, and a hide toggle,
 *   - write edits back to source via the write-back server.
 *
 * Source mapping uses the `data-loc="<absFile>:<line>:<col>"` attribute stamped
 * by the nextcanvas SWC plugin — NOT React internals.
 *
 * IMPORTANT: this file is served raw to the browser as a classic script and is
 * never bundled, so it must stay module-free — no imports, no exports.
 */

interface NextCanvasSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

interface Change {
  el: HTMLElement;
  source: NextCanvasSource;
  before: string;
  after: string;
}

type NextCanvasMode = 'autosave' | 'manual';

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

  const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

  function lsGet(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function lsSet(key: string, val: string): void {
    try {
      window.localStorage.setItem(key, val);
    } catch {
      /* ignore */
    }
  }

  // ---- state ---------------------------------------------------------------

  let mode: NextCanvasMode =
    lsGet('nextcanvas:mode') === 'manual' ? 'manual' : 'autosave';
  let hidden = lsGet('nextcanvas:hidden') === '1';

  const undoStack: Change[] = [];
  const redoStack: Change[] = [];
  // Manual-mode staging: element -> its original source text (+ location).
  const staged = new Map<HTMLElement, { source: NextCanvasSource; oldText: string }>();

  // ---- source resolution ---------------------------------------------------

  function inUI(el: EventTarget | null): boolean {
    return el instanceof Element && el.closest('[data-nextcanvas-ui]') !== null;
  }

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

  function isStaticTextEl(el: EventTarget | null): el is HTMLElement {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (inUI(el)) return false;
    if (el.isContentEditable) return false;
    // Must carry its OWN data-loc stamp. The SWC plugin only stamps host
    // elements whose sole child is static JSXText, so a rendered {expression}
    // (e.g. a code snippet or a bound value) — which looks identical in the DOM
    // (a single text node) — is left unstamped and therefore not editable. This
    // is what stops us outlining elements whose commit would bounce.
    if (!el.hasAttribute('data-loc')) return false;
    if (el.childNodes.length !== 1) return false;
    const only = el.childNodes[0];
    return only.nodeType === 3 && (el.textContent ?? '').trim().length > 0;
  }

  // ---- styles --------------------------------------------------------------

  const style = document.createElement('style');
  style.textContent = `
    .nextcanvas-outline {
      position: fixed; pointer-events: none; z-index: 2147483645;
      border: 1.5px solid #6d28d9; border-radius: 3px;
      background: rgba(109,40,217,0.06); transition: all .04s linear;
    }
    .nextcanvas-toast {
      position: fixed; bottom: 72px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647; font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
      background: #111; color: #fff; padding: 8px 12px; border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); max-width: 80vw;
    }
    .nextcanvas-toast.err { background: #7f1d1d; }
    [contenteditable].nextcanvas-active {
      outline: 2px solid #6d28d9; outline-offset: 2px; cursor: text;
    }
    .nc-root {
      position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
      font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
    }
    .nc-bar {
      display: flex; align-items: center; gap: 10px;
      background: #0d0d12; color: #f5f5f7;
      border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
      padding: 7px 8px 7px 12px; box-shadow: 0 8px 30px rgba(0,0,0,.5);
    }
    .nc-brand { font-weight: 600; letter-spacing: -0.01em; color: #a78bfa; white-space: nowrap; }
    .nc-modes { display: flex; background: rgba(255,255,255,0.06); border-radius: 8px; padding: 2px; }
    .nc-mode {
      border: 0; background: transparent; color: #a2a2b4; font: inherit;
      padding: 4px 9px; border-radius: 6px; cursor: pointer;
    }
    .nc-mode.nc-on { background: #6d28d9; color: #fff; }
    .nc-actions { display: flex; align-items: center; gap: 4px; }
    .nc-btn {
      border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04);
      color: #f5f5f7; width: 28px; height: 28px; border-radius: 7px; cursor: pointer;
      font-size: 14px; display: grid; place-items: center; padding: 0;
    }
    .nc-btn:hover:not(:disabled) { background: rgba(255,255,255,0.1); }
    .nc-btn:disabled { opacity: .35; cursor: default; }
    .nc-save {
      display: inline-flex; align-items: center; gap: 6px; border: 0;
      background: #6d28d9; color: #fff; font: inherit; font-weight: 600;
      padding: 6px 12px; border-radius: 8px; cursor: pointer;
    }
    .nc-save:hover:not(:disabled) { background: #7c3aed; }
    .nc-save:disabled { opacity: .4; cursor: default; }
    .nc-badge {
      background: rgba(255,255,255,0.25); border-radius: 999px; padding: 0 6px;
      font-size: 11px; min-width: 16px; text-align: center;
    }
    .nc-fab {
      width: 40px; height: 40px; border-radius: 50%; background: #6d28d9; color: #fff;
      border: 0; box-shadow: 0 8px 30px rgba(0,0,0,.5); cursor: pointer;
      font-size: 16px; display: grid; place-items: center;
    }
  `;
  document.head.appendChild(style);

  const outline = document.createElement('div');
  outline.className = 'nextcanvas-outline';
  outline.style.display = 'none';
  outline.setAttribute('data-nextcanvas-ui', '');
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
    t.setAttribute('data-nextcanvas-ui', '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), isErr ? 4000 : 2000);
  }

  // ---- toolbar -------------------------------------------------------------

  const ui = document.createElement('div');
  ui.className = 'nc-root';
  ui.setAttribute('data-nextcanvas-ui', '');
  ui.innerHTML = `
    <div class="nc-bar">
      <span class="nc-brand">◆ nextcanvas</span>
      <div class="nc-modes">
        <button class="nc-mode" data-mode="autosave" title="Edits write to source immediately">Autosave</button>
        <button class="nc-mode" data-mode="manual" title="Stage edits, then click Save">Manual</button>
      </div>
      <div class="nc-actions">
        <button class="nc-btn" data-act="undo" title="Undo (Ctrl/Cmd+Z)">↶</button>
        <button class="nc-btn" data-act="redo" title="Redo (Ctrl/Cmd+Shift+Z)">↷</button>
        <button class="nc-save" data-act="save" title="Write staged changes to source">Save <span class="nc-badge">0</span></button>
      </div>
      <button class="nc-btn nc-hide" data-act="hide" title="Hide toolbar">✕</button>
    </div>
    <button class="nc-fab" data-act="show" title="Show nextcanvas toolbar">◆</button>
  `;
  document.body.appendChild(ui);

  const q = <T extends HTMLElement>(sel: string): T => ui.querySelector(sel) as T;
  const barEl = q('.nc-bar');
  const fabEl = q('.nc-fab');
  const undoBtn = q<HTMLButtonElement>('[data-act="undo"]');
  const redoBtn = q<HTMLButtonElement>('[data-act="redo"]');
  const saveBtn = q<HTMLButtonElement>('[data-act="save"]');
  const badgeEl = q('.nc-badge');

  function stagedDirtyCount(): number {
    let n = 0;
    staged.forEach((info, el) => {
      if (norm(el.textContent ?? '') !== norm(info.oldText)) n++;
    });
    return n;
  }

  function refreshUI(): void {
    barEl.style.display = hidden ? 'none' : 'flex';
    fabEl.style.display = hidden ? 'grid' : 'none';
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
    const count = stagedDirtyCount();
    saveBtn.style.display = mode === 'manual' ? 'inline-flex' : 'none';
    saveBtn.disabled = count === 0;
    badgeEl.textContent = String(count);
    ui.querySelectorAll('.nc-mode').forEach((b) =>
      b.classList.toggle('nc-on', b.getAttribute('data-mode') === mode)
    );
  }

  // ---- server write --------------------------------------------------------

  async function writeSource(
    source: NextCanvasSource,
    oldText: string,
    newText: string
  ): Promise<{ ok: boolean; error?: string }> {
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
      return await res.json();
    } catch {
      return { ok: false, error: 'Could not reach the nextcanvas server' };
    }
  }

  // ---- edit lifecycle ------------------------------------------------------

  function commit(
    el: HTMLElement,
    source: NextCanvasSource,
    before: string,
    after: string
  ): void {
    if (norm(before) === norm(after)) return;
    const change: Change = { el, source, before, after };
    undoStack.push(change);
    redoStack.length = 0;

    if (mode === 'autosave') {
      writeSource(source, before, after).then((r) => {
        if (r.ok) {
          toast('Saved — Fast Refresh will update the view');
        } else {
          toast(r.error || 'Edit rejected', true);
          if (el.isConnected) el.textContent = before;
          const i = undoStack.indexOf(change);
          if (i >= 0) undoStack.splice(i, 1);
          refreshUI();
        }
      });
    } else {
      if (!staged.has(el)) staged.set(el, { source, oldText: before });
      toast('Staged — click Save to write to code');
    }
    refreshUI();
  }

  function undo(): void {
    const change = undoStack.pop();
    if (!change) return;
    if (change.el.isConnected) change.el.textContent = change.before;
    if (mode === 'autosave') {
      writeSource(change.source, change.after, change.before).then((r) => {
        if (!r.ok) toast(r.error || 'Undo failed', true);
      });
    } else {
      const s = staged.get(change.el);
      if (s && norm(change.before) === norm(s.oldText)) staged.delete(change.el);
    }
    redoStack.push(change);
    refreshUI();
  }

  function redo(): void {
    const change = redoStack.pop();
    if (!change) return;
    if (change.el.isConnected) change.el.textContent = change.after;
    if (mode === 'autosave') {
      writeSource(change.source, change.before, change.after).then((r) => {
        if (!r.ok) toast(r.error || 'Redo failed', true);
      });
    } else {
      if (!staged.has(change.el))
        staged.set(change.el, { source: change.source, oldText: change.before });
    }
    undoStack.push(change);
    refreshUI();
  }

  async function save(): Promise<void> {
    if (mode !== 'manual') return;
    const edits: Array<{
      source: NextCanvasSource;
      oldText: string;
      newText: string;
    }> = [];
    staged.forEach((info, el) => {
      const cur = el.textContent ?? '';
      if (norm(cur) !== norm(info.oldText))
        edits.push({ source: info.source, oldText: info.oldText, newText: cur });
    });
    if (edits.length === 0) {
      toast('No changes to save');
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const e of edits) {
      const r = await writeSource(e.source, e.oldText, e.newText);
      if (r.ok) ok++;
      else {
        failed++;
        toast(r.error || 'Save failed', true);
      }
    }
    staged.clear();
    undoStack.length = 0;
    redoStack.length = 0;
    toast(
      failed
        ? `Saved ${ok}, ${failed} failed`
        : `Saved ${ok} change${ok === 1 ? '' : 's'}`
    );
    refreshUI();
  }

  function setMode(m: NextCanvasMode): void {
    if (m === mode) return;
    if (m === 'autosave' && stagedDirtyCount() > 0) void save();
    mode = m;
    lsSet('nextcanvas:mode', m);
    refreshUI();
  }

  function setHidden(h: boolean): void {
    hidden = h;
    lsSet('nextcanvas:hidden', h ? '1' : '0');
    refreshUI();
  }

  ui.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const modeBtn = t.closest('[data-mode]');
    if (modeBtn) {
      setMode(modeBtn.getAttribute('data-mode') as NextCanvasMode);
      return;
    }
    const act = t.closest('[data-act]')?.getAttribute('data-act');
    if (act === 'undo') undo();
    else if (act === 'redo') redo();
    else if (act === 'save') void save();
    else if (act === 'hide') setHidden(true);
    else if (act === 'show') setHidden(false);
  });

  refreshUI();

  // ---- interaction ---------------------------------------------------------

  document.addEventListener(
    'mousemove',
    (e) => {
      const el = e.target;
      if (inUI(el)) {
        hideOutline();
        return;
      }
      if (el instanceof HTMLElement && el.isContentEditable) return;
      if (isStaticTextEl(el)) drawOutline(el);
      else hideOutline();
    },
    true
  );

  document.addEventListener('scroll', hideOutline, true);

  document.addEventListener(
    'dblclick',
    (e) => {
      const el = e.target;
      if (inUI(el)) return;
      if (!isStaticTextEl(el)) return;

      const source = getSource(el);
      if (!source) {
        toast('No source info for this element (is it dev mode?)', true);
        return;
      }

      e.preventDefault();
      hideOutline();

      el.dataset.nextCanvasOld = el.textContent ?? '';
      el.contentEditable = 'true';
      el.classList.add('nextcanvas-active');
      el.focus();

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

  // Enter / Escape while editing a field.
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

  // Global undo/redo shortcuts — only when NOT editing a field, so native
  // in-field undo keeps working while you type.
  document.addEventListener(
    'keydown',
    (e) => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.isContentEditable) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    },
    true
  );

  document.addEventListener(
    'blur',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.isContentEditable) return;

      el.contentEditable = 'false';
      el.classList.remove('nextcanvas-active');

      const oldText = el.dataset.nextCanvasOld ?? '';
      const newText = el.textContent ?? '';
      delete el.dataset.nextCanvasOld;

      if (norm(newText) === norm(oldText) || newText.trim() === '') {
        if (newText.trim() === '') el.textContent = oldText;
        return;
      }

      const source = getSource(el);
      if (!source) {
        el.textContent = oldText;
        toast('Lost source info; edit reverted', true);
        return;
      }

      commit(el, source, oldText, newText);
    },
    true
  );

  console.log(
    '[nextcanvas] overlay active — double-click any text to edit; toolbar bottom-right'
  );
});
