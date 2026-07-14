/**
 * withCanvas() — wraps your Next config to enable nextcanvas in development.
 * Works under BOTH webpack (next-swc) and Turbopack, because the source stamp
 * is an SWC plugin (not Babel) that runs inside Next's own compiler.
 *
 *   // next.config.js
 *   const { withCanvas } = require('@rishi-thak/nextcanvas/next');
 *   module.exports = withCanvas({ /* your existing config *\/ });
 *
 * In dev, withCanvas:
 *   1. boots the write-back server (:3131),
 *   2. injects the `data-loc` SWC plugin into `experimental.swcPlugins`,
 *   3. inlines NEXTCANVAS_PORT so the overlay POSTs to the right place.
 *
 * The only remaining manual step is mounting the overlay once in your root
 * layout — `npx nextcanvas init` does that for you. In production withCanvas
 * is a pure no-op: your config passes through untouched.
 */

import { startServer, PORT } from './server';

type SwcPlugin = [string, Record<string, unknown>];

/**
 * Minimal shape of a Next config. Typed locally rather than importing
 * `NextConfig` from `next` so the package builds without `next` installed
 * (it's a peer dependency).
 */
type NextConfig = Record<string, unknown> & {
  env?: Record<string, string | undefined>;
  experimental?: { swcPlugins?: SwcPlugin[] } & Record<string, unknown>;
};

/**
 * The prebuilt SWC plugin, expressed as a resolvable **package specifier** —
 * NOT an absolute filesystem path.
 *
 * Turbopack cannot load a `.wasm` swcPlugin given as an absolute path (it 500s
 * with "Module not found", even though the file exists); it must be a specifier
 * it can resolve through the project's node_modules. webpack/next-swc accepts
 * the specifier too, so one form works under both bundlers.
 *
 * This depends on the package `exports` map exposing `./swc/*` — without it the
 * specifier fails to resolve with ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * The package name is read from our own package.json (a relative require, so it
 * bypasses `exports` encapsulation) rather than hard-coded, so a rename/rescope
 * of the package keeps the specifier correct.
 */
function pluginSpecifier(): string {
  // At runtime __dirname is <pkg>/dist; package.json is one level up.
  const { name } = require('../package.json') as { name: string };
  return `${name}/swc/nextcanvas_swc.wasm`;
}

export function withCanvas(nextConfig: NextConfig = {}): NextConfig {
  if (process.env.NODE_ENV !== 'development') {
    return nextConfig;
  }

  // startServer() is idempotent and tolerates EADDRINUSE across dev workers.
  startServer();

  const existingPlugins = nextConfig.experimental?.swcPlugins ?? [];

  return {
    ...nextConfig,
    experimental: {
      ...(nextConfig.experimental || {}),
      // Append so we don't clobber the user's own SWC plugins.
      swcPlugins: [...existingPlugins, [pluginSpecifier(), {}]],
    },
    // Single source of truth for the port: server.ts derives PORT from
    // NEXTCANVAS_PORT; we inline that same value into the client so the
    // overlay and <NextCanvasOverlay/> POST to the right place.
    env: {
      ...(nextConfig.env || {}),
      NEXTCANVAS_PORT: String(PORT),
    },
  };
}

export default withCanvas;
