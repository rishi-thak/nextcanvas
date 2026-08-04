import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
  alternates: { canonical: '/docs/alternatives' },
  title: 'nextcanvas vs Onlook vs Editability',
  description:
    'An honest comparison of nextcanvas, Onlook, and Editability — three tools for editing a Next.js app visually, built for three different people. Includes where nextcanvas is the wrong choice.',
};

export default function AlternativesPage() {
  return (
    <article>
      <p className="docs-kicker">Reference</p>
      <h1>nextcanvas vs Onlook vs Editability</h1>
      <p className="docs-lede">
        Three tools let you change a Next.js app by clicking it instead of finding
        the file. They are not really competitors — they are built for three
        different people. This page is here so you can tell quickly whether
        nextcanvas is the wrong one for you.
      </p>

      <div className="docs-callout">
        <p>
          Written July 2026. Star counts and version numbers move; the shape of
          each tool is the part worth comparing.
        </p>
      </div>

      <h2>Pick by who is doing the editing</h2>
      <p>
        This is the whole decision, and it is usually obvious once stated:
      </p>
      <ul>
        <li>
          <strong>A developer, on their own machine, with the repo open.</strong>{' '}
          nextcanvas. It lives in your existing <code>next dev</code> session and
          writes to the files on your disk.
        </li>
        <li>
          <strong>Someone doing design work, who wants layout and AI.</strong>{' '}
          <a href="https://github.com/onlook-dev/onlook">Onlook</a>. It is a
          visual editor with an AI chat, Tailwind class editing, and
          drag-and-drop — much closer to a design tool than a dev utility.
        </li>
        <li>
          <strong>A non-technical teammate, editing the deployed site.</strong>{' '}
          <a href="https://editability.dev/">Editability</a>. Editors change copy
          on the live site and publishing opens a GitHub commit that your normal
          CI redeploys.
        </li>
      </ul>
      <p>
        If your actual goal is the third one — a marketer or client updating copy
        without you — <strong>nextcanvas cannot do it and never will</strong>. It
        requires a cloned repo and a running dev server. Stop here and look at
        Editability, or at a headless CMS with visual editing such as Sanity,
        TinaCMS, or Builder.io.
      </p>

      <h2>Side by side</h2>
      <div className="docs-table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>nextcanvas</th>
              <th>Onlook</th>
              <th>Editability</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Editor is</td>
              <td>the developer</td>
              <td>designer / developer</td>
              <td>a non-technical teammate</td>
            </tr>
            <tr>
              <td>Runs against</td>
              <td>
                your own <code>next dev</code>
              </td>
              <td>its own editor app</td>
              <td>the deployed site</td>
            </tr>
            <tr>
              <td>Changes land as</td>
              <td>a direct edit to the file on disk</td>
              <td>an edit to your source files</td>
              <td>one GitHub commit per publish</td>
            </tr>
            <tr>
              <td>Source annotation needed</td>
              <td>none — stamped at compile time</td>
              <td>none</td>
              <td>
                wrap each block in <code>&lt;Editability&gt;</code>
              </td>
            </tr>
            <tr>
              <td>Accounts / tokens</td>
              <td>none</td>
              <td>account for AI features</td>
              <td>Google client ID + GitHub token</td>
            </tr>
            <tr>
              <td>Text editing</td>
              <td>Yes</td>
              <td>Yes</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Data-bound text</td>
              <td>
                Yes — <code>{'{speaker.name}'}</code> resolved back to the source
                array or object
              </td>
              <td>Not a focus</td>
              <td>
                No — explicitly not built for dynamic app UIs
              </td>
            </tr>
            <tr>
              <td>Styling</td>
              <td>
                Tailwind classes in a Tailwind project, otherwise inline{' '}
                <code>style</code> — six properties
              </td>
              <td>Tailwind classes, broad coverage</td>
              <td>n/a — text only</td>
            </tr>
            <tr>
              <td>Layout / drag-and-drop</td>
              <td>No</td>
              <td>Yes</td>
              <td>No</td>
            </tr>
            <tr>
              <td>AI</td>
              <td>No</td>
              <td>Central to the product</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Ships in production</td>
              <td>No — compiles out entirely</td>
              <td>No</td>
              <td>Editor bundle loads in edit mode</td>
            </tr>
            <tr>
              <td>Licence</td>
              <td>MIT</td>
              <td>Apache-2.0</td>
              <td>Open source</td>
            </tr>
            <tr>
              <td>Maturity</td>
              <td>v0.2.2, one maintainer</td>
              <td>~26k stars, team, since 2024</td>
              <td>v0</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Where nextcanvas loses</h2>
      <p>Plainly, because finding this out after installing is worse:</p>
      <ul>
        <li>
          <strong>Tailwind coverage is narrower.</strong> nextcanvas writes
          utility classes for the six properties its panel offers — colour,
          background, font size, weight, alignment, padding — and refuses a
          computed <code>{"className={cn(...)}"}</code>. Onlook edits Tailwind
          classes across far more of the design surface.
        </li>
        <li>
          <strong>No layout editing.</strong> Nothing is created, deleted,
          reordered, or dragged. It edits values in elements that already exist.
        </li>
        <li>
          <strong>No AI.</strong> No chat, no generation, no
          describe-it-and-get-a-component.
        </li>
        <li>
          <strong>Text from a database or API is not editable.</strong> If a value
          arrives at runtime it is not in your source, so there is nothing to
          write back to. Those elements are detected and left un-highlighted
          rather than failing on commit, but they are still off-limits.
        </li>
        <li>
          <strong>Next.js App Router only</strong>, 16.2 or newer. No Pages
          Router, no Vite, no plain React.
        </li>
        <li>
          <strong>It is new.</strong> One maintainer, v0.2.2. Onlook has two years
          and a team behind it.
        </li>
      </ul>

      <h2>Where nextcanvas fits better</h2>
      <ul>
        <li>
          <strong>Nothing to annotate.</strong> An SWC plugin stamps source
          locations at compile time, so every eligible element is editable
          immediately. You do not wrap your content in anything, and removing the
          tool leaves no trace in your components.
        </li>
        <li>
          <strong>Data-driven text is editable.</strong> A heading rendered from{' '}
          <code>{'{speaker.name}'}</code> inside a <code>.map</code> over an array
          in your source resolves back to that array and rewrites the right entry
          — matched by value, so a filtered or reordered list still edits the
          entry you clicked. This is the capability the other two do not have.
        </li>
        <li>
          <strong>No account, no service, no tokens.</strong> Nothing leaves your
          machine. There is no sign-in and nothing to configure beyond two lines
          of wiring.
        </li>
        <li>
          <strong>It is your dev server.</strong> No second app to run and no
          preview environment to keep in sync — the thing you are editing is the
          thing you were already looking at.
        </li>
        <li>
          <strong>Edits preserve formatting.</strong> Changes are applied as AST
          edits, so the diff is the string you changed and nothing else.
        </li>
      </ul>

      <h2>A related but different tool</h2>
      <p>
        If what you actually want is to click an element and hand its exact source
        location to a coding agent — rather than type the new value yourself —
        that is a different category, and tools built specifically for it will
        serve you better than any of the three above.
      </p>

      <Pager
        prev={{ href: '/docs/what-works', label: 'What you can edit' }}
        next={{ href: '/docs/security', label: 'Security & privacy' }}
      />
    </article>
  );
}
