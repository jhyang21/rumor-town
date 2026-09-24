/**
 * Canvas renderer for the town. DOM only (no React). One call to `render()` draws one frame from
 * the engine's snapshot plus the driver's interpolation alpha.
 *
 * Layers: ground (built once, offscreen) -> selection ring -> buildings and characters sorted by
 * their bottom edge -> signals -> name tags and speech bubbles (drawn in screen space so they stay
 * readable at every zoom).
 */
import type { Engine } from '@/sim/engine';
import type { LocationSpec, Rect } from '@/sim/types';
import { BORDER, LOCATIONS, MAP_HEIGHT, MAP_WIDTH, TILE_PX, inRect, isWalkable } from '@/sim/town/mapSpec';
import {
  type SpriteCanvas,
  type SignalKind,
  type TileName,
  bubbleCanvas,
  characterCanvas,
  createCanvas,
  grassVariantAt,
  locationCanvas,
  signalCanvas,
  tileCanvas,
} from '@/art';
import { type Camera, type ZoomLevel, WORLD_H, WORLD_W, createCamera } from './camera';
import { BubbleTimer, PositionTracker, THINKING_TEXT, pickCharacter, wrapText, type CharacterView } from './viewModel';

export interface RenderFrame {
  /** fraction of the way to the next tick */
  alpha: number;
  /** freezes the view clock (bubbles, fountain) */
  paused: boolean;
  /** 5x: only the newest line per speaker */
  fast: boolean;
}

export interface TownRendererOptions {
  /** frame info read each animation frame by the built-in loop */
  getFrame?: () => RenderFrame;
  getSelected?: () => number | null;
  onSelect?: (id: number | null) => void;
  /** drag to pan, wheel to zoom, click to select (default true) */
  interactive?: boolean;
  /** draw name tags and bubbles (default true) */
  showLabels?: boolean;
}

export interface TownRenderer {
  readonly camera: Camera;
  render(frame?: RenderFrame): void;
  resize(): void;
  /** CSS pixel coords relative to the canvas -> character id within 12 px, or null */
  pick(cssX: number, cssY: number): number | null;
  setZoom(z: ZoomLevel): void;
  zoomBy(delta: 1 | -1): void;
  focusTile(x: number, y: number): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

const PICK_RADIUS_CSS = 12;
const BG = '#2b2118';
const SIGNAL_OF: Record<string, SignalKind> = { '!': 'heard', '?': 'doubts', '✓': 'correction' };

/* ---------- ground (pure layout) ---------- */

const key = (x: number, y: number) => y * MAP_WIDTH + x;
const STREET_ROWS = [7, 22] as const;

/** Tiles drawn as dirt path: two streets and the shortest walkable link from each door to one. */
function pathTiles(): Set<number> {
  const out = new Set<number>();
  const street = new Set<number>();
  for (const row of STREET_ROWS)
    for (let x = 1; x < MAP_WIDTH - 1; x++)
      if (isWalkable(x, row)) {
        out.add(key(x, row));
        street.add(key(x, row));
      }
  for (const loc of LOCATIONS) {
    const start = loc.door;
    const prev = new Map<number, number>([[key(start.x, start.y), -1]]);
    const queue = [start];
    let hit = -1;
    while (queue.length) {
      const c = queue.shift()!;
      const k = key(c.x, c.y);
      if (street.has(k)) {
        hit = k;
        break;
      }
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        const nk = key(nx, ny);
        if (!isWalkable(nx, ny) || prev.has(nk)) continue;
        prev.set(nk, k);
        queue.push({ x: nx, y: ny });
      }
    }
    for (let k = hit; k >= 0; k = prev.get(k) ?? -1) out.add(k);
  }
  return out;
}

interface Prop {
  tile: TileName;
  x: number; // world px
  y: number;
}

function inAnyZone(x: number, y: number): boolean {
  return LOCATIONS.some((l) => inRect(l.zone, x, y));
}

