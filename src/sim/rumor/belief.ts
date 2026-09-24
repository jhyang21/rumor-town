/**
 * Belief math. Belief is an integer 0..1000 meaning "how sure this person is that the ORIGINAL
 * rumor is true". Every result is clamped to 0..1000 and rounded to an integer.
 *
 * Rules (for the lead's review)
 * 1. Starter: belief = 850.
 * 2. First hearing of a rumor variant:
 *      belief = 500 + trustInSpeaker/4 - skepticism/4 + claimStrength*60
 *    First hearing of a CORRECTION: belief = 1000 - (500 + trustInSpeaker/4 - skepticism/4)
 *    (trusting the person who corrects you lowers your belief in the rumor).
 * 3. Every telling (first or repeat) then applies the Jev decision:
 *      r = sum(p_i * i) over beliefShiftProbs (rungs 0..4; falls back to answer.beliefShift if probs sum to 0)
 *      delta = round((r - 2) * 160 * exposureFactor * independenceFactor)
 *      exposureFactor = 1 / (1 + 0.5 * exposuresBefore)
 *      independenceFactor = 1.25 when the speaker is a new source, 0.8 when heard from them before
 *    For a correction the sign flips: being convinced by a correction lowers rumor belief.
 * 4. If the listener challenges: belief -= 40.
 * 5. Verification: confirmed -> 950; debunked -> 80; uncertain -> halfway toward 500 (rounded toward the old value).
 * Floats appear only inside step 3 and are rounded before they touch state.
 */
import type { DecisionAnswer } from '../oracle/types';
import type { TruthState } from '../types';
import { TUNING } from '../tuning';

export function clampBelief(v: number): number {
  return v < 0 ? 0 : v > 1000 ? 1000 : Math.round(v);
}

export function firstHearingBelief(trustInSpeaker: number, skepticism: number, claimStrength: number, isCorrection = false): number {
  const base = 500 + Math.trunc(trustInSpeaker / 4) - Math.trunc(skepticism / 4);
  if (isCorrection) return clampBelief(1000 - base);
  return clampBelief(base + claimStrength * 60);
}

export function expectedRung(answer: DecisionAnswer): number {
  const p = answer.beliefShiftProbs;
  let sum = 0;
  let r = 0;
  for (let i = 0; i < 5; i++) {
    const v = p[i] > 0 ? p[i] : 0;
    sum += v;
    r += v * i;
  }
  if (!(sum > 0)) return Math.min(4, Math.max(0, answer.beliefShift));
  return r / sum;
}

export function beliefDelta(answer: DecisionAnswer, exposuresBefore: number, sourceIsNew: boolean, isCorrection = false): number {
  const r = expectedRung(answer);
  const exposureFactor = 1 / (1 + 0.5 * exposuresBefore);
  const independence = sourceIsNew ? 1.25 : 0.8;
  const d = Math.round((r - 2) * 160 * exposureFactor * independence);
  return isCorrection ? -d : d;
}

export function applyDecision(
  belief: number,
  answer: DecisionAnswer,
  exposuresBefore: number,
  sourceIsNew: boolean,
  challenged: boolean,
  isCorrection = false,
): number {
  let b = belief + beliefDelta(answer, exposuresBefore, sourceIsNew, isCorrection);
  if (challenged) b -= TUNING.challengePenalty;
  return clampBelief(b);
}

export function verifiedBelief(belief: number, truth: TruthState): number {
  if (truth === 'true') return 950;
  if (truth === 'false') return 80;
  return clampBelief(belief + Math.trunc((500 - belief) / 2));
}
