/**
 * nextcanvas write-back server.
 *
 * Runs only in `next dev`. Listens on a side port and applies edits coming from
 * the browser overlay to the actual source files using a formatting-preserving
 * AST edit (ts-morph). Next.js Fast Refresh then reflects the change in the
 * browser automatically, so there is no server -> client channel to maintain.
 *
 * MVP scope: static JSX text only, e.g. <h1>Hello</h1>. Bound expressions such
 * as <h1>{title}</h1> are rejected with a clear message.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';

export const PORT = Number(process.env.NEXTCANVAS_PORT || 3131);
const OVERLAY_PATH = path.join(__dirname, 'overlay.js');

interface Edit {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
  oldText: string;
  newText: string;
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

  const { fileName, lineNumber, oldText, newText } = edit;
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
  const full = target.getText();
  const leading = /^\s*/.exec(full)?.[0] ?? '';
  const trailing = /\s*$/.exec(full)?.[0] ?? '';
  target.replaceWithText(leading + String(newText) + trailing);
  sourceFile.saveSync();

  return { ok: true, fileName, lineNumber, oldText: wanted, newText };
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
      const result = isStyle ? applyStyleEdit(payload) : applyEdit(payload);
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
