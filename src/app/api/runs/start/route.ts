import { randomUUID } from 'node:crypto';
import { getPreset } from '@/data/presets';
import { aiFailureResponse, errorJson, json, readJson, SERVER_AI_TIMEOUT_MS } from '@/ai/http';
import { moderateRumor } from '@/ai/moderation';
import { runStartBodySchema, type RumorSpecBody } from '@/ai/schemas';
import { allowIp, capsFor, clientIp, issueRunToken } from '@/ai/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** A rumor skips moderation only when it is a real preset with the preset's own text. */
function isKnownPreset(rumor: RumorSpecBody): boolean {
  const preset = rumor.presetId ? getPreset(rumor.presetId) : undefined;
  return !!preset && preset.text === rumor.text;
}

export async function POST(req: Request): Promise<Response> {
  if (!allowIp(clientIp(req), 'start')) return errorJson('busy', 429);
  const parsed = runStartBodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson('bad_request', 400);
  const { rumor } = parsed.data.config;

  if (!isKnownPreset(rumor)) {
    try {
      const verdict = await moderateRumor(rumor.text, { abortSignal: AbortSignal.timeout(SERVER_AI_TIMEOUT_MS) });
      if (!verdict.allowed) return json({ error: 'blocked', reason: verdict.reason }, 400);
    } catch (err) {
      return aiFailureResponse(err);
    }
  }

  const runId = randomUUID();
  const caps = capsFor(parsed.data.config.population);
  return json({ runId, token: issueRunToken({ runId, caps }), caps });
}
