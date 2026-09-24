import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  experimental_evaluate: vi.fn(),
  generateText: vi.fn(),
}));

import { experimental_evaluate, generateText } from 'ai';
import { moderateRumor } from './moderation';
import { gatewayHttpError } from './testHelpers';

const evaluate = vi.mocked(experimental_evaluate);
const gen = vi.mocked(generateText);

const scores = (s: Partial<Record<'namesRealPerson' | 'harmful' | 'hateful' | 'sexual', number>>) =>
  ({
    answers: Object.fromEntries(
      (['namesRealPerson', 'harmful', 'hateful', 'sexual'] as const).map((k) => [k, { type: 'boolean', probability: s[k] ?? 0.01 }]),
    ),
  }) as never;

describe('moderateRumor', () => {
  beforeEach(() => {
    evaluate.mockReset();
    gen.mockReset();
  });

  it('allows without GPT when every Jev probability is at most 0.2', async () => {
    evaluate.mockResolvedValue(scores({ namesRealPerson: 0.2, harmful: 0.05 }));
    await expect(moderateRumor('The bakery has free bread.')).resolves.toEqual({ allowed: true, reason: 'ok' });
    expect(gen).not.toHaveBeenCalled();
    const q = evaluate.mock.calls[0][0].questions as Record<string, { type: string }>;
    expect(Object.keys(q)).toEqual(['namesRealPerson', 'harmful', 'hateful', 'sexual']);
    expect(Object.values(q).every((x) => x.type === 'boolean')).toBe(true);
  });

  it('asks GPT when any probability is above 0.2, and GPT decides', async () => {
    evaluate.mockResolvedValue(scores({ harmful: 0.21 }));
    gen.mockResolvedValueOnce({ output: { allowed: true, reason: 'ok' } } as never);
    await expect(moderateRumor('The fireworks show is loud.')).resolves.toEqual({ allowed: true, reason: 'ok' });

    gen.mockResolvedValueOnce({ output: { allowed: false, reason: 'harmful' } } as never);
    await expect(moderateRumor('x')).resolves.toEqual({ allowed: false, reason: 'harmful' });
    const prompt = (gen.mock.calls[1][0] as { prompt: string }).prompt;
    expect(prompt).toContain('"x"');
  });

  it('uses the strongest Jev flag when GPT blocks with reason ok or fails', async () => {
    evaluate.mockResolvedValue(scores({ namesRealPerson: 0.9, sexual: 0.3 }));
    gen.mockResolvedValueOnce({ output: { allowed: false, reason: 'ok' } } as never);
    await expect(moderateRumor('x')).resolves.toEqual({ allowed: false, reason: 'real_person' });

    gen.mockRejectedValue(gatewayHttpError(503, 'internal_server_error'));
    await expect(moderateRumor('x')).resolves.toEqual({ allowed: false, reason: 'real_person' });
  });

  it('surfaces account-wide failures', async () => {
    evaluate.mockRejectedValue(gatewayHttpError(402, 'insufficient_funds'));
    await expect(moderateRumor('x')).rejects.toBeDefined();
  });
});
