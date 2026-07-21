import type { MetadataRoute } from 'next';
import { DOCS_NAV } from './docs/nav';
import { SITE_URL } from './site';

// Every docs route is already declared in the side-nav — derive from it so a new
// page can't be added to the nav and silently miss the sitemap.
const ROUTES = ['/', ...DOCS_NAV.flatMap((group) => group.links.map((l) => l.href))];

export default function sitemap(): MetadataRoute.Sitemap {
  // <loc> must be absolute — Next does not resolve sitemap URLs against metadataBase.
  return Array.from(new Set(ROUTES)).map((route) => ({
    url: new URL(route, SITE_URL).href,
    lastModified: new Date(),
  }));
}