/** Deterministic decoration placed from the map alone. */
function propLayout(paths: Set<number>): Prop[] {
  const props: Prop[] = [];
  const taken = new Set<number>();
  const free = (x: number, y: number) => isWalkable(x, y) && !paths.has(key(x, y)) && !taken.has(key(x, y));
  const put = (tile: TileName, x: number, y: number, w = 1) => {
    for (let i = 0; i < w; i++) taken.add(key(x + i, y));
    props.push({ tile, x: x * TILE_PX, y: y * TILE_PX });
  };
  // park furniture
  const park = LOCATIONS.find((l) => l.kind === 'park');
  if (park) {
    const z = park.zone;
    put('bench', z.x + 1, z.y);
    put('bench', z.x + z.w - 2, z.y);
    put('flowerBed', z.x, z.y + z.h - 1);
    put('flowerBed', z.x + z.w - 1, z.y + z.h - 1);
    if (free(z.x + 3, z.y + z.h) && free(z.x + 4, z.y + z.h)) put('parkSign', z.x + 3, z.y + z.h, 2);
  }
  // lamp posts along the streets
  for (const row of [STREET_ROWS[0] - 1, STREET_ROWS[1] - 1])
    for (const x of [10, 16, 22, 28])
      if (free(x, row) && !inAnyZone(x, row)) put('lampPost', x, row);
  // flower beds beside the café and store doors
  for (const loc of LOCATIONS) {
    if (loc.kind !== 'cafe' && loc.kind !== 'store' && loc.kind !== 'office') continue;
    const fx = loc.door.x + 2;
    if (free(fx, loc.door.y) && inRect(loc.zone, fx, loc.door.y)) put('flowerBed', fx, loc.door.y);
  }
  // sparse bushes on open grass
  for (let y = 1; y < MAP_HEIGHT - 1; y++)
    for (let x = 1; x < MAP_WIDTH - 1; x++) {
      if (!free(x, y) || inAnyZone(x, y)) continue;
      const h = ((x * 2654435761) ^ (y * 40503)) >>> 0;
      if (h % 29 === 0) put('bush', x, y);
    }
  return props;
}

function isBorder(x: number, y: number): boolean {
  return BORDER.some((r: Rect) => inRect(r, x, y));
}

function buildGround(): SpriteCanvas {
  const c = createCanvas(WORLD_W, WORLD_H);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  const paths = pathTiles();
  const square = LOCATIONS.find((l) => l.kind === 'square');
  const grass: TileName[] = ['grass0', 'grass1', 'grass2'];
  for (let y = 0; y < MAP_HEIGHT; y++)
    for (let x = 0; x < MAP_WIDTH; x++) {
      const px = x * TILE_PX;
      const py = y * TILE_PX;
      let t: TileName = grass[grassVariantAt(x, y)];
      if (square && inRect(square.zone, x, y)) t = 'stone';
      else if (paths.has(key(x, y))) t = 'path';
      ctx.drawImage(tileCanvas(t), px, py);
    }
  for (const loc of LOCATIONS) {
    if (loc.kind === 'park' || loc.kind === 'square') continue;
    ctx.drawImage(tileCanvas('doorstep'), loc.door.x * TILE_PX, loc.door.y * TILE_PX);
  }
  for (const p of propLayout(paths)) ctx.drawImage(tileCanvas(p.tile), p.x, p.y);
  for (let y = 0; y < MAP_HEIGHT; y++)
    for (let x = 0; x < MAP_WIDTH; x++)
      if (isBorder(x, y)) ctx.drawImage(tileCanvas((x + y) % 2 ? 'tree' : 'treeFlipped'), x * TILE_PX, y * TILE_PX);
  return c;
}

/* ---------- renderer ---------- */

function homeVariant(loc: LocationSpec): number {
  return Number(loc.id.replace(/\D/g, '')) % 4;
}

type Ctx = CanvasRenderingContext2D;

