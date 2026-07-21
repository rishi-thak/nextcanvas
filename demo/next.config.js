const { withCanvas } = require('@rishi-thak/nextcanvas/next');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do NOT set `turbopack.root` / `outputFileTracingRoot` to __dirname to silence
  // the "multiple lockfiles" warning: locally,
  // demo/node_modules/@rishi-thak/nextcanvas is a symlink up to ../nextcanvas, and
  // pinning the root to demo/ puts that target outside it — the build then fails
  // with "Module not found: Can't resolve '@rishi-thak/nextcanvas'". The warning is
  // local-only noise; on Vercel (root = demo/) there is no second lockfile.
};

module.exports = withCanvas(nextConfig);
