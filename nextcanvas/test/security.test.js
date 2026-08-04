/**
 * Security tests: request-source gating and path containment.
 *
 * The edit server writes files on behalf of a browser page, which makes it a
 * drive-by target — any website open in the developer's browser can POST to
 * localhost:3131. These tests pin the two gates that close that off:
 *
 *   1. Origin/Host validation (src/security.ts) — only local origins (plus the
 *      NEXTCANVAS_ALLOWED_ORIGINS escape hatch) may use the server, and a
 *      DNS-rebound Host is refused.
 *   2. Path containment — a client-supplied fileName must resolve, symlinks
 *      included, to a real source file inside the project root; node_modules,
 *      .d.ts, and non-source extensions are refused.
 *
 * Runs against the COMPILED output — `npm run build` first (the `test` script
 * does it for you).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  isAllowedOrigin,
  isAllowedHost,
  validateEditPath,
} = require('../dist/security.js');
const { applyEdit, applyAttrEdit, handler } = require('../dist/server.js');

/**
 * Fresh temp dir used as the containment root for a test body. Handles async
 * bodies too — the env var must stay set until the awaited work finishes.
 */
function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-sec-'));
  const prev = process.env.NEXTCANVAS_ROOT;
  process.env.NEXTCANVAS_ROOT = root;
  const restore = () => {
    if (prev === undefined) delete process.env.NEXTCANVAS_ROOT;
    else process.env.NEXTCANVAS_ROOT = prev;
  };
  try {
    const r = fn(root);
    if (r && typeof r.then === 'function') return r.finally(restore);
    restore();
    return r;
  } catch (err) {
    restore();
    throw err;
  }
}

// --- Origin validation -------------------------------------------------------

test('local origins are allowed', () => {
  for (const origin of [
    'http://localhost:3000',
    'https://localhost',
    'http://127.0.0.1:8080',
    'http://[::1]:3000',
    'http://app.localhost:3000',
    'http://192.168.1.5:3000', // LAN phone testing
    'http://10.0.0.2:3000',
    'http://172.16.0.1:3000',
  ]) {
    assert.equal(isAllowedOrigin(origin), true, origin);
  }
  // No Origin header at all: a non-browser client on the same machine, which
  // could already write files directly. Allowed.
  assert.equal(isAllowedOrigin(undefined), true);
});

test('non-local and malformed origins are refused', () => {
  for (const origin of [
    'https://evil.com',
    'http://evil.com:3131',
    'null', // sandboxed iframe / file://
    '',
    'http://172.32.0.1:3000', // just outside the 172.16/12 private range
    'ftp://localhost',
    'not a url',
  ]) {
    assert.equal(isAllowedOrigin(origin), false, origin || '(empty)');
  }
});

test('NEXTCANVAS_ALLOWED_ORIGINS extends origins and their hosts', () => {
  const prev = process.env.NEXTCANVAS_ALLOWED_ORIGINS;
  process.env.NEXTCANVAS_ALLOWED_ORIGINS =
    'https://myapp.github.dev, https://Dev.Example.COM/';
  try {
    assert.equal(isAllowedOrigin('https://myapp.github.dev'), true);
    // Normalised: case and trailing slash don't matter.
    assert.equal(isAllowedOrigin('https://dev.example.com'), true);
    // The forwarded domain is also acceptable as the Host header.
    assert.equal(isAllowedHost('myapp.github.dev'), true);
    // Everything else is still refused.
    assert.equal(isAllowedOrigin('https://other.github.dev'), false);
  } finally {
    if (prev === undefined) delete process.env.NEXTCANVAS_ALLOWED_ORIGINS;
    else process.env.NEXTCANVAS_ALLOWED_ORIGINS = prev;
  }
});

test('host check refuses DNS-rebound hosts', () => {
  assert.equal(isAllowedHost('localhost:3131'), true);
  assert.equal(isAllowedHost('127.0.0.1:3131'), true);
  assert.equal(isAllowedHost('[::1]:3131'), true);
  assert.equal(isAllowedHost(undefined), true); // no header — not a browser
  assert.equal(isAllowedHost('evil.com:3131'), false);
  assert.equal(isAllowedHost('evil.com'), false);
});

// --- Path containment --------------------------------------------------------

test('a file outside the project root is refused', () => {
  withRoot(() => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-out-'));
    const file = path.join(outside, 'page.tsx');
    fs.writeFileSync(file, 'const x = <h1>Hi</h1>;\n');
    const r = validateEditPath(file);
    assert.equal(r.ok, false);
    assert.match(r.error, /outside the project root/);

    // The same refusal surfaces through a real edit.
    const edit = applyEdit({ fileName: file, lineNumber: 1, oldText: 'Hi', newText: 'X' });
    assert.equal(edit.ok, false);
    assert.match(edit.error, /outside the project root/);
    assert.match(fs.readFileSync(file, 'utf8'), /Hi/); // untouched
  });
});

test('`..` traversal cannot escape the root', () => {
  withRoot((root) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-out-'));
    const file = path.join(outside, 'page.tsx');
    fs.writeFileSync(file, 'const x = <h1>Hi</h1>;\n');
    const sneaky = path.join(root, '..', path.basename(outside), 'page.tsx');
    const r = validateEditPath(sneaky);
    assert.equal(r.ok, false);
  });
});

