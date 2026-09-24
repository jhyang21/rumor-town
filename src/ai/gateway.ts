/**
 * Vercel AI Gateway helpers shared by jev.ts, gpt.ts and moderation.ts (server only).
 *
 * - Model ids come from env with fixed defaults.
 * - `withRetry` retries 429/503-style failures (max 2 retries), honoring `retry-after`.
 * - `classifyAiError` maps any SDK or gateway error to a small code the client can act on.
 * - `logAi` logs only a label, a code and the latency. Never prompts, outputs, or secrets.
 */
import { APICallError, RetryError } from 'ai';
import { AI_ERROR_CODES, type AiErrorCode } from './schemas';

export const DEFAULT_EVALUATION_MODEL = 'typesafe-ai/jev';
export const DEFAULT_LANGUAGE_MODEL = 'openai/gpt-4.1-mini';
export const LANGUAGE_FALLBACK_MODELS = ['openai/gpt-4.1-nano'];

export function evaluationModelId(): string {
  return process.env.AI_GATEWAY_EVALUATION_MODEL?.trim() || DEFAULT_EVALUATION_MODEL;
}

export function languageModelId(): string {
  return process.env.AI_GATEWAY_LANGUAGE_MODEL?.trim() || DEFAULT_LANGUAGE_MODEL;
}

/** Gateway routing for GPT calls: one cheaper fallback model. */
export function languageProviderOptions() {
  return { gateway: { models: LANGUAGE_FALLBACK_MODELS } };
}

export { AI_ERROR_CODES, type AiErrorCode };

export interface AiErrorInfo {
  code: AiErrorCode;
  /** only ever a vercel.com link taken from the gateway error body */
  actionUrl?: string;
}

/** Errors that hit every request on the account; routes answer these with 502. */
export const ACCOUNT_ERROR_CODES: readonly AiErrorCode[] = ['auth', 'funds', 'quota', 'verification'];

/** Our own error type. Carries a code and never the model text. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly actionUrl?: string;
  constructor(code: AiErrorCode, message?: string, actionUrl?: string) {
    super(message ?? `AI call failed (${code})`);
    this.name = 'AiError';
    this.code = code;
    this.actionUrl = actionUrl;
  }
}

/* ---------- classification ---------- */

const BAD_OUTPUT_NAMES = new Set([
  'AI_NoObjectGeneratedError',
  'AI_NoOutputGeneratedError',
  'AI_InvalidResponseDataError',
  'AI_TypeValidationError',
  'AI_JSONParseError',
  'ZodError',
]);

