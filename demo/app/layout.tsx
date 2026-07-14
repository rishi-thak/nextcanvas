import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextCanvasOverlay } from '@rishi-thak/nextcanvas';
import './globals.css';

export const metadata: Metadata = {
  title: 'nextcanvas — edit your Next.js app in the browser',
  description:
    'A dev tool that turns your locally-running Next.js app into an editable canvas. Double-click any text, edit it, and the change is written straight back to your source.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <NextCanvasOverlay />}
      </body>
    </html>
  );
}
