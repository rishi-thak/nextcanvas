'use client';

import { useEffect, useRef, useState } from 'react';

export const INSTALL_COMMAND = 'npm i -D @rishi-thak/nextcanvas';

export function InstallPill() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
    } catch {
      // Clipboard API needs a secure context; fall back to a throwaway selection.
      const el = document.createElement('textarea');
      el.value = INSTALL_COMMAND;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(el);
      }
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="install-pill">
      <span className="prompt">$</span>
      <span>{INSTALL_COMMAND}</span>
      <button
        type="button"
        className="copy"
        onClick={copy}
        aria-label={`Copy "${INSTALL_COMMAND}" to clipboard`}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}
