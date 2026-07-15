import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
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
          Text mixed with an expression in the same parent:{" "}
          <code>{`© 2026 {SITE.name}`}</code>
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
