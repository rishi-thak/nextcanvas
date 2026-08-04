import * as fs from 'fs';
import * as path from 'path';

/**
 * Tailwind support for the style panel.
 *
 * The panel offers six properties (colour, background, font size, weight,
 * align, padding). In a Tailwind project, writing those as an inline
 * `style={{...}}` object produces diffs a team is unlikely to merge, so this
 * module maps each one to a utility class instead and — crucially — works out
 * which *existing* classes on the element already control that property so they
 * can be removed first.
 *
 * That removal is the whole difficulty. Tailwind's `text-` prefix is used by
 * three different properties: `text-center` (align), `text-lg` (font size) and
 * `text-red-500` (colour). Adding a colour without stripping the old one leaves
 * two competing classes whose winner is decided by their order in Tailwind's
 * generated stylesheet, not by the order in `className` — so the edit would
 * appear to do nothing at random. `classControls()` disambiguates by suffix.
 */

/** CSS font-weight value -> Tailwind suffix. */
const WEIGHTS: Record<string, string> = {
  '100': 'thin',
  '200': 'extralight',
  '300': 'light',
  '400': 'normal',
  '500': 'medium',
  '600': 'semibold',
  '700': 'bold',
  '800': 'extrabold',
  '900': 'black',
  normal: 'normal',
  bold: 'bold',
  lighter: 'light',
  bolder: 'extrabold',
};

const WEIGHT_SUFFIXES = new Set(Object.values(WEIGHTS));
const ALIGN_SUFFIXES = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);
const SIZE_SUFFIXES = new Set([
  'xs', 'sm', 'base', 'lg', 'xl',
  '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
]);
/** `font-sans` is a family, not a weight — it must not be stripped as one. */
const FAMILY_SUFFIXES = new Set(['sans', 'serif', 'mono']);

/**
 * `bg-` utilities that are NOT background-color. Anything else after `bg-` is
 * treated as a colour, which is the right default: palette names are open-ended
 * (`bg-brand`, `bg-surface-2`) while these keywords are a closed set.
 */
const NON_COLOR_BG = new Set([
  'none', 'cover', 'contain', 'auto', 'center', 'top', 'bottom', 'left', 'right',
  'repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'repeat-round', 'repeat-space',
  'fixed', 'local', 'scroll', 'clip', 'origin', 'blend', 'gradient',
]);

/** Every padding utility, including the per-side and logical ones. */
const PADDING_RE = /^-?p[xytrbles]?-/;

