import Link from 'next/link';

export function Pager({
  prev,
  next,
}: {
  prev?: { href: string; label: string };
  next?: { href: string; label: string };
}) {
  return (
    <nav className="docs-pager" aria-label="Page">
      {prev ? (
        <Link href={prev.href}>
          <span className="dir">← Previous</span>
          <span className="label">{prev.label}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link className="next" href={next.href}>
          <span className="dir">Next →</span>
          <span className="label">{next.label}</span>
        </Link>
      ) : null}
    </nav>
  );
}
