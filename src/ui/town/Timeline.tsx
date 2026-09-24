'use client';

import { useState } from 'react';
import { DAY_END_TICK, formatTick, type SimEvent } from '@/sim/types';
import { runStore, useRunStore } from '@/store/runStore';

/** Milestone dots on a day bar. Mobile shows one "Latest: …" line until tapped. */
export function Timeline() {
  const engine = useRunStore((s) => s.engine);
  const tick = useRunStore((s) => s.tick);
  const latest = useRunStore((s) => s.milestone);
  const focus = useRunStore((s) => s.focus);
  const [open, setOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  if (!engine) return null;
  const milestones: SimEvent[] = engine.events.filter((e) => e.type === 'milestone');
  const sentence = focus?.text ?? latest ?? 'Nothing yet. The day has just begun.';

  const bar = (
    <div className="relative h-6 w-full">
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-stone-700" />
      <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded bg-amber-700/70" style={{ width: `${Math.min(100, (tick / DAY_END_TICK) * 100)}%` }} />
      {milestones.map((ev, i) => (
        <button
          key={`${ev.tick}-${i}`}
          type="button"
          className="timeline-dot absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${(ev.tick / DAY_END_TICK) * 100}%` }}
          title={`${formatTick(ev.tick)} · ${ev.text}`}
          aria-label={`${formatTick(ev.tick)}: ${ev.text}`}
          onClick={() => runStore.getState().focusEvent(ev)}
        />
      ))}
    </div>
  );

  return (
    <footer className="timeline z-20 px-3 py-2 text-sm">
      {/* wide screens */}
      <div className="hidden md:block">
        <div className="flex items-center gap-3">
          <button type="button" className="text-xs text-stone-400 hover:text-stone-200" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide timeline' : 'Show timeline'}
          </button>
          {open ? <div className="flex-1">{bar}</div> : <p className="flex-1 truncate text-stone-300">Latest: {latest ?? '—'}</p>}
        </div>
        {open ? <p className="mt-1 text-stone-200">{sentence}</p> : null}
      </div>
      {/* phones */}
      <div className="md:hidden">
        <button type="button" className="w-full truncate text-left text-stone-200" onClick={() => setMobileOpen((v) => !v)} aria-expanded={mobileOpen}>
          Latest: {latest ?? 'Nothing yet.'}
        </button>
        {mobileOpen ? (
          <div className="mt-1">
            {bar}
            <p className="mt-1 text-stone-200">{sentence}</p>
          </div>
        ) : null}
      </div>
    </footer>
  );
}
