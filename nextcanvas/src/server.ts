/**
 * nextcanvas write-back server.
 *
 * Runs only in `next dev`. Listens on a side port and applies edits coming from
 * the browser overlay to the actual source files using a formatting-preserving
 * AST edit (ts-morph). Next.js Fast Refresh then reflects the change in the
 * browser automatically, so there is no server -> client channel to maintain.
 *
 * Scope: static JSX text, whether an element's whole child (<h1>Hello</h1>) or
 * text runs mixed with inline child elements (<p>Hello <strong>w</strong>!</p>).
 * The latter arrive as a `segments` array; the inline elements are preserved and
 * only the text runs are rewritten. Bound expressions such as <h1>{title}</h1>
 * are left unstamped and never reach here.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { isMappable, rewriteClassList, usesTailwind } from './tailwind';
import { checkRequestSource, validateEditPath } from './security';
import { decodeEntities, encodeJsxText, encodeJsxAttrValue } from './entities';

export const PORT = Number(process.env.NEXTCANVAS_PORT || 3131);
/**
 * Interface to bind. Loopback by default so the file-writing server is not
 * reachable from the LAN at all; set NEXTCANVAS_HOST (e.g. `0.0.0.0`) to open
 * it up for phone-on-LAN testing — the origin/host checks still apply.
 */
export const HOST = process.env.NEXTCANVAS_HOST || '127.0.0.1';
const OVERLAY_PATH = path.join(__dirname, 'overlay.js');

/**
 * Attributes the server will rewrite — the same six the SWC plugin stamps as
 * editable (EDITABLE_ATTRS in swc-plugin/src/lib.rs; keep in sync). Enforced
 * server-side too so a forged request can't rewrite arbitrary attributes.
 */
const EDITABLE_ATTR_NAMES = new Set([
  'src',
  'href',
  'alt',
  'title',
  'placeholder',
  'aria-label',
]);

interface Segment {
  oldText: string;
  newText: string;
}

interface Edit {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
  // Legacy single-text edit (element whose sole child is static text).
  oldText?: string;
  newText?: string;
  // Mixed-children edit: one entry per non-whitespace text run of the element,
  // in source/DOM order. Present instead of oldText/newText.
  segments?: Segment[];
  // When present, this is an attribute edit (e.g. src/href/alt) rather than a
  // JSX text edit; oldText/newText carry the attribute's string-literal value.
  attrName?: string;
  // Bound-identifier attribute (`href={VAR}`). `scope` decides whether to rewrite
  // the shared variable's declaration ('all') or inline a string literal on just
  // this element ('one'). Ignored unless `attrName` is also set.
  bound?: boolean;
  scope?: 'all' | 'one';
  // Bound TEXT edit: the element's child is a `{member.chain}` (`{speaker.name}`)
  // stamped as `data-nc-text-bound`. `expr` is that dotted path; `index` is the
  // `.map` iteration position (0 for a direct-object binding). oldText/newText
  // carry the string property's value. See applyBoundTextEdit.
  textBound?: boolean;
  expr?: string;
  index?: number;
  /**
   * Resolve and value-match exactly as a real edit would, but write nothing.
   * Powers POST /resolve, which lets the overlay find out which stamped
   * elements can actually be written back before it offers to edit them.
   */
  dryRun?: boolean;
}

interface StyleEdit {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
  /** camelCase style key, e.g. "color", "fontSize", "textAlign". */
  property: string;
  /** New value; empty/null means remove the property from the inline object. */
  value?: string | null;
}

interface EditResult {
  ok: boolean;
  error?: string;
  fileName?: string;
  lineNumber?: number;
  oldText?: string;
  newText?: string;
  property?: string;
  value?: string | null;
  /**
   * How a style edit was written. `class` means a Tailwind utility landed in
   * `className`, so the overlay must drop the inline preview it applied or the
   * inline value would permanently outrank the class.
   */
  mode?: 'class' | 'inline';
}

/**
 * Send a JSON response. CORS reflects the (already-validated) request origin —
 * never `*` — so a disallowed page can't read responses even if one slipped
 * past the request gate.
 */
function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  origin?: string
): void {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  res.writeHead(status, headers);
  res.end(json);
}

/**
 * Corruption guard: refuse to write when an edit would make the file
 * unparseable, leaving the original on disk untouched.
 *
 * The tool rewrites the developer's real source, so a bad edit is a corrupted
 * file — the one failure mode with lasting blast radius. Before every save we
 * re-parse the edited in-memory buffer with the TS scanner (syntactic only, so
 * it's cheap and ignores type errors) and abort if it has parse errors. ts-morph
 * mutations are structural and rarely produce invalid syntax, but this closes
 * the gap for the raw-text paths (`replaceText` of user copy) and any future
 * write path. Returns false WITHOUT saving on invalid; true after saving.
 */
export const CORRUPT_MSG =
  'Refusing to write — the edit would make the file unparseable, so your source was left unchanged. This is a bug; please report it.';

/** True when `text` parses as TSX with no syntax errors. Exported for tests. */
export function parsesClean(filePath: string, text: string): boolean {
  const { ts } = require('ts-morph') as typeof import('ts-morph');
  const parsed = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TSX
  );
  const diags = (parsed as unknown as { parseDiagnostics?: unknown[] })
    .parseDiagnostics;
  return !(diags && diags.length > 0);
}

function trySave(sf: import('ts-morph').SourceFile): boolean {
  if (!parsesClean(sf.getFilePath(), sf.getFullText())) return false;
  sf.saveSync();
  return true;
}

