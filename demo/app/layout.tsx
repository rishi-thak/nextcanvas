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

/**
 * Applies the stored theme before first paint. Light is the default, so without
 * this a returning dark-mode visitor would see a light flash on every load. It
 * has to be inline and synchronous — anything deferred runs after paint.
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('nextcanvas:theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='dark'?'#07070a':'#fbfafd');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The init script sets data-theme before React hydrates, so the server HTML
    // and the live DOM legitimately differ on <html>.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#fbfafd" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <NextCanvasOverlay />}
      </body>
    </html>
  );
}
