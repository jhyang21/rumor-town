/**
 * 16x16 layered characters. Matrices use role letters; color them with characterPalette(look).
 *
 * Layers, bottom to top: body (skin, face, torso in shirt colors), legs (pants and shoes, per walk
 * frame), hair (6 styles), accessory (by occupation).
 * Facings down, up and right are authored; left = mirrorX(right).
 * Walk cycle frames: 0 stand, 1 step A, 2 step B. Play as 0,1,0,2. Frames differ only in LEG_ROWS.
 */
import type { Facing, Occupation } from '../sim/types';
import { type PixelMatrix, blank, keepRows, mirrorX, overrideRows, resize, stack } from './matrix';
import { type HairStyle, type Look, type Palette, characterPalette, hairStyleOf } from './palette';

export const CHAR_SIZE = 16;
/** First row of the leg block; walk frames only change rows LEG_ROW..15. */
export const LEG_ROW = 12;
export type WalkFrame = 0 | 1 | 2;
export const WALK_FRAMES: readonly WalkFrame[] = [0, 1, 2];
/** Suggested playback order for walking. */
export const WALK_CYCLE: readonly WalkFrame[] = [0, 1, 0, 2];

type AuthoredFacing = 'down' | 'up' | 'right';

function pad(rows: string[]): PixelMatrix {
  return resize(rows, CHAR_SIZE, CHAR_SIZE);
}

/* ---------- Body ---------- */

const BODY: Record<AuthoredFacing, PixelMatrix> = {
  down: pad([
    '................',
    '.....OOOOOO.....',
    '....OSSSSSSO....',
    '...OSSSSSSSSO...',
    '...OSSSSSSSSO...',
    '...OSSSSSSSSO...',
    '...OSESSSSESO...',
    '...OCSSSSSSCO...',
    '....OsSSSSsO....',
    '....OTTTTTTO....',
    '...OtTTTTTTtO...',
    '...OStTTTTtSO...',
  ]),
  up: pad([
    '................',
    '.....OOOOOO.....',
    '....OSSSSSSO....',
    '...OSSSSSSSSO...',
    '...OSSSSSSSSO...',
    '...OSSSSSSSSO...',
    '...OSSSSSSSSO...',
    '...OsSSSSSSsO...',
    '....OsSSSSsO....',
    '....OTTTTTTO....',
    '...OtTTTTTTtO...',
    '...OStTTTTtSO...',
  ]),
  right: pad([
    '................',
    '.....OOOOOO.....',
    '....OSSSSSSO....',
    '...OSSSSSSSSO...',
    '...OSSSSSSSSO...',
    '...OSSSSSSSSO...',
    '...OSSSSSSESO...',
    '...OsSSSSCSSO...',
    '....OsSSSSSO....',
    '.....OTTTTO.....',
    '....OTTTTtTO....',
    '....OTTTTSTO....',
  ]),
};

/* ---------- Legs (rows 12..15) ---------- */

const LEGS_FRONT: Record<WalkFrame, string[]> = {
  0: ['....OPPPPPPO....', '....OPPOOPPO....', '....OBBOOBBO....', '.....OO..OO.....'],
  1: ['....OPPPPPPO....', '....OBBOOPPO....', '.....OO.OBBO....', '.........OO.....'],
  2: ['....OPPPPPPO....', '....OPPOOBBO....', '....OBBO.OO.....', '.....OO.........'],
};

const LEGS_SIDE: Record<WalkFrame, string[]> = {
  0: ['.....OPPPPO.....', '.....OPPPPO.....', '.....OBBBBBO....', '......OOOOO.....'],
  1: ['.....OPPPPO.....', '....OPPOOPPO....', '...OBBO..OBBO...', '....OO....OOO...'],
  2: ['.....OPPPPO.....', '.....OPPPPPO....', '....OBBOOBBO....', '.....OO..OO.....'],
};

function legs(facing: AuthoredFacing, frame: WalkFrame): PixelMatrix {
  const rows = facing === 'right' ? LEGS_SIDE[frame] : LEGS_FRONT[frame];
  return overrideRows(blank(CHAR_SIZE, CHAR_SIZE), LEG_ROW, rows);
}

/* ---------- Hair ---------- */

