import { classifyAiError } from '@/ai/gateway';
import { errorJson, isAccountError, json, rawToken, readJson, SERVER_AI_TIMEOUT_MS } from '@/ai/http';
import { speak } from '@/ai/gpt';
import { speakBodySchema } from '@/ai/schemas';
import { allowIp, clientIp, consumeCap, verifyRunToken } from '@/ai/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  if (!allowIp(clientIp(req), 'oracle')) return errorJson('busy', 429);
  const body = await readJson(req);
  if (body === undefined) return errorJson('bad_request', 400);
  if (!rawToken(body)) return errorJson('token', 401);
  const parsed = speakBodySchema.safeParse(body);
  if (!parsed.success) return errorJson('bad_request', 400);
  const payload = verifyRunToken(parsed.data.token);
  if (!payload) return errorJson('token', 401);
  if (!consumeCap(payload, 'speak', 1)) return errorJson('cap', 429);

  const { request } = parsed.data;
  try {
    const answer = await speak(request, { abortSignal: AbortSignal.timeout(SERVER_AI_TIMEOUT_MS) });
    return json({ requestId: request.requestId, answer, source: 'gpt' });
  } catch (err) {
    const info = classifyAiError(err);
    if (isAccountError(info)) return errorJson(info.code, 502, info.actionUrl);
    return json({ requestId: request.requestId, error: info.code });
  }
}
