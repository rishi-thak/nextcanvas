import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
  title: 'What you can edit',
};

export default function WhatWorksPage() {
  return (
    <article>
      <p className="docs-kicker">Reference</p>
      <h1>What you can edit</h1>
      <p className="docs-lede">
        A practical map of what nextcanvas will offer an editor for — and what it
        will leave alone. When something isn&apos;t editable, there&apos;s usually
        no outline on hover.
      </p>

      <h2>Text — yes</h2>
      <div className="docs-table-wrap">
        <table>
          <thead>
            <tr>
              <th>In your JSX</th>
              <th>On the page</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>{'<h1>Hello</h1>'}</code>
              </td>
              <td>Double-click the headline</td>
            </tr>
            <tr>
              <td>
                <code>{'<p>Hi <strong>there</strong></p>'}</code>
              </td>
              <td>Edit surrounding runs; inline tags stay</td>
            </tr>
            <tr>
              <td>
                <code>{'<Reveal as="h2">Title</Reveal>'}</code>
              </td>
              <td>Double-click the title</td>
            </tr>
            <tr>
              <td>
                <code>{'<motion.h1>Hero</motion.h1>'}</code>
              </td>
              <td>Same as a plain h1</td>
            </tr>
            <tr>
              <td>
                <code>{'<Link href="/x">Label</Link>'}</code>
              </td>
              <td>Edit the label (and href via attributes)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Bound text — yes</h2>
      <div className="docs-table-wrap">
        <table>
          <thead>
            <tr>
              <th>In your JSX</th>
              <th>What gets rewritten</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>{'{s.name}'}</code> in a <code>.map</code>
              </td>
              <td>That object&apos;s <code>name</code> in the array</td>
            </tr>
            <tr>
              <td>
                <code>{'{s.name ?? s.role}'}</code>
              </td>
              <td>Whichever side the UI is showing</td>
            </tr>
            <tr>
              <td>
                <code>{'{t}'}</code> as a map element param
              </td>
              <td>That string in the array</td>
            </tr>
            <tr>
              <td>
                <code>{'{cfg.title}'}</code> /{" "}
                <code>{'{COUNCIL_COPY.eyebrow}'}</code>
              </td>
              <td>The object property (local or imported file)</td>
            </tr>
            <tr>
              <td>
                <code>{'{loading ? "Sign in" : "…"}'}</code>
              </td>
              <td>The string arm currently showing</td>
            </tr>
            <tr>
              <td>
                <code>{'{x ?? "—"}'}</code> / <code>{'{job?.service}'}</code>
              </td>
              <td>Literal fallback or optional-chain field</td>
            </tr>
            <tr>
              <td>
                <code>{'{msg.text}'}</code> next to other siblings
              </td>
              <td>Wrapped in a span; data entry via value-match</td>
            </tr>
            <tr>
              <td>
                <code>{'{session.title}'}</code> inside a child component
              </td>
              <td>The mapped data entry, via the prop</td>
            </tr>
            <tr>
              <td>
                <code>{'{q}'}</code> as a component prop from{" "}
                <code>{'q={f.q}'}</code>
              </td>
              <td>
                <code>faqs[].q</code> (etc.)
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Attributes — yes</h2>
      <ul>
        <li>
          Literal: <code>href=&quot;/x&quot;</code>,{" "}
          <code>src=&quot;…&quot;</code>, <code>alt</code>, <code>title</code>,{" "}
          <code>placeholder</code>, <code>aria-label</code>
        </li>
        <li>
          Bound bare identifier: <code>{'href={GITHUB}'}</code> — choose all
          references or just this one
        </li>
      </ul>

      <h2>Styles — yes, with limits</h2>
      <ul>
        <li>
          Literal <code>{'style={{ ... }}'}</code> — color, background, font
          size/weight, text align, padding
        </li>
        <li>
          Not className / Tailwind utilities
        </li>
        <li>
          Not <code>{'style={variable}'}</code>
        </li>
      </ul>

      <h2>No outline / won&apos;t edit</h2>
      <div className="docs-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>{`Hi {name}`}</code> mixed in one parent
              </td>
              <td>Ambiguous which part is source text</td>
            </tr>
            <tr>
              <td>
                <code>{'{items[i].x}'}</code>, <code>{'{fn()}'}</code>
              </td>
              <td>Can&apos;t resolve a single string leaf</td>
            </tr>
            <tr>
              <td>
                Ternary arms that aren&apos;t string literals
              </td>
              <td>Only <code>{'{cond ? "A" : "B"}'}</code> style is editable</td>
            </tr>
            <tr>
              <td>Live clocks, chat streams, validation errors</td>
              <td>Runtime-only — not in source as literals</td>
            </tr>
            <tr>
              <td>
                <code>Foo.Bar.Baz</code> / namespaced tags
              </td>
              <td>Not stamped</td>
            </tr>
            <tr>
              <td>Duplicate bound values across entries</td>
              <td>
                Refused on commit (ambiguous) — make the string unique
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Bundlers &amp; platforms</h2>
      <div className="docs-table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>macOS / Linux</th>
              <th>Windows</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>webpack</td>
              <td>Works</td>
              <td>Works</td>
            </tr>
            <tr>
              <td>Turbopack</td>
              <td>Works</td>
              <td>
                Prefer <code>next dev --webpack</code> for now
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Production</h2>
      <p>
        Deploy freely. In production builds nextcanvas is a complete no-op: no
        overlay, no stamps, no write-back server. Your users never see it.
      </p>

      <Pager prev={{ href: '/docs/toolbar', label: 'Controls & modes' }} />
    </article>
  );
}
