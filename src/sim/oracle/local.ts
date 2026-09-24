/**
 * LocalOracle: a deterministic stand-in for Jev and GPT. Each answer comes from its own sfc32
 * seeded by (seed, requestId), so it does not depend on wall-clock or call timing. The one piece of
 * memory is "don't use the same opener twice in a row", which depends on call order only.
 *
 * Decisions read the trait words in the PairContext ("high (0.8)" or a bare word) and belief bands.
 * Probabilities are floats here (that is the contract); the engine turns them into integers.
 */
import type { BeliefBand, MutationClass, TruthState } from '../types';
import type {
  ConversationSpeechAnswer,
  ConversationSpeechRequest,
  DecisionAnswer,
  DecisionRequest,
  SpeechAnswer,
  SpeechRequest,
  SyncOracle,
  VerificationSpeechAnswer,
  VerificationSpeechRequest,
} from './types';
import { seeded, type Rng } from '../rng';
import { clip } from '../words';

const WORD_VALUE: Record<string, number> = {
  'very low': 0.1,
  low: 0.3,
  medium: 0.5,
  moderate: 0.5,
  high: 0.7,
  'very high': 0.9,
};

/** "high (0.8)" -> 0.8; "high" -> 0.7; unknown -> 0.5 */
export function parseTrait(s: string): number {
  const m = /\(([0-9]*\.?[0-9]+)\)/.exec(s);
  if (m) {
    const v = Number(m[1]);
    if (v >= 0 && v <= 1) return v;
  }
  const w = s.replace(/\(.*\)/, '').trim().toLowerCase();
  return WORD_VALUE[w] ?? 0.5;
}

const BAND_VALUE: Record<BeliefBand, number> = {
  rejects: 0.1,
  skeptical: 0.3,
  unsure: 0.5,
  believes: 0.7,
  strongly_believes: 0.9,
};