const COLOR_FN_RE = /^(rgba?|hsla?|oklch|oklab|lab|lch|color|color-mix)\(/i;
const COLOR_KEYWORDS = new Set([
  'transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert',
  'white', 'black', 'red', 'green', 'blue', 'gray', 'grey',
]);
const LENGTH_RE = /^-?[\d.]+(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|pc|in|cm|mm|q)?$/i;
const LENGTH_FN_RE = /^(calc|clamp|min|max|var)\(/i;

function looksLikeColor(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (s.startsWith('#')) return true;
  if (COLOR_FN_RE.test(s)) return true;
  return COLOR_KEYWORDS.has(s.toLowerCase());
}

function looksLikeLength(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  return LENGTH_RE.test(s) || LENGTH_FN_RE.test(s);
}

/**
 * Tailwind arbitrary values cannot contain spaces — the documented escape is an
 * underscore, which Tailwind converts back to a space when generating the CSS.
 */
export function arbitrary(value: string): string {
  return value.trim().replace(/\s+/g, '_');
}

/** Strip the `!` important marker so classification sees the bare utility. */
function bare(token: string): string {
  return token.replace(/^!/, '').replace(/!$/, '');
}

/** Content of an arbitrary utility (`text-[#fff]` -> `#fff`), else null. */
function arbitraryContent(token: string, prefix: string): string | null {
  if (!token.startsWith(prefix + '-[') || !token.endsWith(']')) return null;
  return token.slice(prefix.length + 2, -1);
}

/**
 * Does `token` (one class from `className`) set `property`?
 *
 * Tokens carrying a variant (`hover:`, `md:`, `dark:`) are always reported as
 * NOT controlling the property. They apply conditionally, so removing
 * `hover:text-red-500` because someone set a base colour would silently delete
 * an interaction state the author wrote on purpose.
 */
export function classControls(token: string, property: string): boolean {
  if (!token) return false;
  // A variant is separated by a colon *before* the arbitrary-value bracket.
  // Arbitrary values legitimately contain colons — Tailwind's own type hints
  // (`text-[length:2rem]`, `text-[color:var(--x)]`) and any `url(data:...)` —
  // so testing the whole token would misread those as variants and skip them.
  const head = token.includes('[') ? token.slice(0, token.indexOf('[')) : token;
  if (head.includes(':')) return false;
  const t = bare(token);

  switch (property) {
    case 'padding':
      return PADDING_RE.test(t);

    case 'backgroundColor': {
      if (!t.startsWith('bg-')) return false;
      const arb = arbitraryContent(t, 'bg');
      if (arb !== null) return !arb.startsWith('length:') && !arb.startsWith('position:');
      const suffix = t.slice(3);
      // Match the whole suffix as well as its first segment: the set holds both
      // single words (`cover`) and hyphenated ones (`no-repeat`), and splitting
      // alone would read `bg-no-repeat` as the colour "no".
      return !(NON_COLOR_BG.has(suffix) || NON_COLOR_BG.has(suffix.split('-')[0]));
    }

    case 'fontWeight': {
      if (!t.startsWith('font-')) return false;
      const arb = arbitraryContent(t, 'font');
      if (arb !== null) return /^\d+$/.test(arb.trim());
      const suffix = t.slice(5);
      if (FAMILY_SUFFIXES.has(suffix)) return false;
      return WEIGHT_SUFFIXES.has(suffix);
    }

    case 'textAlign': {
      if (!t.startsWith('text-')) return false;
      return ALIGN_SUFFIXES.has(t.slice(5));
    }

    case 'fontSize': {
      if (!t.startsWith('text-')) return false;
      const arb = arbitraryContent(t, 'text');
      if (arb !== null) {
        if (arb.startsWith('length:')) return true;
        if (arb.startsWith('color:')) return false;
        return looksLikeLength(arb);
      }
      const suffix = t.slice(5);
      // `text-lg/7` sets size and line-height together.
      return SIZE_SUFFIXES.has(suffix.split('/')[0]);
    }

    case 'color': {
      if (!t.startsWith('text-')) return false;
      const arb = arbitraryContent(t, 'text');
      if (arb !== null) {
        if (arb.startsWith('color:')) return true;
        if (arb.startsWith('length:')) return false;
        return looksLikeColor(arb) || !looksLikeLength(arb);
      }
      const suffix = t.slice(5);
      if (ALIGN_SUFFIXES.has(suffix)) return false;
      if (SIZE_SUFFIXES.has(suffix.split('/')[0])) return false;
      // Anything left is a palette entry: `red-500`, `brand`, `surface-2`.
      return true;
    }

    default:
      return false;
  }
}

/**
 * The Tailwind class for `property: value`, or null when the property isn't one
 * the panel maps.
 *
 * Enumerated properties (weight, align) get their named utility. The continuous
 * ones (colour, size, padding) get an arbitrary value rather than being snapped
 * to the default scale: `p-4` is only 16px under the *default* theme, and a
 * project that customised its spacing or palette would silently get a different
 * value than the one picked in the panel.
 */
export function toClass(property: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;

  switch (property) {
    case 'color':
      return `text-[${arbitrary(v)}]`;
    case 'backgroundColor':
      return `bg-[${arbitrary(v)}]`;
    case 'fontSize':
      return `text-[${arbitrary(v)}]`;
    case 'padding':
      return `p-[${arbitrary(v)}]`;
    case 'fontWeight': {
      const named = WEIGHTS[v];
      return named ? `font-${named}` : `font-[${arbitrary(v)}]`;
    }
    case 'textAlign':
      return ALIGN_SUFFIXES.has(v) ? `text-${v}` : null;
    default:
      return null;
  }
}

/** True when the style panel can express `property` as a Tailwind class. */
export function isMappable(property: string): boolean {
  return (
    property === 'color' ||
    property === 'backgroundColor' ||
    property === 'fontSize' ||
    property === 'padding' ||
    property === 'fontWeight' ||
    property === 'textAlign'
  );
}

/**
 * Rewrite a class list: drop everything already controlling `property`, then
 * append the new class (omitted when `value` is empty, which is a removal).
 * Order is otherwise preserved so the diff stays small.
 */
export function rewriteClassList(
  classList: string,
  property: string,
  value: string
): string {
  const kept = classList
    .split(/\s+/)
    .filter((t) => t && !classControls(t, property));
  const next = value.trim() ? toClass(property, value) : null;
  if (next) kept.push(next);
  return kept.join(' ');
}

const tailwindCache = new Map<string, boolean>();

/**
 * Does the project owning `fromFile` use Tailwind?
 *
 * Walks up for a package.json and looks for `tailwindcss` in either dependency
 * map, or a `tailwind.config.*` alongside it. Both are checked because v4 is
 * config-optional (theme lives in CSS), so config-file presence alone would
 * miss v4 projects and dependency presence alone would miss a vendored setup.
 *
 * Memoised per directory: this runs on every style keystroke.
 */
export function usesTailwind(fromFile: string): boolean {
  let dir = path.dirname(path.resolve(fromFile));

  const chain: string[] = [];
  for (let i = 0; i < 40; i++) {
    const hit = tailwindCache.get(dir);
    if (hit !== undefined) {
      for (const d of chain) tailwindCache.set(d, hit);
      return hit;
    }
    chain.push(dir);

    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      let found = false;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        found = Boolean(
          pkg.dependencies?.['tailwindcss'] || pkg.devDependencies?.['tailwindcss']
        );
      } catch {
        found = false;
      }
      if (!found) {
        found = ['js', 'cjs', 'mjs', 'ts'].some((ext) =>
          fs.existsSync(path.join(dir, `tailwind.config.${ext}`))
        );
      }
      for (const d of chain) tailwindCache.set(d, found);
      return found;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const d of chain) tailwindCache.set(d, false);
  return false;
}

/** Test seam — the cache is process-lifetime and would leak between cases. */
export function resetTailwindCache(): void {
  tailwindCache.clear();
}
