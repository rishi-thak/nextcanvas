/**
 * nextcanvas browser overlay (vanilla DOM — no React coupling).
 *
 * Responsibilities:
 *   - highlight text-bearing elements on hover,
 *   - on double-click, make a text element editable — plain static text, or
 *     text runs mixed with inline child elements (which are locked + preserved),
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
  // One entry per non-whitespace text run of the element (a single-text element
  // is just a one-run edit). `mixed` selects the segmented server protocol and
  // the run-aware DOM restore that preserves inline child elements.
  before: string[];
  after: string[];
  mixed: boolean;
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

  // sessionStorage — scoped to the tab/session: survives reloads, resets when
  // the session ends. Used for the "hide for this session" dismissal.
  function ssGet(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function ssSet(key: string, val: string): void {
    try {
      window.sessionStorage.setItem(key, val);
    } catch {
      /* ignore */
    }
  }

  // ---- state ---------------------------------------------------------------

  let mode: NextCanvasMode =
    lsGet('nextcanvas:mode') === 'manual' ? 'manual' : 'autosave';
  let hidden = lsGet('nextcanvas:hidden') === '1';
  // Fully dismissed for this session — hides the whole UI, logo included.
  let dismissed = ssGet('nextcanvas:dismissed') === '1';

  const undoStack: Change[] = [];
  const redoStack: Change[] = [];
  // Manual-mode staging: element -> its original text runs (+ location, mixed).
  const staged = new Map<
    HTMLElement,
    { source: NextCanvasSource; oldRuns: string[]; mixed: boolean }
  >();
  // In-flight edit snapshot, captured on dblclick: the original text runs and
  // the inline child elements (to detect structural changes on commit).
  const editSnapshots = new WeakMap<
    HTMLElement,
    { oldRuns: string[]; elemChildren: Element[]; mixed: boolean; html: string }
  >();

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

  function isEditableEl(el: EventTarget | null): el is HTMLElement {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (inUI(el)) return false;
    if (el.isContentEditable) return false;
    // Must carry its OWN data-loc stamp. The SWC plugin only stamps host
    // elements that have at least one non-whitespace static-text run and no
    // direct {expression} child, so bound values and expression-only elements
    // are left unstamped (and therefore not editable) — this is what stops us
    // outlining elements whose commit would bounce.
    if (!el.hasAttribute('data-loc')) return false;
    // Editable if it has at least one non-whitespace DIRECT text run. Mixed
    // children (text + inline elements) qualify; a container of only elements
    // or only whitespace does not.
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === 3 && (n.nodeValue ?? '').trim() !== '') return true;
    }
    return false;
  }

  // The element's non-whitespace DIRECT text nodes, in order. normalize() first
  // so browser-split/merged text nodes collapse to one node per run — making the
  // run count stable as long as the inline child elements are unchanged.
  function textRunNodes(el: HTMLElement): Text[] {
    el.normalize();
    const out: Text[] = [];
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === 3 && (n.nodeValue ?? '').trim() !== '') out.push(n as Text);
    }
    return out;
  }
  function readRuns(el: HTMLElement): string[] {
    return textRunNodes(el).map((n) => n.nodeValue ?? '');
  }
  function runsEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((x, i) => norm(x) === norm(b[i]));
  }
  // Restore text runs into the DOM (best-effort; used for revert/undo/redo).
  function applyDom(el: HTMLElement, runs: string[], mixed: boolean): void {
    if (!mixed) {
      el.textContent = runs[0] ?? '';
      return;
    }
    const nodes = textRunNodes(el);
    if (nodes.length !== runs.length) return; // structure drifted; leave as-is
    nodes.forEach((n, i) => {
      n.nodeValue = runs[i];
    });
  }
  // Undo the contentEditable="false" locks placed on inline children on entry.
  function unlockChildren(el: HTMLElement): void {
    el.querySelectorAll('[data-nc-locked]').forEach((c) => {
      c.removeAttribute('contenteditable');
      c.removeAttribute('data-nc-locked');
    });
  }
  // Discard an in-flight edit and restore the element to its pre-edit state.
  // Mixed elements restore from the HTML snapshot (robust even if the user broke
  // structure); plain elements just reset their text.
  function revertEdit(
    el: HTMLElement,
    snap: { oldRuns: string[]; mixed: boolean; html: string }
  ): void {
    if (snap.mixed) el.innerHTML = snap.html;
    else el.textContent = snap.oldRuns[0] ?? '';
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
      <button class="nc-btn nc-hide" data-act="hide" title="Collapse to logo">–</button>
      <button class="nc-btn nc-dismiss" data-act="dismiss" title="Hide for this session (returns on a new session)">✕</button>
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
      if (!runsEqual(readRuns(el), info.oldRuns)) n++;
    });
    return n;
  }

  function refreshUI(): void {
    // Dismissed hides the whole root (bar + logo); otherwise the hidden flag
    // toggles between the expanded bar and the collapsed logo FAB.
    ui.style.display = dismissed ? 'none' : '';
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

  async function postEdit(
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(SERVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch {
      return { ok: false, error: 'Could not reach the nextcanvas server' };
    }
  }

  // Write a run-set edit: legacy single-text payload for a plain element, or the
  // `segments` payload (one entry per text run) for a mixed element.
  function writeChange(
    source: NextCanvasSource,
    from: string[],
    to: string[],
    mixed: boolean
  ): Promise<{ ok: boolean; error?: string }> {
    const base = {
      fileName: source.fileName,
      lineNumber: source.lineNumber,
      columnNumber: source.columnNumber,
    };
    if (!mixed) {
      return postEdit({ ...base, oldText: from[0], newText: to[0] });
    }
    const segments = from.map((oldText, i) => ({ oldText, newText: to[i] }));
    return postEdit({ ...base, segments });
  }

  // ---- edit lifecycle ------------------------------------------------------

  function commit(
    el: HTMLElement,
    source: NextCanvasSource,
    before: string[],
    after: string[],
    mixed: boolean
  ): void {
    if (runsEqual(before, after)) return;
    const change: Change = { el, source, before, after, mixed };
    undoStack.push(change);
    redoStack.length = 0;

    if (mode === 'autosave') {
      writeChange(source, before, after, mixed).then((r) => {
        if (r.ok) {
          toast('Saved — Fast Refresh will update the view');
        } else {
          toast(r.error || 'Edit rejected', true);
          if (el.isConnected) applyDom(el, before, mixed);
          const i = undoStack.indexOf(change);
          if (i >= 0) undoStack.splice(i, 1);
          refreshUI();
        }
      });
    } else {
      if (!staged.has(el)) staged.set(el, { source, oldRuns: before, mixed });
      toast('Staged — click Save to write to code');
    }
    refreshUI();
  }

  function undo(): void {
    const change = undoStack.pop();
    if (!change) return;
    if (change.el.isConnected) applyDom(change.el, change.before, change.mixed);
    if (mode === 'autosave') {
      writeChange(change.source, change.after, change.before, change.mixed).then(
        (r) => {
          if (!r.ok) toast(r.error || 'Undo failed', true);
        }
      );
    } else {
      const s = staged.get(change.el);
      if (s && runsEqual(change.before, s.oldRuns)) staged.delete(change.el);
    }
    redoStack.push(change);
    refreshUI();
  }

  function redo(): void {
    const change = redoStack.pop();
    if (!change) return;
    if (change.el.isConnected) applyDom(change.el, change.after, change.mixed);
    if (mode === 'autosave') {
      writeChange(change.source, change.before, change.after, change.mixed).then(
        (r) => {
          if (!r.ok) toast(r.error || 'Redo failed', true);
        }
      );
    } else {
      if (!staged.has(change.el))
        staged.set(change.el, {
          source: change.source,
          oldRuns: change.before,
          mixed: change.mixed,
        });
    }
    undoStack.push(change);
    refreshUI();
  }

  async function save(): Promise<void> {
    if (mode !== 'manual') return;
    const edits: Array<{
      source: NextCanvasSource;
      from: string[];
      to: string[];
      mixed: boolean;
    }> = [];
    staged.forEach((info, el) => {
      const cur = readRuns(el);
      if (!runsEqual(cur, info.oldRuns))
        edits.push({ source: info.source, from: info.oldRuns, to: cur, mixed: info.mixed });
    });
    if (edits.length === 0) {
      toast('No changes to save');
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const e of edits) {
      const r = await writeChange(e.source, e.from, e.to, e.mixed);
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

  function setDismissed(d: boolean): void {
    dismissed = d;
    ssSet('nextcanvas:dismissed', d ? '1' : '0');
    if (d) {
      // eslint-disable-next-line no-console
      console.info(
        "[nextcanvas] toolbar hidden for this session — run sessionStorage.removeItem('nextcanvas:dismissed') and reload to bring it back"
      );
    }
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
    else if (act === 'dismiss') setDismissed(true);
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
      if (isEditableEl(el)) drawOutline(el);
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
      if (!isEditableEl(el)) return;

      const source = getSource(el);
      if (!source) {
        toast('No source info for this element (is it dev mode?)', true);
        return;
      }

      e.preventDefault();
      hideOutline();

      const mixed = el.children.length > 0;
      editSnapshots.set(el, {
        oldRuns: readRuns(el),
        elemChildren: Array.from(el.children),
        mixed,
        html: el.innerHTML,
      });
      el.dataset.ncMixed = mixed ? '1' : '0';
      el.contentEditable = 'true';
      el.classList.add('nextcanvas-active');

      // For mixed elements, lock the inline children so the caret can't enter
      // them — you edit only the surrounding text, and they're preserved as-is.
      if (mixed) {
        for (let i = 0; i < el.children.length; i++) {
          const c = el.children[i] as HTMLElement;
          c.setAttribute('data-nc-locked', '');
          c.contentEditable = 'false';
        }
      }

      el.focus();

      // Plain text: select the whole label (convenient overwrite). Mixed: keep
      // the browser's native double-click word selection so we don't span the
      // inline elements.
      if (!mixed) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
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
        const snap = editSnapshots.get(el);
        if (snap) revertEdit(el, snap);
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
      unlockChildren(el);

      const snap = editSnapshots.get(el);
      editSnapshots.delete(el);
      const mixed = el.dataset.ncMixed === '1';
      delete el.dataset.ncMixed;
      if (!snap) return;

      const source = getSource(el);
      if (!source) {
        revertEdit(el, snap);
        toast('Lost source info; edit reverted', true);
        return;
      }

      if (!mixed) {
        const oldText = snap.oldRuns[0] ?? '';
        const newText = el.textContent ?? '';
        if (norm(newText) === norm(oldText) || newText.trim() === '') {
          if (newText.trim() === '') el.textContent = oldText;
          return;
        }
        commit(el, source, [oldText], [newText], false);
        return;
      }

      // Mixed: the inline child elements must be unchanged and each text run must
      // stay non-empty, so the positional run mapping holds. Otherwise revert.
      const elemsNow = Array.from(el.children);
      const structOk =
        snap.elemChildren.length === elemsNow.length &&
        snap.elemChildren.every((c, i) => c === elemsNow[i]);
      const newRuns = readRuns(el);
      if (!structOk || newRuns.length !== snap.oldRuns.length) {
        revertEdit(el, snap);
        toast('Reverted — only in-place text edits are supported here', true);
        return;
      }
      if (runsEqual(newRuns, snap.oldRuns)) return;
      commit(el, source, snap.oldRuns, newRuns, true);
    },
    true
  );

  console.log(
    '[nextcanvas] overlay active — double-click any text to edit; toolbar bottom-right'
  );
});
