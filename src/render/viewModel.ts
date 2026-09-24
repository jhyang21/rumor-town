/**
 * Per-frame derived state for the renderer. Pure: no DOM, no timers. The caller passes the view
 * clock (ms that only advance while the town is not paused) so tests control time.
 *
 * - Positions: each character is drawn between the tile it stood on last tick and the tile it stands
 *   on now, by the driver's alpha. Jumps longer than 2 tiles (going inside, several ticks in one
 *   frame) snap.
 * - Bubbles: one bubble per speaker at a time. Each line stays at least BUBBLE_MIN_MS of view clock.
 *   Lines that arrive while one is showing wait in a short queue; at 5x only the newest waits.
 */
import type { CharacterState, Facing } from '@/sim/types';
import type { Bubble } from '@/sim/engine';
import { TILE_PX } from '@/sim/town/mapSpec';
import { WALK_CYCLE, type WalkFrame } from '@/art/characters';

export const BUBBLE_MIN_MS = 1100;
export const THINKING_TEXT = '…';
const QUEUE_CAP = 3;

/* ---------- positions ---------- */

export interface CharacterView {
  id: number;
  /** world pixels of the sprite's top-left */
  px: number;
  py: number;
  facing: Facing;
  frame: WalkFrame;
  visible: boolean;
  moving: boolean;
}

export class PositionTracker {
  private prevX: number[] = [];
  private prevY: number[] = [];
  private curX: number[] = [];
  private curY: number[] = [];
  private dist: number[] = [];
  private lastTick = -1;
  readonly views: CharacterView[] = [];

  reset(): void {
    this.prevX = [];
    this.prevY = [];
    this.curX = [];
    this.curY = [];
    this.dist = [];
    this.lastTick = -1;
    this.views.length = 0;
  }

  update(states: readonly CharacterState[], tick: number, alpha: number): readonly CharacterView[] {
    const n = states.length;
    if (tick < this.lastTick || this.curX.length !== n) {
      this.reset();
      for (const s of states) {
        this.prevX[s.id] = this.curX[s.id] = s.x;
        this.prevY[s.id] = this.curY[s.id] = s.y;
        this.dist[s.id] = 0;
      }
      this.lastTick = tick;
    } else if (tick !== this.lastTick) {
      for (const s of states) {
        const i = s.id;
        // finish the old move before starting the new one
        this.dist[i] += Math.abs(this.curX[i] - this.prevX[i]) + Math.abs(this.curY[i] - this.prevY[i]);
        const far = Math.abs(s.x - this.curX[i]) + Math.abs(s.y - this.curY[i]) > 2;
        this.prevX[i] = far ? s.x : this.curX[i];
        this.prevY[i] = far ? s.y : this.curY[i];
        this.curX[i] = s.x;
        this.curY[i] = s.y;
      }
      this.lastTick = tick;
    }
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    for (const s of states) {
      const i = s.id;
      const dx = this.curX[i] - this.prevX[i];
      const dy = this.curY[i] - this.prevY[i];
      const moving = dx !== 0 || dy !== 0;
      const d = this.dist[i] + (Math.abs(dx) + Math.abs(dy)) * a;
      const v: CharacterView = (this.views[i] ??= { id: i, px: 0, py: 0, facing: 'down', frame: 0, visible: true, moving: false });
      v.px = (this.prevX[i] + dx * a) * TILE_PX;
      v.py = (this.prevY[i] + dy * a) * TILE_PX;
      v.facing = s.facing;
      v.moving = moving;
      v.frame = moving ? WALK_CYCLE[Math.floor(d * 2) % WALK_CYCLE.length] : 0;
      v.visible = s.activity !== 'inside';
    }
    this.views.length = n;
    return this.views;
  }
}

/** Nearest visible character whose sprite center is within `radius` world px, or null. */
export function pickCharacter(views: readonly CharacterView[], wx: number, wy: number, radius: number): number | null {
  let best: number | null = null;
  let bestD = radius * radius;
  for (const v of views) {
    if (!v.visible) continue;
    const cx = v.px + TILE_PX / 2;
    const cy = v.py + TILE_PX / 2;
    const d = (cx - wx) * (cx - wx) + (cy - wy) * (cy - wy);
    if (d <= bestD) {
      bestD = d;
      best = v.id;
    }
  }
  return best;
}

/* ---------- bubbles ---------- */

export interface ShownBubble {
  key: string;
  speakerId: number;
  text: string;
  /** view-clock ms when it first showed */
  startMs: number;
}

function bubbleKey(b: Bubble): string {
  return `${b.speakerId}|${b.fromTick}|${b.text}`;
}

export class BubbleTimer {
  private readonly shown = new Map<number, ShownBubble>();
  private readonly queues = new Map<number, Array<{ key: string; text: string }>>();
  private readonly seen = new Map<string, number>(); // key -> fromTick

  reset(): void {
    this.shown.clear();
    this.queues.clear();
    this.seen.clear();
  }

  /**
   * @param active bubbles the engine shows this tick (the "…" thinking marker is skipped here)
   * @param fast true at 5x: only the newest waiting line per speaker is kept
   */
  update(active: readonly Bubble[], tick: number, nowMs: number, fast: boolean): ShownBubble[] {
    const activeKeys = new Set<string>();
    for (const b of active) {
      if (b.text === THINKING_TEXT) continue;
      const key = bubbleKey(b);
      activeKeys.add(key);
      if (this.seen.has(key)) continue;
      this.seen.set(key, b.fromTick);
      const q = this.queues.get(b.speakerId) ?? [];
      q.push({ key, text: b.text });
      while (q.length > QUEUE_CAP) q.shift();
      this.queues.set(b.speakerId, q);
    }
    if (fast) for (const q of this.queues.values()) while (q.length > 1) q.shift();

    const speakers = new Set<number>([...this.shown.keys(), ...this.queues.keys()]);
    for (const id of speakers) {
      const cur = this.shown.get(id);
      const q = this.queues.get(id);
      const ripe = !cur || nowMs - cur.startMs >= BUBBLE_MIN_MS;
      if (q && q.length > 0 && ripe) {
        const next = q.shift()!;
        this.shown.set(id, { key: next.key, speakerId: id, text: next.text, startMs: nowMs });
      } else if (cur && ripe && !activeKeys.has(cur.key)) {
        this.shown.delete(id);
      }
      if (q && q.length === 0) this.queues.delete(id);
    }

    for (const [k, from] of this.seen) if (from < tick - 60) this.seen.delete(k);
    return [...this.shown.values()].sort((a, b) => a.speakerId - b.speakerId);
  }
}

/* ---------- text ---------- */

/** Wrap on word boundaries to at most `maxLines` lines of `maxChars`; the last line ends in "…" when cut. */
export function wrapText(text: string, maxChars = 24, maxLines = 3): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let i = 0;
  for (; i < words.length; i++) {
    let w = words[i];
    if (w.length > maxChars) w = w.slice(0, maxChars - 1) + '…';
    const next = line ? `${line} ${w}` : w;
    if (next.length <= maxChars) {
      line = next;
      continue;
    }
    lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) {
    lines.push(line);
    line = '';
  }
  if (i < words.length || line) {
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] = (last.length >= maxChars ? last.slice(0, maxChars - 1) : last) + '…';
  }
  return lines;
}
