import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
  title: 'Controls & modes',
};

export default function ToolbarPage() {
  return (
    <article>
      <p className="docs-kicker">The toolbar</p>
      <h1>Controls &amp; modes</h1>
      <p className="docs-lede">
        The floating bar is how you switch between editing and using the app,
        batch changes, and undo mistakes. Everything below is local to your
        browser — nothing is sent to a remote service.
      </p>

      <h2>Master on / off</h2>
      <p>
        The switch next to the brand turns the <strong>whole tool</strong> on or
        off. When off:
      </p>
      <ul>
        <li>No outlines, chips, panels, or edit handlers</li>
        <li>The toolbar collapses to brand + switch</li>
        <li>The page behaves like a normal <code>next dev</code> session</li>
      </ul>
      <p>
        Preference is stored in <code>localStorage</code> as{" "}
        <code>nextcanvas:enabled</code> (defaults on).
      </p>

      <h2>Buttons — edit mode vs live mode</h2>
      <p>
        The <strong>Buttons</strong> toggle is separate from the master switch.
        It only gates whether the <em>page</em> is interactive while nextcanvas
        stays active.
      </p>
      <div className="docs-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Buttons</th>
              <th>What happens</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Off</strong> (default)
              </td>
              <td>
                Edit mode. Clicks and pointer-downs don&apos;t navigate or fire
                app / Motion handlers — including Next <code>Link</code>s like a
                CTA to another page. Single-click selects for styles;
                double-click edits text. A small blocker installs as soon as the
                overlay component mounts, so a fast click can&apos;t race the
                overlay script download.
              </td>
            </tr>
            <tr>
              <td>
                <strong>On</strong>
              </td>
              <td>
                Live mode. Links, buttons, and onClick handlers work normally.
                Single-click does <em>not</em> select. Hover outlines, the
                attribute chip, and double-click editing still work.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="docs-callout tip">
        <strong>Why this exists.</strong> Without it, a stamped{" "}
        <code>{'<a href="#section">'}</code> would scroll the page out from
        under you while you try to select or edit. Flip Buttons on when you need
        to click through the real UI.
      </div>

      <h2>Autosave vs Manual</h2>
      <ul>
        <li>
          <strong>Autosave</strong> — text and attribute commits write to source
          immediately.
        </li>
        <li>
          <strong>Manual</strong> — those commits stage locally. The Save button
          shows a badge for dirty staged edits; click Save to flush them all.
          Switching back to Autosave also flushes.
        </li>
      </ul>
      <p>
        Style panel changes always write immediately today, even in Manual mode.
      </p>

      <h2>Undo / redo</h2>
      <p>
        Use the toolbar buttons or:
      </p>
      <ul>
        <li>
          <span className="docs-kbd">⌘Z</span> /{" "}
          <span className="docs-kbd">Ctrl+Z</span> — undo
        </li>
        <li>
          <span className="docs-kbd">⌘⇧Z</span> /{" "}
          <span className="docs-kbd">Ctrl+⇧Z</span> — redo
        </li>
      </ul>
      <p>
        Undo re-applies the reverse write (including bound-text value matching
        against the current source).
      </p>

      <h2>Hide &amp; dismiss</h2>
      <ul>
        <li>
          <strong>–</strong> collapses the bar to a small FAB. Click the FAB to
          bring it back.
        </li>
        <li>
          <strong>✕</strong> dismisses the toolbar for this page load and turns{" "}
          <strong>Buttons</strong> on so the page is fully interactive again.
          Reload to restore the toolbar.
        </li>
      </ul>

      <h2>Committing text edits</h2>
      <ul>
        <li>
          <span className="docs-kbd">Enter</span> — commit
        </li>
        <li>
          <span className="docs-kbd">Escape</span> — cancel and revert
        </li>
        <li>Click outside the field — commit</li>
      </ul>

      <Pager
        prev={{ href: '/docs/styles', label: 'Styles' }}
        next={{ href: '/docs/what-works', label: 'What you can edit' }}
      />
    </article>
  );
}
