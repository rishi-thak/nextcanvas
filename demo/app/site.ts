// Single source for the deployed origin, used by metadataBase, robots, sitemap,
// OG tags, and /skill.md. Set NEXT_PUBLIC_SITE_URL once a custom domain is live;
// until then Vercel's own production URL is used, and localhost in dev.

const RAW =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000');

/**
 * Normalised so a stray character in the dashboard can't leak into output.
 * A trailing space really did ship once: `new URL(path, SITE_URL)` silently
 * tolerates it, so sitemap/robots/OG looked fine, but /skill.md interpolates the
 * value raw and printed `homepage: https://…com ` into its YAML frontmatter.
 * Trailing slashes are dropped too, so `${SITE_URL}/docs` can't become `…//docs`.
 */
export const SITE_URL = RAW.trim().replace(/\/+$/, '');
