/**
 * Verification: a listener who decides to check the facts does so 20..40 ticks later where they are.
 * Outcome by truth:
 *   true      -> verified 'confirmed', belief 950, becomes a strong believer (no correction)
 *   false     -> verified 'debunked', belief 80, knowsCorrection, correction node created
 *   uncertain -> verified stays 'none' (the contract has no "unclear" value), belief halfway to 500,
 *                knowsCorrection, correction node created ("nobody can confirm it")
 */
import type { RumorKnowledge, TruthState } from '../types';
import type { Rng } from '../rng';
import { TUNING } from '../tuning';
import { verifiedBelief } from './belief';

export interface PendingVerification {
  characterId: number;
  tick: number;
  locationId: string;
  /** VerificationSpeechRequest id, or null when the text is known already */
  requestId: number | null;
}

export function verificationDelay(rng: Rng): number {
  return rng.int(TUNING.verifyMinDelay, TUNING.verifyMaxDelay);
}

/** Mutates `k`; returns whether a correction results. */
export function applyVerification(k: RumorKnowledge, truth: TruthState): { correction: boolean } {
  k.belief = verifiedBelief(k.belief, truth);
  if (truth === 'true') {
    k.verified = 'confirmed';
    k.knowsCorrection = false;
    return { correction: false };
  }
  k.verified = truth === 'false' ? 'debunked' : 'none';
  k.knowsCorrection = true;
  return { correction: true };
}
