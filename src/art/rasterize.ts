/**
 * Turn pixel matrices into canvases (browser only) and cache them by key.
 * Importing this module in Node is safe: nothing touches `document` until rasterize() runs.
 */
import type { LocationKind, Occupation, Facing } from '../sim/types';
import type { PixelMatrix } from './matrix';
import { TRANSPARENT, type Look, type Palette } from './palette';

export type SpriteCanvas = OffscreenCanvas | HTMLCanvasElement;

const rgbaCache = new Map<string, [number, number, number, number]>();

/** Parse #rgb, #rrggbb or #rrggbbaa. */
export function hexToRgba(hex: string): [number, number, number, number] {
  const hit = rgbaCache.get(hex);
  if (hit) return hit;
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) throw new Error(`bad color ${hex}`);
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const out: [number, number, number, number] = [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
  rgbaCache.set(hex, out);
  return out;
}

/** RGBA bytes for a matrix (pure; works in Node). Unknown letters throw. */
export function matrixToRGBA(m: PixelMatrix, palette: Palette): Uint8ClampedArray<ArrayBuffer> {
  const h = m.length;
  const w = h ? m[0].length : 0;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let y = 0; y < h; y++) {
    const row = m[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === TRANSPARENT) continue;
      const hex = palette[ch];
      if (hex === undefined) throw new Error(`rasterize: letter '${ch}' at ${x},${y} is not in the palette`);
      const [r, g, b, a] = hexToRgba(hex);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

/** A blank canvas: OffscreenCanvas when available, else a DOM canvas. */
export function createCanvas(w: number, h: number): SpriteCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  throw new Error('rasterize: no canvas available (browser only)');
}

/** Draw a matrix at 1x onto a new canvas. Scale it up with drawImage and imageSmoothingEnabled = false. */
export function rasterize(m: PixelMatrix, palette: Palette): SpriteCanvas {
  const h = m.length;
  const w = h ? m[0].length : 0;
  const canvas = createCanvas(Math.max(1, w), Math.max(1, h));
  if (w === 0 || h === 0) return canvas;
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('rasterize: 2d context unavailable');
  ctx.putImageData(new ImageData(matrixToRGBA(m, palette), w, h), 0, 0);
  return canvas;
}

/* ---------- Cache ---------- */

const sprites = new Map<string, SpriteCanvas>();

/** Memoized sprite: builds once per key. */
export function getSprite(key: string, build: () => SpriteCanvas): SpriteCanvas {
  let c = sprites.get(key);
  if (!c) {
    c = build();
    sprites.set(key, c);
  }
  return c;
}

export function clearSpriteCache(): void {
  sprites.clear();
}

export function spriteCacheSize(): number {
  return sprites.size;
}

/** Stable cache keys. */
export const spriteKey = {
  tile: (name: string, frame = 0) => `tile:${name}:${frame}`,
  building: (kind: LocationKind, wTiles: number, hTiles: number, variant = 0, doorTile = -1, doorSide = 'bottom', frame = 0) =>
    `bld:${kind}:${wTiles}x${hTiles}:${variant}:${doorTile}:${doorSide}:${frame}`,
  character: (look: Look, occupation: Occupation, facing: Facing, frame: number) =>
    `chr:${look.hair}.${look.skin}.${look.shirt}.${look.pants}:${occupation}:${facing}:${frame}`,
  signal: (kind: string) => `sig:${kind}`,
  bubble: (w: number, h: number, tailX: number) => `bub:${w}x${h}:${tailX}`,
} as const;
