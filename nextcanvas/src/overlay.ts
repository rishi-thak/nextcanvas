/**
 * nextcanvas browser overlay (vanilla DOM — no React coupling).
 *
 * Responsibilities:
 *   - highlight text-bearing elements on hover,
 *   - on double-click, make a text element editable — plain static text, or
 *     text runs mixed with inline child elements (which are locked + preserved),
 *   - on hover, offer an attribute chip/panel for editable string-literal attrs
 *     (src / href / alt / …),
 *   - on single-click, select any stamped element and open a right-side style
 *     panel (color / background / font-size / weight / align / padding) that
 *     rewrites the element's inline style={{...}} in source,
 *   - track an undo/redo history of edits (text, attribute, and style),
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

// A text edit. `before`/`after` hold one entry per non-whitespace text run of
// the element (a plain single-text element is just a one-run edit). `mixed`
// selects the segmented server protocol and the run-aware DOM restore that
// preserves inline child elements.
interface TextChange {
  kind: 'text';
  el: HTMLElement;
  source: NextCanvasSource;
  before: string[];
  after: string[];
  mixed: boolean;
}

// An attribute edit (src/href/alt/…); before/after are the attribute's string
// value. Rewritten via the server's attrName path.
interface AttrChange {
  kind: 'attr';
  el: HTMLElement;
  source: NextCanvasSource;
  attr: string;
  before: string;
  after: string;
  // Set for a bound-identifier attr (`href={VAR}`). `scope` records the user's
  // choice: 'all' rewrites the shared variable, 'one' inlines a literal here.
  bound?: boolean;
  scope?: 'all' | 'one';
}

// A style edit: one inline style property. `before` is the element's prior
// *inline* value ('' if the property wasn't inline-set), so undo restores it.
interface StyleChange {
  kind: 'style';
  el: HTMLElement;
  source: NextCanvasSource;
  /** camelCase style key, e.g. "color", "fontSize". */
  property: string;
  before: string;
  after: string;
}

