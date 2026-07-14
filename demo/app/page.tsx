export default function Home() {
  const title = 'Bound value (not editable in MVP)';

  return (
    <main
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '64px 24px',
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>HI</h1>
      <p style={{ color: '#555' }}>
        Double-click any of this static text. Your change is written straight
        back into app/page.tsx, and Fast Refresh updates the view.
      </p>

      <h2 style={{ marginTop: 40 }}>dsnbajkd</h2>
      <p>szadasdfsavcfsvDSV</p>

      <button
        style={{
          marginTop: 24,
          padding: '10px 16px',
          fontSize: 14,
          borderRadius: 6,
          border: '1px solid #ccc',
          cursor: 'pointer',
        }}
      >
        Click me
      </button>

      {/* This one is a bound value and should be rejected with a message. */}
      <h3 style={{ marginTop: 40, color: '#999' }}>{title}</h3>
    </main>
  );
}
