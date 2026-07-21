import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'nextcanvas — edit your Next.js app in the browser';

// Satori notes: every element with >1 child needs an explicit `display`, and any
// non-ASCII glyph (the ◆ brand mark) triggers a dynamic font fetch that fails at
// build time — so the diamond is drawn as a rotated square instead.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#07070a',
          padding: '0 96px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 30,
              height: 30,
              background: '#8b5cf6',
              transform: 'rotate(45deg)',
              marginRight: 26,
            }}
          />
          <div style={{ fontSize: 40, color: '#f5f5f7' }}>nextcanvas</div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 76,
            color: '#f5f5f7',
            lineHeight: 1.15,
            marginTop: 40,
          }}
        >
          <div>Edit your Next.js app</div>
          <div>in the browser.</div>
        </div>
        <div style={{ fontSize: 32, color: '#a2a2b4', marginTop: 32 }}>
          Double-click any text. It writes straight back to your source.
        </div>
      </div>
    ),
    size,
  );
}
