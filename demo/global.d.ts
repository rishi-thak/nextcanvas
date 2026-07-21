/**
 * The overlay reads its backend base URL off `window`. The package declares this
 * internally but doesn't ship the declaration to consumers, so the demo declares
 * it for its own use (app/DemoCanvas.tsx).
 */
declare global {
  interface Window {
    __NEXTCANVAS_SERVER__?: string;
  }
}

export {};
