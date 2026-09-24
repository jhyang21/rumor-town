'use client';

import { useState } from 'react';
import { formatTick } from '@/sim/types';
import type { Speed } from '@/runtime/driver';
import { useRunStore, runStore } from '@/store/runStore';

const SPEEDS: Speed[] = [1, 2, 5];

export function ThinkingDot() {
  const holding = useRunStore((s) => s.driverState === 'holding' && s.phase === 'running');
  if (!holding) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-200/90" role="status">
      <span className="thinking-dot" aria-hidden />
      thinking…
    </span>
  );
}

/** Top bar: clock, rumor, counters; on wide screens also the controls. */
export function Hud() {
  const tick = useRunStore((s) => s.tick);
  const counters = useRunStore((s) => s.counters);
  const rumor = useRunStore((s) => s.config?.rumor.text ?? s.draft.rumor.text);
  const mode = useRunStore((s) => s.mode);
  const phase = useRunStore((s) => s.phase);
  const [full, setFull] = useState(false);
  return (
    <header className="hud z-20 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
      <span className="font-mono text-base font-semibold tabular-nums text-amber-100">{formatTick(tick)}</span>
      <button
        type="button"
        onClick={() => setFull((v) => !v)}
        className={`min-w-0 flex-1 text-left text-stone-200 ${full ? 'whitespace-normal' : 'truncate'}`}
        title={rumor}
        aria-expanded={full}
      >
        {mode === 'replay' && phase !== 'setup' ? <span className="mr-2 rounded bg-stone-700 px-1.5 py-0.5 text-xs">Replay</span> : null}
        “{rumor}”
      </button>
      <span className="text-stone-300">
        Heard <b className="text-stone-50">{counters.heard}</b> · Believe <b className="text-stone-50">{counters.believe}</b> · Told others{' '}
        <b className="text-stone-50">{counters.told}</b>
      </span>
      <ThinkingDot />
      <div className="hidden md:flex">
        <Controls />
      </div>
    </header>
  );
}

export function Controls({ compact = false }: { compact?: boolean }) {
  const speed = useRunStore((s) => s.speed);
  const paused = useRunStore((s) => s.paused);
  const running = useRunStore((s) => s.phase === 'running');
  const { pause, resume, setSpeed, restart, endDay } = runStore.getState();
  return (
    <div className={`flex items-center ${compact ? 'w-full justify-between gap-1' : 'gap-2'}`}>
      <button type="button" className="ctl" disabled={!running} onClick={() => (paused ? resume() : pause())} aria-label={paused ? 'Resume' : 'Pause'}>
        {paused ? '▶' : '❚❚'}
      </button>
      <div className="flex overflow-hidden rounded-md border border-stone-600" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={!running}
            className={`px-2.5 py-1 text-xs ${speed === s ? 'bg-amber-300 text-stone-900' : 'text-stone-200 hover:bg-stone-700'}`}
            aria-pressed={speed === s}
            onClick={() => setSpeed(s)}
          >
            {s}x
          </button>
        ))}
      </div>
      <button type="button" className="ctl" disabled={!running} onClick={() => void restart()} title="Start this day over">
        Restart
      </button>
      <button type="button" className="ctl ctl-strong" disabled={!running} onClick={() => endDay()}>
        End day
      </button>
    </div>
  );
}
