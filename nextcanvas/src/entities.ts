/**
 * HTML/JSX entity handling for text write-back.
 *
 * The browser hands the overlay an element's *decoded* `textContent`
 * ("Tom & Jerry", "we — you"), while the JSX source holds the *encoded* form
 * (`Tom &amp; Jerry`, `we &mdash; you`). Without reconciling the two, any copy
 * containing an entity — extremely common: `&amp;`, `&mdash;`, `&rsquo;`,
 * `&nbsp;`, `&hellip;` — looked editable (it is stamped) but every commit
 * bounced with "could not find static text". That is exactly the dishonest
 * affordance we must not ship.
 *
 * Two directions:
 *   - `decodeEntities` turns source text into the decoded form so it can be
 *     compared against what the browser sent (matching).
 *   - `encodeJsxText` escapes the characters that are special in JSX text
 *     (`& < > { }`) when writing a user's new value back, so the result stays
 *     valid JSX and round-trips (decode(encode(x)) === x for these).
 */

/**
 * The named entities that actually turn up in prose. Not the full HTML5 table
 * (~2000 entries) — that would be dead weight for a dev tool. Numeric entities
 * (`&#8212;`, `&#x2014;`) are handled generically, so anything missing here is
 * still decoded when written numerically.
 */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  // dashes, ellipsis
  mdash: '—',
  ndash: '–',
  minus: '−',
  hellip: '…',
  // quotes
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  // symbols
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sect: '§',
  para: '¶',
  middot: '·',
  bull: '•',
  dagger: '†',
  Dagger: '‡',
  prime: '′',
  Prime: '″',
  permil: '‰',
  // currency
  cent: '¢',
  pound: '£',
  curren: '¤',
  yen: '¥',
  euro: '€',
  // arrows / math
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  infin: '∞',
  ne: '≠',
  le: '≤',
  ge: '≥',
  // spaces
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '­',
};

/** Decode a single `&…;` body (without the ampersand/semicolon). */
function decodeOne(body: string): string | null {
  if (body[0] === '#') {
    const isHex = body[1] === 'x' || body[1] === 'X';
    const digits = isHex ? body.slice(2) : body.slice(1);
    if (!digits) return null;
    const code = parseInt(digits, isHex ? 16 : 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
    try {
      return String.fromCodePoint(code);
    } catch {
      return null;
    }
  }
  return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : null;
}

/**
 * Decode the HTML entities in `text`. Unknown entities are left verbatim (a
 * `&foo;` that isn't a real entity would render literally in the browser too),
 * so decoding is lossless for anything it doesn't recognise.
 */
export function decodeEntities(text: string): string {
  if (text.indexOf('&') === -1) return text;
  // Entity bodies: a name, or `#123` / `#x1F`. Bounded so a stray `&` in prose
  // ("A & B") doesn't swallow the rest of the string.
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{0,31});/g, (whole, body) => {
    const decoded = decodeOne(body);
    return decoded == null ? whole : decoded;
  });
}

/**
 * Escape the five characters that are special in JSX text so a user's typed
 * value writes back as valid JSX. `{` and `}` have no portable named entity, so
 * they use numeric references. Everything else (accented letters, em-dashes the
 * user typed directly) is valid in a JSX text node as-is.
 */
export function encodeJsxText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

/**
 * Escape a value for a **double-quoted** JSX attribute string literal
 * (`href="…"`). JSX attribute strings take no backslash escapes, so a `"` must
 * become `&quot;` — writing `href="a\"b"` (what `JSON.stringify` would give)
 * produces invalid JSX. `&`, `<`, `>` are encoded too so the result always
 * parses; the browser decodes them back via `getAttribute`, so it round-trips.
 */
export function encodeJsxAttrValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
