/**
 * Building compositor. Builds a (wTiles*16) x (hTiles*16) matrix from wall patterns, a roof and
 * stamped parts. Uses the town PALETTE.
 *
 * The door sits in the tile column `doorTile` (default: the one each mapSpec location uses) so it
 * lines up with the location's `door` tile just below the footprint.
 */
import type { LocationKind, LocationSpec } from '../sim/types';
import {
  type Grid,
  type PixelMatrix,
  fillRectG,
  fromGrid,
  newGrid,
  pixelText,
  setPx,
  stampG,
  strokeRectG,
} from './matrix';
import { FOUNTAIN_FRAMES, TILE } from './tiles';

export type BuildingKind = Exclude<LocationKind, 'park'>;

export interface BuildingOptions {
  /** tile column of the door, 0-based from the left. Defaults per kind. */
  doorTile?: number;
  /** 'top' = the door faces north (away from the viewer): draw the back of the building. */
  doorSide?: 'bottom' | 'top';
  /** animation frame, used by the fountain ('square'). */
  frame?: number;
}

/** Default size in tiles for each kind (matches mapSpec footprints). */
export const BUILDING_SIZES: Record<BuildingKind, { w: number; h: number }> = {
  home: { w: 4, h: 3 },
  cafe: { w: 6, h: 4 },
  store: { w: 6, h: 4 },
  office: { w: 6, h: 4 },
  school: { w: 7, h: 4 },
  square: { w: 2, h: 2 },
};

export const DEFAULT_DOOR_TILE: Record<BuildingKind, number> = {
  home: 1,
  cafe: 2,
  store: 2,
  office: 2,
  school: 3,
  square: 0,
};

/** How many palette variants each kind has. */
export const BUILDING_VARIANTS: Record<BuildingKind, number> = {
  home: 4,
  cafe: 1,
  store: 1,
  office: 1,
  school: 1,
  square: 1,
};

interface Scheme {
  wall: string;
  wallShade: string;
  roof: string;
  roofDark: string;
  brick?: boolean;
}

/** Home variants: cream/red roof, brick/brown roof, blue/slate, yellow/green. */
export const HOME_SCHEMES: readonly Scheme[] = [
  { wall: 'W', wallShade: 'w', roof: 'R', roofDark: 'r' },
  { wall: 'K', wallShade: 'k', roof: 'N', roofDark: 'n', brick: true },
  { wall: 'b', wallShade: 'B', roof: 'L', roofDark: 'm' },
  { wall: 'Y', wallShade: 'x', roof: 'M', roofDark: 'j' },
];

/* ---------- Parts ---------- */

export const WINDOW: PixelMatrix = [
  'OOOOOOOOOOO',
  'OXXXXXXXXXO',
  'OXEEEXEEEXO',
  'OXEEEXEEEXO',
  'OXXXXXXXXXO',
  'OXEEEXEEEXO',
  'OXeeeXeeeXO',
  'OXXXXXXXXXO',
  'OOOOOOOOOOO',
  '.OhhhhhhhO.',
  '..OOOOOOO..',
];

export const PLANTER: PixelMatrix = [
  '.F.f.F.f.F.',
  'UFUfUFUfUFU',
  'OtttttttttO',
  'OOOOOOOOOOO',
];

export const CHIMNEY: PixelMatrix = [
  'OOOOOOOO',
  'OzzzzzzO',
  'OOOOOOOO',
  '.OKKkKO.',
  '.OkKKKO.',
  '.OKKKkO.',
  '.OKkKKO.',
  '.OKKKKO.',
  '.OKKKKO.',
];

export const CAFE_SIGN: PixelMatrix = [
  '....OOOOO....',
  '..OOhhhhhOO..',
  '.OhhhhhhhhhO.',
  '.OhhhXhXhhhO.',
  'OhhhXhXhhhhhO',
  'OhhOOOOOOhhhO',
  'OhhOXXXXOOhhO',
  'OhhOXXXXOhOhO',
  'OhhOXXXXOOhhO',
  'OhhhOXXOhhhhO',
  '.OhhhOOhhhhO.',
  '..OOhhhhhOO..',
  '....OOOOO....',
];

const BELL: PixelMatrix = ['..O..', '.OCO.', 'OCCCO', 'OCCCO', 'OOOOO', '..C..'];

