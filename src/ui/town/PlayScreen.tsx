'use client';

import { useEffect } from 'react';
import { ResultsPanel } from '@/ui/results/ResultsPanel';
import { SetupSheet } from '@/ui/setup/SetupSheet';
import { runStore, useRunStore } from '@/store/runStore';
import { loadPlayIntent, type PlayParams } from '@/store/urlParams';
import { Controls, Hud } from './Hud';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { TownCanvas } from './TownCanvas';

function Banner() {
  const banner = useRunStore((s) => s.banner);
  if (!banner) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-50 flex justify-center px-4">
      <p className="pointer-events-auto flex items-center gap-3 rounded-full bg-stone-800/95 px-4 py-1.5 text-sm text-stone-100 shadow-lg ring-1 ring-stone-600" role="status">
        {banner}
        <button type="button" className="text-stone-400 hover:text-stone-100" aria-label="Dismiss" onClick={() => runStore.getState().setBanner(null)}>
          ✕
        </button>
      </p>
    </div>
  );
}

function Results() {
  const record = useRunStore((s) => s.record);
  const phase = useRunStore((s) => s.phase);
  if (phase !== 'finished' || !record) return null;
  const st = runStore.getState();
  return (
    <div className="results-sheet absolute inset-x-0 bottom-0 z-40 max-h-[88%] overflow-y-auto rounded-t-2xl">
      <ResultsPanel
        record={record}
        actions={{
          replay: () => st.replayRecord(record),
          rerun: () => void st.rerun(record),
          modify: () => st.modify(record),
          share: () => st.share(),
        }}
      />
    </div>
  );
}

export function PlayScreen({ params }: { params: PlayParams }) {
  const phase = useRunStore((s) => s.phase);
  const { replay, rerun, modify } = params;

  useEffect(() => {
    let alive = true;
    const s = runStore.getState();
    s.showPreview();
    void loadPlayIntent({ replay, rerun, modify }).then((intent) => {
      if (!alive) return;
      const st = runStore.getState();
      if (intent.kind === 'replay') st.replayRecord(intent.record);
      else if (intent.kind === 'rerun') void st.rerun(intent.record);
      else if (intent.kind === 'modify') st.modify(intent.record);
      else if (intent.kind === 'error') st.setBanner(intent.message);
    });
    return () => {
      alive = false;
      runStore.getState().dispose();
    };
  }, [replay, rerun, modify]);

  return (
    <div className="play-root flex h-dvh flex-col overflow-hidden">
      <Hud />
      <main className="relative min-h-0 flex-1">
        <TownCanvas className={`h-full w-full ${phase === 'setup' ? 'opacity-60' : ''}`} />
        <Inspector />
        {phase === 'setup' ? <SetupSheet /> : null}
        <Results />
        <Banner />
      </main>
      {phase !== 'setup' ? <Timeline /> : null}
      <nav className="bottom-bar z-20 px-3 py-2 md:hidden" aria-label="Controls">
        <Controls compact />
      </nav>
    </div>
  );
}
