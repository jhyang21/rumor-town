/**
 * Pixel matrices: arrays of equal-length strings, one letter per pixel, `.` = transparent.
 * All helpers are pure and return new matrices.
 */
import { TRANSPARENT, type Palette } from './palette';

export type PixelMatrix = string[];

export function width(m: PixelMatrix): number {
  return m.length === 0 ? 0 : m[0].length;
}

export function height(m: PixelMatrix): number {
  return m.length;
}

export function blank(w: number, h: number, fill: string = TRANSPARENT): PixelMatrix {
  return Array.from({ length: h }, () => fill.repeat(w));
}

/** Problems with a matrix: ragged rows and letters missing from the palette. Empty = valid. */
export function validateMatrix(m: PixelMatrix, palette: Palette): string[] {
  const problems: string[] = [];
  if (m.length === 0) return ['matrix has no rows'];
  const w = m[0].length;
  if (w === 0) problems.push('matrix has zero width');
  const unknown = new Map<string, string>();
  m.forEach((row, y) => {
    if (row.length !== w) problems.push(`row ${y} has length ${row.length}, expected ${w}`);
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== TRANSPARENT && !(ch in palette) && !unknown.has(ch)) unknown.set(ch, `${x},${y}`);
    }
  });
  for (const [ch, at] of unknown) problems.push(`unknown letter '${ch}' (first at ${at})`);
  return problems;
}

export function mirrorX(m: PixelMatrix): PixelMatrix {
  return m.map((row) => row.split('').reverse().join(''));
}

export function mirrorY(m: PixelMatrix): PixelMatrix {
  return [...m].reverse();
}

/** Rotate 90 degrees clockwise. */
export function rotateCW(m: PixelMatrix): PixelMatrix {
  const w = width(m);
  const h = height(m);
  const out: string[] = [];
  for (let x = 0; x < w; x++) {
    let row = '';
    for (let y = h - 1; y >= 0; y--) row += m[y][x];
    out.push(row);
  }
  return out;
}

/** Overlay a part onto a base at (x, y). Only non-transparent part pixels are written; the part is clipped. */
export function stamp(base: PixelMatrix, part: PixelMatrix, x: number, y: number): PixelMatrix {
  const out = base.slice();
  for (let py = 0; py < part.length; py++) {
    const by = y + py;
    if (by < 0 || by >= out.length) continue;
    const chars = out[by].split('');
    let changed = false;
    const prow = part[py];
    for (let px = 0; px < prow.length; px++) {
      const bx = x + px;
      const ch = prow[px];
      if (ch === TRANSPARENT || bx < 0 || bx >= chars.length) continue;
      chars[bx] = ch;
      changed = true;
    }
    if (changed) out[by] = chars.join('');
  }
  return out;
}

/** Layer matrices of equal size; later layers overwrite non-transparent pixels. */
export function stack(layers: PixelMatrix[]): PixelMatrix {
  if (layers.length === 0) return [];
  const w = width(layers[0]);
  const h = height(layers[0]);
  let out = layers[0].slice();
  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i];
    if (width(layer) !== w || height(layer) !== h) {
      throw new Error(`stack: layer ${i} is ${width(layer)}x${height(layer)}, expected ${w}x${h}`);
    }
    out = stamp(out, layer, 0, 0);
  }
  return out;
}

/** Replace whole rows starting at rowIndex. Rows must match the base width and fit inside it. */
export function overrideRows(base: PixelMatrix, rowIndex: number, rows: PixelMatrix): PixelMatrix {
  const w = width(base);
  if (rowIndex < 0 || rowIndex + rows.length > base.length) {
    throw new Error(`overrideRows: rows ${rowIndex}..${rowIndex + rows.length - 1} do not fit in ${base.length} rows`);
  }
  rows.forEach((r, i) => {
    if (r.length !== w) throw new Error(`overrideRows: row ${i} has length ${r.length}, expected ${w}`);
  });
  const out = base.slice();
  rows.forEach((r, i) => (out[rowIndex + i] = r));
  return out;
}