const HAIR: Record<HairStyle, Record<AuthoredFacing, PixelMatrix>> = {
  short: {
    down: pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHhO..',
      '..OHhHH..HHhhO..',
      '...Oh......hO...',
    ]),
    up: pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OhHHHHHHHHhO..',
      '...OhHHHHHHhO...',
      '...OhhhhhhhhO...',
    ]),
    right: pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHhO..',
      '..OHHHHHHhh.....',
      '..OHHHHHh.......',
      '..OhHHHh........',
      '...Ohh..........',
    ]),
  },
  long: {
    down: pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHh....hHHO..',
      '..OHh......hHO..',
      '..OHh......hHO..',
      '..OHh......hHO..',
      '..OHH......HHO..',
      '..OhHO....OHhO..',
      '...OO......OO...',
    ]),
    up: pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OhHHHHHHHHhO..',
      '..OhhHHHHHHhhO..',
      '...OhhhhhhhhO...',
      '....OOOOOOOO....',
    ]),
    right: pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHhO..',
      '..OHHHHHHhh.....',
      '..OHHHHHh.......',
      '..OHHHHh........',
      '..OHHHHh........',
      '..OHHHHh........',
      '..OhHHhO........',
      '...OhhO.........',
      '....OO..........',
    ]),
  },
  bob: {
    down: pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OhhhhhhhhhhO..',
      '..OHh......hHO..',
      '..OHh......hHO..',
      '..OHH......HHO..',
      '..OhhO....OhhO..',
      '...OO......OO...',
    ]),
    up: pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OhhhhhhhhhhO..',
      '...OOOOOOOOOO...',
    ]),
    right: pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHhhhhO..',
      '..OHHHHHh.......',
      '..OHHHHHh.......',
      '..OHHHHHh.......',
      '..OhhhhhO.......',
      '...OOOOO........',
    ]),
  },
  bun: {
    down: pad([
      '......OOOO......',
      '.....OHHHHO.....',
      '....OOhHHhOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHh......hHO..',
      '...Oh......hO...',
    ]),
    up: pad([
      '......OOOO......',
      '.....OHHHHO.....',
      '....OOHhhHOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '...OhHHHHHHhO...',
      '....OhhhhhhO....',
    ]),
    right: pad([
      '..OOOO..........',
      '.OHHHHO.........',
      '.OHhhHOOOOOO....',
      '..OOHHHHHHHHO...',
      '..OHHHHHHHHHhO..',
      '..OHHHHHHhh.....',
      '..OhHHHHh.......',
      '...OhhhO........',
    ]),
  },
  spiky: {
    down: pad([
      '...O...OO...O...',
      '..OHO.OHHO.OHO..',
      '..OHHOHHHHOHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHhO..',
      '..OHhHh..hHhhO..',
      '...Oh......hO...',
    ]),
    up: pad([
      '...O...OO...O...',
      '..OHO.OHHO.OHO..',
      '..OHHOHHHHOHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OhHHHHHHHHhO..',
      '...OhhhhhhhhO...',
    ]),
    right: pad([
      '..O...O...O.....',
      '.OHO.OHO.OHOO...',
      '..OHHOHHHOHHHHO.',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHhhO..',
      '..OHHHHHhh......',
      '..OhHHHh........',
      '...OhhO.........',
    ]),
  },
  cap: {
    down: pad([
      '....OOOOOOOO....',
      '...OQQQQQQQQO...',
      '..OQQQQWWQQQQO..',
      '..OQQQQQQQQQQO..',
      '..OqqqqqqqqqqO..',
      '..OOqqqqqqqqOO..',
      '...OH......HO...',
    ]),
    up: pad([
      '....OOOOOOOO....',
      '...OQQQQQQQQO...',
      '..OQQQQQQQQQQO..',
      '..OQQQQQQQQQQO..',
      '..OqqqqqqqqqqO..',
      '..OHHOOOOOOHHO..',
      '..OHHHHHHHHHHO..',
      '...OhhhhhhhhO...',
    ]),
    right: pad([
      '....OOOOOOOO....',
      '...OQQQQQQQQO...',
      '..OQQQQQQQQQQO..',
      '..OQQQQQQQQQqOOO',
      '..OqqqqqqqqqqqqO',
      '..OHHHhOOOOOOOO.',
      '..OhHh..........',
      '...Oh...........',
    ]),
  },
};

/* ---------- Accessories ---------- */

export type Accessory = 'apron' | 'backpack' | 'tie' | 'vest' | 'book' | 'hat' | 'bag';

export const OCCUPATION_ACCESSORY: Record<Occupation, Accessory> = {
  cafe_worker: 'apron',
  student: 'backpack',
  office_worker: 'tie',
  shopkeeper: 'vest',
  teacher: 'book',
  retiree: 'hat',
  delivery_worker: 'bag',
};

const HAT: PixelMatrix = pad([
  '.....OOOOOO.....',
  '....OYYYYYYO....',
  '....ORRRRRRO....',
  '.OOOYYYYYYYYOOO.',
  '.OyyyyyyyyyyyyO.',
  '..OOOOOOOOOOOO..',
]);

