/**
 * Request and path validation for the nextcanvas edit server.
 *
 * The edit server writes files to disk on behalf of a browser page, which makes
 * it a target for drive-by attacks: any website open in the developer's browser
 * can POST to http://localhost:3131 unless the server checks who is asking.
 * Two gates close that off:
 *
 *   1. Origin/Host validation — only local origins (localhost, 127.0.0.1,
 *      [::1], *.localhost, RFC-1918 private LAN addresses for phone testing)
 *      may call the write endpoints. `NEXTCANVAS_ALLOWED_ORIGINS` (comma-
 *      separated, exact origins) extends the list for forwarded/remote dev
 *      setups (Codespaces, custom dev domains). Requests with NO Origin header
 *      are allowed — those come from non-browser tools on the same machine,
 *      which could already write files directly. `Origin: null` (sandboxed
 *      iframes, file://) is refused. The Host check additionally defeats DNS
 *      rebinding, where a hostile domain resolves to 127.0.0.1 so the browser
 *      treats the edit server as same-origin.
 *
 *   2. Path containment — every fileName coming from the client must resolve
 *      (symlinks included) to a real source file inside the project root:
 *      no `..` escapes, no node_modules, no `.d.ts`, and only source
 *      extensions (.ts/.tsx/.js/.jsx/.mjs/.cjs). The root defaults to the
 *      enclosing git repository (monorepos routinely keep shared components
 *      outside the Next app dir but inside the repo) and falls back to the
 *      dev server's cwd; `NEXTCANVAS_ROOT` overrides it.
 */

import fs from 'fs';
import path from 'path';

/** Extensions the write-back may touch. Everything else is refused. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

let cachedGitRoot: string | null = null;

/** Test seam — the git-root discovery is cached for the process lifetime. */
export function resetSecurityCache(): void {
  cachedGitRoot = null;
}

/**
 * The directory edits must stay inside.
 *
 * `NEXTCANVAS_ROOT` (read per call so tests and long-lived processes can
 * change it) wins; otherwise the nearest enclosing git root of the dev
 * server's cwd; otherwise the cwd itself.
 */
export function projectRoot(): string {
  const env = process.env.NEXTCANVAS_ROOT;
  if (env) return path.resolve(env);
  if (cachedGitRoot) return cachedGitRoot;
  let dir = process.cwd();
  let root = process.cwd();
  for (;;) {
    // `.git` is a directory in a normal checkout and a file in a worktree.
    if (fs.existsSync(path.join(dir, '.git'))) {
      root = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedGitRoot = root;
  return root;
}

export interface PathCheck {
  ok: boolean;
  /** The validated absolute (real) path, present only when ok. */
  path?: string;
  error?: string;
}

/**
 * Validate a client-supplied fileName and return the absolute path to edit.
 *
 * Relative paths (Turbopack stamps are project-relative) resolve against the
 * dev server's cwd — the same base ts-morph would use — NOT against the
 * containment root, which may be a wider monorepo root.
 */
export function validateEditPath(fileName: unknown): PathCheck {
  if (typeof fileName !== 'string' || fileName.trim() === '') {
    return { ok: false, error: 'missing fileName' };
  }
  const abs = path.resolve(process.cwd(), fileName);

  let real: string;
  try {
    // realpath resolves symlinks so a link inside the project can't smuggle a
    // write to a target outside it (and normalises macOS /var → /private/var).
    real = fs.realpathSync(abs);
  } catch {
    return { ok: false, error: `File not found: ${fileName}` };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    return { ok: false, error: `File not found: ${fileName}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `Not a file: ${fileName}` };
  }

  let root: string;
  try {
    root = fs.realpathSync(projectRoot());
  } catch {
    root = projectRoot();
  }
  const rel = path.relative(root, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      ok: false,
      error: `Refusing to edit a file outside the project root: ${fileName}`,
    };
  }
  if (real.split(path.sep).includes('node_modules')) {
    return {
      ok: false,
      error: `Refusing to edit a file inside node_modules: ${fileName}`,
    };
  }
  if (real.endsWith('.d.ts')) {
    return { ok: false, error: `Refusing to edit a declaration file: ${fileName}` };
  }
  if (!SOURCE_EXTENSIONS.has(path.extname(real))) {
    return {
      ok: false,
      error: `Refusing to edit a non-source file: ${fileName}`,
    };
  }
  return { ok: true, path: real };
}

/** Hostnames that always count as local (with or without IPv6 brackets). */
function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0.0.0.0') return true;
  return isPrivateIpv4(h);
}

/** 127/8 loopback plus the RFC-1918 + link-local ranges (LAN phone testing). */
function isPrivateIpv4(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Origins granted by `NEXTCANVAS_ALLOWED_ORIGINS`, normalised. */
function extraAllowedOrigins(): Set<string> {
  const raw = process.env.NEXTCANVAS_ALLOWED_ORIGINS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
      .filter(Boolean)
  );
}

/**
 * May a request with this Origin header use the edit server?
 * `undefined` (no header — non-browser client) is allowed; `"null"` is not.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  const norm = origin.trim().replace(/\/+$/, '').toLowerCase();
  if (!norm || norm === 'null') return false;
  if (extraAllowedOrigins().has(norm)) return true;
  let url: URL;
  try {
    url = new URL(norm);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return isLocalHostname(url.hostname);
}

/**
 * May a request with this Host header use the edit server? Defeats DNS
 * rebinding: a hostile domain pointed at 127.0.0.1 arrives with its own name
 * in Host. Hosts implied by `NEXTCANVAS_ALLOWED_ORIGINS` are accepted too
 * (port-forwarded setups reach the server through that same domain).
 */
export function isAllowedHost(host: string | undefined): boolean {
  if (host === undefined || host.trim() === '') return true;
  let hostname: string;
  try {
    hostname = new URL('http://' + host.trim()).hostname;
  } catch {
    return false;
  }
  if (isLocalHostname(hostname)) return true;
  for (const origin of extraAllowedOrigins()) {
    try {
      if (new URL(origin).hostname === hostname) return true;
    } catch {
      /* ignore malformed entries */
    }
  }
  return false;
}

/** Combined request gate with a user-actionable error message. */
export function checkRequestSource(
  origin: string | undefined,
  host: string | undefined
): { ok: boolean; error?: string } {
  if (!isAllowedOrigin(origin)) {
    return {
      ok: false,
      error:
        `Refused: origin "${origin}" is not allowed to use the nextcanvas edit ` +
        'server. Only local origins may write edits; set NEXTCANVAS_ALLOWED_ORIGINS ' +
        '(comma-separated origins) if you develop through a forwarded domain.',
    };
  }
  if (!isAllowedHost(host)) {
    return {
      ok: false,
      error:
        `Refused: host "${host}" is not a local address. If you develop through ` +
        'a forwarded domain, add its origin to NEXTCANVAS_ALLOWED_ORIGINS.',
    };
  }
  return { ok: true };
}
