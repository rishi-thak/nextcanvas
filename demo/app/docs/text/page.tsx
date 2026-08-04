import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
  alternates: { canonical: '/docs/text' },
  title: 'Text editing',
};

export default function TextPage() {
  return (
    <article>
      <p className="docs-kicker">Editing</p>
      <h1>Text</h1>
      <p className="docs-lede">
        The core loop: double-click copy in the page, type a new value, commit.
        nextcanvas rewrites the matching JSX text in your source file.
      </p>

      <h2>How to edit</h2>
      <ol>
        <li>
          Make sure the toolbar is <strong>on</strong> and{' '}
          <strong>Buttons</strong> is <strong>off</strong> (edit mode). Clicks
          on the page won&apos;t navigate or fire app handlers.
        </li>
        <li>
          Hover text — editable elements get an outline.
        </li>
        <li>
          <strong>Double-click</strong> to enter edit mode. The caret lands in
          the text.
        </li>
        <li>
          Type your change. Press <span className="docs-kbd">Enter</span> to
          save, or <span className="docs-kbd">Escape</span> to cancel. Clicking
          outside also commits.
        </li>
      </ol>
      <div className="docs-callout tip">
        <strong>Autosave vs Manual.</strong> In Autosave (default), the commit
        writes to disk immediately. In Manual, it stages until you hit{' '}
        <strong>Save</strong> on the toolbar. See{' '}
        <a href="/docs/toolbar">Controls &amp; modes</a>.
      </div>

      <h2>What counts as editable text</h2>

      <h3>Plain static text</h3>
      <p>
        A host element whose children are literal text — the classic case:
      </p>
      <pre>
        <code>{`<h1>Generative AI rewires innovation</h1>
<p>Where operators get good at the pipeline.</p>`}</code>
      </pre>
      <p>
        Double-click the rendered headline or paragraph. The matching string in
        the <code>.tsx</code> file updates in place, formatting preserved.
      </p>

      <h3>Mixed text + inline elements</h3>
      <p>
        Text that wraps bold, links, or other inline tags is editable too — you
        edit the surrounding runs; the inline elements stay locked:
      </p>
      <pre>
        <code>{`<p>
  Still unsure?{" "}
  <a href="#register">reserve your seat</a>.
</p>`}</code>
      </pre>
      <ul>
        <li>
          You can change &quot;Still unsure?&quot; and the trailing period.
        </li>
        <li>
          You <strong>cannot</strong> delete the <code>{'<a>'}</code> or empty
          an entire text run — the edit is rejected and reverted with a toast.
        </li>
      </ul>

      <h3>Text inside components</h3>
      <p>
        Copy wrapped in a plain component tag is editable when it&apos;s literal
        text (or supported bound text) as the children:
      </p>
      <pre>
        <code>{`<Reveal as="h2">Who you'll hear from:</Reveal>
<Link href="/chat">Talk to an AI partner</Link>`}</code>
      </pre>
      <p>
        You edit what you see on the page. The write-back still targets the
        original JSX in your source — even if the component doesn&apos;t forward
        props.
      </p>

      <h3>Text interpolated with an expression</h3>
      <p>
        Copy that surrounds an interpolated value is editable — you change the
        static words while the <code>{'{expression}'}</code> is locked and
        preserved:
      </p>
      <pre>
        <code>{`<h1>Hello {name}!</h1>
<p>You have {count} messages today</p>`}</code>
      </pre>
      <ul>
        <li>
          Edit &quot;Hello&quot; / &quot;!&quot; or &quot;You have&quot; /
          &quot;messages today&quot; — the run you type in is rewritten in place.
        </li>
        <li>
          The interpolated value (<code>{'{name}'}</code>,{' '}
          <code>{'{count}'}</code>) is not editable here — it comes from a
          variable, not static copy — so it stays exactly as written. To edit a
          value that <em>is</em> data, see <a href="/docs/bound-text">Bound
          text</a>.
        </li>
        <li>
          If an element is <em>only</em> an expression with no static words
          around it (<code>{'<p>{name}</p>'}</code>), it won&apos;t outline for
          text editing — there is nothing static to change.
        </li>
      </ul>

      <h3>Special characters &amp; entities</h3>
      <p>
        Copy containing HTML entities — <code>&amp;amp;</code>,{' '}
        <code>&amp;mdash;</code>, <code>&amp;rsquo;</code>,{' '}
        <code>&amp;hellip;</code> — edits normally. You type and see the real
        character (<code>&amp;</code>, <code>—</code>, <code>&rsquo;</code>);
        nextcanvas re-encodes anything that needs escaping (<code>&amp;</code>,{' '}
        <code>&lt;</code>, <code>&gt;</code>, <code>{'{'}</code>,{' '}
        <code>{'}'}</code>) so the JSX in your file stays valid.
      </p>

      <h3>Motion / animated tags</h3>
      <p>
        Elements like <code>{'<motion.h1>'}</code>, <code>{'<motion.p>'}</code>,
        and <code>{'<motion.a>'}</code> are editable the same way as plain{' '}
        <code>h1</code> / <code>p</code> / <code>a</code>. Hero copy that lives
        on Motion tags is fair game.
      </p>

      <h2>Shared source, many instances</h2>
      <p>
        If the same JSX line renders many times (for example a card title inside
        a <code>.map</code>), editing one instance rewrites that shared source
        line — so every instance updates. That&apos;s intentional: there&apos;s
        only one string in the file.
      </p>

      <h2>What won&apos;t open an editor</h2>
      <ul>
        <li>
          An element that is <strong>only</strong> an expression, with no static
          words to edit: <code>{'<p>{SITE.name}</p>'}</code> (but see{' '}
          <a href="/docs/bound-text">Bound text</a> — many of these are editable
          as data).
        </li>
        <li>
          The interpolated value itself inside mixed copy — you edit the words
          around <code>{'{count}'}</code>, not the number it resolves to.
        </li>
        <li>
          Purely dynamic runtime strings (countdown digits, form errors, chat
          bubbles)
        </li>
        <li>
          Namespaced or deeply nested member tags beyond simple{" "}
          <code>motion.*</code>
        </li>
      </ul>
      <p>
        For data-driven single-expression children like{" "}
        <code>{'{speaker.name}'}</code>, see{" "}
        <a href="/docs/bound-text">Bound text</a>.
      </p>

      <Pager
        prev={{ href: '/docs/quickstart', label: 'Quickstart' }}
        next={{ href: '/docs/bound-text', label: 'Bound text' }}
      />
    </article>
  );
}
