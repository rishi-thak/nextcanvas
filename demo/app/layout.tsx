import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextCanvasOverlay } from 'nextcanvas';

export const metadata: Metadata = {
  title: 'nextcanvas demo',
  description: 'Double-click any text to edit it in place.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        {children}
        {process.env.NODE_ENV === 'development' && <NextCanvasOverlay />}
      </body>
    </html>
  );
}
