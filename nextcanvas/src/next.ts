/**
 * withCanvas() — wraps your Next config to enable nextcanvas in development.
 * Works under BOTH webpack (next-swc) and Turbopack, because the source stamp
 * is an SWC plugin (not Babel) that runs inside Next's own compiler.
 *
 *   // next.config.js
 *   const { withCanvas } = require('nextcanvas/next');
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

import path from 'path';
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

/** Absolute path to the prebuilt SWC plugin shipped with the package. */
function pluginWasmPath(): string {
  // At runtime __dirname is <pkg>/dist; the wasm ships at <pkg>/swc.
  // Forward slashes: Turbopack mishandles backslashes in swcPlugins paths.
  return path.resolve(__dirname, '..', 'swc', 'nextcanvas_swc.wasm').replace(/\\/g, '/');
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
      swcPlugins: [...existingPlugins, [pluginWasmPath(), {}]],
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
