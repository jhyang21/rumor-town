/**
 * LiveOracle: the browser side of "Jev decides. GPT speaks." Implements the engine's Oracle by
 * calling /api/decide and /api/speak with the run token.
 *
 * - decide() calls made in the same macrotask are gathered into one POST (up to 4 per request).
 * - Each fetch gives up after 8 s.
 * - Failures reject with an OracleCallError carrying a `code`; the driver then asks its LocalOracle.
 */
import type {
  DecisionAnswer,
  DecisionRequest,
  Oracle,
  OracleSource,
  SpeechAnswer,
  SpeechRequest,
} from '@/sim/oracle/types';
import {
  apiErrorSchema,
  decideResponseSchema,
  MAX_DECIDE_PAIRS_PER_REQUEST,
  speakResponseSchema,
} from '@/ai/schemas';

export const LIVE_ORACLE_TIMEOUT_MS = 8_000;

/** Codes: AI codes from the server ('auth', 'rate', ...) plus 'cap', 'busy', 'token',
 * 'bad_request', 'timeout', 'network', 'bad_response'. */
export class OracleCallError extends Error {
  readonly code: string;
  readonly actionUrl?: string;
  readonly status?: number;
  constructor(code: string, opts: { status?: number; actionUrl?: string } = {}) {
    super(`Live oracle call failed (${code})`);
    this.name = 'OracleCallError';
    this.code = code;
    this.status = opts.status;
    this.actionUrl = opts.actionUrl;
  }
}

export interface LiveOracleStats {
  decide: { requests: number; jev: number; error: number };
  speak: { requests: number; gpt: number; error: number };
}

export interface LiveOracleError {
  code: string;
  kind: 'decide' | 'speak';
  status?: number;
  actionUrl?: string;
}

export interface LiveOracle extends Oracle {
  stats(): LiveOracleStats;
  readonly lastError: LiveOracleError | null;
  /**
   * Source of a delivered answer, read once by the driver. The server never
   * answers locally, so this is 'jev' or 'gpt'; failures reject instead and
   * the driver falls back on its own. The entry is removed when read.
   */
  sourceOf(requestId: number): OracleSource | undefined;
}

export interface LiveOracleOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** injectable for tests */
  fetch?: typeof fetch;
}

interface Pending {
  req: DecisionRequest;
  resolve: (a: DecisionAnswer) => void;
  reject: (e: unknown) => void;
}

export function createLiveOracle(opts: LiveOracleOptions): LiveOracle {
  const base = (opts.baseUrl ?? '').replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs ?? LIVE_ORACLE_TIMEOUT_MS;
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const counts: LiveOracleStats = {
    decide: { requests: 0, jev: 0, error: 0 },
    speak: { requests: 0, gpt: 0, error: 0 },
  };
  let lastError: LiveOracleError | null = null;
  const sources = new Map<number, OracleSource>();
  let queue: Pending[] = [];
  let scheduled = false;

  function fail(kind: 'decide' | 'speak', err: OracleCallError): OracleCallError {
    counts[kind].error += 1;
    lastError = { code: err.code, kind, status: err.status, actionUrl: err.actionUrl };
    return err;
  }

  /** POST JSON with a timeout. Resolves with parsed JSON for 200; throws OracleCallError otherwise. */
  async function post(path: string, body: unknown): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        cache: 'no-store',
      });
    } catch {
      throw new OracleCallError(ctrl.signal.aborted ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new OracleCallError('bad_response', { status: res.status });
    }
    if (!res.ok) {
      const e = apiErrorSchema.safeParse(data);
      throw new OracleCallError(e.success ? e.data.code : 'bad_response', {
        status: res.status,
        actionUrl: e.success ? e.data.actionUrl : undefined,
      });
    }
    return data;
  }

  async function sendBatch(batch: Pending[]): Promise<void> {
    counts.decide.requests += 1;
    try {
      const data = await post('/api/decide', { token: opts.token, requests: batch.map((p) => p.req) });
      const parsed = decideResponseSchema.safeParse(data);
      if (!parsed.success) throw new OracleCallError('bad_response');
      const byId = new Map(parsed.data.answers.map((a) => [a.requestId, a]));
      for (const p of batch) {
        const item = byId.get(p.req.requestId);
        if (!item) p.reject(fail('decide', new OracleCallError('bad_response')));
        else if ('error' in item) p.reject(fail('decide', new OracleCallError(item.error)));
        else {
          counts.decide.jev += 1;
          sources.set(p.req.requestId, 'jev');
          p.resolve(item.answer as DecisionAnswer);
        }
      }
    } catch (err) {
      const e = err instanceof OracleCallError ? err : new OracleCallError('network');
      for (const p of batch) p.reject(fail('decide', e));
    }
  }

  function flush() {
    scheduled = false;
    const all = queue;
    queue = [];
    for (let i = 0; i < all.length; i += MAX_DECIDE_PAIRS_PER_REQUEST) {
      void sendBatch(all.slice(i, i + MAX_DECIDE_PAIRS_PER_REQUEST));
    }
  }

  return {
    decide(req: DecisionRequest): Promise<DecisionAnswer> {
      return new Promise((resolve, reject) => {
        queue.push({ req, resolve, reject });
        if (!scheduled) {
          scheduled = true;
          setTimeout(flush, 0);
        }
      });
    },

    async speak(req: SpeechRequest): Promise<SpeechAnswer> {
      counts.speak.requests += 1;
      try {
        const data = await post('/api/speak', { token: opts.token, request: req });
        const parsed = speakResponseSchema.safeParse(data);
        if (!parsed.success || parsed.data.requestId !== req.requestId) throw new OracleCallError('bad_response');
        if ('error' in parsed.data) throw new OracleCallError(parsed.data.error);
        counts.speak.gpt += 1;
        sources.set(req.requestId, 'gpt');
        return parsed.data.answer as SpeechAnswer;
      } catch (err) {
        throw fail('speak', err instanceof OracleCallError ? err : new OracleCallError('network'));
      }
    },

    stats(): LiveOracleStats {
      return { decide: { ...counts.decide }, speak: { ...counts.speak } };
    },

    get lastError() {
      return lastError;
    },

    sourceOf(requestId: number): OracleSource | undefined {
      const s = sources.get(requestId);
      sources.delete(requestId);
      return s;
    },
  };
}