const BAG_DOWN: PixelMatrix = pad([
  '', '', '', '', '', '', '', '', '',
  '..........g.....',
  '........gg......',
  '..OOOOgg........',
  '..OGGGGO........',
  '..OGggGO........',
  '..OOOOOO........',
]);

const ACCESSORY: Record<Accessory, Record<AuthoredFacing, PixelMatrix>> = {
  apron: {
    down: pad(['', '', '', '', '', '', '', '', '', '......W..W......', '.....WWWWWW.....', '.....WWwwWW.....', '.....wWWWWw.....']),
    up: pad(['', '', '', '', '', '', '', '', '', '......W..W......', '......W..W......', '......wWWw......']),
    right: pad(['', '', '', '', '', '', '', '', '', '.........W......', '..........W.....', '..........W.....', '.........WW.....']),
  },
  backpack: {
    down: pad(['', '', '', '', '', '', '', '', '', '.....A....A.....', '.....A....A.....']),
    up: pad(['', '', '', '', '', '', '', '', '', '....OOOOOOOO....', '....OAAAAAAO....', '....OAaaaaAO....', '....OAAAAAAO....', '....OOOOOOOO....']),
    right: pad(['', '', '', '', '', '', '', '', '', '..OOOO.A........', '.OAAAAO.........', '.OAaaAO.........', '.OAAAAO.........', '..OOOO..........']),
  },
  tie: {
    down: pad(['', '', '', '', '', '', '', '', '', '......WRRW......', '.......Rr.......', '.......RR.......']),
    up: pad(['', '', '', '', '', '', '', '', '', '......WWWW......']),
    right: pad(['', '', '', '', '', '', '', '', '', '........WR......', '.........R......']),
  },
  vest: {
    down: pad(['', '', '', '', '', '', '', '', '', '.....VV..VV.....', '.....VV..VV.....', '.....vV..Vv.....']),
    up: pad(['', '', '', '', '', '', '', '', '', '.....VVVVVV.....', '.....VVVVVV.....', '.....vvvvvv.....']),
    right: pad(['', '', '', '', '', '', '', '', '', '......VVV.......', '.....VVVV.......', '.....vvvv.......']),
  },
  book: {
    down: pad(['', '', '', '', '', '', '', '', '', '', '..........OOOOO.', '..........OKKWO.', '..........OKKWO.', '..........OOOOO.']),
    up: pad(['', '', '', '', '', '', '', '', '', '', '..OO............', '..OK............', '..OO............']),
    right: pad(['', '', '', '', '', '', '', '', '', '', '..........OOOO..', '..........OKWO..', '..........OKWO..', '..........OOOO..']),
  },
  hat: { down: HAT, up: HAT, right: HAT },
  bag: {
    down: BAG_DOWN,
    up: mirrorX(BAG_DOWN),
    right: pad([
      '', '', '', '', '', '', '', '', '',
      '.........g......',
      '........g.......',
      '.OOOOgg.........',
      '.OGGGO..........',
      '.OGgGO..........',
      '.OOOOO..........',
    ]),
  },
};

/* ---------- Compose ---------- */

export interface CharacterSpec {
  look: Look;
  occupation: Occupation;
  facing: Facing;
  frame: WalkFrame;
}

function composeAuthored(facing: AuthoredFacing, style: HairStyle, accessory: Accessory, frame: WalkFrame): PixelMatrix {
  let hair = HAIR[style][facing];
  // hats replace the top of the hair
  if (accessory === 'hat') hair = keepRows(hair, 6, CHAR_SIZE - 1);
  const acc = ACCESSORY[accessory][facing];
  // a backpack seen from behind and a book seen from behind sit under long hair
  const accUnderHair = facing === 'up' && (accessory === 'book');
  const layers = accUnderHair
    ? [BODY[facing], legs(facing, frame), acc, hair]
    : [BODY[facing], legs(facing, frame), hair, acc];
  return stack(layers);
}

/** Compose a 16x16 character matrix (role letters; color with characterPalette(look)). */
export function composeCharacter(spec: CharacterSpec): PixelMatrix {
  const style = hairStyleOf(spec.look);
  const accessory = OCCUPATION_ACCESSORY[spec.occupation];
  if (spec.facing === 'left') return mirrorX(composeAuthored('right', style, accessory, spec.frame));
  return composeAuthored(spec.facing, style, accessory, spec.frame);
}

/** Matrix plus the palette that colors it. */
export function characterSprite(spec: CharacterSpec): { matrix: PixelMatrix; palette: Palette } {
  return { matrix: composeCharacter(spec), palette: characterPalette(spec.look) };
}

/** Raw layers, for the contact sheet and tests. */
export const CHARACTER_LAYERS = { BODY, HAIR, ACCESSORY, legs } as const;
