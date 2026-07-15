export type DocsLink = { href: string; label: string };
export type DocsGroup = { title: string; links: DocsLink[] };

export const DOCS_NAV: DocsGroup[] = [
  {
    title: 'Start here',
    links: [
      { href: '/docs', label: 'Welcome' },
      { href: '/docs/quickstart', label: 'Quickstart' },
    ],
  },
  {
    title: 'Editing',
    links: [
      { href: '/docs/text', label: 'Text' },
      { href: '/docs/bound-text', label: 'Bound text' },
      { href: '/docs/attributes', label: 'Attributes' },
      { href: '/docs/styles', label: 'Styles' },
    ],
  },
  {
    title: 'The toolbar',
    links: [
      { href: '/docs/toolbar', label: 'Controls & modes' },
    ],
  },
  {
    title: 'Reference',
    links: [
      { href: '/docs/what-works', label: 'What you can edit' },
    ],
  },
];

export const GITHUB = 'https://github.com/rishi-thak/nextcanvas';
