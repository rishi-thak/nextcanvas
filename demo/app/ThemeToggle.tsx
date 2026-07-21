'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'light' },
  { value: 'dark', label: 'dark' },
];

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="3.1" />
      <g strokeLinecap="round">
        <path d="M8 1.4v1.6M8 13v1.6M14.6 8H13M3 8H1.4M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4L3.3 3.3" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7Z" />
    </svg>
  );
}

/**
 * Light/dark switch. The page theme itself is applied pre-paint by the inline
 * script in the root layout; this component only reflects and updates it.
 *
 * State starts as 'light' (matching what the server rendered) and syncs from the
 * DOM in an effect, so the first client render agrees with the server HTML and
 * React doesn't report a hydration mismatch. The *page* never flashes — only
 * this control settles, within the same frame.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === 'dark' || current === 'light') setTheme(current);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('nextcanvas:theme', next);
    } catch {
      // Private mode / storage disabled: the theme still applies for this page.
    }
    // Keep mobile browser chrome in step with the page.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#07070a' : '#fbfafd');
  }

  return (
    <div className="theme-pill" role="group" aria-label="Color theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="theme-pill-opt"
          data-active={theme === opt.value}
          aria-pressed={theme === opt.value}
          onClick={() => apply(opt.value)}
        >
          {opt.value === 'light' ? <SunIcon /> : <MoonIcon />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
