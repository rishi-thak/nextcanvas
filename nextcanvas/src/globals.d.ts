// Ambient globals shared across nextcanvas. This file has no imports/exports,
// so its top-level declarations augment the global scope. Not emitted.

interface Window {
  /** Set once by the overlay so it initializes at most once per page. */
  __nextCanvasLoaded?: boolean;
  /** Base URL of the write-back server, published by <NextCanvasOverlay/>. */
  __NEXTCANVAS_SERVER__?: string;
}

/** The single edit-server instance, cached per Node process (see server.ts). */
declare var __nextCanvasServer: import('http').Server | undefined;