function bandValue(b: BeliefBand | 'never heard it'): number | null {
  return b === 'never heard it' ? null : BAND_VALUE[b];
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const unit = (rng: Rng) => rng.next() / 4294967296;
const noise = (rng: Rng, amp: number) => (unit(rng) * 2 - 1) * amp;

function weightedPick<T>(rng: Rng, items: ReadonlyArray<[T, number]>): T {
  let total = 0;
  for (const [, w] of items) total += Math.max(0, w);
  let r = unit(rng) * total;
  for (const [v, w] of items) {
    r -= Math.max(0, w);
    if (r < 0) return v;
  }
  return items[items.length - 1][0];
}

function lowerFirst(t: string): string {
  if (t.length < 2) return t;
  // keep "I" and proper names like "The Corner Café" readable: only lower a leading article/pronoun
  return /^(The|A|An|There|It|Some|Our|My|Your|This|That|They|He|She|We)\b/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

function words(t: string, max: number): string {
  const w = t.trim().split(/\s+/);
  if (w.length <= max) return t.trim();
  return `${w.slice(0, max).join(' ').replace(/[,.;:]+$/, '')}…`;
}

function stripEnd(t: string): string {
  return t.trim().replace(/[.!?…]+$/, '');
}

/* ---------- variant wording ---------- */

const DETAIL_SENTENCE: Record<string, string> = {
  'last Tuesday': 'It started last Tuesday.',
  'near the school': 'It was near the school.',
  'the mayor was there': 'The mayor was there.',
  'it cost a fortune': 'It cost a fortune.',
  'late at night': 'It happened late at night.',
  'it happened twice': 'It happened twice.',
};

const WRAPPERS: ReadonlyArray<RegExp> = [
  /^It's only a guess, but maybe /,
  /^Some say /,
  / Nobody is sure\.$/,
  / It's true\.$/,
  /^It's certain: /,
  / Everyone knows\.$/,
];

function coreOf(text: string): string {
  let t = text.trim();
  for (const s of Object.values(DETAIL_SENTENCE)) t = t.replace(` ${s}`, '');
  for (let i = 0; i < 3; i++) for (const w of WRAPPERS) t = t.replace(w, '');
  t = t.trim();
  return t.length > 0 ? t[0].toUpperCase() + t.slice(1) : text;
}

export function variantWording(parentText: string, claimStrength: number, details: readonly string[]): string {
  const core = coreOf(parentText);
  const c = stripEnd(core);
  let t: string;
  if (claimStrength <= -2) t = `It's only a guess, but maybe ${lowerFirst(c)}.`;
  else if (claimStrength === -1) t = `Some say ${lowerFirst(c)}. Nobody is sure.`;
  else if (claimStrength === 1) t = `${c}. It's true.`;
  else if (claimStrength >= 2) t = `It's certain: ${lowerFirst(c)}. Everyone knows.`;
  else t = `${c}.`;
  for (const d of details) t += ` ${DETAIL_SENTENCE[d] ?? `${d[0].toUpperCase()}${d.slice(1)}.`}`;
  return clip(t, 240);
}

/* ---------- speech templates ---------- */

const OPENERS: ReadonlyArray<(t: string, l: string) => string> = [
  (t) => `Did you hear? ${t}`,
  (t, l) => `${l}, you won't believe this. ${t}`,
  (t) => `So I heard that ${lowerFirst(t)}`,
  (t) => `Between us: ${t}`,
  (t) => `Word is, ${lowerFirst(t)}`,
  (t) => `Have you heard the news? ${t}`,
];

const CORRECTION_OPENERS: ReadonlyArray<(t: string, l: string) => string> = [
  (t) => `About that story going around. ${t}`,
  (t, l) => `${l}, that rumor isn't right. ${t}`,
  (t) => `I found out the real story. ${t}`,
];

const REPLY_CHALLENGE = ['Who told you that?', 'Are you sure about that?', 'Hmm, that doesn’t sound right to me.'];
const REPLY_CONVINCED = ['Wow, really? That’s big news.', 'Oh no, I had no idea!', 'That makes sense, actually.'];
const REPLY_DOUBT = ['I’m not so sure about that.', 'Maybe. I’d want to see it first.', 'That sounds a bit much.'];
const REPLY_NEUTRAL = ['Huh. Interesting.', 'Okay, good to know.', 'Hm, I’ll keep that in mind.'];
const REPLY_HEARD = ['I heard something like that already.', 'Yes, someone told me that too.'];
const REPLY_CORRECTION = ['Oh, good to know the real story.', 'Really? I’m glad you told me.', 'Hm, that’s not what I heard.'];
const SPEAKER_CLOSE = ['That’s what people are saying.', 'Don’t tell anyone I told you.', 'I’d check before you pass it on.', 'Anyway, see you later!'];
const LISTENER_CLOSE = ['I’ll keep my ears open.', 'Thanks for telling me.', 'Let’s see what happens.'];

export interface LocalOracleOptions {
  seed?: number;
}

export class LocalOracle implements SyncOracle {
  private readonly seed: number;
  private lastOpener = -1;

  constructor(opts: LocalOracleOptions = {}) {
    this.seed = (opts.seed ?? 0x10ca1) >>> 0;
  }

  private rngFor(requestId: number, salt: number): Rng {
    return seeded((this.seed ^ salt) >>> 0, requestId >>> 0);
  }

  decide(req: DecisionRequest): Promise<DecisionAnswer> {
    return Promise.resolve(this.decideSync(req));
  }

  speak(req: SpeechRequest): Promise<SpeechAnswer> {
    return Promise.resolve(this.speakSync(req));
  }

  decideSync(req: DecisionRequest): DecisionAnswer {
    const rng = this.rngFor(req.requestId, 0xdec1de);
    const p = req.pair;
    const soc = parseTrait(p.speaker.traits.sociability);
    const share = parseTrait(p.speaker.traits.willingnessToShare);
    const sSkep = parseTrait(p.speaker.traits.skepticism);
    const sBelief = BAND_VALUE[p.speaker.belief];
    const lSkep = parseTrait(p.listener.traits.skepticism);
    const lVerify = parseTrait(p.listener.traits.tendencyToVerify);
    const trust = parseTrait(p.listener.traits.trustInSpeaker);
    const lBelief = bandValue(p.listener.belief);
    const correcting = p.rumor.speakerVerified === 'debunked';

    const mention = clamp01(0.2 + 0.3 * soc + 0.35 * share + 0.3 * (sBelief - 0.5) + (correcting ? 0.1 : 0) + noise(rng, 0.05));

    let c = 2.25 + 1.8 * (trust - 0.5) - 1.8 * (lSkep - 0.5) + noise(rng, 0.35);
    if (p.rumor.speakerVerified === 'confirmed' || correcting) c += 0.6;
    if (lBelief !== null && !correcting) c += 0.5 * (lBelief - 0.5); // people lean toward what they already think
    if (c < 0) c = 0;
    if (c > 4) c = 4;
    const w = [0, 1, 2, 3, 4].map((i) => Math.max(0, 1 - Math.abs(i - c) / 1.5) + 0.03);
    const sum = w.reduce((a, b) => a + b, 0);
    const probs = w.map((x) => r3(x / sum)) as [number, number, number, number, number];
    const beliefShift = r3(probs.reduce((a, pi, i) => a + pi * i, 0));

    const retelling: MutationClass = correcting
      ? 'corrected'
      : weightedPick<MutationClass>(rng, [
          ['unchanged', 4],
          ['shortened', 1.2],
          ['softened', 0.3 + 2.2 * sSkep + (sBelief < 0.5 ? 1 : 0)],
          ['strengthened', 0.2 + 2.2 * share * (1 - sSkep) + (sBelief >= 0.7 ? 0.6 : 0)],
          ['distorted', 0.2 + 2.4 * share * soc * (1 - sSkep)],
        ]);

    const challenges = clamp01(0.05 + 0.75 * (lSkep - 0.35) - 0.25 * (trust - 0.5) + noise(rng, 0.05));
    const projected = c / 4;
    const willShare = clamp01(0.15 + 0.6 * projected + 0.2 * (1 - lSkep) + noise(rng, 0.05));
    const verify = clamp01(0.35 * lVerify * lVerify + 0.03 * lSkep - 0.05 + noise(rng, 0.03));

    return {
      mention: r3(mention),
      beliefShift,
      beliefShiftProbs: probs,
      retelling,
      challenges: r3(challenges),
      willShare: r3(willShare),
      verify: r3(verify),
    };
  }

  speakSync(req: SpeechRequest): SpeechAnswer {
    return req.kind === 'verification' ? this.verification(req) : this.conversation(req);
  }

  private conversation(req: ConversationSpeechRequest): ConversationSpeechAnswer {
    const rng = this.rngFor(req.requestId, 0x5bea4);
    const s = req.speaker.id;
    const l = req.listener.id;
    // The speech contract has no correction flag; a speaker who rejects the rumor is telling a correction.
    const correcting = req.newVariant?.mutation === 'corrected' || req.speaker.belief === 'rejects';
    const told = req.newVariant ? this.newVariantText(req, rng) : req.variantText;
    const spoken = words(told, 12);
    const pool = correcting ? CORRECTION_OPENERS : OPENERS;
    let idx = rng.int(0, pool.length - 1);
    if (idx === this.lastOpener) idx = (idx + 1) % pool.length;
    this.lastOpener = idx;
    const lines: Array<{ speakerId: number; text: string }> = [{ speakerId: s, text: clip(pool[idx](spoken, req.listener.name), 120) }];

    let reply: string;
    if (correcting) reply = rng.pick(REPLY_CORRECTION);
    else if (req.flags.challenges) reply = rng.pick(REPLY_CHALLENGE);
    else if (req.listener.alreadyHeard && rng.chance(600)) reply = rng.pick(REPLY_HEARD);
    else if (req.flags.listenerConvinced) reply = rng.pick(REPLY_CONVINCED);
    else if (req.flags.listenerDoubts) reply = rng.pick(REPLY_DOUBT);
    else reply = rng.pick(REPLY_NEUTRAL);
    lines.push({ speakerId: l, text: reply });

    const extra = rng.int(0, 2);
    if (extra >= 1) lines.push({ speakerId: s, text: req.flags.challenges ? 'That’s what I was told, anyway.' : rng.pick(SPEAKER_CLOSE) });
    if (extra >= 2) lines.push({ speakerId: l, text: rng.pick(LISTENER_CLOSE) });

    const out: ConversationSpeechAnswer = { lines };
    if (req.newVariant) out.newVariantText = told;
    return out;
  }

  private newVariantText(req: ConversationSpeechRequest, rng: Rng): string {
    const nv = req.newVariant!;
    if (nv.mutation === 'corrected') return clip(nv.correctionText ?? 'That story is not true.', 240);
    void rng;
    return variantWording(nv.parentText, nv.claimStrength, nv.details);
  }

  private verification(req: VerificationSpeechRequest): VerificationSpeechAnswer {
    const t = stripEnd(clip(req.rumorText, 180));
    return { authoritativeText: clip(verificationText(req.truth, t, req.place), 240) };
  }
}

export function verificationText(truth: TruthState, rumorCore: string, place: string): string {
  const lc = lowerFirst(stripEnd(rumorCore));
  if (truth === 'true') return `It checks out: ${lc}.`;
  if (truth === 'false') return `That story is not true. People at the ${place} say it never happened.`;
  return `Nobody can confirm it yet. No one at the ${place} knows if ${lc}.`;
}
