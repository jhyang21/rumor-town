/**
 * Zod schemas for every API body the browser sends and every answer the server returns.
 * The server trusts nothing from the client that is not validated here.
 * Keep in sync with src/sim/types.ts and src/sim/oracle/types.ts (the TS contracts win).
 */
import { z } from 'zod';

export const MUTATION_CLASSES = ['unchanged', 'shortened', 'softened', 'strengthened', 'distorted', 'corrected'] as const;
export const BELIEF_BANDS = ['rejects', 'skeptical', 'unsure', 'believes', 'strongly_believes'] as const;
export const TRUTH_STATES = ['true', 'false', 'uncertain'] as const;

/** Error codes the AI layer reports to the client (never model text). */
export const AI_ERROR_CODES = [
  'auth',
  'funds',
  'quota',
  'verification',
  'rate',
  'unavailable',
  'bad_output',
  'unknown',
] as const;
export const aiErrorCodeSchema = z.enum(AI_ERROR_CODES);

/** Non-200 JSON bodies from the AI routes. `code` also covers 'cap', 'busy', 'token', 'bad_request'. */
export const apiErrorSchema = z.object({
  code: z.string().max(40),
  actionUrl: z.string().url().optional(),
});

export const RUMOR_MAX_CHARS = 140;
export const MAX_DECIDE_PAIRS_PER_REQUEST = 4;
export const MAX_ORACLE_LOG_BYTES = 200 * 1024;

const shortText = (max: number) => z.string().trim().min(1).max(max);
const traitText = shortText(40);
const beliefBand = z.enum(BELIEF_BANDS);
const beliefOrNever = z.union([beliefBand, z.literal('never heard it')]);

/* ---------- /api/runs/start ---------- */

export const runOverridesSchema = z.object({
  skepticismBias: z.number().int().min(-2).max(2).optional(),
  sociabilityBias: z.number().int().min(-2).max(2).optional(),
  starterId: z.number().int().min(0).max(74).optional(),
});

export const rumorSpecSchema = z.object({
  text: shortText(RUMOR_MAX_CHARS),
  truth: z.enum(TRUTH_STATES),
  presetId: z.string().max(40).optional(),
  verifiedText: z.string().max(240).optional(),
});

export const runConfigSchema = z.object({
  population: z.union([z.literal(30), z.literal(50), z.literal(75)]),
  rumor: rumorSpecSchema,
  townSeed: z.number().int().min(0).max(0xffffffff),
  runSeed: z.number().int().min(0).max(0xffffffff),
  overrides: runOverridesSchema.default({}),
});

export const runStartBodySchema = z.object({ config: runConfigSchema });

export const runCapsSchema = z.object({ decide: z.number().int().positive(), speak: z.number().int().positive() });

export const runStartResponseSchema = z.object({ runId: z.string(), token: z.string(), caps: runCapsSchema });

/** Signed token payload (HMAC over the JSON). Caps are enforced server-side per token. */
export const runTokenPayloadSchema = z.object({
  runId: z.string().min(8).max(40),
  exp: z.number().int(), // unix seconds
  caps: runCapsSchema,
});

/* ---------- /api/decide (Jev) ---------- */

export const pairContextSchema = z.object({
  scene: z.object({ time: shortText(12), place: shortText(40), setting: z.enum(['busy', 'quiet', 'private']) }),
  rumor: z.object({
    text: shortText(240),
    speakerSource: shortText(80),
    speakerVerified: z.enum(['no', 'confirmed', 'debunked']),
    timesSpeakerHeard: z.number().int().min(0).max(50),
  }),
  speaker: z.object({
    name: shortText(30),
    occupation: shortText(30),
    persona: shortText(120),
    traits: z.object({ sociability: traitText, willingnessToShare: traitText, skepticism: traitText }),
    belief: beliefBand,
  }),
  listener: z.object({
    name: shortText(30),
    occupation: shortText(30),
    persona: shortText(120),
    traits: z.object({ skepticism: traitText, tendencyToVerify: traitText, trustInSpeaker: traitText }),
    alreadyHeard: shortText(260),
    belief: beliefOrNever,
  }),
  relationship: shortText(80),
});

export const decisionRequestSchema = z.object({
  requestId: z.number().int().min(0),
  kind: z.literal('encounter'),
  tick: z.number().int().min(0).max(720),
  meetingId: z.number().int().min(0),
  pair: pairContextSchema,
});

export const decideBodySchema = z.object({
  token: z.string().min(16).max(600),
  requests: z.array(decisionRequestSchema).min(1).max(MAX_DECIDE_PAIRS_PER_REQUEST),
});

const prob = z.number().min(0).max(1);

export const decisionAnswerSchema = z.object({
  mention: prob,
  beliefShift: z.number().min(0).max(4),
  beliefShiftProbs: z.tuple([prob, prob, prob, prob, prob]),
  retelling: z.enum(MUTATION_CLASSES),
  challenges: prob,
  willShare: prob,
  verify: prob,
});

