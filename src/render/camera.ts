/**
 * Camera for the town canvas. Pure math: no DOM, no timers (the renderer passes the clock in).
 *
 * - Units: `x`, `y` are the world pixel at the top-left of the view (1 world px = 1 art pixel).
 *   `viewW`, `viewH` are the canvas size in device pixels.
 * - Scale is an integer number of device pixels per world pixel: base (fit to width) times zoom 1..4.
 * - When the view is wider or taller than the map, the map is centered on that axis.
 */
import { MAP_HEIGHT, MAP_WIDTH, TILE_PX } from '@/sim/town/mapSpec';

export const WORLD_W = MAP_WIDTH * TILE_PX;
export const WORLD_H = MAP_HEIGHT * TILE_PX;
export const FOCUS_MS = 400;

export type ZoomLevel = 1 | 2 | 3 | 4;

/** Integer device-pixel scale that best fits the map to the view width (never below 1). */
export function fitScale(viewW: number, worldW = WORLD_W): number {
  if (!(viewW > 0)) return 1;
  return Math.max(1, Math.round(viewW / worldW));
}

/** Clamp one axis: center when the view is larger than the world, else keep inside [0, world - view]. */
export function clampAxis(pos: number, viewWorld: number, world: number): number {
  if (viewWorld >= world) return (world - viewWorld) / 2;
  return Math.min(world - viewWorld, Math.max(0, pos));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2;
}

interface Anim {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startMs: number;
}

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly base: number;
  readonly zoom: ZoomLevel;
  /** device pixels per world pixel */
  readonly scale: number;
  readonly animating: boolean;
  /** Set the view size in device pixels. Refits the base scale when `refit` is true. */
  setView(viewW: number, viewH: number, refit?: boolean): void;
  setZoom(z: ZoomLevel, anchorDevX?: number, anchorDevY?: number): void;
  panBy(dxDev: number, dyDev: number): void;
  /** Center on a world pixel, animated over FOCUS_MS from `nowMs`. */
  focusWorld(wx: number, wy: number, nowMs: number): void;
  focusTile(tx: number, ty: number, nowMs: number): void;
  update(nowMs: number): void;
  screenToWorld(devX: number, devY: number): { x: number; y: number };
  worldToScreen(wx: number, wy: number): { x: number; y: number };
}

export function createCamera(viewW = WORLD_W, viewH = WORLD_H): Camera {
  let vw = viewW;
  let vh = viewH;
  let base = fitScale(vw);
  let zoom: ZoomLevel = 1;
  let x = 0;
  let y = 0;
  let anim: Anim | null = null;

  const scale = () => base * zoom;
  const clampXY = () => {
    const s = scale();
    x = clampAxis(x, vw / s, WORLD_W);
    y = clampAxis(y, vh / s, WORLD_H);
  };
  const centerOn = (wx: number, wy: number) => {
    const s = scale();
    return { x: clampAxis(wx - vw / s / 2, vw / s, WORLD_W), y: clampAxis(wy - vh / s / 2, vh / s, WORLD_H) };
  };

  // start centered
  x = (WORLD_W - vw / scale()) / 2;
  y = 0;
  clampXY();

  return {
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    get viewW() {
      return vw;
    },
    get viewH() {
      return vh;
    },
    get base() {
      return base;
    },
    get zoom() {
      return zoom;
    },
    get scale() {
      return scale();
    },
    get animating() {
      return anim !== null;
    },
    setView(w, h, refit = true) {
      const cx = x + vw / scale() / 2;
      const cy = y + vh / scale() / 2;
      vw = Math.max(1, w);
      vh = Math.max(1, h);
      if (refit) base = fitScale(vw);
      const c = centerOn(cx, cy);
      x = c.x;
      y = c.y;
      anim = null;
    },
    setZoom(z, ax = vw / 2, ay = vh / 2) {
      const before = scale();
      const wx = x + ax / before;
      const wy = y + ay / before;
      zoom = z;
      const s = scale();
      x = wx - ax / s;
      y = wy - ay / s;
      anim = null;
      clampXY();
    },
    panBy(dx, dy) {
      const s = scale();
      x -= dx / s;
      y -= dy / s;
      anim = null;
      clampXY();
    },
    focusWorld(wx, wy, nowMs) {
      const to = centerOn(wx, wy);
      anim = { fromX: x, fromY: y, toX: to.x, toY: to.y, startMs: nowMs };
    },
    focusTile(tx, ty, nowMs) {
      this.focusWorld(tx * TILE_PX + TILE_PX / 2, ty * TILE_PX + TILE_PX / 2, nowMs);
    },
    update(nowMs) {
      if (!anim) return;
      const t = Math.min(1, Math.max(0, (nowMs - anim.startMs) / FOCUS_MS));
      const e = easeInOut(t);
      x = anim.fromX + (anim.toX - anim.fromX) * e;
      y = anim.fromY + (anim.toY - anim.fromY) * e;
      if (t >= 1) anim = null;
    },
    screenToWorld(devX, devY) {
      const s = scale();
      return { x: x + devX / s, y: y + devY / s };
    },
    worldToScreen(wx, wy) {
      const s = scale();
      return { x: (wx - x) * s, y: (wy - y) * s };
    },
  };
}
