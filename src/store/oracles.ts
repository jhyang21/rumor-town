/**
 * Oracle wrappers the play store hands to the driver.
 *
 * - SwitchableOracle: starts on the live oracle; `switchToLocal()` answers every request still in
 *   flight with the LocalOracle at once and sends the rest of the run there too.
 * - SafeReplayOracle: answers from a recorded log and keeps each entry's original source; a request
 *   the log lacks gets a LocalOracle answer instead of throwing inside the animation loop.
 */
import type {
  DecisionAnswer,
  DecisionRequest,
  Oracle,
  OracleLogEntry,
  OracleSource,
  SpeechAnswer,
  SpeechRequest,
  SyncOracle,
} from '@/sim/oracle/types';
import { LocalOracle } from '@/sim/oracle/local';
import { ReplayOracle } from '@/sim/oracle/replay';

type AnyReq = DecisionRequest | SpeechRequest;
type SourceAware = { sourceOf?: (requestId: number) => OracleSource | undefined };

/** Codes that mean the AI account cannot serve this run (switch to local for the rest of it). */
export const ACCOUNT_ERROR_CODES: readonly string[] = ['auth', 'funds', 'quota', 'verification'];

interface InFlight {
  req: AnyReq;
  resolve: (a: DecisionAnswer | SpeechAnswer) => void;
}

export class SwitchableOracle implements Oracle {
  private live: Oracle;
  private readonly local: SyncOracle;
  private switched = false;
  private readonly inFlight = new Map<number, InFlight>();
  private readonly sources = new Map<number, OracleSource>();

  constructor(live: Oracle, local: SyncOracle) {
    this.live = live;
    this.local = local;
  }

  get isLocal(): boolean {
    return this.switched;
  }

  private localAnswer(req: AnyReq): DecisionAnswer | SpeechAnswer {
    return req.kind === 'encounter' ? this.local.decideSync(req) : this.local.speakSync(req);
  }

  private run<T extends DecisionAnswer | SpeechAnswer>(req: AnyReq, call: () => Promise<T>): Promise<T> {
    if (this.switched) {
      this.sources.set(req.requestId, 'fallback');
      return Promise.resolve(this.localAnswer(req) as T);
    }
    return new Promise<T>((resolve, reject) => {
      this.inFlight.set(req.requestId, { req, resolve: resolve as InFlight['resolve'] });
      call().then(
        (a) => {
          // read the source every time: LiveOracle drops its entry on read
          const s = (this.live as SourceAware).sourceOf?.(req.requestId);
          if (!this.inFlight.delete(req.requestId)) return; // already answered locally
          if (s) this.sources.set(req.requestId, s);
          resolve(a);
        },
        (e) => {
          if (!this.inFlight.delete(req.requestId)) return;
          reject(e);
        },
      );
    });
  }

  decide(req: DecisionRequest): Promise<DecisionAnswer> {
    return this.run(req, () => this.live.decide(req));
  }

  speak(req: SpeechRequest): Promise<SpeechAnswer> {
    return this.run(req, () => this.live.speak(req));
  }

  /** Send the rest of the run to the local oracle and answer everything still waiting. */
  switchToLocal(): void {
    if (this.switched) return;
    this.switched = true;
    const waiting = [...this.inFlight.values()].sort((a, b) => a.req.requestId - b.req.requestId);
    this.inFlight.clear();
    for (const w of waiting) {
      this.sources.set(w.req.requestId, 'fallback');
      w.resolve(this.localAnswer(w.req));
    }
  }

  sourceOf(requestId: number): OracleSource | undefined {
    const s = this.sources.get(requestId);
    this.sources.delete(requestId);
    return s;
  }
}

export class SafeReplayOracle implements SyncOracle {
  private readonly replay: ReplayOracle;
  private readonly local: LocalOracle;
  private readonly missed = new Set<number>();

  constructor(log: readonly OracleLogEntry[], seed: number) {
    this.replay = new ReplayOracle(log);
    this.local = new LocalOracle({ seed });
  }

  /** requestIds the log did not cover */
  get missing(): ReadonlySet<number> {
    return this.missed;
  }

  decideSync(req: DecisionRequest): DecisionAnswer {
    try {
      return this.replay.decideSync(req);
    } catch {
      this.missed.add(req.requestId);
      return this.local.decideSync(req);
    }
  }

  speakSync(req: SpeechRequest): SpeechAnswer {
    try {
      return this.replay.speakSync(req);
    } catch {
      this.missed.add(req.requestId);
      return this.local.speakSync(req);
    }
  }

  decide(req: DecisionRequest): Promise<DecisionAnswer> {
    return Promise.resolve(this.decideSync(req));
  }

  speak(req: SpeechRequest): Promise<SpeechAnswer> {
    return Promise.resolve(this.speakSync(req));
  }

  sourceOf(requestId: number): OracleSource | undefined {
    if (this.missed.has(requestId)) return 'fallback';
    return this.replay.entry(requestId)?.source ?? 'replay';
  }
}

/** LocalOracle that reports its answers as 'local' in the log. */
export class LocalSourceOracle extends LocalOracle {
  sourceOf(): OracleSource {
    return 'local';
  }
}