/** Repeat a small pattern to fill w x h. */
export function tilePattern(pattern: PixelMatrix, w: number, h: number): PixelMatrix {
  const pw = width(pattern);
  const ph = height(pattern);
  if (pw === 0 || ph === 0) throw new Error('tilePattern: empty pattern');
  const out: string[] = [];
  for (let y = 0; y < h; y++) out.push(pattern[y % ph].repeat(Math.ceil(w / pw)).slice(0, w));
  return out;
}

/** Pad or crop to w x h, keeping the top-left corner. */
export function resize(m: PixelMatrix, w: number, h: number): PixelMatrix {
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    const row = m[y] ?? '';
    out.push(row.length >= w ? row.slice(0, w) : row + TRANSPARENT.repeat(w - row.length));
  }
  return out;
}

/** Replace letters via a map; unmapped letters stay. */
export function recolor(m: PixelMatrix, map: Record<string, string>): PixelMatrix {
  return m.map((row) => row.replace(/./g, (ch) => map[ch] ?? ch));
}

/** Blank every row outside from..to (inclusive). */
export function keepRows(m: PixelMatrix, from: number, to: number): PixelMatrix {
  const w = width(m);
  return m.map((row, y) => (y >= from && y <= to ? row : TRANSPARENT.repeat(w)));
}

/* ---------- Mutable grid, for compositors ---------- */

export type Grid = string[][];

export function toGrid(m: PixelMatrix): Grid {
  return m.map((row) => row.split(''));
}

export function fromGrid(g: Grid): PixelMatrix {
  return g.map((row) => row.join(''));
}

export function newGrid(w: number, h: number, fill: string = TRANSPARENT): Grid {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
}

export function setPx(g: Grid, x: number, y: number, ch: string): void {
  if (y >= 0 && y < g.length && x >= 0 && x < g[y].length) g[y][x] = ch;
}

export function getPx(g: Grid, x: number, y: number): string {
  if (y >= 0 && y < g.length && x >= 0 && x < g[y].length) return g[y][x];
  return TRANSPARENT;
}

export function fillRectG(g: Grid, x: number, y: number, w: number, h: number, ch: string): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(g, xx, yy, ch);
}

/** 1-pixel outline rectangle. */
export function strokeRectG(g: Grid, x: number, y: number, w: number, h: number, ch: string): void {
  for (let xx = x; xx < x + w; xx++) {
    setPx(g, xx, y, ch);
    setPx(g, xx, y + h - 1, ch);
  }
  for (let yy = y; yy < y + h; yy++) {
    setPx(g, x, yy, ch);
    setPx(g, x + w - 1, yy, ch);
  }
}

export function stampG(g: Grid, part: PixelMatrix, x: number, y: number): void {
  for (let py = 0; py < part.length; py++)
    for (let px = 0; px < part[py].length; px++) {
      const ch = part[py][px];
      if (ch !== TRANSPARENT) setPx(g, x + px, y + py, ch);
    }
}

/**
 * Filled ellipse with a 1-pixel outline, shaded by a light from the top left.
 * `fill(nx, ny)` picks the letter for an inside pixel from its normalized position (-1..1).
 */
export function shadedEllipse(
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  outline: string,
  fill: (nx: number, ny: number) => string,
): PixelMatrix {
  const inside = (x: number, y: number) => {
    const nx = (x + 0.5 - cx) / rx;
    const ny = (y + 0.5 - cy) / ry;
    return nx * nx + ny * ny <= 1;
  };
  const g = newGrid(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      g[y][x] = edge ? outline : fill((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
    }
  return fromGrid(g);
}

/* ---------- Pixel font (3x5) ---------- */

const FONT: Record<string, PixelMatrix> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  ' ': ['...', '...', '...', '...', '...'],
};

/** Render text in a 3x5 pixel font with 1-pixel spacing, using `ch` for ink. */
export function pixelText(text: string, ch: string): PixelMatrix {
  const glyphs = text
    .toUpperCase()
    .split('')
    .map((c) => {
      const g = FONT[c];
      if (!g) throw new Error(`pixelText: no glyph for '${c}'`);
      return g;
    });
  const rows: string[] = [];
  for (let y = 0; y < 5; y++) rows.push(glyphs.map((g) => g[y].replace(/#/g, ch)).join(TRANSPARENT));
  return rows;
}
