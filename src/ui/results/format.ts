/**
 * Pure text helpers for the results views. No React, no engine. Every string here is UI copy:
 * plain words, short sentences, no numbers that describe traits or odds.
 */
import {
  DAY_END_TICK,
  formatTick,
  type MutationClass,
  type RunRecord,
  type RunStats,
  type SimEvent,
  type VariantNode,
} from '@/sim/types';

/** When the day ended: 8:00 PM if it ran out, else the tick the town went quiet. */
export function endTime(stats: RunStats): string {
  return stats.endReason === 'day_over' ? formatTick(DAY_END_TICK) : formatTick(stats.endedAtTick);
}

/** "By 6:40 PM, 31 of 50 people had heard it. 18 believed it." */
export function headline(stats: RunStats): string {
  const at = endTime(stats);
  const heard =
    stats.heard >= stats.population
      ? `all ${stats.population} people had heard it`
      : `${stats.heard} of ${stats.population} people had heard it`;
  const believed = stats.believed === 0 ? 'Nobody believed it.' : `${stats.believed} believed it.`;
  return `By ${at}, ${heard}. ${believed}`;
}

export function variantById(variants: readonly VariantNode[], id: string): VariantNode | undefined {
  return variants.find((v) => v.id === id);
}

/** Number of changes between the original and this version (the root has depth 0). */
export function variantDepth(variants: readonly VariantNode[], id: string): number {
  const byId = new Map(variants.map((v) => [v.id, v]));
  let depth = 0;
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && cur.parentId !== null && !seen.has(cur.id)) {
    seen.add(cur.id);
    depth++;
    cur = byId.get(cur.parentId);
  }
  return depth;
}

/** The note under the "started as / most people heard" pair. */
export function changeNote(record: Pick<RunRecord, 'stats' | 'variants'>): string {
  const id = record.stats.mostWidespreadVariantId;
  const n = id === 'v0' ? 0 : variantDepth(record.variants, id);
  if (n === 0) return 'It reached people mostly unchanged.';
  if (n === 1) return 'It changed once along the way.';
  return `It changed ${n} times along the way.`;
}

const MUTATION_WORDS: Record<MutationClass, string> = {
  unchanged: 'same',
  shortened: 'shortened',
  softened: 'softened',
  strengthened: 'made stronger',
  distorted: 'changed a detail',
  corrected: 'set straight',
};

export function mutationWord(m: MutationClass, isRoot = false): string {
  return isRoot ? 'the original' : MUTATION_WORDS[m];
}

export function personName(names: readonly string[] | undefined, id: number): string {
  return names?.[id] ?? `Person ${id + 1}`;
}

export interface StatItem {
  label: string;
  value: string;
  wide?: boolean;
}

export function statItems(record: Pick<RunRecord, 'stats' | 'variants'>): StatItem[] {
  const s = record.stats;
  const most = variantById(record.variants, s.mostChangedVariantId);
  const items: StatItem[] = [
    { label: 'People who heard it', value: `${s.heard} of ${s.population}` },
    { label: 'Believed it at the end', value: String(s.believed) },
    { label: 'Did not believe it', value: String(s.rejected) },
    { label: 'Told someone', value: String(s.shared) },
    { label: 'Talks about the rumor', value: String(s.rumorConversations) },
    { label: 'Versions', value: String(s.variantCount) },
    { label: 'Longest chain', value: `${s.longestChain} ${s.longestChain === 1 ? 'version' : 'versions'}` },
    { label: 'First set straight', value: s.firstCorrectionTick === null ? 'Never' : formatTick(s.firstCorrectionTick) },
  ];
  if (most && most.id !== 'v0') items.push({ label: 'Most changed version', value: most.text, wide: true });
  return items;
}

export interface Milestone {
  tick: number;
  time: string;
  text: string;
}

export function milestones(events: readonly SimEvent[]): Milestone[] {
  return events.filter((e) => e.type === 'milestone').map((e) => ({ tick: e.tick, time: formatTick(e.tick), text: e.text }));
}

export type SplitKey = 'believe' | 'unsure' | 'reject' | 'unheard';

/** Final belief split: believe / unsure or doubt / reject / never heard. Sums to the population. */
export function beliefSplit(stats: RunStats): Array<{ key: SplitKey; label: string; count: number }> {
  const unsure = Math.max(0, stats.heard - stats.believed - stats.rejected);
  return [
    { key: 'believe', label: 'Believe it', count: stats.believed },
    { key: 'unsure', label: 'Unsure or doubt it', count: unsure },
    { key: 'reject', label: 'Do not believe it', count: stats.rejected },
    { key: 'unheard', label: 'Never heard it', count: Math.max(0, stats.population - stats.heard) },
  ];
}
