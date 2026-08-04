import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
  alternates: { canonical: '/docs/styles' },
  title: 'Styles',
};

export default function StylesPage() {
  return (
    <article>
      <p className="docs-kicker">Editing</p>
      <h1>Styles</h1>
      <p className="docs-lede">
        Single-click a stamped element to open the style panel. In a Tailwind
        project, tweaks are written as utility classes on that element&apos;s{' '}
        <code>className</code>. Everywhere else they go into an inline{' '}
        <code>style={'{{}}'}</code> object. You don&apos;t choose — nextcanvas
        detects which kind of project it is.
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
          In Autosave each control change writes immediately. In Manual mode it
          stages behind the Save button, alongside your text and attribute
          edits — each property stages separately, so you can restyle several
          things and write them in one go.
        </li>
      </ol>

      <h2>In a Tailwind project</h2>
      <p>
        Each control is written as a utility class, and the class that previously
        controlled that property is removed rather than left to fight with the
        new one:
      </p>
      <pre>
        <code>{`<h1 className="text-lg text-red-500">      // before
<h1 className="text-lg text-[#0000ff]">   // after setting the colour`}</code>
      </pre>
      <ul>
        <li>
          <strong>Weight and alignment</strong> use the named utilities —{' '}
          <code>font-bold</code>, <code>text-center</code>.
        </li>
        <li>
          <strong>Colour, size and padding</strong> use arbitrary values —{' '}
          <code>text-[#0000ff]</code>, <code>p-[13px]</code>. That keeps the value
          exactly what you picked; snapping to <code>p-4</code> would silently
          mean something different in a project with a customised scale.
        </li>
        <li>
          Utilities carrying a variant (<code>hover:</code>, <code>md:</code>,{' '}
          <code>dark:</code>) are never removed — they apply conditionally, and
          deleting them because you changed a base value would throw away states
          you wrote deliberately.
        </li>
        <li>
          Clearing a value removes the class. If <code>className</code> ends up
          empty, the attribute is dropped.
        </li>
      </ul>

      <h2>Everywhere else</h2>
      <p>
        Without Tailwind, nextcanvas sets or removes keys on a literal inline
        style object:
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
        <li>
          On the Tailwind path, <code>className</code> must be a plain string —{' '}
          <code>className=&quot;a b&quot;</code> or{' '}
          <code>{'className={\'a b\'}'}</code>. A computed one such as{' '}
          <code>{"className={cn('a', busy && 'b')}"}</code> is refused, because
          there is no position in a conditional that is correct for every render.
        </li>
      </ul>

      <div className="docs-callout">
        <strong>How the project is detected.</strong> nextcanvas looks for{' '}
        <code>tailwindcss</code> in the nearest <code>package.json</code>, or a{' '}
        <code>tailwind.config.*</code> beside it. Both are checked because v4
        needs no config file and a vendored setup may have no dependency entry.
      </div>

      <h2>Undo</h2>
      <p>
        Style changes ride the shared undo/redo stack (
        <span className="docs-kbd">⌘Z</span> /{" "}
        <span className="docs-kbd">⌘⇧Z</span>). Undo writes the previous inline
        value back (or removes a property that didn&apos;t exist before).
      </p>
      <div className="docs-callout warn">
        <strong>Undo on the Tailwind path removes the class</strong> rather than
        restoring the one that was there before. The panel records the
        element&apos;s prior <em>inline</em> value, which is empty in a Tailwind
        project — so undoing a colour edit clears the colour instead of putting{' '}
        <code>text-red-500</code> back. Reach for your editor&apos;s undo, or git,
        if you need the original class name.
      </div>

      <Pager
        prev={{ href: '/docs/attributes', label: 'Attributes' }}
        next={{ href: '/docs/toolbar', label: 'Controls & modes' }}
      />
    </article>
  );
}
