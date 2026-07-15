import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
  title: 'Styles',
};

export default function StylesPage() {
  return (
    <article>
      <p className="docs-kicker">Editing</p>
      <h1>Styles</h1>
      <p className="docs-lede">
        Single-click a stamped element to open the style panel. Tweaks write into
        that element&apos;s inline <code>style={'{{}}'}</code> in source — not
        into Tailwind classes (yet).
      </p>

      <h2>How to edit</h2>
      <ol>
        <li>
          Leave <strong>Buttons</strong> <strong>off</strong> so single-click
          selects instead of activating the page.
        </li>
        <li>Click once on an outlined element.</li>
        <li>
          Use the style panel: color, background, font size, font weight, text
          align, padding.
        </li>
        <li>
          Each control change writes immediately (styles always autosave, even
          in Manual mode — staging for styles is on the roadmap).
        </li>
      </ol>

      <h2>What gets written</h2>
      <p>
        nextcanvas sets or removes keys on a literal inline style object:
      </p>
      <pre>
        <code>{`<h1 style={{ color: '#111', fontSize: '2rem' }}>
  Headline
</h1>`}</code>
      </pre>
      <ul>
        <li>Changing a control updates that property in the object.</li>
        <li>
          Clearing a value removes the key. If the object becomes empty, the{" "}
          <code>style</code> attribute is dropped.
        </li>
      </ul>

      <h2>Requirements</h2>
      <ul>
        <li>
          The element must already be stamped (editable text, bound text, or an
          editable attribute — or you selected it via the outline after a prior
          stamp).
        </li>
        <li>
          Only a <strong>literal</strong> <code>{'style={{ ... }}'}</code>{" "}
          object is editable. <code>{'style={someVar}'}</code> is rejected.
        </li>
      </ul>

      <div className="docs-callout warn">
        <strong>Not Tailwind (yet).</strong> Class names and utility strings are
        left alone. If your design is class-only with no inline style object,
        the panel can&apos;t rewrite the look into source until a className layer
        lands.
      </div>

      <h2>Undo</h2>
      <p>
        Style changes ride the shared undo/redo stack (
        <span className="docs-kbd">⌘Z</span> /{" "}
        <span className="docs-kbd">⌘⇧Z</span>). Undo writes the previous inline
        value back (or removes a property that didn&apos;t exist before).
      </p>

      <Pager
        prev={{ href: '/docs/attributes', label: 'Attributes' }}
        next={{ href: '/docs/toolbar', label: 'Controls & modes' }}
      />
    </article>
  );
}
