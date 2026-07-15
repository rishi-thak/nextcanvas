import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
  title: 'Attributes',
};

export default function AttributesPage() {
  return (
    <article>
      <p className="docs-kicker">Editing</p>
      <h1>Attributes</h1>
      <p className="docs-lede">
        Links, images, and labels often need a URL or string tweak without
        opening the file. Hover an element to open the attribute chip, then edit
        from the panel.
      </p>

      <h2>How to edit</h2>
      <ol>
        <li>Hover a stamped element that has an editable attribute.</li>
        <li>
          Click the small <strong>attribute chip</strong> that appears (separate
          from the style selection).
        </li>
        <li>
          The attribute panel lists editable fields. Change a value and commit.
        </li>
      </ol>
      <p>
        Hover outlines, the chip, and double-click text editing all stay
        available whether <strong>Buttons</strong> is on or off. Style selection
        (single-click) only happens when Buttons is off.
      </p>

      <h2>Which attributes</h2>
      <p>These are editable when present as a string in JSX:</p>
      <ul>
        <li>
          <code>href</code>
        </li>
        <li>
          <code>src</code>
        </li>
        <li>
          <code>alt</code>
        </li>
        <li>
          <code>title</code>
        </li>
        <li>
          <code>placeholder</code>
        </li>
        <li>
          <code>aria-label</code>
        </li>
      </ul>

      <h2>Literal vs bound</h2>

      <h3>Literal — rewrite in place</h3>
      <pre>
        <code>{`<a href="#register">Reserve your seat</a>
<img src="/speakers/bob.png" alt="Robert Cooper" />`}</code>
      </pre>
      <p>
        Changing the value updates that attribute&apos;s string in the JSX.
        Quoting style is preserved.
      </p>

      <h3>Bound identifier — pick a scope</h3>
      <pre>
        <code>{`const GITHUB = 'https://github.com/rishi-thak/nextcanvas';

<a href={GITHUB}>Star on GitHub</a>`}</code>
      </pre>
      <p>
        Bound attributes show a <strong>var</strong> badge in the panel. On
        commit you choose:
      </p>
      <ul>
        <li>
          <strong>All references</strong> — rewrite the variable&apos;s
          declaration (<code>const GITHUB = &apos;…&apos;</code>). Every use of
          that variable picks up the new value.
        </li>
        <li>
          <strong>Just this one</strong> — leave the variable alone and inline a
          literal on this element only (
          <code>{'href={GITHUB}'}</code> → <code>href=&quot;new&quot;</code>).
        </li>
      </ul>
      <div className="docs-callout warn">
        <strong>Undo caveat.</strong> &quot;Just this one&quot; is a one-way
        transform (the identifier is gone from that JSX). Undoing it may not
        restore <code>{'{GITHUB}'}</code> and can error-toast. Prefer forward
        edits; use &quot;all references&quot; when you want a clean shared
        change.
      </div>

      <h2>What isn&apos;t offered</h2>
      <ul>
        <li>
          Member or call expressions:{" "}
          <code>{'href={cfg.url}'}</code>, <code>{'href={fn()}'}</code>
        </li>
        <li>
          Identifiers imported from another module, when you choose{" "}
          <strong>all references</strong> — you&apos;ll get a hint to use{" "}
          <strong>just this one</strong> instead
        </li>
        <li>Attributes outside the whitelist above</li>
      </ul>

      <Pager
        prev={{ href: '/docs/bound-text', label: 'Bound text' }}
        next={{ href: '/docs/styles', label: 'Styles' }}
      />
    </article>
  );
}
