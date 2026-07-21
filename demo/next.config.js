const path = require('node:path');
const { withCanvas } = require('@rishi-thak/nextcanvas/next');

// The repo root carries its own package-lock.json (Playwright), so Next sees two
// lockfiles and warns while it guesses a workspace root. Pin it to the repo root
// explicitly — the same directory Next was already inferring, so this only
// silences the warning.
//
// Do NOT pin this to __dirname (demo/). If the dep is ever swapped back to
// `file:../nextcanvas` for local package work, that symlink points outside
// demo/, and the build dies with "Module not found: Can't resolve
// '@rishi-thak/nextcanvas'". Pointing at the repo root keeps that path valid.
const REPO_ROOT = path.join(__dirname, '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: { root: REPO_ROOT },
  outputFileTracingRoot: REPO_ROOT,
};

const config = withCanvas(nextConfig);

// The deployed demo ships the overlay so visitors can try it on the live site,
// with edits applied in the browser only (see app/DemoCanvas.tsx). That needs
// `data-loc` stamps in the production build, but withCanvas deliberately no-ops
// outside development — so the demo injects the same SWC plugin itself.
//
// Must be the package SPECIFIER, never an absolute path: Turbopack cannot load a
// .wasm swcPlugin given as a filesystem path.
if (process.env.NODE_ENV !== 'development') {
  const existing = (config.experimental && config.experimental.swcPlugins) || [];
  config.experimental = {
    ...(config.experimental || {}),
    swcPlugins: [
      ...existing,
      ['@rishi-thak/nextcanvas/swc/nextcanvas_swc.wasm', {}],
    ],
  };
}

module.exports = config;
