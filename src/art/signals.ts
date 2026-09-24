/**
 * Small 10x10 badges shown over a character's head, and a speech-bubble 9-slice.
 * All use the town PALETTE.
 */
import { type PixelMatrix, fillRectG, fromGrid, mirrorX, mirrorY, newGrid, stampG } from './matrix';

export type SignalKind = 'heard' | 'doubts' | 'correction' | 'thinking';

export const SIGNAL_SIZE = 10;

export const SIGNALS: Record<SignalKind, PixelMatrix> = {
  /** "!" on warm yellow */
  heard: [
    '..OOOOOO..',
    '.OffffffO.',
    'OfffOOfffO',
    'OfffOOfffO',
    'OfffOOfffO',
    'OfffOOfffO',
    'OffffffffO',
    'OfffOOfffO',
    '.OCCCCCCO.',
    '..OOOOOO..',
  ],
  /** "?" on soft blue */
  doubts: [
    '..OOOOOO..',
    '.ObbbbbbO.',
    'ObbbOObbbO',
    'ObbObbObbO',
    'ObbbbbObbO',
    'ObbbbObbbO',
    'ObbbbbbbbO',
    'ObbbbObbbO',
    '.OBBBBBBO.',
    '..OOOOOO..',
  ],
  /** check mark on green */
  correction: [
    '..OOOOOO..',
    '.OUUUUUUO.',
    'OUUUUUUXUO',
    'OUUUUUXXUO',
    'OUXUUXXUUO',
    'OUXXXXUUUO',
    'OUUXXUUUUO',
    'OUUUUUUUUO',
    '.OVVVVVVO.',
    '..OOOOOO..',
  ],
  /** three dots on white */
  thinking: [
    '..OOOOOO..',
    '.OXXXXXXO.',
    'OXXXXXXXXO',
    'OXXXXXXXXO',
    'OXOXOOXOXO',
    'OXXXXXXXXO',
    'OXXXXXXXXO',
    'OXXXXXXXXO',
    '.OuuuuuuO.',
    '..OOOOOO..',
  ],
};

/** 9-slice pieces for a speech bubble. Corners are 4x4; edges are 1 pixel long; fill is 1x1. */
const CORNER_TL: PixelMatrix = ['..OO', '.OXX', 'OXXX', 'OXXX'];
const CORNER_BL: PixelMatrix = ['OXXX', 'OuXX', '.Ouu', '..OO'];

export interface BubbleParts {
  cornerTL: PixelMatrix;
  cornerTR: PixelMatrix;
  cornerBL: PixelMatrix;
  cornerBR: PixelMatrix;
  edgeTop: PixelMatrix;
  edgeBottom: PixelMatrix;
  edgeLeft: PixelMatrix;
  edgeRight: PixelMatrix;
  fill: PixelMatrix;
  tail: PixelMatrix;
  corner: number;
}

export const BUBBLE: BubbleParts = {
  cornerTL: CORNER_TL,
  cornerTR: mirrorX(CORNER_TL),
  cornerBL: CORNER_BL,
  cornerBR: mirrorX(CORNER_BL),
  /** 1 wide x 4 tall */
  edgeTop: ['O', 'X', 'X', 'X'],
  edgeBottom: ['X', 'X', 'u', 'O'],
  /** 4 wide x 1 tall */
  edgeLeft: ['OXXX'],
  edgeRight: ['XXXO'],
  fill: ['X'],
  /** 5x3 tail; stamp it with its top row on the bubble's bottom outline row. */
  tail: ['OuuuO', '.OuO.', '..O..'],
  corner: 4,
};

/** Tail pointing up, for a bubble drawn below its speaker. */
export const BUBBLE_TAIL_UP: PixelMatrix = mirrorY(BUBBLE.tail);

/**
 * A whole bubble of w x h pixels (min 9x9) plus a 3-row tail under it at column tailX
 * (defaults to the left third). Result is w x (h + 2).
 */
export function composeBubble(w: number, h: number, tailX?: number): PixelMatrix {
  const W = Math.max(9, Math.floor(w));
  const H = Math.max(9, Math.floor(h));
  const g = newGrid(W, H + 2);
  fillRectG(g, 1, 1, W - 2, H - 2, 'X');
  for (let x = 4; x < W - 4; x++) {
    stampG(g, BUBBLE.edgeTop, x, 0);
    stampG(g, BUBBLE.edgeBottom, x, H - 4);
  }
  for (let y = 4; y < H - 4; y++) {
    stampG(g, BUBBLE.edgeLeft, 0, y);
    stampG(g, BUBBLE.edgeRight, W - 4, y);
  }
  stampG(g, BUBBLE.cornerTL, 0, 0);
  stampG(g, BUBBLE.cornerTR, W - 4, 0);
  stampG(g, BUBBLE.cornerBL, 0, H - 4);
  stampG(g, BUBBLE.cornerBR, W - 4, H - 4);
  const tx = Math.min(W - 9, Math.max(4, tailX ?? Math.floor(W / 3) - 2));
  stampG(g, BUBBLE.tail, tx, H - 1);
  return fromGrid(g);
}
