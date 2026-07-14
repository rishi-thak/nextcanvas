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

export const PORT = Number(process.env.NEXTCANVAS_PORT || 3131);
const OVERLAY_PATH = path.join(__dirname, 'overlay.js');

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
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

/** Apply a single static-text edit to a source file. */
export function applyEdit(edit: Edit): EditResult {
  // Lazy-require so merely loading this file (e.g. in the Next config worker)
  // does not pull in ts-morph until an edit actually arrives.
  const { Project, SyntaxKind } =
    require('ts-morph') as typeof import('ts-morph');

  const { fileName, lineNumber, columnNumber, oldText, newText } = edit;
  if (!fileName) return { ok: false, error: 'missing fileName' };

  const project = new Project({
    compilerOptions: { allowJs: true, jsx: 4 /* preserve */ },
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFile = project.addSourceFileAtPath(fileName);

  // Compare with internal whitespace collapsed: the browser hands us the
  // rendered textContent (runs of whitespace → a single space), while the JSX
  // source text node may be wrapped across several indented lines. Trimming
  // alone isn't enough — we must normalize interior whitespace on both sides.
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

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
        text: String(seg.newText),
      }))
      .sort((a, b) => b.start - a.start);

    if (patches.length === 0) {
      return { ok: true, fileName, lineNumber, oldText: '', newText: '' };
    }
    for (const p of patches) sourceFile.replaceText([p.start, p.end], p.text);
    sourceFile.saveSync();
    return {
      ok: true,
      fileName,
      lineNumber,
      oldText: segments.map((s) => s.oldText).join(' | '),
      newText: segments.map((s) => s.newText).join(' | '),
    };
  }

  if (oldText == null) return { ok: false, error: 'missing oldText' };
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
  target.replaceWithText(rewrap(target.getText(), String(newText)));
  sourceFile.saveSync();

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

  const { fileName, lineNumber, attrName, oldText, newText } = edit;
  if (!fileName) return { ok: false, error: 'missing fileName' };
  if (!attrName) return { ok: false, error: 'missing attrName' };

  const project = new Project({
    compilerOptions: { allowJs: true, jsx: 4 /* preserve */ },
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFile = project.addSourceFileAtPath(fileName);

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
  sourceFile.saveSync();

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
    // Inline a literal on just this element. JSON.stringify yields a safely
    // escaped double-quoted string, turning `href={GITHUB}` into `href="new"`.
    target.setInitializer(JSON.stringify(String(newText)));
    sourceFile.saveSync();
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
  sourceFile.saveSync();
  return { ok: true, fileName, lineNumber, oldText, newText };
}

/** A single-quoted JS string literal, safe for arbitrary CSS values. */
function jsString(value: string): string {
  return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

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

  const { fileName, lineNumber, columnNumber, property } = edit;
  if (!fileName) return { ok: false, error: 'missing fileName' };
  if (!property) return { ok: false, error: 'missing style property' };
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

  const styleAttr = target.getAttribute('style');

  if (!styleAttr) {
    if (remove) return { ok: true, fileName, lineNumber, property, value: '' };
    target.addAttribute({
      name: 'style',
      initializer: `{{ ${styleKey(property)}: ${jsString(value)} }}`,
    });
    sourceFile.saveSync();
    return { ok: true, fileName, lineNumber, property, value };
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
    sourceFile.saveSync();
    return { ok: true, fileName, lineNumber, property, value: '' };
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
  sourceFile.saveSync();
  return { ok: true, fileName, lineNumber, property, value };
}

function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, service: 'nextcanvas' });
  }
  if (req.method === 'GET' && req.url === '/overlay.js') {
    // Serve the overlay as a raw classic script so no bundler ever touches it.
    fs.readFile(OVERLAY_PATH, 'utf8', (err, code) => {
      if (err) {
        res.writeHead(500);
        res.end('// nextcanvas: overlay not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(code);
    });
    return;
  }
  const isText = req.method === 'POST' && req.url === '/edit';
  const isStyle = req.method === 'POST' && req.url === '/style';
  if (!isText && !isStyle) {
    return send(res, 404, { ok: false, error: 'not found' });
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy(); // basic guard
  });
  req.on('end', () => {
    let payload: Edit & StyleEdit;
    try {
      payload = JSON.parse(raw);
    } catch {
      return send(res, 400, { ok: false, error: 'invalid JSON' });
    }
    try {
      const result = isStyle
        ? applyStyleEdit(payload)
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
      return send(res, status, result);
    } catch (err) {
      console.error('[nextcanvas] edit failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      return send(res, 500, { ok: false, error: message });
    }
  });
}

/** Boot the edit server once per process. Safe to call repeatedly. */
export function startServer(): http.Server {
  if (global.__nextCanvasServer) return global.__nextCanvasServer;

  const server = http.createServer(handler);
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // Another dev worker already booted it; that's fine.
      return;
    }
    console.error('[nextcanvas] server error:', err);
  });
  server.listen(PORT, () => {
    console.log(
      `[nextcanvas] edit server listening on http://localhost:${PORT}`
    );
  });

  global.__nextCanvasServer = server;
  return server;
}
