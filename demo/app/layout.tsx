import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextCanvasOverlay } from '@rishi-thak/nextcanvas';
import { SITE_URL } from './site';
import './globals.css';

const TITLE = 'nextcanvas — edit your Next.js app in the browser';
const DESCRIPTION =
  'A dev tool that turns your locally-running Next.js app into an editable canvas. Double-click any text, edit it, and the change is written straight back to your source.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'nextcanvas',
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
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
