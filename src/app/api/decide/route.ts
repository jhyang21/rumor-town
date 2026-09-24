import { classifyAiError, type AiErrorInfo } from '@/ai/gateway';
import { errorJson, isAccountError, json, rawToken, readJson, SERVER_AI_TIMEOUT_MS } from '@/ai/http';
import { decidePair } from '@/ai/jev';
import { decideBodySchema, type DecideResponse } from '@/ai/schemas';
import { allowIp, clientIp, consumeCap, verifyRunToken } from '@/ai/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  if (!allowIp(clientIp(req), 'oracle')) return errorJson('busy', 429);
  const body = await readJson(req);
  if (body === undefined) return errorJson('bad_request', 400);
  if (!rawToken(body)) return errorJson('token', 401);
  const parsed = decideBodySchema.safeParse(body);
  if (!parsed.success) return errorJson('bad_request', 400);
  const payload = verifyRunToken(parsed.data.token);
  if (!payload) return errorJson('token', 401);
  const { requests } = parsed.data;
  if (!consumeCap(payload, 'decide', requests.length)) return errorJson('cap', 429);

  const abortSignal = AbortSignal.timeout(SERVER_AI_TIMEOUT_MS);
  const failures: AiErrorInfo[] = [];
  const answers: DecideResponse['answers'] = await Promise.all(
    requests.map(async (r) => {
      try {
        return { requestId: r.requestId, answer: await decidePair(r, { abortSignal }), source: 'jev' as const };
      } catch (err) {
        const info = classifyAiError(err);
        failures.push(info);
        return { requestId: r.requestId, error: info.code };
      }
    }),
  );

  // Account-wide failures (auth, funds, quota, verification) end the whole request.
  const account = failures.find(isAccountError);
  if (account) return errorJson(account.code, 502, account.actionUrl);
  return json({ answers });
}