/** Apply a single static-text edit to a source file. */
export function applyEdit(edit: Edit): EditResult {
  // Lazy-require so merely loading this file (e.g. in the Next config worker)
  // does not pull in ts-morph until an edit actually arrives.
  const { Project, SyntaxKind } =
    require('ts-morph') as typeof import('ts-morph');

  const { lineNumber, columnNumber, oldText, newText } = edit;
  const checked = validateEditPath(edit.fileName);
  if (!checked.ok) return { ok: false, error: checked.error };
  const fileName = checked.path!;

  const project = new Project({
    compilerOptions: { allowJs: true, jsx: 4 /* preserve */ },
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFile = project.addSourceFileAtPath(fileName);

  // Compare with internal whitespace collapsed AND entities decoded: the browser
  // hands us the rendered textContent (runs of whitespace → a single space,
  // `&amp;` → "&"), while the JSX source text node may be wrapped across several
  // indented lines and holds the encoded form. Normalise both to compare, and
  // encode the user's new value on the way back so the JSX stays valid.
  const norm = (s: string) => decodeEntities(s).trim().replace(/\s+/g, ' ');

  // Re-insert a JSXText node's original leading/trailing whitespace around new
  // core text, so indentation/wrapping is preserved on write-back.
  const rewrap = (fullText: string, core: string): string => {
    const leading = /^\s*/.exec(fullText)?.[0] ?? '';
    const trailing = /\s*$/.exec(fullText)?.[0] ?? '';
    return leading + core + trailing;
  };

  // Mixed-children edit: rewrite the element's text runs, preserving its inline
  // child elements. Located by the data-loc line (the opening tag's line).
  if (edit.segments && edit.segments.length) {
    if (
      !Array.isArray(edit.segments) ||
      edit.segments.some(
        (s) =>
          s == null ||
          typeof s.oldText !== 'string' ||
          typeof s.newText !== 'string'
      )
    ) {
      return { ok: false, error: 'malformed segments' };
    }
    const els = sourceFile
      .getDescendantsOfKind(SyntaxKind.JsxElement)
      .filter(
        (el) => el.getOpeningElement().getStartLineNumber() === Number(lineNumber)
      );
    if (els.length === 0) {
      return {
        ok: false,
        error: `Could not find an element at ${fileName}:${lineNumber} to edit.`,
      };
    }
    // Disambiguate multiple elements on the same line by opening-tag column.
    let element = els[0];
    if (els.length > 1 && columnNumber) {
      const byCol = els.find(
        (el) =>
          sourceFile.getLineAndColumnAtPos(el.getOpeningElement().getStart())
            .column === Number(columnNumber)
      );
      if (byCol) element = byCol;
    }

    // Direct, non-whitespace JSXText children in source order — these align 1:1
    // with the non-whitespace runs the overlay sends (whitespace-only text is
    // dropped on both sides, so positions match). Use getFullText/getFullStart:
    // a JSXText node's leading whitespace is trivia to getText()/getStart(), so
    // those would clip the run's leading boundary space.
    const runs = element
      .getJsxChildren()
      .filter(
        (c) => c.getKind() === SyntaxKind.JsxText && norm(c.getFullText()) !== ''
      );
    const segments = edit.segments;
    if (runs.length !== segments.length) {
      return {
        ok: false,
        error: `Text structure changed (source has ${runs.length} text run(s), edit has ${segments.length}); only in-place text edits are supported.`,
      };
    }
    for (let i = 0; i < runs.length; i++) {
      if (norm(runs[i].getFullText()) !== norm(segments[i].oldText)) {
        return {
          ok: false,
          error: `Edit no longer matches the source (run ${i + 1}); reload and try again.`,
        };
      }
    }
    // Collect changed runs as absolute [start,end] replacements, then apply from
    // last to first so earlier offsets stay valid (no stale node references).
    // The browser sends each run's full text-node value, which already carries
    // the boundary spacing around inline elements — so write it verbatim (no
    // rewrap). A source run wrapped across indented lines collapses onto one
    // line, matching the single-text path.
    const patches = runs
      .map((node, i) => ({ node, seg: segments[i] }))
      .filter(({ seg }) => norm(seg.oldText) !== norm(seg.newText))
      .map(({ node, seg }) => ({
        start: node.getFullStart(),
        end: node.getEnd(),
        // Encode JSX-special chars so a typed "A & B" writes valid `A &amp; B`.
        // Boundary whitespace the browser sent is untouched by the encoder.
        text: encodeJsxText(String(seg.newText)),
      }))
      .sort((a, b) => b.start - a.start);

    if (patches.length === 0) {
      return { ok: true, fileName, lineNumber, oldText: '', newText: '' };
    }
    for (const p of patches) sourceFile.replaceText([p.start, p.end], p.text);
    if (!trySave(sourceFile)) return { ok: false, error: CORRUPT_MSG };
    return {
      ok: true,
      fileName,
      lineNumber,
      oldText: segments.map((s) => s.oldText).join(' | '),
      newText: segments.map((s) => s.newText).join(' | '),
    };
  }

  if (oldText == null) return { ok: false, error: 'missing oldText' };
  if (typeof newText !== 'string') return { ok: false, error: 'missing newText' };
  const wanted = norm(String(oldText));

  const candidates = sourceFile
    .getDescendantsOfKind(SyntaxKind.JsxText)
    .filter((node) => norm(node.getText()) === wanted);

  if (candidates.length === 0) {
    return {
      ok: false,
      error: `Could not find static text "${wanted}" in ${fileName}. It may be a bound value (e.g. {variable}) rather than literal text.`,
    };
  }

  // Prefer the candidate whose enclosing element starts on the reported line;
  // fall back to the sole/first candidate when the line does not line up.
  let target = candidates.find(
    (node) => node.getStartLineNumber() === Number(lineNumber)
  );
  if (!target && lineNumber) {
    target = candidates.find((node) => {
      const parent = node.getParent();
      return parent != null && parent.getStartLineNumber() === Number(lineNumber);
    });
  }
  if (!target) {
    if (candidates.length > 1) {
      return {
        ok: false,
        error: `Ambiguous edit: "${wanted}" appears ${candidates.length} times and no line matched ${lineNumber}.`,
      };
    }
    target = candidates[0];
  }

  // Preserve the node's leading/trailing whitespace (its indentation) and
  // replace the whole text core. This works for single-line text and for
  // multi-line wrapped text alike (the latter collapses onto one line).
  // Encode JSX-special chars so a typed "A & B" writes valid `A &amp; B`.
  //
  // Use a raw `replaceText` splice on the node's FULL span (getFullText/
  // getFullStart/getEnd — a JSXText node's leading whitespace is part of its
  // full text, trivia to the trimmed getters), NOT `replaceWithText`: the latter
  // runs ts-morph's structural manipulation, which reindents the surrounding
  // lines and can mix spaces into tab-indented JSX. The raw splice touches only
  // this node's bytes, matching the mixed-children path's fidelity.
  sourceFile.replaceText(
    [target.getFullStart(), target.getEnd()],
    rewrap(target.getFullText(), encodeJsxText(String(newText)))
  );
  if (!trySave(sourceFile)) return { ok: false, error: CORRUPT_MSG };

  return { ok: true, fileName, lineNumber, oldText: wanted, newText };
}

/**
 * Apply a single attribute edit (e.g. `src`, `href`, `alt`) to a source file.
 * Only string-literal attribute values are editable; a `{expression}` value is
 * left alone (the overlay never stamps those, but we guard here too).
 */
export function applyAttrEdit(edit: Edit): EditResult {
  const { Project, SyntaxKind, Node } =
    require('ts-morph') as typeof import('ts-morph');

  const { lineNumber, attrName, oldText, newText } = edit;
  const checked = validateEditPath(edit.fileName);
  if (!checked.ok) return { ok: false, error: checked.error };
  const fileName = checked.path!;
  if (!attrName) return { ok: false, error: 'missing attrName' };
  if (!EDITABLE_ATTR_NAMES.has(attrName)) {
    return { ok: false, error: `Attribute "${attrName}" is not editable.` };
  }
  if (typeof oldText !== 'string' || typeof newText !== 'string') {
    return { ok: false, error: 'missing oldText/newText' };
  }

  const project = new Project({
    compilerOptions: { allowJs: true, jsx: 4 /* preserve */ },
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFile = project.addSourceFileAtPath(fileName);

  // Rewritten so downstream code (including the bound path) always sees the
  // validated absolute path.
  edit = { ...edit, fileName };

  if (edit.bound) {
    return applyBoundAttrEdit(edit, sourceFile);
  }

  // Every JSX attribute (covers both <el a="…"> and self-closing <img a="…"/>)
  // named `attrName` whose value is a string literal equal to oldText.
  const wanted = String(oldText);
  const candidates = sourceFile
    .getDescendantsOfKind(SyntaxKind.JsxAttribute)
    .filter((attr) => attr.getNameNode().getText() === attrName)
    .filter((attr) => {
      const init = attr.getInitializer();
      return (
        init != null &&
        Node.isStringLiteral(init) &&
        init.getLiteralValue() === wanted
      );
    });

  if (candidates.length === 0) {
    return {
      ok: false,
      error: `Could not find ${attrName}="${wanted}" in ${fileName}. It may be a bound value ({expr}) rather than a string literal.`,
    };
  }

  // Prefer the attribute whose enclosing tag opens on the reported line (this is
  // the line the SWC plugin stamped); fall back to the sole candidate.
  let target = candidates.find(
    (attr) => attr.getParentOrThrow().getStartLineNumber() === Number(lineNumber)
  );
  if (!target) {
    if (candidates.length > 1) {
      return {
        ok: false,
        error: `Ambiguous edit: ${attrName}="${wanted}" appears ${candidates.length} times and no element matched line ${lineNumber}.`,
      };
    }
    target = candidates[0];
  }

  const init = target.getInitializerOrThrow();
  if (!Node.isStringLiteral(init)) {
    return { ok: false, error: `${attrName} is not a string literal` };
  }
  // setLiteralValue preserves the original quote character and escapes as needed.
  init.setLiteralValue(String(newText));
  if (!trySave(sourceFile)) return { ok: false, error: CORRUPT_MSG };

  return { ok: true, fileName, lineNumber, oldText: wanted, newText };
}

/**
 * Edit a bound-identifier attribute (`href={GITHUB}`), stamped by the plugin as
 * `data-nc-bound`. Two modes, chosen by `edit.scope`:
 *   - 'all': rewrite the shared variable's declaration (`const GITHUB = '…'`),
 *     which changes every element that references it.
 *   - 'one': leave the variable alone and inline a literal on just this element
 *     (`href={GITHUB}` → `href="new"`).
 *
 * The target attribute is located by tag line (the `data-loc` line) among
 * attributes named `attrName` whose initializer is a `{identifier}` expression.
 */
function applyBoundAttrEdit(
  edit: Edit,
  sourceFile: import('ts-morph').SourceFile
): EditResult {
  const { SyntaxKind, Node } = require('ts-morph') as typeof import('ts-morph');
  const { fileName, lineNumber, attrName, oldText, newText, scope } = edit;

  const candidates = sourceFile
    .getDescendantsOfKind(SyntaxKind.JsxAttribute)
    .filter((attr) => attr.getNameNode().getText() === attrName)
    .filter((attr) => {
      const init = attr.getInitializer();
      if (init == null || !Node.isJsxExpression(init)) return false;
      const expr = init.getExpression();
      return expr != null && Node.isIdentifier(expr);
    });

  if (candidates.length === 0) {
    return {
      ok: false,
      error: `Could not find a bound ${attrName}={…} in ${fileName}.`,
    };
  }

  let target = candidates.find(
    (attr) => attr.getParentOrThrow().getStartLineNumber() === Number(lineNumber)
  );
  if (!target) {
    if (candidates.length > 1) {
      return {
        ok: false,
        error: `Ambiguous edit: ${attrName}={…} appears ${candidates.length} times and no element matched line ${lineNumber}.`,
      };
    }
    target = candidates[0];
  }

  if (scope === 'one') {
    // Inline a string-literal on just this element, turning `href={GITHUB}` into
    // `href="new"`. Encode for a double-quoted JSX attribute — `JSON.stringify`
    // would backslash-escape a `"` (`href="a\"b"`), which is INVALID JSX; the
    // entity form (`href="a&quot;b"`) parses and round-trips.
    target.setInitializer(`"${encodeJsxAttrValue(String(newText))}"`);
    if (!trySave(sourceFile)) return { ok: false, error: CORRUPT_MSG };
    return { ok: true, fileName, lineNumber, oldText, newText };
  }

  // scope === 'all' (default): rewrite the variable the identifier points at.
  const init = target.getInitializerOrThrow();
  if (!Node.isJsxExpression(init)) {
    return { ok: false, error: `${attrName} is not a bound expression` };
  }
  const idName = init.getExpressionOrThrow().getText();
  const decl = sourceFile.getVariableDeclaration(idName);
  if (!decl) {
    return {
      ok: false,
      error: `Could not resolve variable "${idName}" in ${fileName} — it may be imported from another module. Try "just this one" instead.`,
    };
  }
  const declInit = decl.getInitializer();
  if (declInit == null || !Node.isStringLiteral(declInit)) {
    return {
      ok: false,
      error: `Variable "${idName}" is not a plain string literal, so it can't be edited safely. Try "just this one" instead.`,
    };
  }
  declInit.setLiteralValue(String(newText));
  if (!trySave(sourceFile)) return { ok: false, error: CORRUPT_MSG };
  return { ok: true, fileName, lineNumber, oldText, newText };
}

/**
 * Resolve a relative import specifier to a SourceFile in the project, adding it
 * on demand. Tries the specifier as-is, then with each common extension, then as
 * a directory `index.*`. Returns undefined for bare/aliased specifiers we can't
 * resolve without tsconfig paths (the caller reports a helpful error).
 */
/**
 * Nearest tsconfig/jsconfig compilerOptions for a file, memoised per directory.
 * `parseJsonConfigFileContent` handles both JSON-with-comments and `extends`,
 * so `paths`/`baseUrl` arrive already merged and normalised.
 */
const compilerOptionsCache = new Map<
  string,
  import('ts-morph').ts.CompilerOptions | null
>();

function compilerOptionsFor(
  fromFile: string
): import('ts-morph').ts.CompilerOptions | null {
  const { ts } = require('ts-morph') as typeof import('ts-morph');
  const visited: string[] = [];
  let dir = path.dirname(fromFile);

  for (;;) {
    const cached = compilerOptionsCache.get(dir);
    if (cached !== undefined) {
      for (const d of visited) compilerOptionsCache.set(d, cached);
      return cached;
    }
    visited.push(dir);

    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      const read = ts.readConfigFile(file, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, dir);
      for (const d of visited) compilerOptionsCache.set(d, parsed.options);
      return parsed.options;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const d of visited) compilerOptionsCache.set(d, null);
  return null;
}

/**
 * Resolve an import specifier to a source file we may edit.
 *
 * Relative specifiers keep a cheap filesystem path. Everything else goes through
 * `ts.resolveModuleName`, which honours the project's tsconfig `paths`/`baseUrl`
 * — without this, alias imports (`@/lib/council`, the Next.js default) resolved
 * to nothing and every bound value living in an aliased module was uneditable,
 * reported as `unresolved import "@/lib/council"`.
 *
 * Anything inside node_modules, or a declaration file, is refused: those are
 * dependencies, not the user's source, and must never be rewritten.
 */
function resolveModuleFile(
  spec: string,
  fromFile: string,
  project: import('ts-morph').Project
): import('ts-morph').SourceFile | undefined {
  const accept = (file: string): import('ts-morph').SourceFile | undefined => {
    // Full path validation, not just node_modules/.d.ts: a resolved import is a
    // file we may later WRITE (the owning file of a bound value is saveSync'd),
    // so it must satisfy the same containment as a client-supplied fileName.
    const checked = validateEditPath(file);
    if (!checked.ok) return undefined;
    return (
      project.getSourceFile(checked.path!) ??
      project.addSourceFileAtPathIfExists(checked.path!) ??
      undefined
    );
  };

  if (spec.startsWith('.')) {
    const base = path.resolve(path.dirname(fromFile), spec);
    const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    const candidates = [
      ...exts.map((e) => base + e),
      ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((f) =>
        path.join(base, f)
      ),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return accept(c);
    }
    return undefined;
  }

  const options = compilerOptionsFor(fromFile);
  if (!options) return undefined;

  const { ts } = require('ts-morph') as typeof import('ts-morph');
  const resolved = ts.resolveModuleName(spec, fromFile, options, ts.sys)
    .resolvedModule?.resolvedFileName;
  return resolved ? accept(resolved) : undefined;
}

/**
 * Edit bound TEXT — an element whose child is a `{member.chain}` (`{speaker.name}`,
 * `{cfg.title}`), a `{a ?? b}` / `{a || b}` of those shapes, or a bare `{ident}`
 * (`.map` element or capitalized-component prop), stamped as `data-nc-text-bound`.
 *
 * Resolution walks the JSX ancestors of the stamped element:
 *   - `.map` binding: callback param (plain or destructured) → collection array →
 *     value-matched entry (see targeting below).
 *   - **prop drill**: base is a param of a capitalized component (`Row({ q })`,
 *     `SessionCard({ session })`) → find `<Row q={f.q} />` / `<SessionCard
 *     session={session} />` call sites and continue resolving from the prop
 *     value (unlocks FAQ / Agenda SessionCard without inlining the JSX).
 *   - direct-object binding (`cfg.title`): base → object literal.
 * Either declaration may be **imported** from another module.
 *
 * When a mapped collection isn't a direct array literal (`visible` from
 * `useMemo` over `AGENDA`), value-match falls back across local/imported object
 * arrays that have the bound property — unique match wins.
 *
 * Targeting is by VALUE, not position. A unique value edits cleanly; a shared
 * value is refused; no match ⇒ stale.
 */
/**
 * Peel wrappers that sit between a declaration and its literal.
 *
 * `export const COUNCIL_COPY = { … } as const;` is an AsExpression, not an
 * ObjectLiteralExpression, so a bare `isObjectLiteralExpression` check refuses
 * it — and `as const` is the norm for exactly the frozen config/data objects
 * people most want to edit. Same for `satisfies` and stray parentheses.
 */
function unwrapExpr(
  node: import('ts-morph').Node | undefined
): import('ts-morph').Node | undefined {
  const { Node } = require('ts-morph') as typeof import('ts-morph');
  let cur = node;
  for (let i = 0; cur && i < 8; i++) {
    if (Node.isAsExpression(cur) || Node.isSatisfiesExpression(cur)) {
      cur = cur.getExpression();
      continue;
    }
    if (Node.isParenthesizedExpression(cur) || Node.isTypeAssertion(cur)) {
      cur = cur.getExpression();
      continue;
    }
    break;
  }
  return cur;
}

export function applyBoundTextEdit(edit: Edit): EditResult {
  const { Project, SyntaxKind, Node } =
    require('ts-morph') as typeof import('ts-morph');

  const { lineNumber, columnNumber, expr, oldText, newText } = edit;
  const checkedPath = validateEditPath(edit.fileName);
  if (!checkedPath.ok) return { ok: false, error: checkedPath.error };
  const fileName = checkedPath.path!;
  if (!expr || typeof expr !== 'string') return { ok: false, error: 'missing expr' };
  if (typeof oldText !== 'string' || typeof newText !== 'string') {
    return { ok: false, error: 'missing oldText/newText' };
  }

  // `{s.name ?? s.role}` / `{a || b}` / `path??#lit:—` — try each operand.
  let candidates = String(expr)
    .split(/\?\?|\|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: `Bound-text expression "${expr}" has no base identifier.`,
    };
  }

  const project = new Project({
    compilerOptions: { allowJs: true, jsx: 4 /* preserve */ },
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFile = project.addSourceFileAtPath(fileName);

  const opens = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ].filter((n) => n.getStartLineNumber() === Number(lineNumber));
  if (opens.length === 0) {
    return {
      ok: false,
      error: `No JSX element found at ${fileName}:${lineNumber} to edit.`,
    };
  }
  let opening = opens[0];
  if (opens.length > 1 && columnNumber) {
    opening = opens
      .map((n) => ({
        n,
        d: Math.abs(
          sourceFile.getLineAndColumnAtPos(n.getStart()).column -
            Number(columnNumber)
        ),
      }))
      .sort((a, b) => a.d - b.d)[0].n;
  }

  type MorphNode = import('ts-morph').Node;
  type MorphExpr = import('ts-morph').Expression;
  type MorphArray = import('ts-morph').ArrayLiteralExpression;
  type MorphObject = import('ts-morph').ObjectLiteralExpression;
  type MorphString = import('ts-morph').StringLiteral;
  type MorphSourceFile = import('ts-morph').SourceFile;

  /** String literals inside JSX expression children of this element (ternary arms, ?? fallbacks). */
  const exprStringLiterals = (): MorphString[] => {
    const parent = opening.getParent();
    if (!parent || !Node.isJsxElement(parent)) return [];
    const out: MorphString[] = [];
    const walk = (n: MorphNode) => {
      if (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) {
        out.push(n as MorphString);
        return;
      }
      n.forEachChild(walk);
    };
    for (const ch of parent.getJsxChildren()) {
      if (Node.isJsxExpression(ch)) {
        const e = ch.getExpression();
        if (e) walk(e);
      }
    }
    return out;
  };

  const rewriteMatchingLiteral = (
    lits: MorphString[]
  ): EditResult | undefined => {
    const matches = lits.filter(
      (l) => l.getLiteralValue() === String(oldText)
    );
    if (matches.length === 1) {
      const owning = matches[0].getSourceFile();
      if (!edit.dryRun) {
        matches[0].setLiteralValue(String(newText));
        if (!trySave(owning)) return { ok: false, error: CORRUPT_MSG };
      }
      return {
        ok: true,
        fileName: owning.getFilePath(),
        lineNumber,
        oldText: String(oldText),
        newText,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        error: `"${oldText}" appears ${matches.length}× in the expression; make the value unique, or edit the source file.`,
      };
    }
    return undefined;
  };

  // `#ternary` — `{cond ? "A" : "B"}` (nested ok): rewrite the arm matching oldText.
  if (String(expr) === '#ternary') {
    const hit = rewriteMatchingLiteral(exprStringLiterals());
    if (hit) return hit;
    return {
      ok: false,
      error: `No string-literal ternary arm equals "${oldText}"; reload and try again.`,
    };
  }

  // Candidates that are `#lit:…` rewrite the matching literal in the JSX expr;
  // remaining candidates fall through to normal path/object resolution below.
  const pathCandidates: string[] = [];
  for (const cand of candidates) {
    if (cand.startsWith('#lit:')) {
      const want = cand.slice('#lit:'.length);
      if (want === String(oldText)) {
        const hit = rewriteMatchingLiteral(exprStringLiterals());
        if (hit) return hit;
      }
      // Literal side isn't what's showing — try other candidates.
      continue;
    }
    if (cand === '#ternary') {
      const hit = rewriteMatchingLiteral(exprStringLiterals());
      if (hit) return hit;
      continue;
    }
    pathCandidates.push(cand);
  }
  if (pathCandidates.length === 0) {
    return {
      ok: false,
      error: `Could not resolve bound-text expression "${expr}" to an editable string.`,
    };
  }
  candidates = pathCandidates;

  const resolveInitializer = (
    name: string,
    from: MorphSourceFile
  ): { init?: MorphExpr; where: string; file: MorphSourceFile } => {
    const local = from.getVariableDeclaration(name);
    if (local)
      return { init: local.getInitializer(), where: 'local', file: from };
    for (const imp of from.getImportDeclarations()) {
      const named = imp
        .getNamedImports()
        .find((ni) => (ni.getAliasNode()?.getText() ?? ni.getName()) === name);
      const isDefault = imp.getDefaultImport()?.getText() === name;
      if (!named && !isDefault) continue;
      const spec = imp.getModuleSpecifierValue();
      const dataFile =
        resolveModuleFile(spec, from.getFilePath(), project) ??
        imp.getModuleSpecifierSourceFile();
      if (!dataFile) {
        return {
          init: undefined,
          where: `unresolved import "${spec}"`,
          file: from,
        };
      }
      const exportName = named ? named.getName() : name;
      const decl = dataFile.getVariableDeclaration(exportName);
      return {
        init: decl?.getInitializer(),
        where: dataFile.getFilePath(),
        file: dataFile,
      };
    }
    return { init: undefined, where: 'not found', file: from };
  };

  /** Does this parameter bind `name` (plain ident or `{ name }` destructure)? */
  const paramBindsName = (
    fn: import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression,
    name: string
  ): boolean => {
    for (const p of fn.getParameters()) {
      const nn = p.getNameNode();
      if (Node.isIdentifier(nn) && nn.getText() === name) return true;
      if (Node.isObjectBindingPattern(nn)) {
        for (const el of nn.getElements()) {
          // `{ session }` or `{ session: s }` — binding name is what JSX uses.
          if (el.getName() === name) return true;
        }
      }
    }
    return false;
  };

  /** Component display name for a function decl / const arrow, if capitalized. */
  const componentNameOf = (
    fn: import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression
  ): string | undefined => {
    const parent = fn.getParent();
    if (Node.isFunctionDeclaration(fn as never)) {
      // unreachable — FunctionDeclaration isn't Arrow/FunctionExpression
    }
    if (Node.isVariableDeclaration(parent)) {
      const n = parent.getName();
      if (/^[A-Z]/.test(n)) return n;
    }
    // function expression with inner name, or FunctionDeclaration via ancestors
    for (const a of fn.getAncestors()) {
      if (Node.isFunctionDeclaration(a)) {
        const n = a.getName();
        if (n && /^[A-Z]/.test(n)) return n;
        return undefined;
      }
      if (Node.isVariableDeclaration(a)) {
        const n = a.getName();
        if (/^[A-Z]/.test(n)) return n;
        return undefined;
      }
    }
    return undefined;
  };

  /** Also handle `function Row(...)` which is a FunctionDeclaration, not expr. */
  const functionDeclName = (
    node: MorphNode
  ): { name: string; fn: import('ts-morph').FunctionDeclaration } | undefined => {
    if (Node.isFunctionDeclaration(node)) {
      const n = node.getName();
      if (n && /^[A-Z]/.test(n)) return { name: n, fn: node };
    }
    return undefined;
  };

  const paramBindsOnDecl = (
    fn: import('ts-morph').FunctionDeclaration,
    name: string
  ): boolean => {
    for (const p of fn.getParameters()) {
      const nn = p.getNameNode();
      if (Node.isIdentifier(nn) && nn.getText() === name) return true;
      if (Node.isObjectBindingPattern(nn)) {
        for (const el of nn.getElements()) {
          if (el.getName() === name) return true;
        }
      }
    }
    return false;
  };

  const leafOfPath = (
    root: MorphObject,
    propPath: string[],
    label: string
  ): { leaf?: MorphString; err?: string } => {
    if (propPath.length === 0) {
      return { err: `"${label}": empty property path.` };
    }
    let obj = root;
    for (let i = 0; i < propPath.length - 1; i++) {
      const p = obj.getProperty(propPath[i]);
      if (!p || !Node.isPropertyAssignment(p))
        return { err: `"${label}": no property "${propPath[i]}".` };
      const v = p.getInitializer();
      const vu = unwrapExpr(v);
      if (!vu || !Node.isObjectLiteralExpression(vu))
        return { err: `"${label}": "${propPath[i]}" is not a nested object.` };
      obj = vu;
    }
    const leafName = propPath[propPath.length - 1];
    const la = obj.getProperty(leafName);
    if (!la || !Node.isPropertyAssignment(la))
      return { err: `"${label}": no property "${leafName}".` };
    const li = la.getInitializer();
    if (!li || !Node.isStringLiteral(li))
      return {
        err: `"${label}": "${leafName}" is not a string literal, so it can't be edited.`,
      };
    return { leaf: li };
  };

  const valueMatchInArray = (
    arr: MorphArray,
    propPath: string[],
    label: string
  ): { matches: MorphString[]; leafErr?: string } => {
    const matches: MorphString[] = [];
    let leafErr: string | undefined;
    for (const el of arr.getElements()) {
      if (propPath.length === 0) {
        if (
          Node.isStringLiteral(el) &&
          el.getLiteralValue() === String(oldText)
        ) {
          matches.push(el);
        }
        continue;
      }
      const elu = unwrapExpr(el);
      if (!elu || !Node.isObjectLiteralExpression(elu)) continue;
      const { leaf, err } = leafOfPath(elu, propPath, label);
      if (err) {
        leafErr = err;
        continue;
      }
      if (leaf!.getLiteralValue() === String(oldText)) matches.push(leaf!);
    }
    return { matches, leafErr };
  };

  /** Local + relatively-imported `const X = [ {…}, … ]` arrays. */
  const allObjectArrays = (): { arr: MorphArray; label: string }[] => {
    const out: { arr: MorphArray; label: string }[] = [];
    const seen = new Set<string>();
    const addFrom = (sf: MorphSourceFile) => {
      for (const d of sf.getVariableDeclarations()) {
        const init = d.getInitializer();
        const initu = unwrapExpr(init);
        if (!initu || !Node.isArrayLiteralExpression(initu)) continue;
        const key = sf.getFilePath() + '#' + d.getName();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ arr: initu, label: d.getName() });
      }
    };
    addFrom(sourceFile);
    for (const imp of sourceFile.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (!spec.startsWith('.')) continue;
      const dataFile =
        resolveModuleFile(spec, fileName, project) ??
        imp.getModuleSpecifierSourceFile();
      if (dataFile) addFrom(dataFile);
    }
    return out;
  };

  type ResolveHit =
    | { kind: 'array'; arr: MorphArray; propPath: string[]; label: string }
    | {
        kind: 'fallback';
        propPath: string[];
        /** Collection name that wasn't a direct array literal (e.g. `visible`). */
        via: string;
      }
    | { kind: 'object'; obj: MorphObject; propPath: string[]; label: string }
    | { kind: 'fail'; error: string };

  /**
   * Resolve one dotted path (`s.name`, `q`, `session.title`) starting from a
   * JSX opening (or call-site opening after prop drill).
   */
  const resolvePath = (
    fromOpening: MorphNode,
    pathExpr: string,
    depth: number
  ): ResolveHit => {
    if (depth > 8) {
      return { kind: 'fail', error: `Bound-text prop-drill for "${pathExpr}" went too deep.` };
    }
    const parts = pathExpr.split('.').filter(Boolean);
    const base = parts[0];
    const propPath = parts.slice(1);
    if (!base) {
      return { kind: 'fail', error: `Bound-text expression "${pathExpr}" has no base.` };
    }

    // Walk ancestors for a binding of `base`.
    for (const anc of fromOpening.getAncestors()) {
      // `function Row({ q }) { … }`
      const decl = functionDeclName(anc);
      if (decl && paramBindsOnDecl(decl.fn, base)) {
        // Prop of a component — find call sites and drill.
        const drilled = drillProp(decl.name, base, propPath, fromOpening, depth);
        if (drilled) return drilled;
        return {
          kind: 'fail',
          error: `Found component prop "${base}" on ${decl.name} but no resolvable call-site binding.`,
        };
      }

      if (!Node.isArrowFunction(anc) && !Node.isFunctionExpression(anc)) continue;
      if (!paramBindsName(anc, base)) continue;

      const call = anc.getParent();
      if (call && Node.isCallExpression(call)) {
        const callee = call.getExpression();
        if (
          Node.isPropertyAccessExpression(callee) &&
          (callee.getName() === 'map' || callee.getName() === 'flatMap')
        ) {
          const objExpr = callee.getExpression();
          if (Node.isArrayLiteralExpression(objExpr)) {
            return {
              kind: 'array',
              arr: objExpr,
              propPath,
              label: 'the mapped array',
            };
          }
          if (Node.isIdentifier(objExpr)) {
            const cname = objExpr.getText();
            const { init, where } = resolveInitializer(
              cname,
              fromOpening.getSourceFile()
            );
            const initArr = unwrapExpr(init);
            if (initArr && Node.isArrayLiteralExpression(initArr)) {
              return { kind: 'array', arr: initArr, propPath, label: cname };
            }
            // `visible` from useMemo / filter — fall back to value-match across
            // known object arrays (AGENDA, SPEAKERS, …).
            if (propPath.length > 0) {
              return { kind: 'fallback', propPath, via: cname };
            }
            return {
              kind: 'fail',
              error: `Could not resolve "${cname}" to an array literal (${where}).`,
            };
          }
        }
      }

      // Capitalized const/function component param — prop drill.
      const cname = componentNameOf(anc);
      if (cname) {
        const drilled = drillProp(cname, base, propPath, fromOpening, depth);
        if (drilled) return drilled;
      }

      // Nearest binding of base wasn't a map and wasn't a drillable component.
      break;
    }

    // Direct-object binding (`cfg.title`).
    if (propPath.length === 0) {
      return {
        kind: 'fail',
        error: `Bound-text expression "${pathExpr}" is a bare identifier that isn't a mapped-array element or resolvable component prop.`,
      };
    }
    const { init, where } = resolveInitializer(base, fromOpening.getSourceFile());
    const initObj = unwrapExpr(init);
    if (!initObj || !Node.isObjectLiteralExpression(initObj)) {
      return {
        kind: 'fail',
        error: `Could not resolve "${base}" to an object literal (${where}).`,
      };
    }
    return { kind: 'object', obj: initObj, propPath, label: base };
  };

  /**
   * Find `<Comp prop={expr} />` usages and continue resolution from `expr`.
   * `q={f.q}` → resolve `f.q`; `session={session}` → resolve `session` (+rest path)
   * from the call site (where `session` is often a `.map` param).
   */
  const drillProp = (
    compName: string,
    propName: string,
    restPath: string[],
    _fromOpening: MorphNode,
    depth: number
  ): ResolveHit | undefined => {
    const usages = sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)
      .concat(
        sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement) as never
      )
      .filter((el) => {
        const tag = el.getTagNameNode().getText();
        return tag === compName;
      });

    for (const usage of usages) {
      const attr = usage.getAttribute(propName);
      if (!attr || !Node.isJsxAttribute(attr)) continue;
      const init = attr.getInitializer();
      if (!init) continue;

      // `q={f.q}` or `q="literal"` — only expression containers are drillable.
      if (Node.isJsxExpression(init)) {
        const e = init.getExpression();
        if (!e) continue;
        if (Node.isIdentifier(e)) {
          const next = [e.getText(), ...restPath].join('.');
          return resolvePath(usage, next, depth + 1);
        }
        if (Node.isPropertyAccessExpression(e)) {
          // Rebuild dotted path from the member expression + rest.
          const segs: string[] = [];
          let cur: MorphExpr = e;
          while (Node.isPropertyAccessExpression(cur)) {
            segs.unshift(cur.getName());
            cur = cur.getExpression();
          }
          if (!Node.isIdentifier(cur)) continue;
          segs.unshift(cur.getText());
          const next = [...segs, ...restPath].join('.');
          return resolvePath(usage, next, depth + 1);
        }
      }
    }
    return undefined;
  };

  // Try each `??` / `||` operand; collect unique matching leaves.
  const allMatches: MorphString[] = [];
  let lastErr: string | undefined;

  for (const cand of candidates) {
    const hit = resolvePath(opening, cand, 0);
    if (hit.kind === 'fail') {
      lastErr = hit.error;
      continue;
    }
    if (hit.kind === 'object') {
      const { leaf, err } = leafOfPath(hit.obj, hit.propPath, cand);
      if (!leaf) {
        lastErr = err;
        continue;
      }
      if (leaf.getLiteralValue() === String(oldText)) allMatches.push(leaf);
      else
        lastErr = `Bound-text edit no longer matches the source ("${leaf.getLiteralValue()}" ≠ "${oldText}"); reload and try again.`;
      continue;
    }
    if (hit.kind === 'fallback') {
      const matches: MorphString[] = [];
      let leafErr: string | undefined;
      for (const { arr, label } of allObjectArrays()) {
        const r = valueMatchInArray(arr, hit.propPath, label);
        matches.push(...r.matches);
        if (r.leafErr) leafErr = r.leafErr;
      }
      if (matches.length === 1) {
        allMatches.push(matches[0]);
      } else if (matches.length > 1) {
        return {
          ok: false,
          error: `"${oldText}" appears ${matches.length}× across data arrays (via "${hit.via}"); nextcanvas can't tell which entry you meant. Make the value unique, or edit it directly in the data file.`,
        };
      } else {
        lastErr =
          leafErr ?? `Not editable — this text comes from your data, not your code.`;
      }
      continue;
    }
    // hit.kind === 'array'
    const { matches, leafErr } = valueMatchInArray(
      hit.arr,
      hit.propPath,
      hit.label
    );
    if (matches.length === 1) {
      allMatches.push(matches[0]);
    } else if (matches.length > 1) {
      return {
        ok: false,
        error: `"${oldText}" appears ${matches.length}× in ${hit.label}; nextcanvas can't tell which entry you meant. Make the value unique, or edit it directly in the data file.`,
      };
    } else {
      lastErr =
        leafErr ??
        `Couldn't find this text in ${hit.label} — the source may have changed, ` +
        `or the text is altered before it's shown.`;
    }
  }

  // Deduplicate by node identity (same leaf found via two candidates).
  const unique = [...new Set(allMatches)];
  if (unique.length === 1) {
    const leafInit = unique[0];
    const owning = leafInit.getSourceFile();
    if (!edit.dryRun) {
      leafInit.setLiteralValue(String(newText));
      if (!trySave(owning)) return { ok: false, error: CORRUPT_MSG };
    }
    return {
      ok: true,
      fileName: owning.getFilePath(),
      lineNumber,
      oldText: String(oldText),
      newText,
    };
  }
  if (unique.length > 1) {
    return {
      ok: false,
      error: `"${oldText}" matched ${unique.length} different source locations for "${expr}"; make the value unique, or edit the data file.`,
    };
  }
  return {
    ok: false,
    error:
      lastErr ??
      `Could not resolve bound-text expression "${expr}" to an editable string.`,
  };
}

