import { InstallPill } from './InstallPill';
import { ThemeToggle } from './ThemeToggle';
import { DemoCanvas } from './DemoCanvas';

const GITHUB = 'https://github.com/rishi-thak/nextcanvas';

function CodeWindow({
  file,
  children,
}: {
  file: string;
  children: React.ReactNode;
}) {
  return (
    <div className="window">
      <div className="window-bar">
        <div className="lights">
          <span />
          <span />
          <span />
        </div>
        <span className="fname">{file}</span>
      </div>
      <pre className="code">{children}</pre>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <DemoCanvas />

      {/* ---------------- Nav ---------------- */}
      <nav className="nav">
        <div className="container nav-inner">
          <a className="brand" href="/">
            <span className="brand-mark">◆</span>
            <span>nextcanvas</span>
          </a>
          <div className="nav-links">
            <a className="hide-sm" href="#features">features</a>
            <a className="hide-sm" href="#install">install</a>
            <a className="hide-sm" href="/docs">docs</a>
            <a href={GITHUB}>github</a>
            <a className="btn btn-ghost" href="#install">get started</a>
          </div>
        </div>
      </nav>

      {/* ---------------- Hero ---------------- */}
      <header className="hero">
        <div className="container">
          <h1 className="hero-title">edit your next.js app right in the browser.</h1>
          <p className="hero-sub">
            nextcanvas turns your locally-running app into an editable canvas. double-click any text, type a new value, and it is written straight back into your source file. fast refresh does the rest.
                                                                                                  </p>
          {/* The copy-prompt pill IS the primary action now — pasting setup into
              an agent is the path most people take, so it replaces "get started". */}
          <div className="hero-actions">
            <InstallPill />
            <a className="btn btn-ghost btn-lg" href={GITHUB}>
              star on github
            </a>
          </div>
          <p
            style={{
              marginTop: 22,
              fontSize: 13.5,
              color: 'var(--faint)',
            }}
          >
            fyi, this entire page is a live demo running the real overlay. flip the switch in the toolbar, then double-click any text. changes stay in your browser — reload to reset.
                                </p>
        </div>
      </header>

      {/* ---------------- Install / integration ---------------- */}
      <section id="install">
        <div className="container split">
          <div>
            <p className="eyebrow">integration</p>
            <h2 className="section-title">two commands. nothing to wire by hand.</h2>
            <p className="section-sub">
              install it, run one command, and start editing. init wraps your next.config and mounts the overlay for you.
                                      </p>
            <div className="steps">
              <div className="step">
                <span className="step-num">1</span>
                <div>
                  <h4>install the package</h4>
                  <p>
                    add it as a dev dependency. it ships prebuilt, so there is no
                    build step on your end.
                  </p>
                </div>
              </div>
              <div className="step">
                <span className="step-num">2</span>
                <div>
                  <h4>run npx nextcanvas init</h4>
                  <p>
                    it wraps your next.config with withCanvas and mounts the
                    overlay in your root layout. then run next dev.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <CodeWindow file="terminal">
              <span className="prompt">{'$ '}</span>
              {'npm i -D @rishi-thak/nextcanvas'}
              {'\n'}
              <span className="prompt">{'$ '}</span>
              {'npx nextcanvas init'}
              {'\n'}
              <span className="cmt">{'✓ wrapped next.config.ts with withCanvas'}</span>
              {'\n'}
              <span className="cmt">{'✓ mounted <NextCanvasOverlay/> in app/layout.tsx'}</span>
              {'\n'}
              <span className="cmt">{'→ run `next dev` and double-click any text'}</span>
            </CodeWindow>

            <CodeWindow file="next.config.ts">
              <span className="cmt">{'// wired for you by `npx nextcanvas init`'}</span>
              {'\n'}
              <span className="kw">{'import'}</span>
              {' { withCanvas } '}
              <span className="kw">{'from'}</span>
              {' '}
              <span className="str">{"'@rishi-thak/nextcanvas/next'"}</span>
              {';'}
              {'\n\n'}
              <span className="kw">{'export default'}</span>
              {' '}
              <span className="fn">{'withCanvas'}</span>
              {'(nextConfig);'}
            </CodeWindow>
          </div>
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section id="how">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">how it works</p>
            <h2 className="section-title">from double-click to source edit.</h2>
            <p className="section-sub">
              a compile-time stamp maps every element back to its exact line of
              source. the rest is a single round-trip.
            </p>
          </div>
          <div className="flow">
            <div className="flow-node">
              <div className="k">01 · click</div>
              <p>double-click text in the browser. the overlay reads the element data-loc stamp.</p>
            </div>
            <span className="flow-arrow">→</span>
            <div className="flow-node">
              <div className="k">02 · post</div>
              <p>it posts the file, line, old and new text to the local write-back server.</p>
            </div>
            <span className="flow-arrow">→</span>
            <div className="flow-node">
              <div className="k">03 · write</div>
              <p>ts-morph does a formatting-preserving ast edit and saves your source file.</p>
            </div>
            <span className="flow-arrow">→</span>
            <div className="flow-node">
              <div className="k">04 · refresh</div>
              <p>next.js fast refresh re-renders instantly. no websocket, no reload.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Features ---------------- */}
      <section id="features">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">features</p>
            <h2 className="section-title">everything you need, nothing you do not.</h2>
          </div>
          <div className="grid">
            <div className="card">
              <div className="ico">✎</div>
              <h3>double-click to edit</h3>
              <p>
                any static text becomes editable inline. no side panels, no edit
                mode to toggle — just click and type.
              </p>
            </div>
            <div className="card">
              <div className="ico">💾</div>
              <h3>written back to source</h3>
              <p>
                edits land in your real .tsx file through a formatting-preserving
                ast edit. your code and style are untouched.
              </p>
            </div>
            <div className="card">
              <div className="ico">⚡</div>
              <h3>fast refresh, instantly</h3>
              <p>
                edits are one-way posts; the browser update comes for free from
                next.js fast refresh. no socket to maintain.
              </p>
            </div>
            <div className="card">
              <div className="ico">🦀</div>
              <h3>swc plugin, both bundlers</h3>
              <p>
                the source stamp runs inside swc, so webpack and turbopack both
                work. zero extra config, next/font intact.
              </p>
            </div>
            <div className="card">
              <div className="ico">🌙</div>
              <h3>dev-only, zero prod cost</h3>
              <p>
                everything is gated to development and compiles out completely in
                production builds. ship with confidence.
              </p>
            </div>
            <div className="card">
              <div className="ico">🧩</div>
              <h3>robust across react</h3>
              <p>
                elements are mapped to source at compile time, not from fragile
                react internals. it just keeps working.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section>
        <div className="container">
          <div className="cta">
            <h2>drop it into your next.js app.</h2>
            <p>
              install once, edit forever. nextcanvas is a dev dependency that
              stays out of your way and out of production.
            </p>
            <div className="hero-cta" style={{ marginBottom: 0 }}>
              <a className="btn btn-primary btn-lg" href="#install">get started</a>
              <a className="btn btn-ghost btn-lg" href="/docs">read the docs</a>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="footer">
        <div className="container footer-inner">
          <p>© 2026 nextcanvas · mit licensed</p>
          <div className="footer-links">
            <a href={GITHUB}>github</a>
            <a href="/docs">docs</a>
            <a href="#install">install</a>
            <a href="#features">features</a>
          </div>
          <ThemeToggle />
        </div>
      </footer>
    </>
  );
}
