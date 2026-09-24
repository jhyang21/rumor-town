import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveOracle, OracleCallError } from './liveOracle';
import { conversationRequest, decisionRequest } from '@/ai/testHelpers';
import type { DecisionAnswer } from '@/sim/oracle/types';

const answer: DecisionAnswer = {
  mention: 0.8,
  beliefShift: 2.5,
  beliefShiftProbs: [0, 0.1, 0.3, 0.6, 0],
  retelling: 'unchanged',
  challenges: 0.3,
  willShare: 0.4,
  verify: 0.2,
};
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.useRealTimers());

describe('createLiveOracle', () => {
  it('batches decide calls from one macrotask, 4 per request', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { token: string; requests: Array<{ requestId: number }> };
      expect(body.token).toBe('tok');
      return jsonRes({
        answers: body.requests.map((r) =>
          r.requestId === 3 ? { requestId: 3, error: 'rate' } : { requestId: r.requestId, answer, source: 'jev' },
        ),
      });
    });
    const oracle = createLiveOracle({ token: 'tok', baseUrl: 'https://town.test/', fetch: fetchMock as typeof fetch });
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((id) => oracle.decide(decisionRequest(id))));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://town.test/api/decide');
    const sizes = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).requests.length);
    expect(sizes).toEqual([4, 1]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    const err = (results[2] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(OracleCallError);
    expect(err.code).toBe('rate');
    expect(oracle.stats().decide).toEqual({ requests: 2, jev: 4, error: 1 });
    expect(oracle.lastError).toMatchObject({ code: 'rate', kind: 'decide' });
    expect(oracle.sourceOf(1)).toBe('jev');
    expect(oracle.sourceOf(1)).toBeUndefined();
    expect(oracle.sourceOf(3)).toBeUndefined();
  });

  it('rejects every caller in a batch with the server code on 502', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ code: 'funds' }, 502));
    const oracle = createLiveOracle({ token: 'tok', fetch: fetchMock as typeof fetch });
    const results = await Promise.allSettled([oracle.decide(decisionRequest(1)), oracle.decide(decisionRequest(2))]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === 'rejected' && r.reason.code === 'funds')).toBe(true);
  });

  it('times out after 8 s', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const oracle = createLiveOracle({ token: 'tok', fetch: fetchMock as typeof fetch });
    const pending = oracle.speak(conversationRequest());
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    await assertion;
    expect(oracle.stats().speak).toEqual({ requests: 1, gpt: 0, error: 1 });
  });

  it('speak returns the validated answer and counts the source', async () => {
    const fetchMock = vi.fn(async () =>
      jsonRes({ requestId: 2, answer: { lines: [{ speakerId: 1, text: 'Hi.' }, { speakerId: 2, text: 'Hello.' }] }, source: 'gpt' }),
    );
    const oracle = createLiveOracle({ token: 'tok', fetch: fetchMock as typeof fetch });
    await expect(oracle.speak(conversationRequest())).resolves.toEqual({
      lines: [{ speakerId: 1, text: 'Hi.' }, { speakerId: 2, text: 'Hello.' }],
    });
    expect(oracle.stats().speak).toEqual({ requests: 1, gpt: 1, error: 0 });
    expect(oracle.lastError).toBeNull();
    expect(oracle.sourceOf(2)).toBe('gpt');
  });
});
