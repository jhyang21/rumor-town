/**
 * Ground tiles and props, 16x16 unless noted. All use the town PALETTE.
 * Props (tree, bush, bench, lamp, sign, flower bed, fountain) have transparent backgrounds;
 * draw a ground tile under them first.
 */
import {
  type PixelMatrix,
  blank,
  fromGrid,
  mirrorX,
  newGrid,
  pixelText,
  rotateCW,
  setPx,
  shadedEllipse,
  stamp,
  stampG,
  toGrid,
} from './matrix';

export const TILE = 16;

const TUFT: PixelMatrix = ['g.g', '.g.'];
const TUFT_LIGHT: PixelMatrix = ['l.l', '.l.'];
const FLOWER_PINK: PixelMatrix = ['.F.', 'FfF', '.F.'];
const FLOWER_YELLOW: PixelMatrix = ['.f.', 'fCf', '.f.'];
const FLOWER_VIOLET: PixelMatrix = ['.v.', 'vXv', '.v.'];

function field(ch: string): PixelMatrix {
  return blank(TILE, TILE, ch);
}

function place(base: PixelMatrix, parts: Array<[PixelMatrix, number, number]>): PixelMatrix {
  return parts.reduce((m, [p, x, y]) => stamp(m, p, x, y), base);
}

/* ---------- Ground ---------- */

export const GRASS_0 = place(field('G'), [
  [TUFT, 3, 4],
  [TUFT, 11, 10],
  [TUFT_LIGHT, 9, 2],
]);

export const GRASS_1 = place(field('G'), [
  [TUFT, 10, 3],
  [TUFT, 12, 12],
  [FLOWER_PINK, 3, 9],
]);

export const GRASS_2 = place(field('G'), [
  [TUFT, 5, 7],
  [TUFT_LIGHT, 1, 13],
  [FLOWER_YELLOW, 11, 10],
  [TUFT, 12, 2],
]);

export const PATH = place(field('D'), [
  [['yd'], 3, 4],
  [['yd'], 11, 9],
  [['yd'], 6, 13],
  [['d'], 13, 2],
  [['d'], 1, 10],
]);

/** Path with a grass lip along the top edge. E, S, W are rotations. */
export const PATH_EDGE_N = place(PATH, [
  [
    [
      'GGGGGGGGGGGGGGGG',
      'GGGGGGGGGGGGGGGG',
      'ggGGggggggGGgggg',
      '..gg......gg....',
    ],
    0,
    0,
  ],
]);
export const PATH_EDGE_E = rotateCW(PATH_EDGE_N);
export const PATH_EDGE_S = rotateCW(PATH_EDGE_E);
export const PATH_EDGE_W = rotateCW(PATH_EDGE_S);

function water(shift: number): PixelMatrix {
  const g = toGrid(field('A'));
  const waves: Array<[number, number]> = [
    [2, 3],
    [9, 6],
    [4, 10],
    [12, 13],
  ];
  for (const [wx, wy] of waves) {
    for (let i = 0; i < 3; i++) {
      setPx(g, (wx + shift + i) % TILE, wy, 'i');
      setPx(g, (wx + shift + i + 1) % TILE, wy + 1, 'a');
    }
  }
  return fromGrid(g);
}

export const WATER_0 = water(0);
export const WATER_1 = water(2);

/** Stone plaza: two courses of 8-pixel stones, the lower course offset by 4. */
export const STONE: PixelMatrix = (() => {
  const g = newGrid(TILE, TILE, 'Q');
  for (let y = 0; y < TILE; y++) {
    const course = y < 8 ? 0 : 1;
    const yIn = y % 8;
    for (let x = 0; x < TILE; x++) {
      const xIn = (x + course * 4) % 8;
      if (yIn === 7 || xIn === 7) g[y][x] = 'q';
      else if (yIn === 0 || xIn === 0) g[y][x] = 'u';
    }
  }
  return fromGrid(g);
})();

/** Small mat and step for a door tile whose house lies below it (rear-facing homes). */
export const DOORSTEP: PixelMatrix = place(blank(TILE, TILE), [
  [
    [
      '..OOOOOOOOOO..',
      '..OFFFFFFFFO..',
      '..OFFFFFFFFO..',
      '..OOOOOOOOOO..',
      '.OuuuuuuuuuuO.',
      '.OqqqqqqqqqqO.',
    ],
    1,
    10,
  ],
]);

/* ---------- Plants ---------- */

function leafShade(nx: number, ny: number): string {
  if (nx * 0.55 + ny * 0.85 > 0.45) return 'V';
  const lx = nx + 0.35;
  const ly = ny + 0.4;
  if (lx * lx + ly * ly < 0.18) return 'H';
  return 'U';
}

