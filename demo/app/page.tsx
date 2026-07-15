import { SPEAKERS, siteConfig } from './speakers';

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
      {/* ---------------- Nav ---------------- */}
      <nav className="nav">
        <div className="container nav-inner">
          <a className="brand" href="/">
            <span className="brand-mark">◆</span>
            <span>nextcanvas</span>
          </a>
          <div className="nav-links">
            <a className="hide-sm" href="#features">
              Features
            </a>
            <a className="hide-sm" href="#install">
              Install
            </a>
            <a className="hide-sm" href="#how">
              How
                                                                </a>
            <a href={GITHUB}>GitHub</a>
            <a className="btn btn-ghost" href="#install">
              Get started
            </a>
          </div>
        </div>
      </nav>

      {/* ---------------- Hero ---------------- */}
      <header className="hero">
        <div className="container">
          <span className="badge">
            <span className="dot" />
            Dev-only · Next.js App Router
          </span>
          <h1 className="hero-title">Edit your Next.js app right in the browser.</h1>
          <p className="hero-sub">
            nextcanvas turns your locally-running app into an editable canvas.
            Double-click any static text, type a new value, and it is written
            straight back into your source file. Fast Refresh does the rest.
          </p>
          <div className="hero-cta">
            <a className="btn btn-primary btn-lg" href="#install">
              Get started
            </a>
            <a className="btn btn-ghost btn-lg" href={GITHUB}>
              Star on GitHub
            </a>
          </div>
          <div className="install-pill">
            <span className="prompt">$</span>
            <span>npm i -D @rishi-thak/nextcanvas</span>
            <span className="copy">copy</span>
          </div>
          <p
            style={{
              marginTop: 22,
              fontSize: 13.5,
              color: 'var(--faint)',
            }}
          >
            Psst — this entire page is a live nextcanvas demo. Run it in dev and
            double-click any headline to edit it.
          </p>
        </div>
      </header>

      {/* ---------------- Install / integration ---------------- */}
      <section id="install">
        <div className="container split">
          <div>
            <p className="eyebrow">integration</p>
            <h2 className="section-title">Two commands. Nothing to wire by hand.</h2>
            <p className="section-sub">
              Install it, run one command, and start editing. init wraps your next.config and mounts the overlay for you.
                                      </p>
            <div className="steps">
              <div className="step">
                <span className="step-num">1</span>
                <div>
                  <h4>Install the package</h4>
                  <p>
                    Add it as a dev dependency. It ships prebuilt, so there is no
                    build step on your end.
                  </p>
                </div>
              </div>
              <div className="step">
                <span className="step-num">2</span>
                <div>
                  <h4>Run npx nextcanvas init</h4>
                  <p>
                    It wraps your next.config with withCanvas and mounts the
                    overlay in your root layout. Then run next dev.
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
            <h2 className="section-title">From double-click to source edit.</h2>
            <p className="section-sub">
              A compile-time stamp maps every element back to its exact line of
              source. The rest is a single round-trip.
            </p>
          </div>
          <div className="flow">
            <div className="flow-node">
              <div className="k">01 · click</div>
              <p>Double-click text in the browser. The overlay reads the element data-loc stamp.</p>
            </div>
            <span className="flow-arrow">→</span>
            <div className="flow-node">
              <div className="k">02 · post</div>
              <p>It POSTs the file, line, old and new text to the local write-back server.</p>
            </div>
            <span className="flow-arrow">→</span>
            <div className="flow-node">
              <div className="k">03 · write</div>
              <p>ts-morph does a formatting-preserving AST edit and saves your source file.</p>
            </div>
            <span className="flow-arrow">→</span>
            <div className="flow-node">
              <div className="k">04 · refresh</div>
              <p>Next.js Fast Refresh re-renders instantly. No websocket, no reload.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Features ---------------- */}
      <section id="features">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">features</p>
            <h2 className="section-title">Everything you need, nothing you do not.</h2>
          </div>
          <div className="grid">
            <div className="card">
              <div className="ico">✎</div>
              <h3>Double-click to edit</h3>
              <p>
                Any static text becomes editable inline. No side panels, no edit
                mode to toggle — just click and type.
              </p>
            </div>
            <div className="card">
              <div className="ico">💾</div>
              <h3>Written back to source</h3>
              <p>
                Edits land in your real .tsx file through a formatting-preserving
                AST edit. Your code and style are untouched.
              </p>
            </div>
            <div className="card">
              <div className="ico">⚡</div>
              <h3>Fast Refresh, instantly</h3>
              <p>
                Edits are one-way POSTs; the browser update comes for free from
                Next.js Fast Refresh. No socket to maintain.
              </p>
            </div>
            <div className="card">
              <div className="ico">🦀</div>
              <h3>SWC plugin, both bundlers</h3>
              <p>
                The source stamp runs inside SWC, so webpack and Turbopack both
                work. Zero extra config, next/font intact.
              </p>
            </div>
            <div className="card">
              <div className="ico">🌙</div>
              <h3>Dev-only, zero prod cost</h3>
              <p>
                Everything is gated to development and compiles out completely in
                production builds. Ship with confidence.
              </p>
            </div>
            <div className="card">
              <div className="ico">🧩</div>
              <h3>Robust across React</h3>
              <p>
                Elements are mapped to source at compile time, not from fragile
                React internals. It just keeps working.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Speakers (bound-text demo) ---------------- */}
      <section id="speakers">
        <div className="container">
          {/* direct-object binding: {siteConfig.title} */}
          <h2 className="section-title">{siteConfig.title}</h2>
          <div className="cards">
            {SPEAKERS.map((s, i) => (
              <div className="card" key={i}>
                {/* .map bindings — editable, written back into speakers.ts */}
                <h3>{s.name}</h3>
                <p>{s.bio}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section>
        <div className="container">
          <div className="cta">
            <h2>Drop it into your Next.js app.</h2>
            <p>
              Install once, edit forever. nextcanvas is a dev dependency that
              stays out of your way and out of production.
            </p>
            <div className="hero-cta" style={{ marginBottom: 0 }}>
              <a className="btn btn-primary btn-lg" href={GITHUB}>
                Get started
              </a>
              <a className="btn btn-ghost btn-lg" href="#install">
                Read the docs
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="footer">
        <div className="container footer-inner">
          <p>© 2026 nextcanvas · MIT licensed</p>
          <div className="footer-links">
            <a href={GITHUB}>GitHub</a>
            <a href="#install">Install</a>
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
          </div>
        </div>
      </footer>
    </>
  );
}