export function createTownRenderer(
  canvas: HTMLCanvasElement,
  engineGetter: () => Engine | null,
  opts: TownRendererOptions = {},
): TownRenderer {
  const ctx = canvas.getContext('2d') as Ctx;
  const camera = createCamera(canvas.width || WORLD_W, canvas.height || WORLD_H);
  const positions = new PositionTracker();
  const bubbles = new BubbleTimer();
  const interactive = opts.interactive ?? true;
  const showLabels = opts.showLabels ?? true;
  let ground: SpriteCanvas | null = null;
  let lastEngine: Engine | null = null;
  let views: readonly CharacterView[] = [];
  let hovered: number | null = null;
  let viewClock = 0;
  let lastWall = 0;
  let raf = 0;
  let running = false;
  let dpr = 1;
  let monoFamily = 'ui-monospace, Menlo, monospace';
  let sansFamily = 'system-ui, sans-serif';

  const wall = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function readFonts() {
    if (typeof document === 'undefined') return;
    const cs = getComputedStyle(document.documentElement);
    const mono = cs.getPropertyValue('--font-geist-mono').trim();
    const sans = cs.getPropertyValue('--font-geist-sans').trim();
    if (mono) monoFamily = `${mono}, ui-monospace, monospace`;
    if (sans) sansFamily = `${sans}, system-ui, sans-serif`;
  }

  function resize() {
    dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    camera.setView(w, h, true);
    readFonts();
  }

  function render(frame: RenderFrame = opts.getFrame?.() ?? { alpha: 0, paused: false, fast: false }) {
    const now = wall();
    const dt = lastWall ? Math.min(250, now - lastWall) : 0;
    lastWall = now;
    if (!frame.paused) viewClock += dt;
    camera.update(now);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const s = camera.scale;
    const tx = Math.round(-camera.x * s);
    const ty = Math.round(-camera.y * s);
    ctx.setTransform(s, 0, 0, s, tx, ty);
    if (!ground) ground = buildGround();
    ctx.drawImage(ground, 0, 0);

    const engine = engineGetter();
    if (engine !== lastEngine) {
      positions.reset();
      bubbles.reset();
      lastEngine = engine;
    }
    const fountainFrame = Math.floor(viewClock / 500) % 2;
    if (!engine) {
      drawBuildingsOnly(fountainFrame);
      return;
    }
    const snap = engine.snapshot();
    views = positions.update(snap.states, snap.tick, snap.finished ? 1 : frame.alpha);
    const snapPx = (v: number) => Math.round(v * s) / s;
    const selected = opts.getSelected?.() ?? null;

    // selection ring
    if (selected !== null && views[selected]?.visible) {
      const v = views[selected];
      ctx.fillStyle = 'rgba(255, 214, 102, 0.55)';
      ctx.beginPath();
      ctx.ellipse(snapPx(v.px) + 8, snapPx(v.py) + 15, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // depth-sorted buildings and characters
    const items = buildingItems(fountainFrame);
    for (const v of views) {
      if (!v.visible) continue;
      const c = snap.characters[v.id];
      const x = snapPx(v.px);
      const y = snapPx(v.py);
      items.push({
        y: y + TILE_PX,
        draw: () => ctx.drawImage(characterCanvas({ look: c.look, occupation: c.occupation, facing: v.facing, frame: v.frame }), x, y),
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // signals: newest per character; "…" bubbles become the thinking badge
    const badge = new Map<number, SignalKind>();
    for (const sig of snap.signals) {
      const k = SIGNAL_OF[sig.kind];
      if (k) badge.set(sig.id, k);
    }
    for (const b of snap.bubbles) if (b.text === THINKING_TEXT && !badge.has(b.speakerId)) badge.set(b.speakerId, 'thinking');
    for (const [id, kind] of badge) {
      const v = views[id];
      if (!v?.visible) continue;
      ctx.drawImage(signalCanvas(kind), snapPx(v.px) + 3, snapPx(v.py) - 11);
    }

    if (!showLabels) return;

    // screen-space labels
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const u = Math.max(1, Math.round(dpr));
    const tagged = new Set<number>();
    if (selected !== null) tagged.add(selected);
    if (hovered !== null) tagged.add(hovered);
    for (const m of snap.meetings)
      if (m.rumorRelevant) {
        tagged.add(m.aId);
        tagged.add(m.bId);
      }
    for (const id of tagged) {
      const v = views[id];
      if (!v?.visible) continue;
      const st = snap.states[id];
      drawTag(snap.characters[id].name, st.rumor !== null, st.rumor?.knowsCorrection === true, v, u);
    }
    const shown = bubbles.update(snap.bubbles, snap.tick, viewClock, frame.fast);
    // rumor talk first, then lowest speakers first; a bubble with no room is skipped, not piled up
    const rank = (id: number) => (tagged.has(id) ? 0 : 1);
    const order = shown
      .filter((b) => views[b.speakerId]?.visible)
      .sort((a, b) => rank(a.speakerId) - rank(b.speakerId) || views[b.speakerId].py - views[a.speakerId].py);
    const placed: Rect[] = [];
    for (const b of order) drawBubble(b.text, views[b.speakerId], badge.has(b.speakerId), u, placed);
  }

  type Item = { y: number; draw: () => void };

  function buildingItems(fountainFrame: number): Item[] {
    const items: Item[] = [];
    for (const loc of LOCATIONS) {
      const fp = loc.footprint;
      if (!fp) continue;
      const variant = loc.kind === 'home' ? homeVariant(loc) : 0;
      const spr = locationCanvas(loc, variant, loc.kind === 'square' ? fountainFrame : 0);
      if (!spr) continue;
      const bottom = (fp.y + fp.h) * TILE_PX;
      const left = fp.x * TILE_PX - (spr.width - fp.w * TILE_PX) / 2;
      items.push({ y: bottom, draw: () => ctx.drawImage(spr, left, bottom - spr.height) });
    }
    return items;
  }

  function drawBuildingsOnly(fountainFrame: number) {
    for (const it of buildingItems(fountainFrame)) it.draw();
  }

  function drawTag(name: string, knows: boolean, corrected: boolean, v: CharacterView, u: number) {
    const fs = Math.round(9 * dpr);
    ctx.font = `600 ${fs}px ${sansFamily}`;
    const label = corrected ? `${name} ✓` : name;
    const w = Math.ceil(ctx.measureText(label).width) + 6 * u;
    const h = fs + 4 * u;
    const feet = camera.worldToScreen(v.px + TILE_PX / 2, v.py + TILE_PX);
    const x = Math.round(feet.x - w / 2);
    const y = Math.round(feet.y + u);
    ctx.fillStyle = corrected ? 'rgba(38, 92, 60, 0.88)' : knows ? 'rgba(122, 76, 22, 0.88)' : 'rgba(30, 24, 20, 0.78)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = knows && !corrected ? '#ffe2a8' : '#fbf5ea';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 3 * u, y + 2 * u);
  }

  function drawBubble(text: string, v: CharacterView, hasBadge: boolean, u: number, placed: Rect[]) {
    const lines = wrapText(text, 24, 3);
    const fs = Math.round(10 * dpr);
    const lh = Math.round(12 * dpr);
    ctx.font = `${fs}px ${monoFamily}`;
    let tw = 0;
    for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
    const padX = 5;
    const padY = 4;
    const wArt = Math.ceil(Math.ceil(tw / u) + padX * 2 + 1);
    const wBucket = Math.ceil(wArt / 4) * 4;
    const hArt = Math.max(9, Math.ceil((lines.length * lh) / u) + padY * 2);
    const head = camera.worldToScreen(v.px + TILE_PX / 2, v.py);
    const lift = hasBadge ? 12 * camera.scale : 2 * u;
    const bw = wBucket * u;
    const bh = (hArt + 2) * u;
    let left = Math.round(head.x - bw / 3);
    left = Math.max(2, Math.min(canvas.width - bw - 2, left));
    const home = Math.round(head.y - lift - bh);
    let top = home;
    // move up past a bubble already drawn this frame; give up if that takes it far from the head
    for (let moved = true; moved; ) {
      moved = false;
      for (const r of placed) {
        if (left < r.x + r.w && left + bw > r.x && top < r.y + r.h && top + bh > r.y) {
          top = r.y - bh - u;
          moved = true;
        }
      }
      if (home - top > bh + 2 * u || (top < 0 && top < home)) return;
    }
    placed.push({ x: left, y: top, w: bw, h: bh });
    const tailX = Math.round((head.x - left) / u) - 2;
    const spr = bubbleCanvas(wBucket, hArt, Math.max(4, Math.min(wBucket - 9, tailX)));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr, left, top, spr.width * u, spr.height * u);
    ctx.fillStyle = '#3a2a1e';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, left + padX * u, top + padY * u + i * lh));
  }

  function pick(cssX: number, cssY: number): number | null {
    const w = camera.screenToWorld(cssX * dpr, cssY * dpr);
    const radius = (PICK_RADIUS_CSS * dpr) / camera.scale;
    return pickCharacter(views, w.x, w.y, Math.max(radius, 8));
  }

  /* ---------- input ---------- */

  let down: { x: number; y: number; id: number; moved: boolean } | null = null;
  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: PointerEvent) => {
    const p = local(e);
    down = { ...p, id: e.pointerId, moved: false };
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const p = local(e);
    if (down && down.id === e.pointerId) {
      const dx = p.x - down.x;
      const dy = p.y - down.y;
      if (!down.moved && dx * dx + dy * dy < 25) return;
      down.moved = true;
      camera.panBy(dx * dpr, dy * dpr);
      down.x = p.x;
      down.y = p.y;
      return;
    }
    if (e.pointerType === 'mouse') {
      hovered = pick(p.x, p.y);
      canvas.style.cursor = hovered !== null ? 'pointer' : 'grab';
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!down || down.id !== e.pointerId) return;
    const wasDrag = down.moved;
    down = null;
    if (wasDrag) return;
    const p = local(e);
    opts.onSelect?.(pick(p.x, p.y));
  };
  const onCancel = () => {
    down = null;
  };
  const onLeave = () => {
    hovered = null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    const z = Math.min(4, Math.max(1, camera.zoom + (e.deltaY < 0 ? 1 : -1))) as ZoomLevel;
    if (z !== camera.zoom) camera.setZoom(z, p.x * dpr, p.y * dpr);
  };

  if (interactive) {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
  }

  function loop() {
    if (!running) return;
    render();
    raf = requestAnimationFrame(loop);
  }

  resize();

  return {
    camera,
    render,
    resize,
    pick,
    setZoom(z) {
      camera.setZoom(z);
    },
    zoomBy(delta) {
      const z = Math.min(4, Math.max(1, camera.zoom + delta)) as ZoomLevel;
      camera.setZoom(z);
    },
    focusTile(x, y) {
      camera.focusTile(x, y, wall());
    },
    start() {
      if (running) return;
      running = true;
      lastWall = 0;
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      if (interactive) {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onCancel);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('wheel', onWheel);
      }
    },
  };
}
