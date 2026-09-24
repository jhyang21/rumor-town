/**
 * POST /api/runs  — save a finished run. The client sends config + oracle log + its final hash; the
 *                   server replays the log itself, checks the hash, and stores its own derived record.
 * GET  /api/runs?id= — the stored record.
 *
 * Errors (JSON `{ code }`): 400 bad_request | bad_log, 401 token, 404 not_found, 409 hash_mismatch,
 * 413 too_large, 429 busy, 500 store_failed.
 */
import { json, rawToken } from '@/ai/http';
import { MAX_ORACLE_LOG_BYTES, runsPostBodySchema } from '@/ai/schemas';
import { allowIp, clientIp, verifyRunToken } from '@/ai/token';
import { loadRecord, markSaved, newRunId, RUN_ID_RE, saveRecord, savedIdFor } from '@/lib/blob';
import { replayRun } from '@/sim/runHeadless';
import type { RunConfig, RunRecord } from '@/sim/types';
import type { OracleLogEntry } from '@/sim/oracle/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY_BYTES = MAX_ORACLE_LOG_BYTES; // 200 KB

const err = (code: string, status: number) => json({ code }, status);

export async function POST(req: Request): Promise<Response> {
  if (!allowIp(clientIp(req), 'oracle')) return err('busy', 429);

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return err('too_large', 413);
  let text: string;
  try {
    text = await req.text();
  } catch {
    return err('bad_request', 400);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return err('too_large', 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return err('bad_request', 400);
  }
  if (!rawToken(body)) return err('token', 401);
  const parsed = runsPostBodySchema.safeParse(body);
  if (!parsed.success) return err('bad_request', 400);
  const payload = verifyRunToken(parsed.data.token);
  if (!payload) return err('token', 401);

  const url = (id: string) => new URL(`/r/${id}`, req.url).toString();
  const earlier = savedIdFor(payload.runId);
  if (earlier) return json({ id: earlier, url: url(earlier) });

  const config = parsed.data.config as RunConfig;
  let derived: RunRecord;
  try {
    derived = replayRun(config, parsed.data.oracleLog as OracleLogEntry[]);
  } catch {
    return err('bad_log', 400);
  }
  if (derived.finalHash !== parsed.data.finalHash) return err('hash_mismatch', 409);

  const record: RunRecord = { ...derived, id: newRunId(), createdAt: new Date().toISOString() };
  try {
    await saveRecord(record);
  } catch (e) {
    console.error('[runs] could not store a run:', e instanceof Error ? e.message : 'unknown error');
    return err('store_failed', 500);
  }
  markSaved(payload.runId, record.id);
  return json({ id: record.id, url: url(record.id) });
}

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!RUN_ID_RE.test(id)) return err('bad_request', 400);
  let record: RunRecord | null;
  try {
    record = await loadRecord(id);
  } catch {
    return err('store_failed', 500);
  }
  if (!record) return err('not_found', 404);
  return Response.json(record, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=86400' } });
}
