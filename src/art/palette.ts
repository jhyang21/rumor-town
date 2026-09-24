/**
 * Shared colors for all Rumor Town art. Every sprite is a matrix of single-letter pixels; a palette
 * maps each letter to a hex color. `.` is always transparent and never appears in a palette.
 *
 * Two kinds of palette exist:
 * - PALETTE: the town palette (ground, trees, buildings, signals). Fixed.
 * - characterPalette(look): role letters (S skin, H hair, T shirt, P pants, ...) resolved from a
 *   character's `look` indices. Character matrices only use these role letters.
 */

export type Palette = Record<string, string>;

export const TRANSPARENT = '.';

export interface NamedColor {
  letter: string;
  name: string;
  hex: string;
}

/** The town palette, in display order. Outlines are dark brown, never black. */
export const TOWN_COLORS: readonly NamedColor[] = [
  { letter: 'O', name: 'outline', hex: '#3d2b1f' },
  // ground
  { letter: 'G', name: 'grass', hex: '#88bd5c' },
  { letter: 'g', name: 'grass dark', hex: '#6ea148' },
  { letter: 'l', name: 'grass light', hex: '#a8d277' },
  { letter: 'D', name: 'path', hex: '#dcbc8c' },
  { letter: 'd', name: 'path dark', hex: '#c49f6d' },
  { letter: 'y', name: 'path light', hex: '#ead3a8' },
  { letter: 'A', name: 'water', hex: '#63acd6' },
  { letter: 'a', name: 'water dark', hex: '#4588bb' },
  { letter: 'i', name: 'water light', hex: '#b9e4f3' },
  { letter: 'Q', name: 'stone', hex: '#cdc3ae' },
  { letter: 'q', name: 'stone dark', hex: '#a89c85' },
  { letter: 'u', name: 'stone light', hex: '#e6dfcf' },
  // plants
  { letter: 'V', name: 'leaf dark', hex: '#3e7a3c' },
  { letter: 'U', name: 'leaf', hex: '#59984a' },
  { letter: 'H', name: 'leaf light', hex: '#7fbd5d' },
  { letter: 'F', name: 'flower pink', hex: '#ee7f8f' },
  { letter: 'f', name: 'flower yellow', hex: '#f7d65c' },
  { letter: 'v', name: 'flower violet', hex: '#b58ad6' },
  // wood and metal
  { letter: 'T', name: 'wood', hex: '#a8744a' },
  { letter: 't', name: 'wood dark', hex: '#7c5233' },
  { letter: 'h', name: 'wood light', hex: '#cb9964' },
  { letter: 'Z', name: 'metal', hex: '#8c919a' },
  { letter: 'z', name: 'metal dark', hex: '#5f646d' },
  { letter: 'C', name: 'brass', hex: '#e2ab3a' },
  // roofs
  { letter: 'R', name: 'roof red', hex: '#cf6048' },
  { letter: 'r', name: 'roof red dark', hex: '#a2433a' },
  { letter: 'N', name: 'roof brown', hex: '#9c6b47' },
  { letter: 'n', name: 'roof brown dark', hex: '#744a30' },
  { letter: 'L', name: 'roof slate', hex: '#72839c' },
  { letter: 'm', name: 'roof slate dark', hex: '#536179' },
  { letter: 'M', name: 'roof green', hex: '#6a9c5a' },
  { letter: 'j', name: 'roof green dark', hex: '#4c7743' },
  // walls
  { letter: 'W', name: 'wall cream', hex: '#f4e4c1' },
  { letter: 'w', name: 'wall cream shade', hex: '#dcc69c' },
  { letter: 'K', name: 'brick', hex: '#bf6a4c' },
  { letter: 'k', name: 'brick dark', hex: '#94503a' },
  { letter: 'Y', name: 'wall yellow', hex: '#f3d57e' },
  { letter: 'x', name: 'wall yellow shade', hex: '#dcb65c' },
  { letter: 'b', name: 'wall blue', hex: '#a3c8e0' },
  { letter: 'B', name: 'wall blue shade', hex: '#80a8c6' },
  { letter: 'I', name: 'wall gray', hex: '#d3d8dd' },
  { letter: 'J', name: 'wall gray shade', hex: '#aab3bd' },
  // light
  { letter: 'E', name: 'window glow', hex: '#ffd98a' },
  { letter: 'e', name: 'window glow dark', hex: '#f0b25a' },
  { letter: 'X', name: 'white', hex: '#fbf6ea' },
];

export const PALETTE: Palette = Object.fromEntries(TOWN_COLORS.map((c) => [c.letter, c.hex]));

/* ---------- Character colors ---------- */

