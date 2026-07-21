// Single source for the deployed origin, used by metadataBase, robots, and OG
// tags. Set NEXT_PUBLIC_SITE_URL once a custom domain is live; until then
// Vercel's own production URL is used, and localhost in dev.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000');
