import { describe, expect, it, vi } from 'vitest';
import { RetryError } from 'ai';
import { AiError, classifyAiError, retryAfterMs, withRetry } from './gateway';
import { gatewayHttpError } from './testHelpers';

describe('classifyAiError', () => {
  it('maps the gateway error table', () => {
    expect(classifyAiError(gatewayHttpError(401, 'authentication_error')).code).toBe('auth');
    expect(classifyAiError(gatewayHttpError(402, 'insufficient_funds')).code).toBe('funds');
    expect(classifyAiError(gatewayHttpError(402, 'quota_for_entity_exceeded')).code).toBe('quota');
    expect(classifyAiError(gatewayHttpError(429, 'rate_limit_exceeded')).code).toBe('rate');
    expect(classifyAiError(gatewayHttpError(503, 'internal_server_error')).code).toBe('unavailable');
    expect(classifyAiError(new Error('boom')).code).toBe('unknown');
  });

  it('keeps only a vercel.com action url for verification errors', () => {
    const err = gatewayHttpError(403, 'customer_verification_required', {
      body: { error: { message: 'Add a card at https://vercel.com/d?to=ai-gateway', type: 'customer_verification_required' } },
    });
    expect(classifyAiError(err)).toEqual({ code: 'verification', actionUrl: 'https://vercel.com/d?to=ai-gateway' });
    const other = gatewayHttpError(403, 'customer_verification_required', {
      body: { error: { message: 'see https://evil.example.com/x', type: 'customer_verification_required' } },
    });
    expect(classifyAiError(other)).toEqual({ code: 'verification' });
  });

  it('looks through wrappers and our own errors', () => {
    const wrapped = new Error('outer', { cause: gatewayHttpError(402, 'insufficient_funds') });
    expect(classifyAiError(wrapped).code).toBe('funds');
    const retry = new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [gatewayHttpError(429, 'rate_limit_exceeded')] });
    expect(classifyAiError(retry).code).toBe('rate');
    expect(classifyAiError(new AiError('bad_output'))).toEqual({ code: 'bad_output' });
  });
});

describe('withRetry', () => {
  it('retries rate errors twice, honoring retry-after', async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn().mockRejectedValue(gatewayHttpError(429, 'rate_limit_exceeded', { headers: { 'retry-after': '1' } }));
    await expect(withRetry(fn, { sleep })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
  });

  it('succeeds after one 503 and never retries auth errors', async () => {
    const sleep = vi.fn(async () => {});
    const flaky = vi.fn().mockRejectedValueOnce(gatewayHttpError(503, 'internal_server_error')).mockResolvedValue('ok');
    await expect(withRetry(flaky, { sleep })).resolves.toBe('ok');
    expect(sleep).toHaveBeenCalledWith(400);

    const auth = vi.fn().mockRejectedValue(gatewayHttpError(401, 'authentication_error'));
    await expect(withRetry(auth, { sleep })).rejects.toBeDefined();
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it('reads retry-after-ms and caps long waits', async () => {
    expect(retryAfterMs(gatewayHttpError(429, 'x', { headers: { 'retry-after-ms': '250' } }))).toBe(250);
    const sleep = vi.fn(async () => {});
    const fn = vi.fn().mockRejectedValueOnce(gatewayHttpError(429, 'x', { headers: { 'retry-after': '60' } })).mockResolvedValue(1);
    await withRetry(fn, { sleep });
    expect(sleep).toHaveBeenCalledWith(1200);
  });
});
