import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
  title: 'Bound text',
};

export default function BoundTextPage() {
  return (
    <article>
      <p className="docs-kicker">Editing</p>
      <h1>Bound text</h1>
      <p className="docs-lede">
        When the page shows a value from your data — not a hardcoded string in
        the JSX — you can still edit it in the browser. nextcanvas finds the
        matching entry in your source data and rewrites that string.
      </p>

      <h2>How it feels</h2>
      <p>
        Bound text looks like normal text on the page. You double-click and type
        the same way. Under the hood, the commit updates a property in an array
        or object (often in another file), not the JSX expression itself.
      </p>
      <div className="docs-callout tip">
        <strong>Targeting is by value.</strong> If a list is filtered or
        reordered on screen, nextcanvas still edits the data entry whose current
        string matches what you changed — not &quot;whatever is at index 3.&quot;
      </div>

      <h2>Shapes that work</h2>

      <h3>Object fields in a map</h3>
      <pre>
        <code>{`{SPEAKERS.map((s) => (
  <h3>{s.name}</h3>
))}`}</code>
      </pre>
      <p>
        Double-click a name on the page → that speaker&apos;s{" "}
        <code>name</code> string in the <code>SPEAKERS</code> array (or imported
        data module) updates.
      </p>

      <h3>Fallback expressions</h3>
      <pre>
        <code>{`<h3>{s.name ?? s.role}</h3>
<p>{result.number ?? "—"}</p>`}</code>
      </pre>
      <p>
        Edit whatever the page is currently showing. If the name is present,
        you&apos;re editing <code>name</code>; if the UI fell through to the
        role, you&apos;re editing <code>role</code>. Same idea for{" "}
        <code>||</code>.
      </p>
      <p>
        Literal fallbacks work too — when the page shows the{" "}
        <code>&quot;—&quot;</code>, editing it rewrites that string in the JSX.
        When it shows the bound side, you&apos;re editing the data property.
      </p>

      <h3>Optional chaining</h3>
      <pre>
        <code>{`<h3>{job?.service}</h3>`}</code>
      </pre>
      <p>
        Treated like a normal member path (<code>job.service</code>). If{" "}
        <code>job</code> comes from a <code>.map</code>, the matching array
        entry updates.
      </p>

      <h3>Button labels and other string ternaries</h3>
      <pre>
        <code>{`<button>{loading ? "Signing in..." : "Sign in"}</button>
<span>{status === "a" ? "Alpha" : status === "b" ? "Beta" : "Other"}</span>`}</code>
      </pre>
      <p>
        When <strong>every</strong> arm is a string literal (nested ternaries
        ok), double-click the label you see. nextcanvas rewrites that arm in
        source — the other arms stay put. Great for loading CTAs and status
        chrome.
      </p>

      <h3>String arrays</h3>
      <pre>
        <code>{`{truths.map((t) => (
  <p>{t}</p>
))}`}</code>
      </pre>
      <p>
        Each rendered line maps to a string literal in the array. Change one on
        the page; that array entry updates.
      </p>

      <h3>Config / copy objects</h3>
      <pre>
        <code>{`<Reveal as="p">{COUNCIL_COPY.eyebrow}</Reveal>
<h1>{cfg.title}</h1>`}</code>
      </pre>
      <p>
        Nested paths like <code>cfg.meta.title</code> work too. If the object is
        imported from another file, that file is what gets saved.
      </p>

      <h3>Props drilled through a child component</h3>
      <pre>
        <code>{`function SessionCard({ session }) {
  return <h3>{session.title}</h3>;
}

{visible.map((session) => (
  <SessionCard session={session} />
))}`}</code>
      </pre>
      <p>
        You still edit the title on the card. nextcanvas follows{" "}
        <code>session</code> back through the prop to the mapped data (and, when
        the list is a filtered view, to the underlying source array).
      </p>
      <p>
        FAQ-style props work the same way:
      </p>
      <pre>
        <code>{`function Row({ q, a }) {
  return (
    <>
      <span>{q}</span>
      <p>{a}</p>
    </>
  );
}

{faqs.map((f) => (
  <Row q={f.q} a={f.a} />
))}`}</code>
      </pre>

      <h3>Bound text beside siblings</h3>
      <pre>
        <code>{`<div>
  {msg.role === "assistant" && <p>Relay</p>}
  {msg.text}
</div>`}</code>
      </pre>
      <p>
        A bound expression that isn&apos;t the only child still becomes
        editable — nextcanvas wraps it in a stamped span at compile time. You
        double-click the text as usual; write-back targets the data the same
        way.
      </p>
      <p>
        Inert chrome like <code>{'{isStreaming && <span />}'}</code> next to a
        bound value is ignored, so <code>{'{content}'}</code> can still be the
        editable child.
      </p>

      <h2>When an edit is refused</h2>
      <ul>
        <li>
          <strong>Duplicate values</strong> — if two entries share the exact
          same string, nextcanvas can&apos;t tell which you meant. Make the copy
          unique, or edit the data file directly.
        </li>
        <li>
          <strong>Stale text</strong> — if the source no longer contains the
          old value (someone else edited the file), reload and try again.
        </li>
        <li>
          <strong>Non-string leaves</strong> — numbers or expressions in the
          data object can&apos;t be edited as text.
        </li>
      </ul>

      <h2>What stays uneditable</h2>
      <ul>
        <li>
          Mixed literal + expression:{" "}
          <code>{`Day {session.day}`}</code>,{" "}
          <code>{`{SITE.dates} · {SITE.location}`}</code>
        </li>
        <li>
          Computed access or calls:{" "}
          <code>{'{items[i].x}'}</code>, <code>{'{fn().y}'}</code>
        </li>
        <li>
          Ternaries whose arms aren&apos;t plain string literals (components,
          fragments, calls)
        </li>
        <li>
          Runtime-only strings (API payloads, live clocks, validation errors)
          — there&apos;s no source literal to rewrite
        </li>
        <li>
          Bare identifiers that are React reserved props (
          <code>children</code>, <code>className</code>, …) or arbitrary locals
          with no resolvable data binding
        </li>
      </ul>

      <Pager
        prev={{ href: '/docs/text', label: 'Text' }}
        next={{ href: '/docs/attributes', label: 'Attributes' }}
      />
    </article>
  );
}
