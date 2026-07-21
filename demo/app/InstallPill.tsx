'use client';

import { useEffect, useRef, useState } from 'react';
import { COPY_TABS, type CopyTab } from './agent-setup';

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" />
      <path d="M10.5 3.2A1.7 1.7 0 0 0 8.9 2H3.7A1.7 1.7 0 0 0 2 3.7v5.2c0 .75.48 1.39 1.2 1.6" />
    </svg>
  );
}

/**
 * The hero's setup control: pick how you want to install nextcanvas, then copy
 * it. Replaces the old plain install pill — "paste this into your agent" is the
 * path most people take now, so it leads, and the raw npm command is one tab
 * over rather than gone.
 */
export function InstallPill() {
  const [tab, setTab] = useState<CopyTab['id']>('agent');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = COPY_TABS.find((t) => t.id === tab) ?? COPY_TABS[0];

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(active.payload);
    } catch {
      // Clipboard API needs a secure context; fall back to a throwaway selection.
      const el = document.createElement('textarea');
      el.value = active.payload;
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
    <div className="setup">
      <div className="setup-bar">
        <button
          type="button"
          className="setup-copy"
          onClick={copy}
          aria-label={`${active.action} to clipboard`}
        >
          {copied ? 'copied' : active.action}
          <CopyIcon />
        </button>

        <div className="setup-tabs" role="group" aria-label="setup method">
          {COPY_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="setup-tab"
              data-active={t.id === tab}
              aria-pressed={t.id === tab}
              onClick={() => {
                setTab(t.id);
                setCopied(false);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <p className="setup-hint">{active.hint}</p>
    </div>
  );
}
