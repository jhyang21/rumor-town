import { aiFailureResponse, errorJson, json, readJson, SERVER_AI_TIMEOUT_MS } from '@/ai/http';
import { moderateRumor } from '@/ai/moderation';
import { moderateBodySchema, moderateResponseSchema } from '@/ai/schemas';
import { allowIp, clientIp } from '@/ai/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  if (!allowIp(clientIp(req), 'moderate')) return errorJson('busy', 429);
  const parsed = moderateBodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson('bad_request', 400);
  try {
    const verdict = await moderateRumor(parsed.data.text, { abortSignal: AbortSignal.timeout(SERVER_AI_TIMEOUT_MS) });
    return json(moderateResponseSchema.parse(verdict));
  } catch (err) {
    return aiFailureResponse(err);
  }
}