const CLOCK: PixelMatrix = [
  '...OOOOO...',
  '..OXXXXXO..',
  '.OXXXOXXXO.',
  'OXXXXOXXXXO',
  'OXXXXOXXXXO',
  'OXXXXOOOXXO',
  'OXXXXXXXXXO',
  'OXXXXXXXXXO',
  '.OXXXXXXXO.',
  '..OXXXXXO..',
  '...OOOOO...',
];

/* ---------- Helpers ---------- */

function drawPitchedRoof(g: Grid, top: number, bottom: number, w: number, s: Scheme): void {
  for (let y = top; y <= bottom; y++) {
    const i = y - top;
    const inset = Math.max(0, 3 - i) * 2;
    const x0 = inset;
    const x1 = w - 1 - inset;
    const course = Math.floor((i - 1) / 4);
    for (let x = x0; x <= x1; x++) {
      let ch: string;
      if (i === 0 || y === bottom || x === x0 || x === x1) ch = 'O';
      else if ((i - 1) % 4 === 3) ch = s.roofDark;
      else if ((x + (course % 2) * 3) % 6 === 0) ch = s.roofDark;
      else ch = s.roof;
      g[y][x] = ch;
    }
  }
}

function drawWalls(g: Grid, top: number, w: number, h: number, s: Scheme, siding: 'plain' | 'lines' | 'brick' | 'planks'): void {
  const x0 = 2;
  const x1 = w - 3;
  for (let y = top; y < h; y++)
    for (let x = x0; x <= x1; x++) {
      let ch = s.wall;
      const yy = y - top;
      if (siding === 'brick') {
        const course = Math.floor(yy / 4);
        if (yy % 4 === 3 || (x + (course % 2) * 4) % 8 === 0) ch = s.wallShade;
      } else if (siding === 'lines' && yy % 5 === 4) ch = s.wallShade;
      else if (siding === 'planks' && yy % 4 === 3) ch = s.wallShade;
      if (yy < 2) ch = s.wallShade; // shadow under the eave
      g[y][x] = ch;
    }
  // foundation
  fillRectG(g, x0, h - 3, x1 - x0 + 1, 1, 'u');
  fillRectG(g, x0, h - 2, x1 - x0 + 1, 1, 'q');
  // sides and bottom outline
  for (let y = top; y < h; y++) {
    setPx(g, x0, y, 'O');
    setPx(g, x1, y, 'O');
  }
  fillRectG(g, x0, h - 1, x1 - x0 + 1, 1, 'O');
}

/** Wooden door with a small lit window and a brass knob; bottom edge on the last row. */
function drawDoor(g: Grid, doorTile: number, h: number, dw: number, dh: number, glass = false): void {
  const dx = doorTile * TILE + Math.floor((TILE - dw) / 2);
  const dy = h - dh;
  // lintel
  fillRectG(g, dx - 1, dy - 1, dw + 2, 1, 't');
  strokeRectG(g, dx, dy, dw, dh, 'O');
  fillRectG(g, dx + 1, dy + 1, dw - 2, dh - 2, 'T');
  fillRectG(g, dx + 1, dy + 1, 1, dh - 2, 't');
  if (glass) {
    fillRectG(g, dx + 2, dy + 2, dw - 4, Math.floor(dh / 2), 'E');
    fillRectG(g, dx + 2, dy + 2 + Math.floor(dh / 2) - 1, dw - 4, 1, 'e');
    if (dw >= 12) fillRectG(g, dx + Math.floor(dw / 2), dy + 1, 1, dh - 2, 'O');
  } else {
    fillRectG(g, dx + 3, dy + 2, dw - 6, 3, 'E');
    fillRectG(g, dx + 3, dy + 4, dw - 6, 1, 'e');
    // panel lines
    fillRectG(g, dx + 3, dy + 7, dw - 6, 1, 't');
    fillRectG(g, dx + 3, dy + dh - 4, dw - 6, 1, 't');
  }
  setPx(g, dx + dw - 3, dy + Math.floor(dh / 2) + 1, 'C');
  if (dw >= 12 && glass) setPx(g, dx + Math.floor(dw / 2) - 2, dy + Math.floor(dh / 2) + 1, 'C');
  // step
  fillRectG(g, dx, h - 1, dw, 1, 'O');
}

