/**
 * Run tokens, per-run caps, and per-IP rate limits (server only).
 *
 * Token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload part, RUN_TOKEN_SECRET)).
 *
 * All counters live in this process's memory. On Vercel each function instance has its own memory
 * and instances come and go, so a determined visitor can exceed a cap by landing on a fresh
 * instance. That is acceptable for a demo: the gateway budget is the real spend limit. The upgrade
 * path is a shared store such as Upstash Redis (`@upstash/ratelimit` for the IP windows and an
 * INCR per runId with a TTL for the caps), behind the same functions below.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { runTokenPayloadSchema } from './schemas';

export interface RunCaps {
  decide: number;
  speak: number;
}
export interface RunTokenPayload {
  runId: string;
  exp: number; // unix seconds
  caps: RunCaps;
}

export const DEFAULT_CAPS: RunCaps = { decide: 250, speak: 70 };

/** Caps for a town size. Must match src/sim/tuning.ts maxSpeechFor. */
export function capsFor(population: number): RunCaps {
  return { decide: 250, speak: population >= 75 ? 100 : 70 };
}
export const DEFAULT_TOKEN_TTL_SECONDS = 2 * 60 * 60;

const DEV_SECRET = 'rumor-town-dev-only-secret-do-not-use-in-production';
let warnedDevSecret = false;

function secret(): string {
  const s = process.env.RUN_TOKEN_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('RUN_TOKEN_SECRET must be set (16+ characters) in production.');
  }
  if (!warnedDevSecret && process.env.NODE_ENV !== 'test') {
    warnedDevSecret = true;
    console.warn('[token] RUN_TOKEN_SECRET is not set; using the fixed development secret.');
  }
  return DEV_SECRET;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const sign = (data: string) => createHmac('sha256', secret()).update(data).digest();

export function issueRunToken(
  { runId, caps = DEFAULT_CAPS }: { runId: string; caps?: RunCaps },
  ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS,
  nowMs = Date.now(),
): string {
  const payload: RunTokenPayload = { runId, exp: Math.floor(nowMs / 1000) + ttlSeconds, caps };
  runTokenPayloadSchema.parse(payload);
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${b64url(sign(body))}`;
}

/** Returns the payload when the signature is good and the token has not expired; else null. */
export function verifyRunToken(token: unknown, nowMs = Date.now()): RunTokenPayload | null {
  if (typeof token !== 'string' || token.length > 600) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  const expected = sign(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = runTokenPayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  if (parsed.data.exp * 1000 <= nowMs) return null;
  return parsed.data;
}

/* ---------- per-run caps ---------- */

interface Usage {
  decide: number;
  speak: number;
  exp: number;
}
const usage = new Map<string, Usage>();
let lastPrune = 0;

function prune(nowMs: number) {
  if (nowMs - lastPrune < 60_000) return;
  lastPrune = nowMs;
  for (const [k, u] of usage) if (u.exp * 1000 <= nowMs) usage.delete(k);
}

/**
 * Count `n` calls of `kind` against the token's cap. Returns false (and counts nothing) when the
 * call would go over the cap.
 */
export function consumeCap(payload: RunTokenPayload, kind: keyof RunCaps, n = 1, nowMs = Date.now()): boolean {
  prune(nowMs);
  let u = usage.get(payload.runId);
  if (!u) {
    u = { decide: 0, speak: 0, exp: payload.exp };
    usage.set(payload.runId, u);
  }
  if (u[kind] + n > payload.caps[kind]) return false;
  u[kind] += n;
  return true;
}

export function capUsage(runId: string): { decide: number; speak: number } {
  const u = usage.get(runId);
  return { decide: u?.decide ?? 0, speak: u?.speak ?? 0 };
}

/* ---------- per-IP rate limits (fixed 10-minute windows) ---------- */

export const IP_LIMITS = {
  /** POST /api/runs/start */
  start: { max: 5, windowMs: 10 * 60_000 },
  /** POST /api/decide and /api/speak together */
  oracle: { max: 600, windowMs: 10 * 60_000 },
  /** POST /api/moderate */
  moderate: { max: 20, windowMs: 10 * 60_000 },
} as const;
export type IpBucket = keyof typeof IP_LIMITS;

const windows = new Map<string, { start: number; count: number }>();

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Count one request for this IP in this bucket. Returns false when the IP is over the limit. */
export function allowIp(ip: string, bucket: IpBucket, nowMs = Date.now()): boolean {
  const { max, windowMs } = IP_LIMITS[bucket];
  const key = `${bucket}:${ip}`;
  const w = windows.get(key);
  if (!w || nowMs - w.start >= windowMs) {
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (nowMs - v.start >= windowMs) windows.delete(k);
    }
    windows.set(key, { start: nowMs, count: 1 });
    return true;
  }
  if (w.count >= max) return false;
  w.count += 1;
  return true;
}

/** Test helper: forget all counters. */
export function resetTokenStateForTests(): void {
  usage.clear();
  windows.clear();
  lastPrune = 0;
}