/** One item per request: a Jev answer, or an error code (the client then asks its LocalOracle). */
export const decideResponseItemSchema = z.union([
  z.object({ requestId: z.number().int(), answer: decisionAnswerSchema, source: z.literal('jev') }),
  z.object({ requestId: z.number().int(), error: aiErrorCodeSchema }),
]);

export const decideResponseSchema = z.object({ answers: z.array(decideResponseItemSchema) });

/* ---------- /api/speak (GPT) ---------- */

const speechPerson = z.object({ id: z.number().int().min(0), name: shortText(30), persona: shortText(120) });

export const conversationSpeechRequestSchema = z.object({
  requestId: z.number().int().min(0),
  kind: z.literal('conversation'),
  tick: z.number().int().min(0).max(720),
  meetingId: z.number().int().min(0),
  speaker: speechPerson.extend({ belief: beliefBand }),
  listener: speechPerson.extend({ belief: beliefOrNever, alreadyHeard: z.boolean() }),
  variantText: shortText(240),
  flags: z.object({ challenges: z.boolean(), listenerConvinced: z.boolean(), listenerDoubts: z.boolean() }),
  newVariant: z
    .object({
      mutation: z.enum(MUTATION_CLASSES),
      parentText: shortText(240),
      claimStrength: z.number().int().min(-2).max(2),
      details: z.array(shortText(40)).max(2),
      correctionText: shortText(240).optional(),
    })
    .nullable(),
});

export const verificationSpeechRequestSchema = z.object({
  requestId: z.number().int().min(0),
  kind: z.literal('verification'),
  tick: z.number().int().min(0).max(720),
  characterName: shortText(30),
  rumorText: shortText(240),
  truth: z.enum(TRUTH_STATES),
  place: shortText(40),
});

export const speechRequestSchema = z.discriminatedUnion('kind', [
  conversationSpeechRequestSchema,
  verificationSpeechRequestSchema,
]);

export const speakBodySchema = z.object({
  token: z.string().min(16).max(600),
  request: speechRequestSchema,
});

/** What GPT must return for a conversation (used as the structured-output schema too). */
export const conversationSpeechAnswerSchema = z.object({
  lines: z.array(z.object({ speakerId: z.number().int().min(0), text: shortText(120) })).min(2).max(4),
  newVariantText: shortText(240).optional(),
});

export const verificationSpeechAnswerSchema = z.object({ authoritativeText: shortText(240) });

export const speakResponseSchema = z.union([
  z.object({
    requestId: z.number().int(),
    answer: z.union([conversationSpeechAnswerSchema, verificationSpeechAnswerSchema]),
    source: z.literal('gpt'),
  }),
  z.object({ requestId: z.number().int(), error: aiErrorCodeSchema }),
]);

/* ---------- /api/moderate ---------- */

export const moderateBodySchema = z.object({ text: shortText(RUMOR_MAX_CHARS) });

export const moderateResponseSchema = z.object({
  allowed: z.boolean(),
  /** shown to the user when blocked; plain words, never model text */
  reason: z.enum(['ok', 'real_person', 'harmful', 'hateful', 'sexual', 'unclear']),
});

/* ---------- /api/runs ---------- */

export const oracleLogEntrySchema = z.object({
  requestId: z.number().int().min(0),
  kind: z.enum(['decide', 'speak']),
  request: z.union([decisionRequestSchema, speechRequestSchema]),
  response: z.union([decisionAnswerSchema, conversationSpeechAnswerSchema, verificationSpeechAnswerSchema]),
  source: z.enum(['jev', 'gpt', 'local', 'fallback', 'replay']),
});

export const runsPostBodySchema = z.object({
  token: z.string().min(16).max(600),
  config: runConfigSchema,
  oracleLog: z.array(oracleLogEntrySchema).max(600),
  /** the client's final hash; the server recomputes it and rejects on mismatch */
  finalHash: z.string().min(8).max(64),
});

export const runsPostResponseSchema = z.object({ id: z.string(), url: z.string() });

export type RunsPostBody = z.infer<typeof runsPostBodySchema>;
export type DecideBody = z.infer<typeof decideBodySchema>;
export type SpeakBody = z.infer<typeof speakBodySchema>;
export type ModerateResponse = z.infer<typeof moderateResponseSchema>;
export type AiErrorCode = z.infer<typeof aiErrorCodeSchema>;
export type RumorSpecBody = z.infer<typeof rumorSpecSchema>;
export type DecideResponse = z.infer<typeof decideResponseSchema>;
export type SpeakResponse = z.infer<typeof speakResponseSchema>;
export type RunStartResponse = z.infer<typeof runStartResponseSchema>;
