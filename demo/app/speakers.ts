// Data module for the bound-text editing demo. Exercises two write-back paths:
//  - `SPEAKERS.map(...)` rendering `{s.name}` / `{s.bio}` (positional-index
//    targeting into this array), and
//  - `siteConfig.title` (direct-object binding).
// Double-clicking those in the running demo rewrites the strings *here*.

export interface Speaker {
  name: string;
  role: string;
  bio: string;
}

export const SPEAKERS: Speaker[] = [
  {
    name: 'Ada Lovelace',
    role: 'Keynote',
    bio: 'Wrote the first algorithm intended for a machine.',
  },
  {
    name: 'Grace Hopper',
    role: 'Workshop',
    bio: 'Pioneered machine-independent programming languages.',
  },
];

export const siteConfig = {
  title: 'Speakers you should not miss',
};
