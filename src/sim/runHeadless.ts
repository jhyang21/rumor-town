/**
 * Drive an engine to the end synchronously. `replayRun` is what the server uses to check an upload:
 * it rebuilds the run from the config and the oracle log and returns the recomputed record.
 */
import type { RunConfig, RunRecord } from './types';
import type { OracleSource, SyncOracle, DecisionRequest, SpeechRequest } from './oracle/types';
import type { OracleLogEntry } from './oracle/types';
import { Engine } from './engine';
import { ReplayOracle } from './oracle/replay';

export function driveToEnd(engine: Engine, oracle: SyncOracle, sourceOf: (req: DecisionRequest | SpeechRequest) => OracleSource): void {
  while (!engine.finished) {
    for (const req of engine.pendingRequests()) {
      const ans = req.kind === 'encounter' ? oracle.decideSync(req) : oracle.speakSync(req);
      engine.deliver(req.requestId, ans, sourceOf(req));
    }
    engine.step();
  }
}

export function toRecord(engine: Engine): RunRecord {
  return {
    id: '',
    version: 1,
    config: engine.config,
    oracleLog: engine.oracleLog.slice(),
    stats: engine.stats(),
    events: engine.events.slice(),
    conversations: engine.conversations.slice(),
    variants: engine.variants.map((v) => ({ ...v, details: v.details.slice() })),
    series: engine.series.slice(),
    finalHash: engine.finalHash(),
    createdAt: '',
  };
}

export function runHeadless(config: RunConfig, oracle: SyncOracle, source: OracleSource = 'local'): RunRecord {
  const engine = new Engine(config);
  driveToEnd(engine, oracle, () => source);
  return toRecord(engine);
}

/** Rebuild a run from its log. Keeps each entry's original source so the log round-trips unchanged. */
export function replayRun(config: RunConfig, oracleLog: readonly OracleLogEntry[]): RunRecord {
  const oracle = new ReplayOracle(oracleLog);
  const engine = new Engine(config);
  driveToEnd(engine, oracle, (req) => oracle.entry(req.requestId)?.source ?? 'replay');
  return toRecord(engine);
}

/** Engine-level replay that also returns the sampled hashes (for tests and the CLI). */
export function replayEngine(config: RunConfig, oracleLog: readonly OracleLogEntry[]): Engine {
  const oracle = new ReplayOracle(oracleLog);
  const engine = new Engine(config);
  driveToEnd(engine, oracle, (req) => oracle.entry(req.requestId)?.source ?? 'replay');
  return engine;
}
