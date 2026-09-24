/**
 * Encounter helpers: who is near whom, the local gate, and who speaks in a rumor pair.
 * All integer per-mille. The engine scans pairs in (minId, maxId) order each tick.
 */
import type { Character, CharacterState } from './types';
import { TUNING } from './tuning';

export function chebyshev(a: CharacterState, b: CharacterState): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function pairKey(a: number, b: number): number {
  return a < b ? a * 1024 + b : b * 1024 + a;
}

/** Local gate chance per tick, per-mille, for an adjacent idle pair. */
export function gateChance(a: Character, b: Character, strength: number, rumorSpeaker: Character | null): number {
  const avgSoc = Math.trunc((a.traits.sociability + b.traits.sociability) / 2);
  let c = TUNING.gateBase + Math.trunc((avgSoc * TUNING.gateSociability) / 1000) + Math.trunc((strength * TUNING.gateStrength) / 1000);
  if (rumorSpeaker) c += Math.trunc((rumorSpeaker.traits.shareWillingness * TUNING.gateRumorShare) / 1000);
  return Math.min(1000, Math.max(0, c));
}

/** What the engine needs to know about a person's willingness to tell someone. */
export interface SpeakerView {
  character: Character;
  state: CharacterState;
  wantsToShare: boolean;
  maxShares: number;
  /** people told the rumor / told the correction today */
  toldRumor: ReadonlySet<number>;
  toldCorrection: ReadonlySet<number>;
}

/** Can `s` tell `listener` something today? */
export function canTell(s: SpeakerView, listener: SpeakerView): boolean {
  const k = s.state.rumor;
  if (!k) return false;
  if (!s.wantsToShare) return false;
  if (k.knowsCorrection) {
    if (listener.state.rumor?.knowsCorrection) return false;
    return s.toldCorrection.size < s.maxShares && !s.toldCorrection.has(listener.character.id);
  }
  return s.toldRumor.size < s.maxShares && !s.toldRumor.has(listener.character.id);
}

/**
 * Speaker rule: whoever knows; a correction-holder always speaks; if both know, the higher
 * shareWillingness x belief (ties: lower id). Falls back to the other person if the first cannot tell.
 */
export function chooseSpeaker(a: SpeakerView, b: SpeakerView): SpeakerView | null {
  const ka = a.state.rumor;
  const kb = b.state.rumor;
  const order: SpeakerView[] = [];
  if (ka && kb) {
    if (ka.knowsCorrection !== kb.knowsCorrection) order.push(ka.knowsCorrection ? a : b, ka.knowsCorrection ? b : a);
    else {
      const sa = a.character.traits.shareWillingness * ka.belief;
      const sb = b.character.traits.shareWillingness * kb.belief;
      order.push(sb > sa ? b : a, sb > sa ? a : b);
    }
  } else if (ka) order.push(a);
  else if (kb) order.push(b);
  for (const s of order) {
    const l = s === a ? b : a;
    if (canTell(s, l)) return s;
  }
  return null;
}