function windowsExcept(g: Grid, wTiles: number, skip: number | null, y: number, planterAt?: number): void {
  for (let t = 0; t < wTiles; t++) {
    if (t === skip) continue;
    stampG(g, WINDOW, t * TILE + 2 + (t === 0 ? 1 : t === wTiles - 1 ? -1 : 0), y);
    if (planterAt === t) stampG(g, PLANTER, t * TILE + 2 + (t === wTiles - 1 ? -1 : 0), y + 10);
  }
}

/** Board with dark wood and cream letters. */
function signBoard(text: string): PixelMatrix {
  const letters = pixelText(text, 'X');
  const w = letters[0].length + 6;
  const g = newGrid(w, 9, 't');
  strokeRectG(g, 0, 0, w, 9, 'O');
  fillRectG(g, 1, 7, w - 2, 1, 'n');
  stampG(g, letters, 3, 2);
  return fromGrid(g);
}

/* ---------- Kinds ---------- */

function composeHome(w: number, h: number, variant: number, doorTile: number, rear: boolean): PixelMatrix {
  const s = HOME_SCHEMES[((variant % HOME_SCHEMES.length) + HOME_SCHEMES.length) % HOME_SCHEMES.length];
  const g = newGrid(w, h);
  const wallH = Math.max(20, Math.round(h * 0.55));
  const wallTop = h - wallH;
  const roofTop = 6;
  drawWalls(g, wallTop, w, h, s, s.brick ? 'brick' : 'lines');
  stampG(g, CHIMNEY, rear ? 6 : w - 14, 0);
  drawPitchedRoof(g, roofTop, wallTop + 1, w, s);
  const winY = wallTop + 4;
  const wTiles = w / TILE;
  if (rear) {
    windowsExcept(g, wTiles, null, winY);
  } else {
    windowsExcept(g, wTiles, doorTile, winY, doorTile === wTiles - 1 ? 0 : wTiles - 1);
    drawDoor(g, doorTile, h, 10, Math.min(17, wallH - 5));
  }
  return fromGrid(g);
}

function composeCafe(w: number, h: number, doorTile: number, rear: boolean): PixelMatrix {
  const s: Scheme = { wall: 'W', wallShade: 'w', roof: 'N', roofDark: 'n' };
  const g = newGrid(w, h);
  const wallH = Math.round(h * 0.55);
  const wallTop = h - wallH;
  drawWalls(g, wallTop, w, h, s, 'plain');
  // brick wainscot
  const wainTop = h - 11;
  for (let y = wainTop; y < h - 3; y++)
    for (let x = 3; x < w - 3; x++) {
      const yy = y - wainTop;
      g[y][x] = yy % 4 === 3 || (x + (Math.floor(yy / 4) % 2) * 4) % 8 === 0 ? 'k' : 'K';
    }
  drawPitchedRoof(g, 8, wallTop + 1, w, s);
  const wTiles = w / TILE;
  if (!rear) {
    // striped awning
    const aTop = wallTop + 2;
    for (let x = 2; x <= w - 3; x++) {
      const stripe = Math.floor((x - 2) / 4) % 2 === 0 ? 'R' : 'X';
      setPx(g, x, aTop, 'O');
      for (let y = aTop + 1; y < aTop + 6; y++) setPx(g, x, y, y === aTop + 5 && stripe === 'R' ? 'r' : stripe);
      const inStripe = (x - 2) % 4;
      setPx(g, x, aTop + 6, inStripe === 1 || inStripe === 2 ? stripe : 'O');
      if (inStripe === 1 || inStripe === 2) setPx(g, x, aTop + 7, 'O');
    }
    windowsExcept(g, wTiles, doorTile, aTop + 10);
    drawDoor(g, doorTile, h, 12, wallH - 12, true);
    stampG(g, CAFE_SIGN, doorTile * TILE + 1, 12);
  } else {
    windowsExcept(g, wTiles, null, wallTop + 6);
  }
  return fromGrid(g);
}

const GOODS = ['R', 'f', 'U', 'A', 'F', 'C', 'v', 'H'];

