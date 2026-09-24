/** ReplayOracle: answers every request from a recorded log, keyed by requestId. */
import type { DecisionAnswer, DecisionRequest, OracleLogEntry, SpeechAnswer, SpeechRequest, SyncOracle } from './types';

export class ReplayOracle implements SyncOracle {
  private readonly byId = new Map<number, OracleLogEntry>();

  constructor(log: readonly OracleLogEntry[]) {
    for (const e of log) this.byId.set(e.requestId, e);
  }

  entry(requestId: number): OracleLogEntry | undefined {
    return this.byId.get(requestId);
  }

  decideSync(req: DecisionRequest): DecisionAnswer {
    const e = this.byId.get(req.requestId);
    if (!e) throw new Error(`replay: no logged answer for decision request ${req.requestId}`);
    if (e.kind !== 'decide' || e.request.kind !== 'encounter') {
      throw new Error(`replay: request ${req.requestId} is a decision now but the log has kind "${e.kind}"`);
    }
    return e.response as DecisionAnswer;
  }

  speakSync(req: SpeechRequest): SpeechAnswer {
    const e = this.byId.get(req.requestId);
    if (!e) throw new Error(`replay: no logged answer for speech request ${req.requestId}`);
    if (e.kind !== 'speak' || e.request.kind !== req.kind) {
      throw new Error(`replay: request ${req.requestId} is a ${req.kind} speech now but the log has "${e.kind}/${e.request.kind}"`);
    }
    return e.response as SpeechAnswer;
  }

  decide(req: DecisionRequest): Promise<DecisionAnswer> {
    return Promise.resolve(this.decideSync(req));
  }

  speak(req: SpeechRequest): Promise<SpeechAnswer> {
    return Promise.resolve(this.speakSync(req));
  }
}