export const TREE: PixelMatrix = (() => {
  const canopy = shadedEllipse(TILE, 13, 8, 6.5, 7.6, 6.4, 'O', leafShade);
  let m = stamp(blank(TILE, TILE), ['.OTtO.', '.OTtO.', 'OtTttO', 'OOOOOO'], 5, 12);
  m = stamp(m, ['OTtO', 'OTtO'], 6, 10);
  m = stamp(m, canopy, 0, 0);
  // leaf clumps
  m = stamp(m, ['V.', '.V'], 4, 7);
  m = stamp(m, ['.V', 'V.'], 9, 4);
  m = stamp(m, ['VV'], 6, 10);
  return m;
})();

export const BUSH: PixelMatrix = (() => {
  const blob = shadedEllipse(14, 10, 7, 5, 7, 5, 'O', leafShade);
  let m = stamp(blank(TILE, TILE), blob, 1, 5);
  m = stamp(m, ['F'], 4, 9);
  m = stamp(m, ['F'], 10, 8);
  m = stamp(m, ['F'], 8, 12);
  return m;
})();

export const FLOWER_BED: PixelMatrix = (() => {
  let m = stamp(blank(TILE, TILE), [
    '.OOOOOOOOOOOOOO.',
    'OhhhhhhhhhhhhhhO',
    'OtnnnnnnnnnnnntO',
    'OtnnnnnnnnnnnntO',
    'OtnnnnnnnnnnnntO',
    'OtnnnnnnnnnnnntO',
    'OtnnnnnnnnnnnntO',
    'OTTTTTTTTTTTTTTO',
    '.OOOOOOOOOOOOOO.',
  ], 0, 6);
  const flowers: Array<[PixelMatrix, number, number]> = [
    [FLOWER_PINK, 1, 4],
    [FLOWER_YELLOW, 5, 3],
    [FLOWER_VIOLET, 9, 4],
    [FLOWER_PINK, 12, 3],
    [FLOWER_YELLOW, 3, 8],
    [FLOWER_PINK, 7, 8],
    [FLOWER_VIOLET, 11, 8],
  ];
  for (const [f, x, y] of flowers) {
    m = stamp(m, ['U'], x + 1, y + 3);
    m = stamp(m, f, x, y);
  }
  return m;
})();

/* ---------- Props ---------- */

export const BENCH: PixelMatrix = [
  '................',
  '................',
  '................',
  '................',
  '.OOOOOOOOOOOOOO.',
  '.OhhhhhhhhhhhhO.',
  '.OTTTTTTTTTTTTO.',
  '.OOOOOOOOOOOOOO.',
  '..OtO......OtO..',
  'OOOOOOOOOOOOOOOO',
  'OhhhhhhhhhhhhhhO',
  'OTTTTTTTTTTTTTTO',
  'OOOOOOOOOOOOOOOO',
  '.OzO........OzO.',
  '.OzO........OzO.',
  '.OOO........OOO.',
];

export const LAMP_POST: PixelMatrix = [
  '......OOOO......',
  '.....OzzzzO.....',
  '.....OEEEEO.....',
  '.....OEffEO.....',
  '.....OEEEEO.....',
  '......OzzO......',
  '......OZzO......',
  '......OZzO......',
  '......OZzO......',
  '......OZzO......',
  '......OZzO......',
  '......OZzO......',
  '......OZzO......',
  '......OZzO......',
  '.....OzzzzO.....',
  '.....OOOOOO.....',
];

/** 32x16 wooden sign reading PARK. */
export const PARK_SIGN: PixelMatrix = (() => {
  const g = newGrid(32, 16);
  const board = [
    '.OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.',
    'OhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhO',
    'OhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhO',
    'OhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhO',
    'OhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhO',
    'OhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhO',
    'OhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhO',
    'OhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhO',
    'OTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTO',
    '.OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.',
  ];
  stampG(g, board, 0, 1);
  stampG(g, pixelText('PARK', 't'), 3, 3);
  // little tree icon at the right
  stampG(g, ['.UU.', 'UHUU', 'UUUV', '.tt.'], 21, 3);
  stampG(g, ['.H.', 'HUU', '.t.'], 26, 4);
  for (const px of [4, 26]) stampG(g, ['OtO', 'OtO', 'OtO', 'OtO', 'OOO'], px, 11);
  return fromGrid(g);
})();

/* ---------- Fountain (32x32, 2 frames) ---------- */

