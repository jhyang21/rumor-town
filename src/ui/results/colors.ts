/**
 * Colors for the results views, drawn from the warm town palette (src/art/palette.ts).
 * The results card keeps its own cream surface in light and dark mode, so one set of steps serves both.
 * Series hues were checked with the dataviz palette validator against the cream surface (all checks pass).
 */
import { PALETTE } from '@/art/palette';
import type { SeriesKey } from './chartScale';
import type { SplitKey } from './format';

export const INK = {
  surface: '#fbf6ea',
  raised: '#fffdf7',
  line: '#e6dac1',
  grid: '#ece2cc',
  text: '#3d2b1f',
  muted: '#6f5a48',
  accent: '#a2433a',
  accentText: '#fbf6ea',
} as const;

export const SERIES: Record<SeriesKey, { color: string; label: string }> = {
  heard: { color: '#3f7fb5', label: 'Heard it' },
  believing: { color: '#d0672c', label: 'Believe it' },
  shared: { color: '#8a5cb8', label: 'Told someone' },
};

/** Diverging: cool = does not believe, warm = believes, gray midpoint = unsure. */
export const SPLIT_COLORS: Record<SplitKey, string> = {
  believe: '#e08a4a',
  unsure: '#a39a8c',
  reject: '#2f5f8f',
  unheard: '#e2d8c4',
};

export const MAP_COLORS = {
  grass: PALETTE.G,
  grassDark: PALETTE.g,
  trees: PALETTE.V,
  park: PALETTE.l,
  square: PALETTE.u,
  outline: PALETTE.O,
  home: [PALETTE.R, PALETTE.N, PALETTE.L, PALETTE.M] as const,
  cafe: PALETTE.K,
  store: PALETTE.Y,
  office: PALETTE.I,
  school: PALETTE.b,
  fountain: PALETTE.A,
} as const;
