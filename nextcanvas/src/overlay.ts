/**
 * nextcanvas browser overlay (vanilla DOM — no React coupling).
 *
 * Responsibilities:
 *   - highlight text-bearing elements on hover,
 *   - on double-click, make a static-text element editable,
 *   - on single-click, select any stamped element and open a right-side style
 *     panel (color / background / font-size / weight / align / padding) that
 *     rewrites the element's inline style={{...}} in source,
 *   - track an undo/redo history of edits (text and style),
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

interface TextChange {
  kind: 'text';
  el: HTMLElement;
  source: NextCanvasSource;
  before: string;
  after: string;
}

interface StyleChange {
  kind: 'style';
  el: HTMLElement;
  source: NextCanvasSource;
  /** camelCase style key, e.g. "color", "fontSize". */
  property: string;
  /** Prior inline value ('' when the element had no inline value for it). */
  before: string;
  after: string;
}

type Change = TextChange | StyleChange;

type NextCanvasMode = 'autosave' | 'manual';

/** The design controls the style panel exposes, in render order. */
interface StyleControl {
  property: string; // camelCase DOM/React style key
  label: string;
  kind: 'color' | 'length' | 'weight' | 'align';
}

const STYLE_CONTROLS: StyleControl[] = [
  { property: 'color', label: 'Text', kind: 'color' },
  { property: 'backgroundColor', label: 'Background', kind: 'color' },
  { property: 'fontSize', label: 'Font size', kind: 'length' },
  { property: 'fontWeight', label: 'Weight', kind: 'weight' },
  { property: 'textAlign', label: 'Align', kind: 'align' },
  { property: 'padding', label: 'Padding', kind: 'length' },
];

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

  const BASE = window.__NEXTCANVAS_SERVER__ || 'http://localhost:3131';
  const SERVER = BASE + '/edit';
  const STYLE_SERVER = BASE + '/style';

  const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

  /** rgb()/rgba() → #rrggbb (drops alpha); pass through if already hex. */
  function rgbToHex(color: string): string {
    if (!color) return '#000000';
    if (color[0] === '#') return color;
    const m = color.match(/\d+(\.\d+)?/g);
    if (!m || m.length < 3) return '#000000';
    const hex = (n: string) =>
      Math.max(0, Math.min(255, Math.round(Number(n))))
        .toString(16)
        .padStart(2, '0');
    return '#' + hex(m[0]) + hex(m[1]) + hex(m[2]);
  }

  /** Is a computed color effectively transparent (so we show it as "unset")? */
  function isTransparent(color: string): boolean {
    if (!color) return true;
    const m = color.match(/[\d.]+/g);
    return color === 'transparent' || (m != null && m.length >= 4 && Number(m[3]) === 0);
  }

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
  // The element currently selected for styling (null when nothing is selected).
  let selected: HTMLElement | null = null;

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

  // Style editing is broader than text editing: any element carrying its own
  // `data-loc` stamp can have its inline style rewritten, regardless of whether
  // its children are static text (a <div className=...> wrapper is fair game).
  function isStylableEl(el: EventTarget | null): el is HTMLElement {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (inUI(el)) return false;
    if (el.isContentEditable) return false;
    return el.hasAttribute('data-loc');
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
    .nextcanvas-selected {
      position: fixed; pointer-events: none; z-index: 2147483644;
      border: 1.5px dashed #a78bfa; border-radius: 3px;
      box-shadow: 0 0 0 2px rgba(167,139,250,0.25);
    }
    .nc-panel {
      position: fixed; top: 16px; right: 16px; width: 244px; z-index: 2147483647;
      background: #0d0d12; color: #f5f5f7;
      border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,.5);
      font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
      overflow: hidden;
    }
    .nc-panel-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .nc-panel-title { font-weight: 600; color: #a78bfa; }
    .nc-panel-tag { color: #6b7280; font-family: ui-monospace, monospace; }
    .nc-panel-body { padding: 6px 12px 12px; display: flex; flex-direction: column; gap: 2px; }
    .nc-row {
      display: flex; align-items: center; gap: 8px; min-height: 34px;
    }
    .nc-row > label { flex: 0 0 74px; color: #a2a2b4; }
    .nc-row > .nc-ctl { flex: 1 1 auto; display: flex; align-items: center; gap: 6px; }
    .nc-swatch {
      width: 24px; height: 24px; padding: 0; border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px; background: none; cursor: pointer;
    }
    .nc-swatch::-webkit-color-swatch-wrapper { padding: 2px; }
    .nc-swatch::-webkit-color-swatch { border: none; border-radius: 4px; }
    .nc-hex, .nc-len {
      flex: 1 1 auto; width: 100%; min-width: 0; box-sizing: border-box;
      background: rgba(255,255,255,0.05); color: #f5f5f7;
      border: 1px solid rgba(255,255,255,0.12); border-radius: 6px;
      padding: 5px 7px; font: inherit; font-family: ui-monospace, monospace;
    }
    .nc-hex:focus, .nc-len:focus { outline: 1px solid #6d28d9; }
    .nc-seg { display: flex; background: rgba(255,255,255,0.06); border-radius: 7px; padding: 2px; gap: 2px; }
    .nc-seg button {
      flex: 1 1 auto; border: 0; background: transparent; color: #a2a2b4;
      font: inherit; padding: 4px 0; border-radius: 5px; cursor: pointer; min-width: 26px;
    }
    .nc-seg button.nc-on { background: #6d28d9; color: #fff; }
    .nc-clear {
      border: 0; background: transparent; color: #6b7280; cursor: pointer;
      font-size: 14px; padding: 0 2px; line-height: 1;
    }
    .nc-clear:hover { color: #f5f5f7; }
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

  // Persistent outline for the element selected in the style panel.
  const selOutline = document.createElement('div');
  selOutline.className = 'nextcanvas-selected';
  selOutline.style.display = 'none';
  selOutline.setAttribute('data-nextcanvas-ui', '');
  document.body.appendChild(selOutline);

  function drawSelOutline(): void {
    if (!selected || !selected.isConnected) return;
    const r = selected.getBoundingClientRect();
    selOutline.style.display = 'block';
    selOutline.style.left = r.left + 'px';
    selOutline.style.top = r.top + 'px';
    selOutline.style.width = r.width + 'px';
    selOutline.style.height = r.height + 'px';
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

  async function writeStyle(
    source: NextCanvasSource,
    property: string,
    value: string
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(STYLE_SERVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: source.fileName,
          lineNumber: source.lineNumber,
          columnNumber: source.columnNumber,
          property,
          value,
        }),
      });
      return await res.json();
    } catch {
      return { ok: false, error: 'Could not reach the nextcanvas server' };
    }
  }

  /** Set or clear one inline style property in the live DOM (instant preview). */
  function applyInlineStyle(el: HTMLElement, property: string, value: string): void {
    // Indexing the CSSStyleDeclaration by camelCase key; '' removes it.
    (el.style as unknown as Record<string, string>)[property] = value;
  }

  // ---- edit lifecycle ------------------------------------------------------

  function commit(
    el: HTMLElement,
    source: NextCanvasSource,
    before: string,
    after: string
  ): void {
    if (norm(before) === norm(after)) return;
    const change: Change = { kind: 'text', el, source, before, after };
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

  // Commit one style property change. Unlike text, style edits always write to
  // source immediately (no manual staging in v1), but they DO ride the shared
  // undo/redo stack. `before` is the element's prior *inline* value ('' if the
  // property wasn't inline-set), so undo restores it — including removing an
  // inline value we introduced.
  function commitStyle(
    el: HTMLElement,
    source: NextCanvasSource,
    property: string,
    before: string,
    after: string
  ): void {
    if (before === after) return;
    applyInlineStyle(el, property, after);
    const change: StyleChange = { kind: 'style', el, source, property, before, after };
    undoStack.push(change);
    redoStack.length = 0;
    writeStyle(source, property, after).then((r) => {
      if (r.ok) {
        toast('Styled — Fast Refresh will update the view');
      } else {
        toast(r.error || 'Style edit rejected', true);
        if (el.isConnected) applyInlineStyle(el, property, before);
        const i = undoStack.indexOf(change);
        if (i >= 0) undoStack.splice(i, 1);
        if (selected === el) populatePanel();
        refreshUI();
      }
    });
    refreshUI();
  }

  // Roll `change` to one of its ends: `before` when undoing, `after` when
  // redoing. Style edits always write to source (they don't participate in
  // manual-mode text staging).
  function applyChange(change: Change, to: 'before' | 'after'): void {
    const value = change[to];
    if (change.kind === 'style') {
      if (change.el.isConnected) applyInlineStyle(change.el, change.property, value);
      writeStyle(change.source, change.property, value).then((r) => {
        if (!r.ok) toast(r.error || 'Style change failed', true);
      });
      if (selected === change.el) populatePanel();
      return;
    }
    if (change.el.isConnected) change.el.textContent = value;
    if (mode === 'autosave') {
      const from = to === 'before' ? change.after : change.before;
      writeSource(change.source, from, value).then((r) => {
        if (!r.ok) toast(r.error || 'Change failed', true);
      });
    } else if (to === 'before') {
      const s = staged.get(change.el);
      if (s && norm(value) === norm(s.oldText)) staged.delete(change.el);
    } else if (!staged.has(change.el)) {
      staged.set(change.el, { source: change.source, oldText: change.before });
    }
  }

  function undo(): void {
    const change = undoStack.pop();
    if (!change) return;
    applyChange(change, 'before');
    redoStack.push(change);
    refreshUI();
  }

  function redo(): void {
    const change = redoStack.pop();
    if (!change) return;
    applyChange(change, 'after');
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

  // ---- style panel ---------------------------------------------------------

  function rowHtml(c: StyleControl): string {
    const head = `<div class="nc-row" data-prop="${c.property}"><label>${c.label}</label><div class="nc-ctl">`;
    const clear = `<button class="nc-clear" data-role="clear" title="Remove inline value">×</button>`;
    if (c.kind === 'color') {
      return (
        head +
        `<input type="color" class="nc-swatch" data-role="swatch">` +
        `<input type="text" class="nc-hex" data-role="hex" spellcheck="false" placeholder="—">` +
        clear +
        `</div></div>`
      );
    }
    if (c.kind === 'weight') {
      return (
        head +
        `<select class="nc-len" data-role="weight">` +
        ['', '300', '400', '500', '600', '700']
          .map(
            (v) =>
              `<option value="${v}">${
                v === ''
                  ? '—'
                  : { '300': 'Light', '400': 'Normal', '500': 'Medium', '600': 'Semibold', '700': 'Bold' }[
                      v
                    ] +
                    ' ' +
                    v
              }</option>`
          )
          .join('') +
        `</select>` +
        `</div></div>`
      );
    }
    if (c.kind === 'align') {
      return (
        head +
        `<div class="nc-seg" data-role="align">` +
        [
          ['left', 'L'],
          ['center', 'C'],
          ['right', 'R'],
          ['justify', 'J'],
        ]
          .map(([v, t]) => `<button data-val="${v}" title="${v}">${t}</button>`)
          .join('') +
        `</div></div></div>`
      );
    }
    // length
    return (
      head +
      `<input type="text" class="nc-len" data-role="len" spellcheck="false" placeholder="—">` +
      clear +
      `</div></div>`
    );
  }

  const panel = document.createElement('div');
  panel.className = 'nc-panel';
  panel.setAttribute('data-nextcanvas-ui', '');
  panel.style.display = 'none';
  panel.innerHTML =
    `<div class="nc-panel-head"><span class="nc-panel-title">◆ Style <span class="nc-panel-tag"></span></span>` +
    `<button class="nc-btn" data-role="close" title="Deselect (Esc)">✕</button></div>` +
    `<div class="nc-panel-body">${STYLE_CONTROLS.map(rowHtml).join('')}</div>`;
  document.body.appendChild(panel);
  const panelTag = panel.querySelector('.nc-panel-tag') as HTMLElement;

  function rowFor(property: string): HTMLElement | null {
    return panel.querySelector(`.nc-row[data-prop="${property}"]`);
  }

  // Fill every control from the selected element's *computed* style, so a value
  // coming from a CSS class (not an inline style) is still shown and editable.
  function populatePanel(): void {
    if (!selected) return;
    const cs = getComputedStyle(selected);
    for (const c of STYLE_CONTROLS) {
      const row = rowFor(c.property);
      if (!row) continue;
      const raw = cs.getPropertyValue(
        c.property.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
      );
      if (c.kind === 'color') {
        const swatch = row.querySelector('[data-role="swatch"]') as HTMLInputElement;
        const hex = row.querySelector('[data-role="hex"]') as HTMLInputElement;
        const transparent = c.property === 'backgroundColor' && isTransparent(raw);
        swatch.value = rgbToHex(raw);
        hex.value = transparent ? '' : rgbToHex(raw);
      } else if (c.kind === 'weight') {
        const sel = row.querySelector('[data-role="weight"]') as HTMLSelectElement;
        sel.value = ['300', '400', '500', '600', '700'].includes(raw) ? raw : '';
      } else if (c.kind === 'align') {
        const norm = raw === 'start' ? 'left' : raw === 'end' ? 'right' : raw;
        row.querySelectorAll('[data-val]').forEach((b) =>
          b.classList.toggle('nc-on', b.getAttribute('data-val') === norm)
        );
      } else {
        const len = row.querySelector('[data-role="len"]') as HTMLInputElement;
        len.value = raw;
      }
    }
  }

  function applyControl(property: string, value: string): void {
    if (!selected) return;
    const source = getSource(selected);
    if (!source) {
      toast('Lost source info for this element', true);
      return;
    }
    const before = (selected.style as unknown as Record<string, string>)[property] || '';
    commitStyle(selected, source, property, before, value || '');
    populatePanel();
  }

  function selectEl(el: HTMLElement): void {
    selected = el;
    panelTag.textContent = '<' + el.tagName.toLowerCase() + '>';
    panel.style.display = 'block';
    populatePanel();
    drawSelOutline();
  }

  function deselect(): void {
    if (!selected) return;
    selected = null;
    panel.style.display = 'none';
    selOutline.style.display = 'none';
  }

  // Commit on `change` (fires when the color picker closes or a field blurs),
  // not on every `input`, so dragging the picker doesn't flood the undo stack.
  panel.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest('.nc-row');
    const property = row?.getAttribute('data-prop');
    const role = t.getAttribute('data-role');
    if (!property) return;
    if (role === 'swatch') applyControl(property, (t as HTMLInputElement).value);
    else if (role === 'hex') applyControl(property, (t as HTMLInputElement).value.trim());
    else if (role === 'len') applyControl(property, (t as HTMLInputElement).value.trim());
    else if (role === 'weight') applyControl(property, (t as HTMLSelectElement).value);
  });

  // Enter commits a text field without waiting for blur.
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  });

  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-role="close"]')) {
      deselect();
      return;
    }
    const alignBtn = t.closest('.nc-seg [data-val]');
    if (alignBtn) {
      const property = alignBtn.closest('.nc-row')?.getAttribute('data-prop');
      if (property) applyControl(property, alignBtn.getAttribute('data-val') || '');
      return;
    }
    const clearBtn = t.closest('[data-role="clear"]');
    if (clearBtn) {
      const property = clearBtn.closest('.nc-row')?.getAttribute('data-prop');
      if (property) applyControl(property, '');
      return;
    }
  });

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

  document.addEventListener(
    'scroll',
    () => {
      hideOutline();
      drawSelOutline();
    },
    true
  );
  window.addEventListener('resize', drawSelOutline);

  // Single-click selects a stamped element for styling (double-click still
  // enters text editing; the two coexist — selecting is harmless). Clicking
  // empty space or a non-stamped element deselects.
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target;
      if (inUI(el)) return;
      if (el instanceof HTMLElement && el.isContentEditable) return;
      if (isStylableEl(el)) selectEl(el);
      else deselect();
    },
    true
  );

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
      if (e.key === 'Escape' && selected && !inUI(active)) {
        deselect();
        return;
      }
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
