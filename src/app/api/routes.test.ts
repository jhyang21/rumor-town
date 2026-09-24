import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  experimental_evaluate: vi.fn(),
  generateText: vi.fn(),
}));

import { experimental_evaluate, generateText } from 'ai';
import { POST as decidePOST } from './decide/route';
import { POST as speakPOST } from './speak/route';
import { POST as startPOST } from './runs/start/route';
import { POST as moderatePOST } from './moderate/route';
import { issueRunToken, resetTokenStateForTests } from '@/ai/token';
import { decideResponseSchema, speakResponseSchema } from '@/ai/schemas';
import { PRESETS } from '@/data/presets';
import { conversationRequest, decisionRequest, gatewayHttpError, jevAnswers } from '@/ai/testHelpers';

const evaluate = vi.mocked(experimental_evaluate);
const gen = vi.mocked(generateText);

let ipCounter = 0;
function post(body: unknown, ip = `10.0.0.${++ipCounter % 250}`): Request {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const token = () => issueRunToken({ runId: 'run-12345678', caps: { decide: 250, speak: 70 } });

beforeEach(() => {
  resetTokenStateForTests();
  evaluate.mockReset();
  gen.mockReset();
});

describe('POST /api/decide', () => {
  it('401 without a token, 400 on a bad body, no-store always', async () => {
    const r1 = await decidePOST(post({ requests: [decisionRequest()] }));
    expect(r1.status).toBe(401);
    expect(r1.headers.get('cache-control')).toBe('no-store');
    expect((await decidePOST(post({ token: token(), requests: [] }))).status).toBe(400);
    expect((await decidePOST(post('not json'))).status).toBe(400);
    expect((await decidePOST(post({ token: 'x'.repeat(40), requests: [decisionRequest()] }))).status).toBe(401);
  });

  it('answers each item, with a per-item error code on failure', async () => {
    evaluate
      .mockResolvedValueOnce({ answers: jevAnswers } as never)
      .mockRejectedValueOnce(gatewayHttpError(400, 'invalid_request_error'));
    const res = await decidePOST(post({ token: token(), requests: [decisionRequest(1), decisionRequest(2)] }));
    expect(res.status).toBe(200);
    const body = decideResponseSchema.parse(await res.json());
    expect(body.answers[0]).toMatchObject({ requestId: 1, source: 'jev', answer: { retelling: 'distorted' } });
    expect(body.answers[1]).toEqual({ requestId: 2, error: 'unknown' });
  });

  it('502 with the code when the account cannot pay', async () => {
    evaluate.mockRejectedValue(gatewayHttpError(402, 'insufficient_funds'));
    const res = await decidePOST(post({ token: token(), requests: [decisionRequest()] }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ code: 'funds' });
  });

  it('429 cap once the run has used its decisions', async () => {
    evaluate.mockResolvedValue({ answers: jevAnswers } as never);
    const small = issueRunToken({ runId: 'run-small-cap', caps: { decide: 2, speak: 1 } });
    expect((await decidePOST(post({ token: small, requests: [decisionRequest(1), decisionRequest(2)] }))).status).toBe(200);
    const res = await decidePOST(post({ token: small, requests: [decisionRequest(3)] }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: 'cap' });
  });
});

describe('POST /api/speak', () => {
  it('returns a validated answer or a per-item error', async () => {
    gen.mockResolvedValueOnce({ output: { lines: ['Hi there.', 'Hello.'] } } as never);
    const res = await speakPOST(post({ token: token(), request: conversationRequest() }));
    expect(res.status).toBe(200);
    expect(speakResponseSchema.parse(await res.json())).toMatchObject({ requestId: 2, source: 'gpt' });

    gen.mockResolvedValue({ output: { lines: ['one'] } } as never);
    const bad = await speakPOST(post({ token: token(), request: conversationRequest() }));
    expect(await bad.json()).toEqual({ requestId: 2, error: 'bad_output' });
  });

  it('401 without a token and 400 on a bad request', async () => {
    expect((await speakPOST(post({ request: conversationRequest() }))).status).toBe(401);
    expect((await speakPOST(post({ token: token(), request: { kind: 'poem' } }))).status).toBe(400);
  });
});

describe('POST /api/runs/start', () => {
  const config = (rumor: object) => ({ config: { population: 30, rumor, townSeed: 1, runSeed: 2, overrides: {} } });

  it('skips moderation for a real preset and returns a working token', async () => {
    const p = PRESETS[0];
    const res = await startPOST(post(config({ text: p.text, truth: p.truth, presetId: p.presetId })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.caps).toEqual({ decide: 250, speak: 70 });
    expect(typeof body.runId).toBe('string');
    expect(evaluate).not.toHaveBeenCalled();
    evaluate.mockResolvedValue({ answers: jevAnswers } as never);
    expect((await decidePOST(post({ token: body.token, requests: [decisionRequest()] }))).status).toBe(200);
  });

  it('moderates a preset id with changed text, and blocks with a reason', async () => {
    evaluate.mockResolvedValue({
      answers: { namesRealPerson: { probability: 0.95 }, harmful: { probability: 0 }, hateful: { probability: 0 }, sexual: { probability: 0 } },
    } as never);
    gen.mockResolvedValue({ output: { allowed: false, reason: 'real_person' } } as never);
    const res = await startPOST(post(config({ text: 'A famous singer moved here.', truth: 'uncertain', presetId: PRESETS[0].presetId })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'blocked', reason: 'real_person' });
  });

  it('limits run starts per IP', async () => {
    const p = PRESETS[0];
    const body = config({ text: p.text, truth: p.truth, presetId: p.presetId });
    for (let i = 0; i < 5; i++) expect((await startPOST(post(body, '7.7.7.7'))).status).toBe(200);
    expect((await startPOST(post(body, '7.7.7.7'))).status).toBe(429);
  });
});

describe('POST /api/moderate', () => {
  it('returns the verdict and 400 on a bad body', async () => {
    evaluate.mockResolvedValue({
      answers: { namesRealPerson: { probability: 0 }, harmful: { probability: 0 }, hateful: { probability: 0 }, sexual: { probability: 0 } },
    } as never);
    const res = await moderatePOST(post({ text: 'The park has new swings.' }));
    expect(await res.json()).toEqual({ allowed: true, reason: 'ok' });
    expect((await moderatePOST(post({ text: '' }))).status).toBe(400);
  });
});
