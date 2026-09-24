/**
 * Timeline events and the milestone detector. The engine writes one plain sentence per event.
 * One-shot milestones (first transmission, first mutation, first correction, major contradiction) use
 * `once`; threshold milestones come from `observe`, called once per tick.
 */
import type { MilestoneKind, SimEvent } from './types';
import { FADING_TICKS } from './types';

export interface MilestoneInput {
  tick: number;
  population: number;
  heard: number;
  /** variant held by the most people (ties: lower index), and how many hold it */
  dominantVariantId: string | null;
  dominantHolders: number;
  /** consecutive rumor-quiet ticks (0 while anything rumor-related is happening) */
  quietTicks: number;
}

export const DOMINANT_MIN_HOLDERS = 5;

export class MilestoneTracker {
  private readonly done = new Set<MilestoneKind>();
  private dominant: string | null = null;
  private readonly announced = new Set<string>();
  private fadingArmed = true;

  /** true the first time `kind` is seen */
  once(kind: MilestoneKind): boolean {
    if (this.done.has(kind)) return false;
    this.done.add(kind);
    return true;
  }

  has(kind: MilestoneKind): boolean {
    return this.done.has(kind);
  }

  observe(i: MilestoneInput): Array<{ kind: MilestoneKind; variantId?: string }> {
    const out: Array<{ kind: MilestoneKind; variantId?: string }> = [];
    for (const [kind, p] of [
      ['heard_25', 25],
      ['heard_50', 50],
      ['heard_75', 75],
    ] as const) {
      if (i.heard * 100 >= i.population * p && this.once(kind)) out.push({ kind });
    }
    if (i.dominantVariantId !== null && i.dominantHolders >= DOMINANT_MIN_HOLDERS) {
      // each variant is announced as the new leader at most once, so a close race does not flicker
      if (this.dominant === null) {
        this.dominant = i.dominantVariantId;
        this.announced.add(i.dominantVariantId);
      } else if (this.dominant !== i.dominantVariantId) {
        this.dominant = i.dominantVariantId;
        if (!this.announced.has(i.dominantVariantId)) {
          this.announced.add(i.dominantVariantId);
          out.push({ kind: 'new_dominant_variant', variantId: i.dominantVariantId });
        }
      }
    }
    if (i.quietTicks === 0) this.fadingArmed = true;
    else if (i.quietTicks >= FADING_TICKS && this.fadingArmed) {
      this.fadingArmed = false;
      out.push({ kind: 'fading' });
    }
    return out;
  }
}

export function milestoneEvent(tick: number, milestone: MilestoneKind, text: string, characterIds: number[] = [], extra: Partial<SimEvent> = {}): SimEvent {
  return { tick, type: 'milestone', milestone, text, characterIds, ...extra };
}

export const MILESTONE_TEXT: Partial<Record<MilestoneKind, string>> = {
  heard_25: 'A quarter of the town has now heard the rumor.',
  heard_50: 'Half the town has now heard the rumor.',
  heard_75: 'Three in four people have now heard the rumor.',
  fading: 'The rumor is fading. Nobody has talked about it for an hour.',
};
