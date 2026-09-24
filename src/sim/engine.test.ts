import { describe, expect, it } from 'vitest';
import { Engine, createEngine } from './engine';
import { LocalOracle } from './oracle/local';
import { ReplayOracle } from './oracle/replay';
import { driveToEnd, replayEngine, replayRun, runHeadless } from './runHeadless';
import { DEFAULT_RUMOR, PRESETS } from './rumor/presets';
import type { RunConfig } from './types';
import { DAY_END_TICK } from './types';

const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
  population: 50,
  rumor: DEFAULT_RUMOR,
  townSeed: 7,
  runSeed: 3,
  overrides: {},
  ...over,
});

function live(c: RunConfig): Engine {
  const e = createEngine(c);
  driveToEnd(e, new LocalOracle({ seed: c.runSeed }), () => 'local');
  return e;
}

describe('engine', () => {
  it('runs 50 people to the end with the LocalOracle', () => {
    const e = live(cfg());
    expect(e.finished).toBe(true);
    expect(e.tick).toBeLessThanOrEqual(DAY_END_TICK);
    const st = e.stats();
    expect(e.events.filter((x) => x.type === 'transmission').length).toBeGreaterThanOrEqual(1);
    expect(st.heard).toBeGreaterThan(1);
    expect(st.variantCount).toBeLessThanOrEqual(12);
    expect(st.believed).toBeLessThanOrEqual(st.heard);
    expect(st.jevCalls).toBeLessThanOrEqual(250);
    expect(st.gptCalls).toBeLessThanOrEqual(70);
    expect(e.events[e.events.length - 1].milestone).toBe('ended');
    expect(e.series[0].tick).toBe(0);
    expect(e.series[e.series.length - 1].tick).toBe(e.tick);
  });

  it('gives the same hashes on two runs', () => {
    const a = live(cfg());
    const b = live(cfg());
    expect(a.hashes.length).toBeGreaterThan(10);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash()).toBe(b.finalHash());
    const c = live(cfg({ runSeed: 4 }));
    expect(c.finalHash()).not.toBe(a.finalHash());
  });

  it('replay equals live, and the record round-trips through JSON', () => {
    for (const c of [cfg(), cfg({ population: 30, townSeed: 11, runSeed: 5 }), cfg({ population: 75, rumor: PRESETS[1] })]) {
      const a = live(c);
      const log = JSON.parse(JSON.stringify(a.oracleLog));
      const r = replayEngine(c, log);
      expect(r.hashes).toEqual(a.hashes);
      expect(r.finalHash()).toBe(a.finalHash());
      const rec = replayRun(c, log);
      expect(rec.finalHash).toBe(a.finalHash());
      expect(rec.oracleLog).toEqual(log);
      expect(rec.stats).toEqual(a.stats());
    }
  });

  it('answers applied at deadlines do not depend on delivery timing', () => {
    // deliver every answer the moment it is issued vs. only when it is due
    const c = cfg({ townSeed: 3, runSeed: 9 });
    const early = live(c);
    const o = new LocalOracle({ seed: c.runSeed });
    const late = createEngine(c);
    const held = new Map<number, unknown>();
    while (!late.finished) {
      for (const r of late.pendingRequests()) if (!held.has(r.requestId)) held.set(r.requestId, r.kind === 'encounter' ? o.decideSync(r) : o.speakSync(r));
      if (!late.canStep()) {
        for (const r of late.pendingRequests()) if ((late.deadlineOf(r.requestId) ?? 1e9) <= late.tick) late.deliver(r.requestId, held.get(r.requestId) as never, 'local');
      }
      late.step();
    }
    expect(late.hashes).toEqual(early.hashes);
  });

  it('holds while a due answer is missing', () => {
    const e = createEngine(cfg());
    let guard = 0;
    while (e.pendingRequests().length === 0 && guard++ < 720) e.step();
    const req = e.pendingRequests()[0];
    while (e.canStep()) e.step();
    expect(e.tick).toBe(e.deadlineOf(req.requestId));
    expect(() => e.step()).toThrow();
    e.deliver(req.requestId, new LocalOracle().decideSync(req as never), 'local');
    expect(e.canStep()).toBe(true);
  });

  it('replay throws a clear error when an answer is missing', () => {
    const a = live(cfg());
    const log = a.oracleLog.slice(0, 3);
    expect(() => replayRun(cfg(), log)).toThrow(/no logged answer/);
    const o = new ReplayOracle(a.oracleLog);
    const speak = a.oracleLog.find((x) => x.kind === 'speak')!;
    expect(() => o.decideSync({ ...(a.oracleLog[0].request as object), requestId: speak.requestId } as never)).toThrow(/log has kind/);
  });

  it('snapshot exposes bubbles, signals and meetings for the renderer', () => {
    const e = createEngine(cfg());
    const o = new LocalOracle();
    let sawBubble = false;
    let sawSignal = false;
    let sawMeeting = false;
    while (!e.finished && e.tick < 300) {
      for (const r of e.pendingRequests()) e.deliver(r.requestId, r.kind === 'encounter' ? o.decideSync(r) : o.speakSync(r), 'local');
      e.step();
      const s = e.snapshot();
      if (s.bubbles.length) sawBubble = true;
      if (s.signals.length) sawSignal = true;
      if (s.meetings.length) sawMeeting = true;
      for (const b of s.bubbles) expect(b.text.length).toBeLessThanOrEqual(120);
    }
    expect(sawBubble && sawSignal && sawMeeting).toBe(true);
  });

  it('headless record has the contract shape', () => {
    const rec = runHeadless(cfg(), new LocalOracle());
    expect(rec.version).toBe(1);
    expect(rec.id).toBe('');
    expect(rec.createdAt).toBe('');
    expect(rec.variants[0].id).toBe('v0');
    expect(JSON.stringify(rec.oracleLog).length).toBeLessThan(200 * 1024);
    for (const c of rec.conversations) {
      expect(c.lines.length).toBeGreaterThanOrEqual(1);
      expect(c.lines.length).toBeLessThanOrEqual(4);
    }
  });
});
