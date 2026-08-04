import type { Metadata } from 'next';
import { Pager } from '../Pager';

export const metadata: Metadata = {
  alternates: { canonical: '/docs/security' },
  title: 'Security & privacy',
};

export default function SecurityPage() {
  return (
    <article>
      <p className="docs-kicker">Reference</p>
      <h1>Security &amp; privacy</h1>
      <p className="docs-lede">
        nextcanvas writes files on your disk in response to clicks in a browser.
        That is exactly the kind of power a stray web page would love to borrow,
        so the write-back server is locked to your own machine and your own
        project. Here is what that means and how to loosen it when your setup
        needs it.
      </p>

      <h2>It only runs in development</h2>
      <p>
        Everything is gated on <code>NODE_ENV === &apos;development&apos;</code>.
        A production build stamps no source locations, serves no overlay script,
        and never starts the write-back server. There is nothing to disable
        before you deploy.
      </p>

      <h2>The write-back server stays on your machine</h2>
      <p>
        In <code>next dev</code>, <code>withCanvas</code> starts a small HTTP
        server (port <code>3131</code>) that applies edits to source files. It is
        bound to <strong>loopback only</strong>, so the LAN cannot reach it, and
        every write request passes three gates before a byte is written:
      </p>
      <div className="docs-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gate</th>
              <th>What it stops</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Origin check</strong>
              </td>
              <td>
                Only requests from a local origin (<code>localhost</code>,{' '}
                <code>127.0.0.1</code>, <code>::1</code>, a private LAN address)
                are accepted. A random site open in the same browser cannot POST
                an edit — its <code>Origin</code> is rejected, and it never
                receives a CORS grant, so it cannot even read the response.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Host check</strong>
              </td>
              <td>
                Defeats DNS rebinding, where a hostile domain resolves to{' '}
                <code>127.0.0.1</code> so the browser treats the edit server as
                same-origin. A request arriving under a non-local{' '}
                <code>Host</code> header is refused.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Path containment</strong>
              </td>
              <td>
                Every file to edit must resolve — symlinks followed — to a real
                source file inside your project root. No <code>..</code> escapes,
                no symlink out of the tree, no <code>node_modules</code>, no{' '}
                <code>.d.ts</code>, and only source extensions (
                <code>.ts</code>, <code>.tsx</code>, <code>.js</code>,{' '}
                <code>.jsx</code>, <code>.mjs</code>, <code>.cjs</code>).
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="docs-callout tip">
        <strong>No account, no telemetry.</strong> nextcanvas talks only to its
        own <code>localhost</code> server. Nothing about your code or your edits
        leaves your machine.
      </div>

      <h2>When you develop through a forwarded domain</h2>
      <p>
        Codespaces, Gitpod, a remote dev box, or a custom{' '}
        <code>*.dev</code> host serve your app from an origin that is not{' '}
        <code>localhost</code>. Grant those origins explicitly:
      </p>
      <pre>
        <code>{`NEXTCANVAS_ALLOWED_ORIGINS=https://your-app.github.dev next dev`}</code>
      </pre>
      <p>
        The value is a comma-separated list of exact origins. Each granted origin
        is also accepted as a <code>Host</code>, since the forwarded request
        arrives through that same domain.
      </p>

      <h2>Environment variables</h2>
      <div className="docs-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Variable</th>
              <th>Default</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>NEXTCANVAS_PORT</code>
              </td>
              <td>
                <code>3131</code>
              </td>
              <td>
                Port for the write-back server. The same value is inlined for the
                browser overlay.
              </td>
            </tr>
            <tr>
              <td>
                <code>NEXTCANVAS_ALLOWED_ORIGINS</code>
              </td>
              <td>—</td>
              <td>
                Comma-separated origins allowed in addition to local ones — for
                forwarded/remote dev.
              </td>
            </tr>
            <tr>
              <td>
                <code>NEXTCANVAS_HOST</code>
              </td>
              <td>
                <code>127.0.0.1</code>
              </td>
              <td>
                Bind address. Set to <code>0.0.0.0</code> to test from a phone on
                your LAN — the origin/host checks still apply.
              </td>
            </tr>
            <tr>
              <td>
                <code>NEXTCANVAS_ROOT</code>
              </td>
              <td>enclosing git repo</td>
              <td>
                The directory edits must stay inside. Defaults to the git root
                (so a monorepo&apos;s shared components resolve), falling back to
                the dev server&apos;s working directory.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>If an edit is refused</h2>
      <p>
        A refused edit shows a toast with the reason. The common cases:{' '}
        <em>&ldquo;origin not allowed&rdquo;</em> means you are serving from a
        non-local domain — add it to <code>NEXTCANVAS_ALLOWED_ORIGINS</code>;{' '}
        <em>&ldquo;outside the project root&rdquo;</em> means the file lives
        beyond <code>NEXTCANVAS_ROOT</code> — widen the root if that is genuinely
        your source.
      </p>

      <Pager
        prev={{ href: '/docs/alternatives', label: 'Alternatives' }}
      />
    </article>
  );
}
