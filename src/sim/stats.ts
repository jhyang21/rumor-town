/** Run statistics and the time series for the results page. */
import type { BeliefBand, CharacterState, RunStats, SeriesPoint } from './types';
import { beliefBand } from './types';
import type { VariantLattice } from './rumor/variants';

export const SERIES_EVERY = 10;

export function seriesPoint(tick: number, states: readonly CharacterState[]): SeriesPoint {
  let heard = 0;
  let believing = 0;
  let shared = 0;
  for (const s of states) {
    if (!s.rumor) continue;
    heard++;
    if (s.rumor.belief >= 600) believing++;
    if (s.rumor.sharedWithIds.length > 0) shared++;
  }
  return { tick, heard, believing, shared };
}

const BANDS: readonly BeliefBand[] = ['rejects', 'skeptical', 'unsure', 'believes', 'strongly_believes'];

export interface StatsInput {
  states: readonly CharacterState[];
  lattice: VariantLattice;
  rumorConversations: number;
  firstCorrectionTick: number | null;
  endedAtTick: number;
  endReason: 'day_over' | 'quiet';
  gptCalls: number;
  jevCalls: number;
}

export function computeStats(i: StatsInput): RunStats {
  const counts = new Map<BeliefBand, number>(BANDS.map((b) => [b, 0]));
  let heard = 0;
  let believed = 0;
  let shared = 0;
  let rejected = 0;
  for (const s of i.states) {
    if (!s.rumor) continue;
    heard++;
    const band = beliefBand(s.rumor.belief);
    counts.set(band, counts.get(band)! + 1);
    if (band === 'believes' || band === 'strongly_believes') believed++;
    if (band === 'rejects') rejected++;
    if (s.rumor.sharedWithIds.length > 0) shared++;
  }
  let dominant: BeliefBand = 'unsure';
  let best = -1;
  for (const b of BANDS) {
    const c = counts.get(b)!;
    if (c > best) {
      best = c;
      dominant = b;
    }
  }
  return {
    population: i.states.length,
    heard,
    believed,
    shared,
    rejected,
    rumorConversations: i.rumorConversations,
    variantCount: i.lattice.nodes.length,
    longestChain: i.lattice.longestChain(),
    mostWidespreadVariantId: i.lattice.mostWidespread(),
    mostChangedVariantId: i.lattice.mostChanged(),
    firstCorrectionTick: i.firstCorrectionTick,
    dominantBelief: dominant,
    endedAtTick: i.endedAtTick,
    endReason: i.endReason,
    gptCalls: i.gptCalls,
    jevCalls: i.jevCalls,
  };
}
