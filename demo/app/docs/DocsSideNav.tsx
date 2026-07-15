'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS_NAV } from './nav';

export function DocsSideNav() {
  const pathname = usePathname();

  return (
    <nav className="docs-side-nav" aria-label="Documentation">
      {DOCS_NAV.map((group) => (
        <div key={group.title} className="docs-nav-group">
          <p className="docs-nav-title">{group.title}</p>
          <ul>
            {group.links.map((link) => {
              const active =
                link.href === '/docs'
                  ? pathname === '/docs'
                  : pathname === link.href || pathname.startsWith(link.href + '/');
              return (
                <li key={link.href}>
                  <Link href={link.href} className={active ? 'is-active' : undefined}>
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