test('a symlink inside the root pointing outside it is refused', () => {
  withRoot((root) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-out-'));
    const target = path.join(outside, 'real.tsx');
    fs.writeFileSync(target, 'const x = <h1>Hi</h1>;\n');
    const link = path.join(root, 'link.tsx');
    fs.symlinkSync(target, link);
    const r = validateEditPath(link);
    assert.equal(r.ok, false);
    assert.match(r.error, /outside the project root/);
  });
});

test('node_modules, .d.ts, and non-source files are refused', () => {
  withRoot((root) => {
    const nm = path.join(root, 'node_modules', 'pkg');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'index.tsx'), 'x');
    assert.match(
      validateEditPath(path.join(nm, 'index.tsx')).error,
      /node_modules/
    );

    fs.writeFileSync(path.join(root, 'types.d.ts'), 'export {};\n');
    assert.match(
      validateEditPath(path.join(root, 'types.d.ts')).error,
      /declaration file/
    );

    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
    assert.match(validateEditPath(path.join(root, '.env')).error, /non-source/);
    fs.writeFileSync(path.join(root, 'data.json'), '{}\n');
    assert.match(
      validateEditPath(path.join(root, 'data.json')).error,
      /non-source/
    );
  });
});

test('a source file inside the root passes and resolves to its realpath', () => {
  withRoot((root) => {
    const file = path.join(root, 'page.tsx');
    fs.writeFileSync(file, 'const x = <h1>Hi</h1>;\n');
    const r = validateEditPath(file);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.path, fs.realpathSync(file));
  });
});

test('a missing file is reported as not found, not crashed on', () => {
  withRoot((root) => {
    const r = validateEditPath(path.join(root, 'ghost.tsx'));
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/i);
  });
});

// --- Payload validation ------------------------------------------------------

test('a missing newText is rejected instead of writing "undefined"', () => {
  withRoot((root) => {
    const file = path.join(root, 'page.tsx');
    fs.writeFileSync(file, 'const x = <h1>Hi</h1>;\n');
    const r = applyEdit({ fileName: file, lineNumber: 1, oldText: 'Hi' });
    assert.equal(r.ok, false);
    assert.match(r.error, /missing newText/);
    assert.match(fs.readFileSync(file, 'utf8'), /Hi/);
  });
});

test('only the plugin-stamped attribute names are editable', () => {
  withRoot((root) => {
    const file = path.join(root, 'page.tsx');
    fs.writeFileSync(file, 'const x = <a data-x="1" href="/a">Hi</a>;\n');
    const r = applyAttrEdit({
      fileName: file,
      lineNumber: 1,
      attrName: 'data-x',
      oldText: '1',
      newText: 'evil',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /not editable/);
  });
});

// --- End-to-end: the HTTP handler gates requests -----------------------------

/** Boot the real handler on an ephemeral loopback port. */
function bootServer() {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/** Raw request helper (fetch won't let us spoof the Host header). */
function rawRequest(port, { method = 'POST', url = '/edit', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: url, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: data })
        );
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('the handler refuses cross-origin requests and honours local ones', async () => {
  await withRoot(async (root) => {
    const file = path.join(root, 'page.tsx');
    fs.writeFileSync(file, 'const x = <h1>Hello</h1>;\n');
    const { server, port } = await bootServer();
    try {
      const edit = JSON.stringify({
        fileName: file,
        lineNumber: 1,
        oldText: 'Hello',
        newText: 'Pwned',
      });

      // A drive-by page: refused, no CORS grant, file untouched.
      const evil = await rawRequest(port, {
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.com' },
        body: edit,
      });
      assert.equal(evil.status, 403);
      assert.equal(evil.headers['access-control-allow-origin'], undefined);
      assert.match(fs.readFileSync(file, 'utf8'), /Hello/);

      // Its preflight is refused too.
      const preflight = await rawRequest(port, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.com' },
      });
      assert.equal(preflight.status, 403);

      // DNS rebinding: local-looking request arriving under a foreign Host.
      const rebound = await rawRequest(port, {
        headers: { 'Content-Type': 'application/json', Host: 'evil.com:3131' },
        body: edit,
      });
      assert.equal(rebound.status, 403);
      assert.match(fs.readFileSync(file, 'utf8'), /Hello/);

      // The real overlay, from the app's own local origin: works, and the CORS
      // grant reflects that specific origin rather than `*`.
      const good = await rawRequest(port, {
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          fileName: file,
          lineNumber: 1,
          oldText: 'Hello',
          newText: 'Edited',
        }),
      });
      assert.equal(good.status, 200, good.body);
      assert.equal(
        good.headers['access-control-allow-origin'],
        'http://localhost:3000'
      );
      assert.match(fs.readFileSync(file, 'utf8'), /Edited/);
    } finally {
      server.close();
    }
  });
});

test('an oversized body is answered 413 before any parsing', async () => {
  await withRoot(async () => {
    const { server, port } = await bootServer();
    try {
      const r = await rawRequest(port, {
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: '{"pad":"' + 'x'.repeat(1_100_000) + '"}',
      });
      assert.equal(r.status, 413);
    } finally {
      server.close();
    }
  });
});