/** A single-quoted JS string literal, safe for arbitrary CSS values. */
function jsString(value: string): string {
  return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Write `property` into the element's `className` as a Tailwind utility.
 *
 * Only a plain string is rewritten — `className="a b"`, `className={'a b'}` or
 * an untagged template with no `${}` in it. Anything computed (`className={cn(
 * 'a', busy && 'b')}`, a template with substitutions, a bare identifier) is
 * refused rather than guessed at: appending to one branch of a conditional would
 * change the styling of states the author did not select, and there is no
 * position that is correct for every render. This mirrors how the inline path
 * already refuses `style={someVar}`.
 */
function applyClassStyle(
  target: any,
  property: string,
  value: string,
  remove: boolean,
  Node: any,
  _SyntaxKind: any
): EditResult {
  const attr = target.getAttribute('className');

  if (!attr) {
    if (remove) return { ok: true };
    const cls = rewriteClassList('', property, value);
    if (!cls) return { ok: false, error: `Cannot express ${property} as a Tailwind class.` };
    target.addAttribute({ name: 'className', initializer: `"${cls}"` });
    return { ok: true };
  }

  if (!Node.isJsxAttribute(attr)) {
    return { ok: false, error: 'className is a spread; cannot edit.' };
  }

  const init = attr.getInitializer();
  let literal: any = null;

  if (Node.isStringLiteral(init)) {
    literal = init;
  } else if (Node.isJsxExpression(init)) {
    const inner = init.getExpression();
    if (Node.isStringLiteral(inner) || Node.isNoSubstitutionTemplateLiteral(inner)) {
      literal = inner;
    }
  }

  if (!literal) {
    return {
      ok: false,
      error:
        'This element builds className dynamically, so nextcanvas cannot safely add a class. Edit the class list in your source, or give the element a plain className string.',
    };
  }

  const next = rewriteClassList(String(literal.getLiteralValue()), property, value);

  if (!next.trim()) {
    attr.remove();
    return { ok: true };
  }
  literal.setLiteralValue(next);
  return { ok: true };
}

/**
 * Drop `property` from a literal inline `style={{...}}` if one is present.
 *
 * Called after a class write: an inline value for the same property wins over
 * any class, so leaving it behind makes the class edit look broken. Anything
 * non-literal is left alone — it isn't ours to rewrite.
 */
function clearInlineProperty(target: any, property: string, Node: any): void {
  const styleAttr = target.getAttribute('style');
  if (!styleAttr || !Node.isJsxAttribute(styleAttr)) return;
  const init = styleAttr.getInitializer();
  const expr = Node.isJsxExpression(init) ? init.getExpression() : undefined;
  if (!expr || !Node.isObjectLiteralExpression(expr)) return;
  const existing = expr.getProperty(property);
  if (!existing) return;
  existing.remove();
  if (expr.getProperties().length === 0) styleAttr.remove();
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** camelCase style keys are valid identifiers; quote anything unexpected. */
function styleKey(property: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(property) ? property : jsString(property);
}

/**
 * Set (or remove) one property of an element's inline `style={{...}}` object.
 *
 * The element is located by the same `data-loc` the overlay reads: we find the
 * JSX opening element whose tag starts on `lineNumber` (disambiguating by
 * `columnNumber` when several share a line). Only a literal `style={{...}}` is
 * editable — `style={someVar}` is rejected rather than silently mangled.
 *
 * Writing back is the inverse of a "remove": an empty/null `value` deletes the
 * key (and drops an empty `style` attribute entirely), which is exactly what the
 * overlay sends to undo a style that had no prior inline value. So this stays
 * stateless — the client owns before/after; the server just set-or-removes.
 */
export function applyStyleEdit(edit: StyleEdit): EditResult {
  const { Project, SyntaxKind, Node } =
    require('ts-morph') as typeof import('ts-morph');

  const { lineNumber, columnNumber, property } = edit;
  const checked = validateEditPath(edit.fileName);
  if (!checked.ok) return { ok: false, error: checked.error };
  const fileName = checked.path!;
  if (!property || typeof property !== 'string') {
    return { ok: false, error: 'missing style property' };
  }
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(property)) {
    return { ok: false, error: `Malformed style property "${property}".` };
  }
  const value = edit.value == null ? '' : String(edit.value);
  const remove = value.trim() === '';

  const project = new Project({
    compilerOptions: { allowJs: true, jsx: 4 /* preserve */ },
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFile = project.addSourceFileAtPath(fileName);

  const opens = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ].filter((n) => n.getStartLineNumber() === Number(lineNumber));

  if (opens.length === 0) {
    return {
      ok: false,
      error: `No JSX element found at ${fileName}:${lineNumber} to style.`,
    };
  }

  // Several host elements can open on one line; pick the one whose start column
  // is closest to the stamped column.
  let target = opens[0];
  if (opens.length > 1 && columnNumber) {
    target = opens
      .map((n) => ({
        n,
        d: Math.abs(
          sourceFile.getLineAndColumnAtPos(n.getStart()).column -
            Number(columnNumber)
        ),
      }))
      .sort((a, b) => a.d - b.d)[0].n;
  }

  // In a Tailwind project, write a utility class instead of an inline style —
  // an inline `style` object in a utility-class codebase is a diff most teams
  // will not merge. Falls through to the inline path for everyone else.
  if (isMappable(property) && usesTailwind(fileName)) {
    const classResult = applyClassStyle(
      target,
      property,
      value,
      remove,
      Node,
      SyntaxKind
    );
    if (!classResult.ok) return { ...classResult, fileName, lineNumber, property };
    // An inline value for the same property would outrank the class we just
    // wrote, leaving the edit visibly dead. Strip it if it's ours to strip.
    clearInlineProperty(target, property, Node);
    if (!trySave(sourceFile)) return { ok: false, error: CORRUPT_MSG };
    return { ok: true, fileName, lineNumber, property, value, mode: 'class' };
  }

  const styleAttr = target.getAttribute('style');

  if (!styleAttr) {
    if (remove)
      return { ok: true, fileName, lineNumber, property, value: '', mode: 'inline' };
    target.addAttribute({
      name: 'style',
      initializer: `{{ ${styleKey(property)}: ${jsString(value)} }}`,
    });
    if (!trySave(sourceFile)) return { ok: false, error: CORRUPT_MSG };
    return { ok: true, fileName, lineNumber, property, value, mode: 'inline' };
  }

  if (!Node.isJsxAttribute(styleAttr)) {
    return { ok: false, error: 'style attribute is a spread; cannot edit.' };
  }
  const init = styleAttr.getInitializer();
  const expr = Node.isJsxExpression(init) ? init.getExpression() : undefined;
  if (!expr || !Node.isObjectLiteralExpression(expr)) {
    return {
      ok: false,
      error:
        'nextcanvas can only edit an inline style={{ ... }} object literal on this element.',
    };
  }

  const existing = expr.getProperty(property);
  if (remove) {
    if (existing) existing.remove();
    if (expr.getProperties().length === 0) styleAttr.remove();
    if (!trySave(sourceFile)) return { ok: false, error: CORRUPT_MSG };
    return { ok: true, fileName, lineNumber, property, value: '', mode: 'inline' };
  }

  if (existing && Node.isPropertyAssignment(existing)) {
    existing.setInitializer(jsString(value));
  } else {
    if (existing) existing.remove();
    expr.addPropertyAssignment({
      name: styleKey(property),
      initializer: jsString(value),
    });
  }
  if (!trySave(sourceFile)) return { ok: false, error: CORRUPT_MSG };
  return { ok: true, fileName, lineNumber, property, value, mode: 'inline' };
}

interface ResolveItem {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
  expr: string;
  oldText: string;
}

/**
 * Dry-run a batch of bound-text stamps and report which are actually writable.
 *
 * The SWC plugin stamps `{s.display_name}` on shape alone — it is syntactic,
 * single-file, and cannot tell a `.map` over a literal array from one over rows
 * fetched at runtime. That made the overlay advertise edits which could never
 * land: the element highlighted, and committing produced an error. This lets the
 * overlay ask first, using the very same resolution the write path uses, so the
 * two can never disagree.
 *
 * Callers should send one item per distinct source location (a `.map` renders
 * many elements from one line), which is also what keeps the batch cheap.
 */
function resolveBatch(items: ResolveItem[]): {
  key: string;
  ok: boolean;
  error?: string;
}[] {
  return items.map((it) => {
    const key = `${it.fileName}:${it.lineNumber}:${it.columnNumber}|${it.expr}`;
    try {
      const r = applyBoundTextEdit({
        fileName: it.fileName,
        lineNumber: it.lineNumber,
        columnNumber: it.columnNumber,
        expr: it.expr,
        oldText: it.oldText,
        newText: it.oldText,
        textBound: true,
        dryRun: true,
      });
      return { key, ok: r.ok, error: r.error };
    } catch (err) {
      return {
        key,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

/**
 * Serialize all mutating edits through one queue.
 *
 * Every `apply*` call is a read-modify-write on a source file (ts-morph reads
 * the file, edits the AST, `saveSync`s). Today they are fully synchronous, so
 * Node's event loop already runs them one at a time with no interleaving — two
 * concurrent requests can't produce a lost update because each re-reads the
 * current file. This queue makes that guarantee **explicit and durable**: it
 * survives someone later introducing an `await` into a write path (at which
 * point sync atomicity would silently break), and it documents the intent. The
 * overhead is a microtask hop per edit — irrelevant for a human clicking.
 *
 * Read-only endpoints (`/resolve`, dry-run) are not queued; they never write.
 */
let writeQueue: Promise<void> = Promise.resolve();
function serializeWrite(task: () => void): void {
  const run = writeQueue.then(task);
  // Keep the chain alive whether the task resolved or threw (it shouldn't — the
  // task has its own try/catch and always responds — but never wedge the queue).
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
}

/** Largest accepted request body; beyond this the request is answered 413. */
const MAX_BODY_BYTES = 1_000_000;
/** Largest /resolve batch; a bigger one is truncated (and logged). */
const MAX_RESOLVE_ITEMS = 500;

export function handler(req: IncomingMessage, res: ServerResponse): void {
  const origin =
    typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

  // Who is asking? A file-writing server on localhost is a drive-by target for
  // any website open in the same browser, so non-local origins/hosts are turned
  // away before a single byte of the body is read. See src/security.ts.
  const source = checkRequestSource(origin, req.headers.host);
  if (!source.ok) {
    console.warn(`[nextcanvas] ${source.error}`);
    // No CORS headers on the refusal: the caller can't read it either.
    return send(res, 403, { ok: false, error: source.error });
  }

  if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, service: 'nextcanvas' }, origin);
  }
  if (req.method === 'GET' && req.url === '/overlay.js') {
    // Serve the overlay as a raw classic script so no bundler ever touches it.
    fs.readFile(OVERLAY_PATH, 'utf8', (err, code) => {
      if (err) {
        res.writeHead(500);
        res.end('// nextcanvas: overlay not found');
        return;
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      };
      if (origin) headers['Access-Control-Allow-Origin'] = origin;
      res.writeHead(200, headers);
      res.end(code);
    });
    return;
  }
  const isText = req.method === 'POST' && req.url === '/edit';
  const isStyle = req.method === 'POST' && req.url === '/style';
  const isResolve = req.method === 'POST' && req.url === '/resolve';
  if (!isText && !isStyle && !isResolve) {
    return send(res, 404, { ok: false, error: 'not found' }, origin);
  }

  let raw = '';
  let tooLarge = false;
  req.on('data', (chunk) => {
    if (tooLarge) return;
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) {
      tooLarge = true;
      raw = '';
      send(res, 413, { ok: false, error: 'payload too large' }, origin);
    }
  });
  req.on('end', () => {
    if (tooLarge) return;
    let payload: Edit & StyleEdit;
    try {
      payload = JSON.parse(raw);
    } catch {
      return send(res, 400, { ok: false, error: 'invalid JSON' }, origin);
    }
    if (payload == null || typeof payload !== 'object') {
      return send(res, 400, { ok: false, error: 'invalid payload' }, origin);
    }
    if (isResolve) {
      let items = Array.isArray((payload as { items?: ResolveItem[] }).items)
        ? (payload as unknown as { items: ResolveItem[] }).items
        : [];
      if (items.length > MAX_RESOLVE_ITEMS) {
        console.warn(
          `[nextcanvas] /resolve batch of ${items.length} truncated to ${MAX_RESOLVE_ITEMS}`
        );
        items = items.slice(0, MAX_RESOLVE_ITEMS);
      }
      try {
        const results = resolveBatch(items);
        const dead = results.filter((r) => !r.ok).length;
        if (dead) {
          console.log(
            `[nextcanvas] ${dead}/${results.length} bound-text location(s) are not writable; the overlay will not offer them`
          );
        }
        return send(res, 200, { ok: true, results }, origin);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return send(res, 500, { ok: false, error: message }, origin);
      }
    }

    // Run through the write queue so overlapping edits can never interleave.
    serializeWrite(() => {
      try {
        const result = isStyle
          ? applyStyleEdit(payload)
          : payload.textBound
            ? applyBoundTextEdit(payload)
            : payload.attrName
              ? applyAttrEdit(payload)
              : applyEdit(payload);
        const status = result.ok ? 200 : 422;
        if (result.ok) {
          console.log(
            isStyle
              ? `[nextcanvas] styled ${result.fileName}: ${result.property} = "${result.value}"`
              : `[nextcanvas] edited ${result.fileName}: "${result.oldText}" -> "${result.newText}"`
          );
        } else {
          console.warn(`[nextcanvas] rejected edit: ${result.error}`);
        }
        send(res, status, result, origin);
      } catch (err) {
        console.error('[nextcanvas] edit failed:', err);
        const message = err instanceof Error ? err.message : String(err);
        send(res, 500, { ok: false, error: message }, origin);
      }
    });
  });
}

/** How often to re-attempt the bind while the port is held by someone else. */
const REBIND_INTERVAL_MS = 2000;

/**
 * Boot the edit server once per process. Safe to call repeatedly.
 *
 * EADDRINUSE is NOT terminal. `withCanvas` calls this at config-load time, and
 * the process holding the port may be on its way out — a previous `next dev`
 * shutting down, or a short-lived process that binds and then exits (Next can
 * load the config, bind, and only afterwards decide to bail, e.g. "Another next
 * dev server is already running"). Giving up on the first EADDRINUSE left Next
 * dev running happily with no edit server behind it: every edit then toasted
 * "Could not reach the nextcanvas server", the overlay script 404'd on the next
 * reload so the toolbar vanished, and only a full dev restart recovered it.
 *
 * So we keep a low-frequency watchdog that re-attempts the bind whenever we are
 * not listening. Whoever currently owns the port keeps it; if that owner dies,
 * the next tick takes over. The timer is unref'd, so it never holds the process
 * open on its own.
 */
export function startServer(): http.Server {
  if (global.__nextCanvasServer) return global.__nextCanvasServer;

  const server = http.createServer(handler);
  let binding = false;

  const tryBind = (): void => {
    if (server.listening || binding) return;
    binding = true;
    // Loopback-only by default (NEXTCANVAS_HOST overrides) — the LAN never
    // sees the file-writing server unless the user opts in.
    server.listen(PORT, HOST);
  };

  server.on('listening', () => {
    binding = false;
    console.log(
      `[nextcanvas] edit server listening on http://localhost:${PORT}`
    );
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    binding = false;
    if (err.code === 'EADDRINUSE') {
      // Someone else holds it right now — maybe a sibling dev worker, maybe a
      // process that is about to exit. Stay quiet; the watchdog retries.
      return;
    }
    console.error('[nextcanvas] server error:', err);
  });

  tryBind();
  const watchdog = setInterval(tryBind, REBIND_INTERVAL_MS);
  watchdog.unref();

  global.__nextCanvasServer = server;
  return server;
}