/** Shop window with two shelves of goods. */
function shopWindow(w: number, h: number, seed: number): PixelMatrix {
  const g = newGrid(w, h, 'E');
  strokeRectG(g, 0, 0, w, h, 'O');
  strokeRectG(g, 1, 1, w - 2, h - 2, 'X');
  const shelves = [Math.floor(h / 2) - 1, h - 3];
  shelves.forEach((sy, si) => {
    fillRectG(g, 2, sy, w - 4, 1, 't');
    for (let x = 3, k = seed + si * 3; x + 1 < w - 2; x += 3, k++) {
      const c = GOODS[k % GOODS.length];
      fillRectG(g, x, sy - 2, 2, 2, c);
      setPx(g, x, sy - 2, k % 3 === 0 ? 'X' : c);
    }
  });
  fillRectG(g, 2, 2, w - 4, 1, 'e');
  return fromGrid(g);
}

function composeStore(w: number, h: number, doorTile: number, rear: boolean): PixelMatrix {
  const s: Scheme = { wall: 'h', wallShade: 'T', roof: 'M', roofDark: 'j' };
  const g = newGrid(w, h);
  const wallH = Math.round(h * 0.55);
  const wallTop = h - wallH;
  drawWalls(g, wallTop, w, h, s, 'planks');
  drawPitchedRoof(g, 8, wallTop + 1, w, s);
  const wTiles = w / TILE;
  if (!rear) {
    const winY = wallTop + 5;
    const winH = 16;
    const doorLeft = doorTile * TILE;
    const doorRight = doorLeft + TILE;
    if (doorLeft - 8 >= 12) stampG(g, shopWindow(doorLeft - 8, winH, 0), 5, winY);
    if (w - 5 - (doorRight + 3) >= 12) stampG(g, shopWindow(w - 5 - (doorRight + 3), winH, 2), doorRight + 3, winY);
    drawDoor(g, doorTile, h, 12, wallH - 10, true);
    const board = signBoard('STORE');
    stampG(g, board, Math.floor((w - board[0].length) / 2), 14);
  } else {
    windowsExcept(g, wTiles, null, wallTop + 6);
  }
  return fromGrid(g);
}

function composeOffice(w: number, h: number, doorTile: number, rear: boolean): PixelMatrix {
  const s: Scheme = { wall: 'I', wallShade: 'J', roof: 'L', roofDark: 'm' };
  const g = newGrid(w, h);
  const roofH = 10;
  // flat roof seen from above
  fillRectG(g, 0, 0, w, roofH, 'L');
  for (let x = 0; x < w; x += 8) fillRectG(g, x, 1, 1, roofH - 4, 'm');
  strokeRectG(g, 0, 0, w, roofH, 'O');
  // rooftop vent box
  stampG(g, ['OOOOOOOOO', 'OZZZZZZzO', 'OZzzzzzzO', 'OOOOOOOOO'], w - 20, 2);
  // parapet front
  fillRectG(g, 1, roofH - 3, w - 2, 1, 'I');
  fillRectG(g, 1, roofH - 2, w - 2, 1, 'J');
  drawWalls(g, roofH, w, h, s, 'plain');
  // pilasters at tile boundaries
  const wTiles = w / TILE;
  for (let t = 1; t < wTiles; t++) fillRectG(g, t * TILE, roofH + 2, 1, h - roofH - 5, 'J');
  const small: PixelMatrix = ['OOOOOOOOO', 'OXXXXXXXO', 'OXEEXEEXO', 'OXEEXEEXO', 'OXeeXeeXO', 'OXXXXXXXO', 'OOOOOOOOO'];
  for (let t = 0; t < wTiles; t++) {
    const x = t * TILE + 4;
    stampG(g, small, x, roofH + 4);
    if (rear || t !== doorTile) stampG(g, small, x, roofH + 17);
    if (rear || t !== doorTile) stampG(g, small, x, roofH + 30 > h - 12 ? h - 12 : roofH + 30);
  }
  if (!rear) {
    drawDoor(g, doorTile, h, 12, 20, true);
    // awning over the door
    const dx = doorTile * TILE + 1;
    stampG(g, ['OOOOOOOOOOOOOO', 'OmmmmmmmmmmmmO', 'OOOOOOOOOOOOOO'], dx, h - 24);
  }
  return fromGrid(g);
}

