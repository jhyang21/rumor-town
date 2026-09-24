/**
 * Jev decides. One `experimental_evaluate` call per meeting answers six behavior questions.
 * The state is the engine-built PairContext as given (no ground truth). Answers are returned as
 * floats exactly as Jev reports them; the engine turns them into outcomes with its seeded stream.
 */
import { experimental_evaluate as evaluate } from 'ai';
import type { DecisionAnswer, DecisionRequest, PairContext } from '@/sim/oracle/types';
import type { MutationClass } from '@/sim/types';
import { decisionAnswerSchema } from './schemas';
import { AiError, evaluationModelId, timed, withRetry } from './gateway';

export const BELIEF_SHIFT_RUNGS = [
  'much less convinced',
  'somewhat less convinced',
  'no change',
  'somewhat more convinced',
  'much more convinced',
] as const;

export const RETELLING_CRITERIA: Record<MutationClass, string> = {
  unchanged:
    'The speaker repeats the story the same way they heard it. Usual when nothing about the speaker or the moment pushes the wording one way or another.',
  shortened:
    'The speaker tells a shorter version and leaves parts out. Usual in a busy setting, or when the speaker has low sociability or little interest in the story.',
  softened:
    'The speaker adds doubt, such as "I might be wrong" or "someone said". Usual when the speaker has high skepticism or their belief is unsure or skeptical.',
  strengthened:
    'The speaker states it as certain fact. Usual when the speaker strongly believes it, has very high willingness to share, and low skepticism.',
  distorted:
    'The speaker changes a fact or mixes in a new detail. Usual for very sociable, very eager sharers with low skepticism who heard it second hand.',
  corrected:
    'The speaker tells the checked version: that the story was confirmed or shown to be wrong. Only possible when rumor.speakerVerified is "confirmed" or "debunked", or the speaker already knows a correction.',
};

/** The six questions, in one evaluate call. Exported for tests and calibration. */
export const DECISION_QUESTIONS = {
  mention: {
    type: 'boolean',
    instructions:
      'The speaker and the listener meet and chat. Does the speaker bring up the rumor in this conversation? Weigh the speaker\'s willingness to share and sociability, their belief, the relationship, and the setting.',
  },
  beliefShift: {
    type: 'score',
    instructions:
      'Suppose the speaker tells the listener the rumor. How does the listener\'s belief in the rumor move after this exchange? Weigh the listener\'s skepticism, their trust in the speaker, what they already heard, and whether the speaker checked the facts.',
    criteria: [...BELIEF_SHIFT_RUNGS],
  },
  retelling: {
    type: 'choice',
    instructions:
      'Suppose the speaker tells the rumor in this conversation. How does the speaker word it this time, compared with rumor.text?',
    criteria: RETELLING_CRITERIA,
  },
  challenges: {
    type: 'boolean',
    instructions:
      'Suppose the speaker tells the rumor. Does the listener openly question the story, for example by asking who said so or saying they doubt it?',
  },
  willShare: {
    type: 'boolean',
    instructions: 'Suppose the listener hears the rumor now. Will the listener pass it on to someone else later today?',
  },
  verify: {
    type: 'boolean',
    instructions:
      'Suppose the listener hears the rumor now. Will the listener try to check the facts, for example by asking someone who would know or going to see for themselves?',
  },
} as const;

/** Jev state: the engine's PairContext, unchanged. */
type JevState = Parameters<typeof evaluate>[0]['state'];

export function buildJevState(pair: PairContext): JevState {
  return pair as unknown as JevState;
}

interface JevAnswers {
  mention: { probability: number };
  beliefShift: { score: number; probabilities?: Record<string, number> };
  retelling: { choice: string };
  challenges: { probability: number };
  willShare: { probability: number };
  verify: { probability: number };
}

/**
 * Rung probabilities in order. Jev returns a distribution; when a model does not, spread the
 * mass over the two rungs around the score so the mean still equals the score.
 */
function rungProbs(score: number, probs?: Record<string, number>): DecisionAnswer['beliefShiftProbs'] {
  if (probs && [0, 1, 2, 3, 4].every((i) => typeof probs[String(i)] === 'number')) {
    return [probs['0'], probs['1'], probs['2'], probs['3'], probs['4']];
  }
  const s = Math.min(4, Math.max(0, score));
  const lo = Math.floor(s);
  const out: DecisionAnswer['beliefShiftProbs'] = [0, 0, 0, 0, 0];
  if (lo === 4) out[4] = 1;
  else {
    out[lo] = lo + 1 - s;
    out[lo + 1] = s - lo;
  }
  return out;
}

export function mapJevAnswers(a: JevAnswers): DecisionAnswer {
  const answer = {
    mention: a.mention.probability,
    beliefShift: a.beliefShift.score,
    beliefShiftProbs: rungProbs(a.beliefShift.score, a.beliefShift.probabilities),
    retelling: a.retelling.choice,
    challenges: a.challenges.probability,
    willShare: a.willShare.probability,
    verify: a.verify.probability,
  };
  const parsed = decisionAnswerSchema.safeParse(answer);
  if (!parsed.success) throw new AiError('bad_output', 'Jev answer did not match the decision schema');
  return parsed.data;
}

export interface JevCallOptions {
  abortSignal?: AbortSignal;
}

export async function decidePair(req: DecisionRequest, opts: JevCallOptions = {}): Promise<DecisionAnswer> {
  return timed('jev.decide', () =>
    withRetry(
      async () => {
        const result = await evaluate({
          model: evaluationModelId(),
          state: buildJevState(req.pair),
          questions: DECISION_QUESTIONS,
          maxRetries: 0,
          abortSignal: opts.abortSignal,
        });
        return mapJevAnswers(result.answers as unknown as JevAnswers);
      },
      { label: 'jev.decide', abortSignal: opts.abortSignal },
    ),
  );
}
