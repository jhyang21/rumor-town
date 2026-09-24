/** Plain words the town UI shows. Never numbers for traits or belief. */
import type { BeliefBand, Traits } from '@/sim/types';

export const BELIEF_STEPS: readonly BeliefBand[] = ['rejects', 'skeptical', 'unsure', 'believes', 'strongly_believes'];

export const BELIEF_WORDS: Record<BeliefBand, string> = {
  rejects: 'Doesn’t buy it',
  skeptical: 'Doubts it',
  unsure: 'Not sure',
  believes: 'Believes it',
  strongly_believes: 'Sure it’s true',
};

export const TRAIT_LABELS: ReadonlyArray<[keyof Traits, string]> = [
  ['sociability', 'Chats with people'],
  ['shareWillingness', 'Passes news on'],
  ['skepticism', 'Doubts things'],
  ['verifyTendency', 'Checks the facts'],
];

export const TRAIT_WORDS: Record<string, string> = {
  'very low': 'hardly',
  low: 'a little',
  medium: 'some',
  high: 'a lot',
  'very high': 'all the time',
};
