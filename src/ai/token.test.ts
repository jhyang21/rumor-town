import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowIp, clientIp, consumeCap, issueRunToken, resetTokenStateForTests, verifyRunToken } from './token';

const NOW = 1_800_000_000_000;

describe('run tokens', () => {
  beforeEach(() => resetTokenStateForTests());

  it('issues a token that verifies to its payload', () => {
    const token = issueRunToken({ runId: 'run-12345678', caps: { decide: 250, speak: 70 } }, 600, NOW);
    expect(token.split('.')).toHaveLength(2);
    expect(verifyRunToken(token, NOW)).toEqual({ runId: 'run-12345678', exp: NOW / 1000 + 600, caps: { decide: 250, speak: 70 } });
  });

  it('rejects expired, tampered and junk tokens', () => {
    const token = issueRunToken({ runId: 'run-12345678' }, 600, NOW);
    expect(verifyRunToken(token, NOW + 601_000)).toBeNull();

    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    payload.caps.decide = 99999;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
    expect(verifyRunToken(forged, NOW)).toBeNull();
    expect(verifyRunToken(`${body}.${sig.slice(0, -2)}xx`, NOW)).toBeNull();
    expect(verifyRunToken('not-a-token', NOW)).toBeNull();
    expect(verifyRunToken(undefined, NOW)).toBeNull();
  });

  it('refuses to run in production without a secret', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RUN_TOKEN_SECRET', '');
    expect(() => issueRunToken({ runId: 'run-12345678' })).toThrow(/RUN_TOKEN_SECRET/);
    vi.unstubAllEnvs();
  });

  it('a token signed with another secret does not verify', () => {
    vi.stubEnv('RUN_TOKEN_SECRET', 'secret-number-one-000');
    const token = issueRunToken({ runId: 'run-12345678' }, 600, NOW);
    vi.stubEnv('RUN_TOKEN_SECRET', 'secret-number-two-000');
    expect(verifyRunToken(token, NOW)).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('caps and IP limits', () => {
  beforeEach(() => resetTokenStateForTests());

  it('enforces per-run caps without counting refused calls', () => {
    const payload = { runId: 'run-12345678', exp: NOW / 1000 + 600, caps: { decide: 5, speak: 1 } };
    expect(consumeCap(payload, 'decide', 4, NOW)).toBe(true);
    expect(consumeCap(payload, 'decide', 2, NOW)).toBe(false);
    expect(consumeCap(payload, 'decide', 1, NOW)).toBe(true);
    expect(consumeCap(payload, 'decide', 1, NOW)).toBe(false);
    expect(consumeCap(payload, 'speak', 1, NOW)).toBe(true);
    expect(consumeCap(payload, 'speak', 1, NOW)).toBe(false);
  });

  it('allows 5 run starts per 10 minutes per IP', () => {
    for (let i = 0; i < 5; i++) expect(allowIp('1.2.3.4', 'start', NOW)).toBe(true);
    expect(allowIp('1.2.3.4', 'start', NOW)).toBe(false);
    expect(allowIp('5.6.7.8', 'start', NOW)).toBe(true);
    expect(allowIp('1.2.3.4', 'start', NOW + 10 * 60_000)).toBe(true);
  });

  it('reads the first x-forwarded-for address', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': ' 9.9.9.9 , 10.0.0.1' } });
    expect(clientIp(req)).toBe('9.9.9.9');
    expect(clientIp(new Request('http://x'))).toBe('unknown');
  });
});
