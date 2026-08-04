/**
 * Concurrency: overlapping edits must not lose writes.
 *
 * The write-back server does a read-modify-write per edit (ts-morph reads the
 * file, edits, saves). If two edits to the same file ran read-A, read-B,
 * write-A, write-B, the second write — built from a stale read — would clobber
 * the first (a lost update). These tests fire overlapping requests through the
 * REAL HTTP handler and assert every edit survives, pinning the serialization
 * guarantee.
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

process.env.NEXTCANVAS_ROOT = os.tmpdir();
const { handler } = require('../dist/server.js');

function bootServer() {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: server.address().port })
    );
  });
}

function postEdit(port, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/edit',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
      },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: JSON.parse(out) })
        );
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

test('two overlapping edits to different runs of one file both survive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-conc-'));
  const file = path.join(dir, 'page.tsx');
  fs.writeFileSync(
    file,
    'const V = () => (\n  <div>\n    <h1>AAA</h1>\n    <h2>BBB</h2>\n  </div>\n);\n'
  );
  const { server, port } = await bootServer();
  try {
    // Fire BOTH without awaiting the first — they race through the handler.
    const [r1, r2] = await Promise.all([
      postEdit(port, { fileName: file, lineNumber: 3, oldText: 'AAA', newText: 'XXX' }),
      postEdit(port, { fileName: file, lineNumber: 4, oldText: 'BBB', newText: 'YYY' }),
    ]);
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    const after = fs.readFileSync(file, 'utf8');
    // No lost update: BOTH edits are present, and the file still parses.
    assert.match(after, /<h1>XXX<\/h1>/, 'first edit survived');
    assert.match(after, /<h2>YYY<\/h2>/, 'second edit survived');
  } finally {
    server.close();
  }
});

test('a burst of overlapping edits to the same file all land', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextcanvas-conc-'));
  const file = path.join(dir, 'page.tsx');
  const rows = Array.from({ length: 8 }, (_, i) => `    <li>row${i}</li>`).join('\n');
  fs.writeFileSync(file, `const V = () => (\n  <ul>\n${rows}\n  </ul>\n);\n`);
  const { server, port } = await bootServer();
  try {
    const jobs = [];
    for (let i = 0; i < 8; i++) {
      jobs.push(
        postEdit(port, {
          fileName: file,
          lineNumber: 3 + i, // each <li> is on its own line starting at line 3
          oldText: `row${i}`,
          newText: `done${i}`,
        })
      );
    }
    const results = await Promise.all(jobs);
    assert.ok(results.every((r) => r.status === 200), 'every edit returned ok');
    const after = fs.readFileSync(file, 'utf8');
    for (let i = 0; i < 8; i++) {
      assert.match(after, new RegExp(`<li>done${i}</li>`), `row ${i} landed`);
    }
    // Nothing was left in the original state.
    assert.ok(!/row\d/.test(after), 'no original rows remain');
  } finally {
    server.close();
  }
});