interface ErrorFacts {
  status?: number;
  text: string; // lowercased error types, codes and messages, joined
  headers?: Record<string, string>;
  actionUrl?: string;
  badOutput: boolean;
  timeout: boolean;
  own?: AiError;
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

const ACTION_URL_RE = /https:\/\/(?:[a-z0-9-]+\.)*vercel\.com\/[^\s"'<>)]*/i;

function findActionUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === 'string') return value.match(ACTION_URL_RE)?.[0];
  if (typeof value !== 'object') return undefined;
  for (const v of Object.values(value as Record<string, unknown>)) {
    const hit = findActionUrl(v, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function collectFacts(err: unknown): ErrorFacts {
  const facts: ErrorFacts = { text: '', badOutput: false, timeout: false };
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0 && seen.size < 12) {
    const e = queue.shift();
    if (e == null || typeof e !== 'object' || seen.has(e)) continue;
    seen.add(e);
    const o = e as Record<string, unknown>;
    if (e instanceof AiError && !facts.own) facts.own = e;
    const name = typeof o.name === 'string' ? o.name : '';
    if (BAD_OUTPUT_NAMES.has(name)) facts.badOutput = true;
    if (name === 'TimeoutError' || name === 'AbortError' || name === 'GatewayTimeoutError') facts.timeout = true;
    if (typeof o.statusCode === 'number' && facts.status === undefined) facts.status = o.statusCode;
    if (typeof o.status === 'number' && facts.status === undefined) facts.status = o.status;
    for (const k of ['type', 'code', 'message', 'name']) if (typeof o[k] === 'string') parts.push(o[k] as string);
    if (APICallError.isInstance(e)) {
      if (e.responseHeaders && !facts.headers) facts.headers = e.responseHeaders;
      const body = parseBody(e.data ?? e.responseBody);
      const inner = (body as { error?: Record<string, unknown> } | undefined)?.error;
      if (inner) for (const k of ['type', 'code']) if (typeof inner[k] === 'string') parts.push(inner[k] as string);
      facts.actionUrl ??= findActionUrl(body);
    }
    if (RetryError.isInstance(e)) queue.push(e.lastError);
    if ('cause' in o) queue.push(o.cause);
    if ('lastError' in o) queue.push(o.lastError);
  }
  facts.text = parts.join(' ').toLowerCase();
  return facts;
}

export function classifyAiError(err: unknown): AiErrorInfo {
  const f = collectFacts(err);
  if (f.own) return { code: f.own.code, ...(f.own.actionUrl ? { actionUrl: f.own.actionUrl } : {}) };
  const withUrl = (code: AiErrorCode): AiErrorInfo => (f.actionUrl ? { code, actionUrl: f.actionUrl } : { code });

  if (f.text.includes('customer_verification_required')) return withUrl('verification');
  if (f.text.includes('quota_for_entity_exceeded')) return withUrl('quota');
  if (f.text.includes('insufficient_funds')) return withUrl('funds');
  if (f.status === 401 || f.text.includes('authentication_error')) return withUrl('auth');
  if (f.status === 402) return withUrl(f.text.includes('quota') ? 'quota' : 'funds');
  if (f.status === 403) return withUrl(f.text.includes('verification') ? 'verification' : 'unknown');
  if (f.status === 429 || f.text.includes('rate_limit')) return { code: 'rate' };
  if (f.badOutput) return { code: 'bad_output' };
  if (f.timeout || (f.status !== undefined && f.status >= 500)) return { code: 'unavailable' };
  return { code: 'unknown' };
}

/* ---------- retry ---------- */

const MAX_RETRY_WAIT_MS = 1_200; // keeps one retry inside the driver's 3 s fallback window

/** Wait asked for by the server, in ms, or undefined. */
export function retryAfterMs(err: unknown): number | undefined {
  const h = collectFacts(err).headers;
  if (!h) return undefined;
  const get = (k: string) => Object.entries(h).find(([key]) => key.toLowerCase() === k)?.[1];
  const ms = get('retry-after-ms');
  if (ms && Number.isFinite(parseFloat(ms))) return Math.max(0, parseFloat(ms));
  const s = get('retry-after');
  if (!s) return undefined;
  const secs = parseFloat(s);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(s);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export interface RetryOptions {
  maxRetries?: number;
  label?: string;
  abortSignal?: AbortSignal;
  /** injectable for tests */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying up to `maxRetries` (default 2) times when the error classifies as `rate`
 * or `unavailable`. Waits `retry-after` when present (capped at 4 s), else 400 ms then 800 ms.
 * Call the SDK with `maxRetries: 0` inside `fn` so retries do not stack.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const max = opts.maxRetries ?? 2;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const { code } = classifyAiError(err);
      const retryable = code === 'rate' || code === 'unavailable';
      if (!retryable || attempt >= max || opts.abortSignal?.aborted) throw err;
      const wait = Math.min(retryAfterMs(err) ?? 400 * 2 ** attempt, MAX_RETRY_WAIT_MS);
      logAi(opts.label ?? 'ai', `retry:${code}`, wait);
      await sleep(wait);
    }
  }
}

/* ---------- logging ---------- */

/** Logs only a label, a code and a number of ms. Silent under test. */
export function logAi(label: string, code: string, ms: number): void {
  if (process.env.NODE_ENV === 'test') return;
  console.info(`[ai] ${label} ${code} ${Math.round(ms)}ms`);
}

/** Time `fn`, log ok/error code with latency, rethrow errors unchanged. */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    logAi(label, 'ok', Date.now() - t0);
    return out;
  } catch (err) {
    logAi(label, classifyAiError(err).code, Date.now() - t0);
    throw err;
  }
}
