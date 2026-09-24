import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDriver } from './driver';
import { createEngine } from '@/sim/engine';
import { LocalOracle } from '@/sim/oracle/local';
import { DEFAULT_RUMOR } from '@/sim/rumor/presets';
import type { DecisionAnswer, DecisionRequest, Oracle, SpeechAnswer, SpeechRequest } from '@/sim/oracle/types';

describe('driver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the tick on a slow decision and falls back after 3 s', async () => {
    const engine = createEngine({ population: 50, rumor: DEFAULT_RUMOR, townSeed: 7, runSeed: 3, overrides: {} });
    const local = new LocalOracle();
    let lateResolved = 0;
    const slow: Oracle = {
      decide: (req: DecisionRequest) =>
        new Promise<DecisionAnswer>((res) =>
          setTimeout(() => {
            lateResolved++;
            res(local.decideSync(req));
          }, 10_000),
        ),
      speak: (req: SpeechRequest) => Promise.resolve<SpeechAnswer>(local.speakSync(req)),
    };
    const driver = createDriver({ engine, oracle: slow, fallback: local, speed: 5 });
    driver.play();

    let waited = 0;
    while (driver.state !== 'holding' && waited < 120_000) {
      await vi.advanceTimersByTimeAsync(50);
      waited += 50;
    }
    expect(driver.state).toBe('holding');
    const heldAt = engine.tick;

    await vi.advanceTimersByTimeAsync(2500);
    expect(engine.tick).toBe(heldAt);
    expect(driver.fallbackIds.size).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(driver.fallbackIds.size).toBeGreaterThanOrEqual(1);
    expect(engine.tick).toBeGreaterThan(heldAt);
    const firstFallback = [...driver.fallbackIds][0];
    expect(engine.oracleLog.find((e) => e.requestId === firstFallback)?.source).toBe('fallback');

    // the real answer lands later and is ignored
    await vi.advanceTimersByTimeAsync(8000);
    expect(lateResolved).toBeGreaterThanOrEqual(1);
    expect(engine.oracleLog.find((e) => e.requestId === firstFallback)?.source).toBe('fallback');
    driver.stop();
    expect(driver.state).toBe('idle');
  });

  it('runs at 4 ticks per second at 1x and pauses', async () => {
    const engine = createEngine({ population: 30, rumor: DEFAULT_RUMOR, townSeed: 2, runSeed: 2, overrides: {} });
    const local = new LocalOracle();
    const driver = createDriver({ engine, oracle: local, fallback: local, speed: 1 });
    driver.play();
    await vi.advanceTimersByTimeAsync(1000);
    // a hold can only slow it down
    expect(engine.tick).toBeGreaterThanOrEqual(2);
    expect(engine.tick).toBeLessThanOrEqual(5);
    driver.pause();
    const t = engine.tick;
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.tick).toBe(t);
    expect(driver.state).toBe('paused');
    driver.setSpeed(5);
    driver.play();
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.tick).toBeGreaterThan(t + 10);
    driver.stop();
  });
});