type Change = TextChange | AttrChange | StyleChange;
// Text and attribute edits share the autosave/manual-staging lifecycle (style
// edits always write immediately, so they bypass these helpers).
type EditChange = TextChange | AttrChange;

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
  // "Buttons" toggle. OFF (default) = edit mode: the page is inert so clicks
  // don't navigate/scroll/fire handlers, letting you select and edit freely.
  // ON = live mode: the app behaves normally. Persisted across sessions.
  let buttonsEnabled = lsGet('nextcanvas:buttons') === 'on';

  const undoStack: Change[] = [];
  const redoStack: Change[] = [];
  // Manual-mode staging, keyed by loc(+attr) so one element can stage its text
  // AND several attributes independently. `oldRuns` holds the original text runs
  // (text edits) or a single original value (attr edits, in `oldRuns[0]`).
  interface StagedEdit {
    el: HTMLElement;
    source: NextCanvasSource;
    kind: 'text' | 'attr';
    attr?: string;
    oldRuns: string[];
    mixed: boolean;
    // Set for a bound-identifier attr, carrying the user's all/one choice so a
    // manual-mode Save writes it through the same bound path as autosave.
    bound?: boolean;
    scope?: 'all' | 'one';
  }
  const staged = new Map<string, StagedEdit>();
  function stageKey(source: NextCanvasSource, attr?: string): string {
    return `${source.fileName}:${source.lineNumber}:${source.columnNumber}:${attr ?? '#text'}`;
  }
  // In-flight text-edit snapshot, captured on dblclick: the original text runs
  // and the inline child elements (to detect structural changes on commit).
  const editSnapshots = new WeakMap<
    HTMLElement,
    { oldRuns: string[]; elemChildren: Element[]; mixed: boolean; html: string }
  >();
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

  // ---- attribute editing ---------------------------------------------------

  // The editable attributes are those the SWC plugin listed in `data-nc-attrs`
  // (space-separated) — the ones that are string literals in source. We must NOT
  // infer this from the DOM: a bound `href={x}` and a literal `href="/x"` both
  // render as a resolved value, so guessing would offer edits that just bounce.
  function editableAttrs(
    el: HTMLElement
  ): Array<{ name: string; value: string; bound: boolean }> {
    const out: Array<{ name: string; value: string; bound: boolean }> = [];
    const add = (raw: string | null, bound: boolean): void => {
      if (!raw) return;
      for (const name of raw.split(/\s+/)) {
        if (!name) continue;
        // getAttribute returns the raw source value for a literal (e.g. "/a.png")
        // and the resolved string for a bound one (`href={GITHUB}` → the URL);
        // both are exactly the string we compare against / edit.
        out.push({ name, value: el.getAttribute(name) ?? '', bound });
      }
    };
    add(el.getAttribute('data-nc-attrs'), false);
    add(el.getAttribute('data-nc-bound'), true);
    return out;
  }

  // Nearest ancestor (incl. self) with an editable attr — literal (`data-nc-attrs`)
  // or bound (`data-nc-bound`). Matching these (not `data-loc`) means a
  // stamped-but-attr-less child (e.g. a <span> inside <a href="…">) doesn't
  // shadow the link's editable href.
  function attrHost(el: EventTarget | null): HTMLElement | null {
    if (!(el instanceof Element)) return null;
    if (inUI(el)) return null;
    const node = el.closest('[data-nc-attrs], [data-nc-bound]');
    return node instanceof HTMLElement ? node : null;
  }

  // Write a value to the live DOM (used for attr panel visual feedback).
  function applyValue(el: HTMLElement, attr: string | undefined, value: string): void {
    if (attr) el.setAttribute(attr, value);
    else el.textContent = value;
  }

  function escapeAttr(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
    .nc-switch {
      display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
      font-size: 12px; font-weight: 600; color: #a2a2b4; white-space: nowrap;
      user-select: none; padding: 0 4px;
    }
    .nc-switch.nc-on { color: #f5f5f7; }
    .nc-switch-track {
      position: relative; width: 34px; height: 18px; border-radius: 999px;
      background: rgba(255,255,255,0.18); transition: background .15s ease;
    }
    .nc-switch-knob {
      position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
      border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.4);
      transition: transform .15s ease;
    }
    .nc-switch.nc-on .nc-switch-track { background: #6d28d9; }
    .nc-switch.nc-on .nc-switch-knob { transform: translateX(16px); }
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
    .nc-chip {
      position: fixed; z-index: 2147483646; width: 22px; height: 22px; padding: 0;
      border-radius: 6px; background: #6d28d9; color: #fff;
      border: 1px solid rgba(255,255,255,0.25); display: none; place-items: center;
      cursor: pointer; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.35);
    }
    .nc-chip:hover { background: #7c3aed; }
    .nc-attr-panel {
      position: fixed; z-index: 2147483647; display: none; width: 280px;
      background: #0d0d12; color: #f5f5f7; border: 1px solid rgba(255,255,255,0.14);
      border-radius: 10px; padding: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.5);
      font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
    }
    .nc-attr-title {
      font-weight: 600; color: #a78bfa; margin-bottom: 8px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .nc-attr-close {
      border: 0; background: transparent; color: #a2a2b4; cursor: pointer;
      font-size: 14px; padding: 0 2px; line-height: 1;
    }
    .nc-attr-row { margin-bottom: 8px; }
    .nc-attr-row:last-child { margin-bottom: 0; }
    .nc-attr-row label { display: block; color: #a2a2b4; margin-bottom: 3px; font-size: 11px; }
    .nc-attr-row input {
      width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; color: #f5f5f7;
      padding: 5px 7px; font: inherit; outline: none;
    }
    .nc-attr-row input:focus { border-color: #6d28d9; }
    .nc-thumb {
      max-width: 100%; max-height: 80px; border-radius: 6px; margin-top: 6px;
      display: block; background: rgba(255,255,255,0.04);
    }
    .nc-attr-row .nc-bound-tag {
      display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 600;
      color: #a78bfa; background: rgba(167,139,250,0.14); border-radius: 4px;
      padding: 0 5px; vertical-align: middle;
    }
    .nc-scope {
      margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.12);
    }
    .nc-scope-msg { color: #d5d5df; margin-bottom: 8px; }
    .nc-scope-btns { display: flex; gap: 6px; }
    .nc-scope-btns button {
      flex: 1; border: 1px solid rgba(255,255,255,0.14); border-radius: 6px;
      padding: 6px 8px; font: inherit; cursor: pointer; color: #f5f5f7;
      background: rgba(255,255,255,0.06);
    }
    .nc-scope-btns button:hover { background: rgba(255,255,255,0.12); }
    .nc-scope-btns button[data-scope="all"] { background: #6d28d9; border-color: transparent; }
    .nc-scope-btns button[data-scope="all"]:hover { background: #7c3aed; }
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

  // Hover chip ("✎") shown at the top-right of an element with editable attrs.
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'nc-chip';
  chip.title = 'Edit attributes';
  chip.textContent = '✎';
  chip.setAttribute('data-nextcanvas-ui', '');
  document.body.appendChild(chip);

  // Popover listing an element's editable attributes as inputs.
  const attrPanel = document.createElement('div');
  attrPanel.className = 'nc-attr-panel';
  attrPanel.setAttribute('data-nextcanvas-ui', '');
  document.body.appendChild(attrPanel);

  let chipTarget: HTMLElement | null = null;
  let panelTarget: HTMLElement | null = null;
  let panelOpen = false;

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
        <span class="nc-switch" data-act="buttons">
          <span class="nc-switch-text">Buttons</span>
          <span class="nc-switch-track"><span class="nc-switch-knob"></span></span>
        </span>
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
  const buttonsBtn = q('[data-act="buttons"]');
  const undoBtn = q<HTMLButtonElement>('[data-act="undo"]');
  const redoBtn = q<HTMLButtonElement>('[data-act="redo"]');
  const saveBtn = q<HTMLButtonElement>('[data-act="save"]');
  const badgeEl = q('.nc-badge');

  // A staged edit is dirty when the element's current value differs from its
  // staged original — attrs compare exactly, text runs compare whitespace-normed.
  function stagedIsDirty(s: StagedEdit): boolean {
    return s.attr
      ? (s.el.getAttribute(s.attr) ?? '') !== s.oldRuns[0]
      : !runsEqual(readRuns(s.el), s.oldRuns);
  }

  function stagedDirtyCount(): number {
    let n = 0;
    staged.forEach((s) => {
      if (stagedIsDirty(s)) n++;
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
    buttonsBtn.classList.toggle('nc-on', buttonsEnabled);
    buttonsBtn.title = buttonsEnabled
      ? 'Buttons: on — links, scrolling and click handlers work (click to turn off for editing)'
      : 'Buttons: off — page is inert so you can edit freely (click to turn on)';
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

  // Write a run-set text edit: legacy single-text payload for a plain element,
  // or the `segments` payload (one entry per text run) for a mixed element.
  function writeText(
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

  // Write an attribute edit (server dispatches on `attrName`). For a bound
  // attr (`href={VAR}`) we pass `bound` + the chosen `scope` so the server
  // either rewrites the shared variable ('all') or inlines a literal ('one').
  function writeAttr(
    source: NextCanvasSource,
    attr: string,
    oldText: string,
    newText: string,
    bound?: boolean,
    scope?: 'all' | 'one'
  ): Promise<{ ok: boolean; error?: string }> {
    return postEdit({
      fileName: source.fileName,
      lineNumber: source.lineNumber,
      columnNumber: source.columnNumber,
      attrName: attr,
      oldText,
      newText,
      ...(bound ? { bound: true, scope } : {}),
    });
  }

  // ---- change helpers (kind-aware) -----------------------------------------

  function changeUnchanged(c: EditChange): boolean {
    return c.kind === 'attr'
      ? c.before === c.after
      : runsEqual(c.before, c.after);
  }
  // Source write in the forward (before→after) or reverse (after→before) sense.
  function writeForward(c: EditChange): Promise<{ ok: boolean; error?: string }> {
    return c.kind === 'attr'
      ? writeAttr(c.source, c.attr, c.before, c.after, c.bound, c.scope)
      : writeText(c.source, c.before, c.after, c.mixed);
  }
  function writeReverse(c: EditChange): Promise<{ ok: boolean; error?: string }> {
    return c.kind === 'attr'
      ? writeAttr(c.source, c.attr, c.after, c.before, c.bound, c.scope)
      : writeText(c.source, c.after, c.before, c.mixed);
  }
  // Restore the change's element to one of its ends in the live DOM.
  function applyChangeDom(c: EditChange, to: 'before' | 'after'): void {
    if (c.kind === 'attr') c.el.setAttribute(c.attr, c[to]);
    else applyDom(c.el, c[to], c.mixed);
  }
  function keyFor(c: EditChange): string {
    return c.kind === 'attr'
      ? stageKey(c.source, c.attr)
      : stageKey(c.source);
  }
  function stageChange(c: EditChange): void {
    const key = keyFor(c);
    if (staged.has(key)) return;
    staged.set(
      key,
      c.kind === 'attr'
        ? { el: c.el, source: c.source, kind: 'attr', attr: c.attr, oldRuns: [c.before], mixed: false, bound: c.bound, scope: c.scope }
        : { el: c.el, source: c.source, kind: 'text', oldRuns: c.before, mixed: c.mixed }
    );
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

  function commit(change: EditChange): void {
    if (changeUnchanged(change)) return;
    undoStack.push(change);
    redoStack.length = 0;

    if (mode === 'autosave') {
      writeForward(change).then((r) => {
        if (r.ok) {
          toast('Saved — Fast Refresh will update the view');
        } else {
          toast(r.error || 'Edit rejected', true);
          if (change.el.isConnected) applyChangeDom(change, 'before');
          const i = undoStack.indexOf(change);
          if (i >= 0) undoStack.splice(i, 1);
          refreshUI();
        }
      });
    } else {
      stageChange(change);
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
  // manual-mode staging); text/attr edits write in autosave and (un)stage in
  // manual mode.
  function applyChange(change: Change, to: 'before' | 'after'): void {
    if (change.el.isConnected) {
      if (change.kind === 'style')
        applyInlineStyle(change.el, change.property, change[to]);
      else applyChangeDom(change, to);
    }
    if (change.kind === 'style') {
      writeStyle(change.source, change.property, change[to]).then((r) => {
        if (!r.ok) toast(r.error || 'Style change failed', true);
      });
      if (selected === change.el) populatePanel();
      return;
    }
    if (mode === 'autosave') {
      const write = to === 'before' ? writeReverse : writeForward;
      write(change).then((r) => {
        if (!r.ok) toast(r.error || 'Change failed', true);
      });
    } else if (to === 'before') {
      const key = keyFor(change);
      const s = staged.get(key);
      const reverted =
        change.kind === 'attr'
          ? s != null && change.before === s.oldRuns[0]
          : s != null && runsEqual(change.before, s.oldRuns);
      if (reverted) staged.delete(key);
    } else {
      stageChange(change);
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
    const jobs: Array<() => Promise<{ ok: boolean; error?: string }>> = [];
    staged.forEach((s) => {
      if (!stagedIsDirty(s)) return;
      if (s.attr) {
        const cur = s.el.getAttribute(s.attr) ?? '';
        const attr = s.attr;
        const { bound, scope } = s;
        jobs.push(() => writeAttr(s.source, attr, s.oldRuns[0], cur, bound, scope));
      } else {
        const cur = readRuns(s.el);
        jobs.push(() => writeText(s.source, s.oldRuns, cur, s.mixed));
      }
    });
    if (jobs.length === 0) {
      toast('No changes to save');
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const job of jobs) {
      const r = await job();
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

  function setButtons(on: boolean): void {
    buttonsEnabled = on;
    lsSet('nextcanvas:buttons', on ? 'on' : 'off');
    // Leaving edit mode drops any current style selection.
    if (on) deselect();
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
    else if (act === 'buttons') setButtons(!buttonsEnabled);
    else if (act === 'hide') setHidden(true);
    else if (act === 'show') setHidden(false);
    else if (act === 'dismiss') setDismissed(true);
  });

  refreshUI();

  // ---- attribute chip + panel ----------------------------------------------

  function showChip(host: HTMLElement): void {
    chipTarget = host;
    const r = host.getBoundingClientRect();
    chip.style.display = 'grid';
    chip.style.left = Math.max(2, Math.min(window.innerWidth - 24, r.right - 24)) + 'px';
    chip.style.top = Math.max(2, r.top + 2) + 'px';
  }
  function hideChip(): void {
    chip.style.display = 'none';
    chipTarget = null;
  }

  function positionPanel(host: HTMLElement): void {
    const r = host.getBoundingClientRect();
    const pw = 280;
    let left = r.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    attrPanel.style.left = Math.max(8, left) + 'px';
    // Below the element, or above it if there isn't room below.
    const belowTop = r.bottom + 8;
    attrPanel.style.top =
      belowTop + 160 > window.innerHeight && r.top > 160
        ? Math.max(8, r.top - 8 - attrPanel.offsetHeight) + 'px'
        : belowTop + 'px';
  }

  function openPanel(host: HTMLElement): void {
    const source = getSource(host);
    if (!source) {
      toast('No source info for this element (is it dev mode?)', true);
      return;
    }
    panelTarget = host;
    panelOpen = true;

    const rows = editableAttrs(host)
      .map((a) => {
        const thumb =
          a.name === 'src'
            ? `<img class="nc-thumb" alt="" src="${escapeAttr(a.value)}" />`
            : '';
        const tag = a.bound ? `<span class="nc-bound-tag" title="Bound to a variable">var</span>` : '';
        return `<div class="nc-attr-row">
            <label>${a.name}${tag}</label>
            <input data-attr="${a.name}" data-bound="${a.bound ? '1' : '0'}" value="${escapeAttr(a.value)}" spellcheck="false" autocomplete="off" />
            ${thumb}
          </div>`;
      })
      .join('');
    attrPanel.innerHTML = `<div class="nc-attr-title">Edit attributes<button type="button" class="nc-attr-close" data-act="close" title="Close">✕</button></div>${rows}`;

    // Stash each input's original value so we only commit real changes, and hide
    // any thumbnail that fails to load (avoids a broken-image icon).
    attrPanel.querySelectorAll('input').forEach((inp) => {
      (inp as HTMLInputElement).dataset.old = (inp as HTMLInputElement).value;
    });
    attrPanel.querySelectorAll('.nc-thumb').forEach((img) => {
      img.addEventListener('error', () => {
        (img as HTMLElement).style.display = 'none';
      });
    });

    positionPanel(host);
    attrPanel.style.display = 'block';
    positionPanel(host); // re-run now offsetHeight is known
    const first = attrPanel.querySelector('input') as HTMLInputElement | null;
    if (first) {
      first.focus();
      first.select();
    }
  }

  function closePanel(): void {
    if (cancelScope) cancelScope();
    attrPanel.style.display = 'none';
    panelOpen = false;
    panelTarget = null;
  }

  // A bound attr resolves to a shared variable, so committing it asks whether to
  // rewrite that variable (all references) or inline a literal here (just this
  // one). The choice is presented as a bar inside the panel; `scopeAsking` guards
  // re-entrancy (focusout fires when the buttons take focus) and closePanel
  // cancels a pending ask so `scopeAsking` never gets stuck.
  let scopeAsking = false;
  let cancelScope: (() => void) | null = null;

  function askScopeInPanel(): Promise<'all' | 'one' | null> {
    return new Promise((resolve) => {
      const bar = document.createElement('div');
      bar.className = 'nc-scope';
      bar.innerHTML = `<div class="nc-scope-msg">This value comes from a shared variable. Apply your change to…</div>
        <div class="nc-scope-btns">
          <button type="button" data-scope="all">All references</button>
          <button type="button" data-scope="one">Just this one</button>
        </div>`;
      const finish = (v: 'all' | 'one' | null): void => {
        cancelScope = null;
        bar.remove();
        if (panelOpen && panelTarget) positionPanel(panelTarget);
        resolve(v);
      };
      cancelScope = () => finish(null);
      bar.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-scope]');
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        finish(b.getAttribute('data-scope') as 'all' | 'one');
      });
      attrPanel.appendChild(bar);
      if (panelTarget) positionPanel(panelTarget);
    });
  }

  async function commitAttrInput(input: HTMLInputElement): Promise<void> {
    if (!panelTarget) return;
    const name = input.dataset.attr;
    if (!name) return;
    const bound = input.dataset.bound === '1';
    const oldVal = input.dataset.old ?? '';
    const newVal = input.value;
    if (newVal === oldVal) return;

    const target = panelTarget; // capture — closePanel may run while we await
    const source = getSource(target);
    if (!source) {
      input.value = oldVal;
      toast('Lost source info; edit reverted', true);
      return;
    }

    let scope: 'all' | 'one' | undefined;
    if (bound) {
      if (scopeAsking) return;
      scopeAsking = true;
      const choice = await askScopeInPanel();
      scopeAsking = false;
      if (!choice) {
        input.value = oldVal;
        return;
      }
      scope = choice;
    }

    applyValue(target, name, newVal); // instant visual feedback
    input.dataset.old = newVal; // so a following blur won't re-commit
    if (name === 'src') {
      const thumb = attrPanel.querySelector('.nc-thumb') as HTMLImageElement | null;
      if (thumb) {
        thumb.style.display = '';
        thumb.src = newVal;
      }
    }
    commit({
      kind: 'attr',
      el: target,
      source,
      attr: name,
      before: oldVal,
      after: newVal,
      ...(bound ? { bound: true, scope } : {}),
    });
  }

  chip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (chipTarget) openPanel(chipTarget);
  });

  attrPanel.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
    } else if (e.key === 'Enter' && t instanceof HTMLInputElement) {
      e.preventDefault();
      commitAttrInput(t);
    }
  });
  attrPanel.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement) commitAttrInput(t);
  });
  attrPanel.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act="close"]')) {
      e.preventDefault();
      closePanel();
    }
  });

  // Click outside the panel/chip closes it — but commit the focused input first
  // (this capture handler runs before the input's blur, which would otherwise be
  // dropped once panelTarget is cleared).
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!panelOpen) return;
      const t = e.target;
      if (t instanceof Element && (t.closest('.nc-attr-panel') || t.closest('.nc-chip')))
        return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.closest('.nc-attr-panel'))
        commitAttrInput(active);
      closePanel();
    },
    true
  );

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
        // Hovering our own UI (e.g. the chip): keep the chip anchored so it's
        // clickable; just drop the text outline.
        hideOutline();
        return;
      }
      if (el instanceof HTMLElement && el.isContentEditable) return;
      if (isEditableEl(el)) drawOutline(el);
      else hideOutline();
      if (!panelOpen) {
        const host = attrHost(el);
        if (host) showChip(host);
        else hideChip();
      }
    },
    true
  );

  document.addEventListener(
    'scroll',
    () => {
      hideOutline();
      if (panelOpen && panelTarget) positionPanel(panelTarget);
      else hideChip();
      drawSelOutline();
    },
    true
  );
  window.addEventListener('resize', drawSelOutline);

  // Click behavior depends on the "Buttons" toggle:
  //  - Buttons OFF (edit mode, default): the page is inert — every non-UI click
  //    is prevented AND its propagation stopped, so links don't navigate, in-page
  //    anchors don't scroll, and the app's own onClick handlers don't fire. This
  //    is what lets you single-click to select for styling and double-click to
  //    edit text without the element navigating out from under you.
  //  - Buttons ON (live mode): the overlay stays out of the way so the app behaves
  //    normally; single-click does not select (use edit mode for that).
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target;
      if (inUI(el)) return;
      if (el instanceof HTMLElement && el.isContentEditable) return;
      if (buttonsEnabled) return;
      e.preventDefault();
      e.stopPropagation();
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
        commit({ kind: 'text', el, source, before: [oldText], after: [newText], mixed: false });
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
      commit({ kind: 'text', el, source, before: snap.oldRuns, after: newRuns, mixed: true });
    },
    true
  );

  console.log(
    '[nextcanvas] overlay active — double-click any text to edit; toolbar bottom-right'
  );
});
