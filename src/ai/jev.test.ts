import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', async (importOriginal) => ({ ...(await importOriginal<typeof import('ai')>()), experimental_evaluate: vi.fn() }));

import { experimental_evaluate } from 'ai';
import { BELIEF_SHIFT_RUNGS, decidePair, mapJevAnswers } from './jev';
import { decisionRequest, jevAnswers, samplePair } from './testHelpers';

const evaluate = vi.mocked(experimental_evaluate);

describe('decidePair', () => {
  beforeEach(() => {
    evaluate.mockReset();
    vi.stubEnv('AI_GATEWAY_EVALUATION_MODEL', '');
  });

  it('sends the pair as the state and asks six typed questions in one call', async () => {
    evaluate.mockResolvedValue({ answers: jevAnswers } as never);
    await decidePair(decisionRequest());
    expect(evaluate).toHaveBeenCalledTimes(1);
    const args = evaluate.mock.calls[0][0];
    expect(args.state).toEqual(samplePair);
    expect(args.model).toBe('typesafe-ai/jev');
    expect(args.maxRetries).toBe(0);
    const q = args.questions as Record<string, { type: string; criteria?: unknown }>;
    expect(Object.keys(q).sort()).toEqual(['beliefShift', 'challenges', 'mention', 'retelling', 'verify', 'willShare']);
    expect(q.mention.type).toBe('boolean');
    expect(q.challenges.type).toBe('boolean');
    expect(q.willShare.type).toBe('boolean');
    expect(q.verify.type).toBe('boolean');
    expect(q.beliefShift).toMatchObject({ type: 'score', criteria: [...BELIEF_SHIFT_RUNGS] });
    expect(q.retelling.type).toBe('choice');
    expect(Object.keys(q.retelling.criteria as object)).toEqual(['unchanged', 'shortened', 'softened', 'strengthened', 'distorted', 'corrected']);
    expect(JSON.stringify(q.retelling.criteria)).toContain('speakerVerified');
  });

  it('maps answers exactly as returned', async () => {
    evaluate.mockResolvedValue({ answers: jevAnswers } as never);
    await expect(decidePair(decisionRequest())).resolves.toEqual({
      mention: 0.8,
      beliefShift: 2.54,
      beliefShiftProbs: [0.01, 0.09, 0.25, 0.65, 0],
      retelling: 'distorted',
      challenges: 0.76,
      willShare: 0.17,
      verify: 0.81,
    });
  });

  it('builds rung probabilities from the score when none are returned', () => {
    const a = mapJevAnswers({ ...jevAnswers, beliefShift: { score: 2.25 } });
    expect(a.beliefShiftProbs).toEqual([0, 0, 0.75, 0.25, 0]);
    expect(mapJevAnswers({ ...jevAnswers, beliefShift: { score: 4 } }).beliefShiftProbs).toEqual([0, 0, 0, 0, 1]);
  });

  it('rejects an answer outside the schema with bad_output', () => {
    expect(() => mapJevAnswers({ ...jevAnswers, retelling: { choice: 'invented' } })).toThrowError(
      expect.objectContaining({ code: 'bad_output' }),
    );
  });
});
