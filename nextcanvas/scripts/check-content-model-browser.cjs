// Optional real Next dev + Chromium regression. Run from the package directory:
// node scripts/check-content-model-browser.cjs [--webpack]
// Requires the repository root's Playwright dev dependency and Chromium.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const pkg = path.join(root, 'nextcanvas');
const scratch = fs.mkdtempSync(path.join(root, '.content-model-'));
const freePort = () => new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
let server, browser;
let logs = '';
(async () => {
  fs.mkdirSync(path.join(scratch, 'app'));
  fs.mkdirSync(path.join(scratch, 'node_modules/@rishi-thak'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'node_modules/@types'), { recursive: true });
  for (const name of ['next', 'react', 'react-dom', 'typescript', '@types/react', '@types/node']) {
    fs.symlinkSync(path.dirname(require.resolve(`${name}/package.json`)), path.join(scratch, 'node_modules', name), 'junction');
  }
  fs.symlinkSync(pkg, path.join(scratch, 'node_modules/@rishi-thak/nextcanvas'), 'junction');
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ private: true, dependencies: { next: '*', react: '*', 'react-dom': '*' } }));
  fs.writeFileSync(path.join(scratch, 'next.config.js'), `const { withCanvas } = require('@rishi-thak/nextcanvas/next'); module.exports = withCanvas({ turbopack: { root: ${JSON.stringify(root)} } });`);
  fs.writeFileSync(path.join(scratch, 'app/layout.jsx'), `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`);
  let fixture = fs.readFileSync(path.join(pkg, 'test/fixtures/restricted-text.tsx'), 'utf8');
  fixture = `'use client';\nimport { NextCanvasOverlay } from '@rishi-thak/nextcanvas';\n${fixture}`.replace('export default function Fixture() {', `export default function Fixture() {
    React.useEffect(() => { document.body.dataset.hydrated = 'yes'; }, []);`);
  fixture = fixture.replace('<form>', '<form><NextCanvasOverlay/><p id="editable">Edit me</p>');
  fs.writeFileSync(path.join(scratch, 'app/page.tsx'), fixture);
  const port = await freePort();
  const editPort = await freePort();
  server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', scratch, '-p', String(port), ...(process.argv.includes('--webpack') ? ['--webpack'] : [])], {
    cwd: root, env: { ...process.env, NEXTCANVAS_PORT: String(editPort), NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', data => { logs += data; });
  server.stderr.on('data', data => { logs += data; });
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 90000;
  while (true) {
    if (server.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(url)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(logs);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('nextcanvas:buttons', 'on'));
  await page.goto(url);
  await page.waitForSelector('body[data-hydrated="yes"]');
  assert.equal(await page.locator('option span').count(), 0);
  assert.equal(await page.locator('#dates option, #members option, #shapes option').count(), 16);
  assert.equal(await page.locator('#dates').inputValue(), '30');
  assert.equal(await page.locator('#members option:checked').textContent(), 'A & <B> — Organization not set');
  assert.equal(await page.locator('#shapes').inputValue(), 'fragment');
  await page.locator('#dates').selectOption('7');
  assert.equal(await page.locator('#dates').inputValue(), '7');
  await page.locator('#shapes').selectOption({ label: 'Implicit & value' });
  assert.equal(await page.locator('#shapes').inputValue(), 'Implicit & value');
  assert.equal(await page.locator('#normal[data-loc] [data-nc-expr]').count(), 1, await page.locator('#normal').evaluate(el => el.outerHTML));
  assert.equal(await page.locator('td[data-loc] [data-nc-expr]').count(), 1);
  await page.waitForFunction(() => window.__nextCanvasLoaded);
  const editable = page.locator('#editable');
  await editable.dblclick();
  await editable.fill('Changed by test');
  await editable.press('Enter');
  const writeDeadline = Date.now() + 10000;
  while (!fs.readFileSync(path.join(scratch, 'app/page.tsx'), 'utf8').includes('Changed by test')) {
    if (Date.now() > writeDeadline) throw new Error('Normal text edit did not reach source');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.reload();
  await page.waitForSelector('body[data-hydrated="yes"]');
  assert.equal(await page.locator('#editable').textContent(), 'Changed by test');
  assert.deepEqual(errors, []);
  assert.doesNotMatch(logs, /hydration|cannot be a child|cannot contain a nested/i);
  console.log(`PASS: Next ${require('next/package.json').version}, React ${ReactVersion()}, ${process.argv.includes('--webpack') ? 'webpack' : 'Turbopack'}: hydration, 16 options, labels, escaping, selection, and a normal text edit written to source and preserved after reload.`);
})().catch(error => { console.error(error, logs); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});
function ReactVersion() { return require('react/package.json').version; }