/** [base, shade] pairs. */
export type ColorPair = readonly [string, string];

export const SKIN_TONES: readonly ColorPair[] = [
  ['#f6d5b8', '#e3b594'],
  ['#e8b98f', '#cf9a70'],
  ['#c68a5e', '#a86f47'],
  ['#8d5a3b', '#744630'],
];

export const HAIR_COLORS: readonly ColorPair[] = [
  ['#5a3a28', '#3f281b'], // dark brown
  ['#2f2826', '#1d1816'], // black
  ['#a2482e', '#7c3421'], // auburn
  ['#e7c36a', '#c9a14a'], // blonde
  ['#d9773a', '#b55a26'], // ginger
  ['#c4bdb3', '#9a9289'], // gray
];

export const SHIRT_COLORS: readonly ColorPair[] = [
  ['#d9574a', '#b04238'], // red
  ['#eb9446', '#c7732e'], // orange
  ['#efcf5a', '#cfab3a'], // yellow
  ['#6fae5a', '#528d42'], // green
  ['#4fa5a0', '#3a8580'], // teal
  ['#5b86c9', '#4468a6'], // blue
  ['#9a6bc2', '#7a51a0'], // purple
  ['#ef9ab0', '#cf7690'], // pink
];

export const PANTS_COLORS: readonly ColorPair[] = [
  ['#4f6a9a', '#3b5078'], // denim
  ['#8a5f3f', '#6b462d'], // brown
  ['#55545c', '#3e3d44'], // charcoal
  ['#c9ae7c', '#a88d5d'], // khaki
];

export const HAIR_STYLES = ['short', 'long', 'bob', 'bun', 'spiky', 'cap'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/**
 * Valid ranges for Character.look. Any integer is accepted (values wrap), but the generator
 * should pick from 0..n-1 so every combination is reachable.
 * `hair` encodes style and color: style = hair % 6, color = floor(hair / 6) % 6.
 */
export const LOOK_RANGES = {
  hair: 36, // 6 styles x 6 colors
  skin: 4,
  shirt: 8,
  pants: 4,
} as const;

export interface Look {
  hair: number;
  skin: number;
  shirt: number;
  pants: number;
}

export function wrapIndex(n: number, count: number): number {
  const i = Math.trunc(n) % count;
  return i < 0 ? i + count : i;
}

export function hairStyleOf(look: Look): HairStyle {
  return HAIR_STYLES[wrapIndex(look.hair, HAIR_STYLES.length)];
}

export function hairColorIndexOf(look: Look): number {
  return Math.floor(wrapIndex(look.hair, LOOK_RANGES.hair) / HAIR_STYLES.length);
}

/** Fixed colors every character palette shares (outline, face, accessories). */
export const CHARACTER_FIXED: Palette = {
  O: '#3d2b1f', // outline
  E: '#2e2018', // eyes
  C: '#f2998a', // cheeks
  B: '#6b4a35', // shoes
  W: '#fbf6ea', // apron, collar, book pages
  w: '#ddd3bf', // apron shade
  A: '#e07a4f', // backpack
  a: '#b25a38', // backpack shade
  R: '#c8453c', // tie, hat band
  r: '#962f2a', // tie shade
  V: '#4f7d5a', // vest
  v: '#3b6146', // vest shade
  K: '#4a6fb0', // book cover
  k: '#35528a', // book cover shade
  Y: '#e2bd72', // straw hat
  y: '#bf9750', // straw hat shade
  G: '#9a6a3f', // shoulder bag
  g: '#74502d', // bag shade and strap
};

/**
 * Palette for a character matrix. Role letters:
 * S/s skin, H/h hair, T/t shirt, P/p pants, Q/q cap (a shirt color offset by 4 so caps contrast).
 */
export function characterPalette(look: Look): Palette {
  const skin = SKIN_TONES[wrapIndex(look.skin, SKIN_TONES.length)];
  const hair = HAIR_COLORS[hairColorIndexOf(look)];
  const shirtIndex = wrapIndex(look.shirt, SHIRT_COLORS.length);
  const shirt = SHIRT_COLORS[shirtIndex];
  const cap = SHIRT_COLORS[(shirtIndex + 4) % SHIRT_COLORS.length];
  const pants = PANTS_COLORS[wrapIndex(look.pants, PANTS_COLORS.length)];
  return {
    ...CHARACTER_FIXED,
    S: skin[0],
    s: skin[1],
    H: hair[0],
    h: hair[1],
    T: shirt[0],
    t: shirt[1],
    Q: cap[0],
    q: cap[1],
    P: pants[0],
    p: pants[1],
  };
}