function fountain(frame: 0 | 1): PixelMatrix {
  const S = 32;
  const cx = 16;
  const cy = 18;
  const g = newGrid(S, S);
  const inE = (x: number, y: number, rx: number, ry: number, ecy = cy) => {
    const nx = (x + 0.5 - cx) / rx;
    const ny = (y + 0.5 - ecy) / ry;
    return nx * nx + ny * ny <= 1;
  };
  const RX = 15.5;
  const RY = 9.5;
  const WALL = 4; // front wall height
  // front wall: lower half of outer ellipse, dropped by WALL rows
  for (let x = 0; x < S; x++)
    for (let y = 0; y < S; y++) {
      if (inE(x, y - WALL, RX, RY) && y + 0.5 >= cy) {
        g[y][x] = inE(x, y + 1 - WALL, RX, RY) ? (y - cy > WALL + 5 ? 'q' : 'Q') : 'O';
      }
    }
  for (let x = 0; x < S; x++)
    for (let y = 0; y < S; y++) {
      if (!inE(x, y, RX, RY)) continue;
      const edge = !inE(x - 1, y, RX, RY) || !inE(x + 1, y, RX, RY) || !inE(x, y - 1, RX, RY);
      if (edge) g[y][x] = 'O';
      else if (inE(x, y, 12.5, 6.8)) {
        const innerEdge = !inE(x, y - 1, 12.5, 6.8) || !inE(x - 1, y, 12.5, 6.8) || !inE(x + 1, y, 12.5, 6.8);
        g[y][x] = innerEdge ? 'q' : 'A';
      } else g[y][x] = y < cy ? 'u' : 'Q';
    }
  // ripple ring
  const ringR = frame === 0 ? 5.5 : 8.5;
  for (let x = 0; x < S; x++)
    for (let y = 0; y < S; y++) {
      if (g[y][x] !== 'A') continue;
      const nx = (x + 0.5 - cx) / ringR;
      const ny = (y + 0.5 - cy) / (ringR * 0.55);
      const d = Math.sqrt(nx * nx + ny * ny);
      if (Math.abs(d - 1) < 0.12) g[y][x] = 'i';
      else if (y > cy + 3 && g[y][x] === 'A' && ((x + frame * 3) % 9 === 0)) g[y][x] = 'a';
    }
  // pillar
  stampG(g, ['OuQqO', 'OuQqO', 'OuQqO', 'OuQqO', 'OuQqO', 'OuQqO', 'OuQqO', 'OuQqO', 'OOOOO'], 14, 10);
  // top bowl
  stampG(g, ['..OOOOOOOOO..', '.OuuAAAAAuuO.', 'OuQQQQQQQQQqO', '.OOqqqqqqqOO.'], 10, 7);
  // jet
  const jet: PixelMatrix =
    frame === 0
      ? [
          '......i......',
          '....i.i.i....',
          '...i..i..i...',
          '..i...i...i..',
          '.i....i....i.',
          '......i......',
        ]
      : [
          '.....i.i.....',
          '...i..i..i...',
          '..i...i...i..',
          '.i....i....i.',
          '......i......',
          'i.....i.....i',
        ];
  stampG(g, jet, 10, 1);
  return fromGrid(g);
}

export const FOUNTAIN_0 = fountain(0);
export const FOUNTAIN_1 = fountain(1);

/* ---------- Registry ---------- */

export const TILES = {
  grass0: GRASS_0,
  grass1: GRASS_1,
  grass2: GRASS_2,
  path: PATH,
  pathEdgeN: PATH_EDGE_N,
  pathEdgeE: PATH_EDGE_E,
  pathEdgeS: PATH_EDGE_S,
  pathEdgeW: PATH_EDGE_W,
  water0: WATER_0,
  water1: WATER_1,
  stone: STONE,
  doorstep: DOORSTEP,
  tree: TREE,
  treeFlipped: mirrorX(TREE),
  bush: BUSH,
  flowerBed: FLOWER_BED,
  bench: BENCH,
  lampPost: LAMP_POST,
  parkSign: PARK_SIGN,
  fountain0: FOUNTAIN_0,
  fountain1: FOUNTAIN_1,
} as const satisfies Record<string, PixelMatrix>;

export type TileName = keyof typeof TILES;

export const GRASS_VARIANTS: readonly PixelMatrix[] = [GRASS_0, GRASS_1, GRASS_2];
export const WATER_FRAMES: readonly PixelMatrix[] = [WATER_0, WATER_1];
export const FOUNTAIN_FRAMES: readonly PixelMatrix[] = [FOUNTAIN_0, FOUNTAIN_1];

/** Stable grass variant for a map tile (mostly plain grass, some tufts and flowers). */
export function grassVariantAt(x: number, y: number): number {
  const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  const r = h % 10;
  return r < 6 ? 0 : r < 8 ? 1 : 2;
}
