'use client';

import { useEffect, useRef, useState } from 'react';
import { Engine } from '@/sim/engine';
import { formatTick, type RunConfig } from '@/sim/types';
import type { OracleLogEntry, SyncOracle } from '@/sim/oracle/types';
import { LocalOracle } from '@/sim/oracle/local';
import { createDriver, type Driver, type FrameInfo } from '@/runtime/driver';
import { createTownRenderer } from '@/render/renderer';
import { SafeReplayOracle } from '@/store/oracles';
import { presetRumor } from '@/store/runStore';

interface DemoRun {
  config: RunConfig;
  oracleLog: OracleLogEntry[];
}

const FALLBACK_CONFIG: RunConfig = { population: 30, rumor: presetRumor('cafe-closing'), townSeed: 11, runSeed: 5, overrides: {} };
const WARMUP_MAX_TICKS = 45;

/** Step the replay forward until someone is walking, so the town moves at once. */
function warmUp(engine: Engine, oracle: SyncOracle): void {
  while (!engine.finished && engine.tick < WARMUP_MAX_TICKS) {
    if (engine.states.some((s) => s.activity === 'walking')) return;
    for (const req of engine.pendingRequests()) {
      engine.deliver(req.requestId, req.kind === 'encounter' ? oracle.decideSync(req) : oracle.speakSync(req), 'replay');
    }
    if (!engine.canStep()) return;
    engine.step();
  }
}

/** Looping replay of a recorded day. No controls; the HUD shows the clock and who has heard. */
export function DemoTown() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [clock, setClock] = useState('8:00 AM');
  const [heard, setHeard] = useState(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let alive = true;
    let engine: Engine | null = null;
    let driver: Driver | null = null;
    let frame: FrameInfo = { tick: 0, alpha: 0, state: 'idle', clockScale: 1 };
    let lastHud = 0;
    let demo: DemoRun | null = null;

    const renderer = createTownRenderer(canvas, () => engine, {
      interactive: false,
      getFrame: () => ({ alpha: frame.alpha, paused: false, fast: false }),
    });
    renderer.start();
    const ro = new ResizeObserver(() => renderer.resize());
    ro.observe(canvas);

    function begin() {
      if (!alive) return;
      driver?.stop();
      const cfg = demo?.config ?? FALLBACK_CONFIG;
      const oracle: SyncOracle = demo ? new SafeReplayOracle(demo.oracleLog, cfg.runSeed) : new LocalOracle({ seed: cfg.runSeed });
      const e = new Engine(cfg);
      warmUp(e, oracle);
      engine = e;
      driver = createDriver({
        engine: e,
        oracle,
        fallback: oracle,
        speed: 2,
        onFrame: (f) => {
          frame = f;
          const now = performance.now();
          if (now - lastHud > 250) {
            lastHud = now;
            setClock(formatTick(e.tick));
            setHeard(e.states.reduce((n, s) => n + (s.rumor ? 1 : 0), 0));
          }
          if (f.state === 'finished') setTimeout(begin, 2500);
        },
      });
      driver.play();
    }

    // start the town at once with whatever we have, then swap in the recording when it lands
    fetch('/demo-run.json')
      .then((r) => (r.ok ? (r.json() as Promise<DemoRun>) : null))
      .catch(() => null)
      .then((d) => {
        if (!alive) return;
        if (d && d.config && Array.isArray(d.oracleLog)) demo = d;
        begin();
      });

    return () => {
      alive = false;
      driver?.stop();
      ro.disconnect();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]" style={{ aspectRatio: '4 / 3' }}>
      <canvas ref={ref} className="block h-full w-full" style={{ imageRendering: 'pixelated' }} aria-label="A small town passing a rumor around" />
      <div className="pointer-events-none absolute left-3 top-3 flex gap-3 rounded-full bg-stone-900/70 px-3 py-1 text-xs text-stone-200">
        <span className="font-mono tabular-nums">{clock}</span>
        <span>Heard {heard}</span>
      </div>
    </div>
  );
}
