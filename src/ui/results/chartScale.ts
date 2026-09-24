/** Pure scale and path helpers for SpreadChart. The day runs from tick 0 (8 AM) to 720 (8 PM). */
import { DAY_END_TICK, type SeriesPoint } from '@/sim/types';

export interface ChartBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const CHART_BOX: ChartBox = { width: 720, height: 300, left: 40, right: 104, top: 16, bottom: 32 };

export function xForTick(tick: number, box: ChartBox = CHART_BOX): number {
  const w = box.width - box.left - box.right;
  const t = Math.min(Math.max(tick, 0), DAY_END_TICK);
  return box.left + (t / DAY_END_TICK) * w;
}

export function yForCount(count: number, population: number, box: ChartBox = CHART_BOX): number {
  const h = box.height - box.top - box.bottom;
  const c = Math.min(Math.max(count, 0), population);
  return box.top + h - (population > 0 ? (c / population) * h : 0);
}

/** Inverse of xForTick, rounded and clamped to the day. */
export function tickForX(x: number, box: ChartBox = CHART_BOX): number {
  const w = box.width - box.left - box.right;
  const t = ((x - box.left) / w) * DAY_END_TICK;
  return Math.min(Math.max(Math.round(t), 0), DAY_END_TICK);
}

/** Hour marks every two hours: 8 AM, 10 AM, 12 PM, 2 PM, 4 PM, 6 PM, 8 PM. */
export function hourTicks(): Array<{ tick: number; label: string }> {
  const out: Array<{ tick: number; label: string }> = [];
  for (let h = 8; h <= 20; h += 2) {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    out.push({ tick: (h - 8) * 60, label: `${h12} ${h < 12 ? 'AM' : 'PM'}` });
  }
  return out;
}

/** People marks from 0 to the population with a round step; the population is always the top mark. */
export function countTicks(population: number): number[] {
  const step = population <= 50 ? 10 : 25;
  const out: number[] = [];
  for (let v = 0; v < population; v += step) if (population - v >= step / 2 || v === 0) out.push(v);
  out.push(population);
  return out;
}

export type SeriesKey = 'heard' | 'believing' | 'shared';

export function linePath(series: readonly SeriesPoint[], key: SeriesKey, population: number, box: ChartBox = CHART_BOX): string {
  return series
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForTick(p.tick, box).toFixed(1)},${yForCount(p[key], population, box).toFixed(1)}`)
    .join('');
}

/** Area under a line down to the zero baseline. */
export function areaPath(series: readonly SeriesPoint[], key: SeriesKey, population: number, box: ChartBox = CHART_BOX): string {
  if (series.length === 0) return '';
  const base = yForCount(0, population, box).toFixed(1);
  const first = xForTick(series[0].tick, box).toFixed(1);
  const last = xForTick(series[series.length - 1].tick, box).toFixed(1);
  return `${linePath(series, key, population, box)}L${last},${base}L${first},${base}Z`;
}

/** The recorded point at or just before `tick` (series sorted by tick); the first point before it starts. */
export function pointAt(series: readonly SeriesPoint[], tick: number): SeriesPoint | undefined {
  let found: SeriesPoint | undefined;
  for (const p of series) {
    if (p.tick > tick) break;
    found = p;
  }
  return found ?? series[0];
}

/**
 * Push end labels apart so they never overlap. Returns positions in the input order, each at least
 * `gap` from its neighbours and inside [min, max] when there is room.
 */
export function spreadLabels(ys: readonly number[], gap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const placed = order.map((o) => o.y);
  for (let k = 1; k < placed.length; k++) if (placed[k] - placed[k - 1] < gap) placed[k] = placed[k - 1] + gap;
  const overflow = placed.length ? placed[placed.length - 1] - max : 0;
  if (overflow > 0) {
    placed[placed.length - 1] = max;
    for (let k = placed.length - 2; k >= 0; k--) if (placed[k + 1] - placed[k] < gap) placed[k] = placed[k + 1] - gap;
  }
  if (placed.length && placed[0] < min) {
    const shift = min - placed[0];
    for (let k = 0; k < placed.length; k++) placed[k] += shift;
  }
  const out = new Array<number>(ys.length);
  order.forEach((o, k) => (out[o.i] = placed[k]));
  return out;
}
