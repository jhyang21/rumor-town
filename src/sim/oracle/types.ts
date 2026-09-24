/**
 * Oracle contract: the ONLY way the engine obtains AI decisions (Jev) and language (GPT).
 * Implementations: LocalOracle (deterministic, sync-capable), LiveOracle (fetches /api routes),
 * ReplayOracle (answers from a recorded log). The engine never imports fetch or any AI SDK.
 *
 * "Jev decides. GPT speaks."
 */
import type { BeliefBand, MutationClass, TruthState } from '../types';

/* ---------- Decisions (Jev) ---------- */

/** Trait presentation for prompts: adjective band plus the number, e.g. "high (0.8)". Never ground truth. */
export interface PairContext {
  scene: { time: string; place: string; setting: 'busy' | 'quiet' | 'private' };
  rumor: {
    text: string; // the speaker's current variant text
    speakerSource: string; // "heard it from Mina (close friend)" | "started it"
    speakerVerified: 'no' | 'confirmed' | 'debunked';
    timesSpeakerHeard: number;
  };
  speaker: {
    name: string;
    occupation: string;
    persona: string;
    traits: { sociability: string; willingnessToShare: string; skepticism: string };
    belief: BeliefBand;
  };
  listener: {
    name: string;
    occupation: string;
    persona: string;
    traits: { skepticism: string; tendencyToVerify: string; trustInSpeaker: string };
    alreadyHeard: string; // "no" | "yes: <text they know>"
    belief: BeliefBand | 'never heard it';
  };
  relationship: string; // "neighbors, friendly, talk weekly"
}

export interface DecisionRequest {
  requestId: number;
  kind: 'encounter';
  tick: number;
  meetingId: number;
  pair: PairContext;
}

/** Probabilities are 0..1 floats exactly as the model returned them; the engine turns them into
 * integers/booleans with its own seeded stream so replay is deterministic. */
export interface DecisionAnswer {
  mention: number; // P(speaker brings up the rumor)
  /** expected rung 0..4 over ["much less convinced","somewhat less","no change","somewhat more","much more convinced"] */
  beliefShift: number;
  beliefShiftProbs: [number, number, number, number, number];
  retelling: MutationClass;
  challenges: number; // P(listener openly questions it)
  willShare: number; // P(listener passes it on today)
  verify: number; // P(listener tries to check the facts)
}

/* ---------- Speech (GPT) ---------- */

export interface ConversationSpeechRequest {
  requestId: number;
  kind: 'conversation';
  tick: number;
  meetingId: number;
  speaker: { id: number; name: string; persona: string; belief: BeliefBand };
  listener: { id: number; name: string; persona: string; belief: BeliefBand | 'never heard it'; alreadyHeard: boolean };
  variantText: string; // what the speaker says (current node text)
  flags: { challenges: boolean; listenerConvinced: boolean; listenerDoubts: boolean };
  /** set when the retelling creates a new variant node; GPT must write its wording */
  newVariant: null | {
    mutation: MutationClass;
    parentText: string;
    claimStrength: number; // -2..2 target
    details: string[]; // details the new node must keep; a distortion may add ONE small new one
    correctionText?: string; // for mutation === 'corrected'
  };
}

export interface VerificationSpeechRequest {
  requestId: number;
  kind: 'verification';
  tick: number;
  characterName: string;
  rumorText: string;
  truth: TruthState;
  place: string;
}

export type SpeechRequest = ConversationSpeechRequest | VerificationSpeechRequest;

export interface ConversationSpeechAnswer {
  lines: Array<{ speakerId: number; text: string }>; // 2..4 lines, each < 16 words
  newVariantText?: string; // present iff request.newVariant was set
}

export interface VerificationSpeechAnswer {
  /** one sentence the verifier learns, consistent with `truth`; becomes the correction node text */
  authoritativeText: string;
}

export type SpeechAnswer = ConversationSpeechAnswer | VerificationSpeechAnswer;

/* ---------- Oracle ---------- */

export interface Oracle {
  decide(req: DecisionRequest): Promise<DecisionAnswer>;
  speak(req: SpeechRequest): Promise<SpeechAnswer>;
}

/** LocalOracle also answers synchronously so the driver can resolve a timed-out request at once. */
export interface SyncOracle extends Oracle {
  decideSync(req: DecisionRequest): DecisionAnswer;
  speakSync(req: SpeechRequest): SpeechAnswer;
}

export type OracleSource = 'jev' | 'gpt' | 'local' | 'fallback' | 'replay';

export interface OracleLogEntry {
  requestId: number;
  kind: 'decide' | 'speak';
  request: DecisionRequest | SpeechRequest;
  response: DecisionAnswer | SpeechAnswer;
  source: OracleSource;
}
