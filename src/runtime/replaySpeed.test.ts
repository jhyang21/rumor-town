import { describe, expect, it } from 'vitest';
import { createEngine } from '@/sim/engine';
import { LocalOracle } from '@/sim/oracle/local';
import { driveToEnd, replayRun } from '@/sim/runHeadless';
import { DEFAULT_RUMOR } from '@/sim/rumor/presets';
import type { RunConfig } from '@/sim/types';

// Timing lives here because src/sim may not read the clock.
describe('replay speed', () => {
  it('replays 50 people in under 200 ms', () => {
    const cfg: RunConfig = { population: 50, rumor: DEFAULT_RUMOR, townSeed: 7, runSeed: 3, overrides: {} };
    const e = createEngine(cfg);
    driveToEnd(e, new LocalOracle({ seed: 3 }), () => 'local');
    const log = e.oracleLog.slice();
    replayRun(cfg, log); // warm up
    const t0 = performance.now();
    replayRun(cfg, log);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