function composeSchool(w: number, h: number, doorTile: number, rear: boolean): PixelMatrix {
  const s: Scheme = { wall: 'K', wallShade: 'k', roof: 'L', roofDark: 'm' };
  const g = newGrid(w, h);
  const wallH = Math.round(h * 0.47);
  const wallTop = h - wallH;
  drawWalls(g, wallTop, w, h, s, 'brick');
  drawPitchedRoof(g, 16, wallTop + 1, w, s);
  // white trim line under the eave
  fillRectG(g, 3, wallTop + 2, w - 6, 1, 'X');
  const wTiles = w / TILE;
  // bell tower over the door column (center)
  const tw = 14;
  const tx = doorTile * TILE + 1;
  const towerBottom = wallTop + 1;
  fillRectG(g, tx, 7, tw, towerBottom - 7, 'W');
  fillRectG(g, tx + tw - 3, 7, 2, towerBottom - 7, 'w');
  strokeRectG(g, tx, 7, tw, towerBottom - 6, 'O');
  // tower roof (pyramid)
  for (let i = 0; i < 8; i++) {
    const half = i + 1;
    const cx = tx + tw / 2;
    for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
      const edge = x === Math.floor(cx - half) || x === Math.ceil(cx + half) - 1 || i === 7;
      setPx(g, x, i, edge ? 'O' : x < cx ? 'R' : 'r');
    }
  }
  // bell opening
  fillRectG(g, tx + 3, 9, tw - 6, 8, 'n');
  strokeRectG(g, tx + 3, 9, tw - 6, 8, 'O');
  stampG(g, BELL, tx + 5, 10);
  stampG(g, CLOCK, tx + 2, 19);
  if (!rear) {
    windowsExcept(g, wTiles, doorTile, wallTop + 6);
    drawDoor(g, doorTile, h, 14, wallH - 12, true);
    const board = signBoard('SCHOOL');
    // small plaque above the door, below the tower
    stampG(g, board, tx + Math.floor((tw - board[0].length) / 2), wallTop + 3 < h ? wallTop + 3 : 0);
  } else {
    windowsExcept(g, wTiles, null, wallTop + 6);
  }
  return fromGrid(g);
}

function composeSquare(w: number, h: number, frame: number): PixelMatrix {
  const f = FOUNTAIN_FRAMES[((frame % 2) + 2) % 2];
  if (w === f[0].length && h === f.length) return f.slice();
  const g = newGrid(w, h);
  stampG(g, f, Math.floor((w - f[0].length) / 2), Math.floor((h - f.length) / 2));
  return fromGrid(g);
}

/**
 * Compose a building for a footprint of wTiles x tiles hTiles.
 * `variant` picks a color scheme (homes have 4). Park has no building and throws.
 */
export function composeBuilding(
  kind: LocationKind,
  wTiles: number,
  hTiles: number,
  variant = 0,
  opts: BuildingOptions = {},
): PixelMatrix {
  if (kind === 'park') throw new Error('composeBuilding: the park has no building');
  if (wTiles < 1 || hTiles < 1) throw new Error(`composeBuilding: bad size ${wTiles}x${hTiles}`);
  const w = wTiles * TILE;
  const h = hTiles * TILE;
  const doorTile = Math.min(wTiles - 1, Math.max(0, opts.doorTile ?? Math.min(DEFAULT_DOOR_TILE[kind], wTiles - 1)));
  const rear = opts.doorSide === 'top';
  switch (kind) {
    case 'home':
      return composeHome(w, h, variant, doorTile, rear);
    case 'cafe':
      return composeCafe(w, h, doorTile, rear);
    case 'store':
      return composeStore(w, h, doorTile, rear);
    case 'office':
      return composeOffice(w, h, doorTile, rear);
    case 'school':
      return composeSchool(w, h, doorTile, rear);
    case 'square':
      return composeSquare(w, h, opts.frame ?? 0);
  }
}

/** Options that line a building up with a mapSpec location's door tile. */
export function buildingOptionsFor(loc: LocationSpec): BuildingOptions {
  if (!loc.footprint) return {};
  return {
    doorTile: loc.door.x - loc.footprint.x,
    doorSide: loc.door.y < loc.footprint.y ? 'top' : 'bottom',
  };
}

/** Compose the building for a mapSpec location (null for the park). */
export function composeLocation(loc: LocationSpec, variant = 0, frame = 0): PixelMatrix | null {
  if (!loc.footprint || loc.kind === 'park') return null;
  return composeBuilding(loc.kind, loc.footprint.w, loc.footprint.h, variant, { ...buildingOptionsFor(loc), frame });
}
