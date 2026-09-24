'use client';

import { useEffect, useRef } from 'react';
import { createTownRenderer, type TownRenderer } from '@/render/renderer';
import { runStore } from '@/store/runStore';

/** The play canvas: renders whatever engine the store holds (the run, or the idle town). */
export function TownCanvas({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<TownRenderer | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const get = runStore.getState;
    const r = createTownRenderer(canvas, () => get().engine ?? get().previewEngine, {
      getFrame: () => {
        const s = get();
        const f = s.frame.current;
        return {
          alpha: s.phase === 'finished' ? 1 : f.alpha,
          paused: s.paused || f.state === 'paused' || s.phase === 'finished',
          fast: s.speed === 5,
        };
      },
      getSelected: () => get().selectedCharacterId,
      onSelect: (id) => {
        const s = get();
        if (s.phase !== 'running') return;
        s.select(id);
      },
    });
    rendererRef.current = r;
    r.start();
    const ro = new ResizeObserver(() => r.resize());
    ro.observe(canvas);
    let lastSeq = 0;
    const unsub = runStore.subscribe((s) => {
      if (s.focus && s.focus.seq !== lastSeq) {
        lastSeq = s.focus.seq;
        // at the fitted zoom the whole town is in view, so step in once to make the move visible
        if (r.camera.zoom === 1) r.setZoom(2);
        r.focusTile(s.focus.x, s.focus.y);
      }
    });
    return () => {
      unsub();
      ro.disconnect();
      r.dispose();
      rendererRef.current = null;
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <canvas ref={ref} className="block h-full w-full" style={{ imageRendering: 'pixelated' }} aria-label="The town" />
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button type="button" className="zoom-btn" aria-label="Zoom in" onClick={() => rendererRef.current?.zoomBy(1)}>
          +
        </button>
        <button type="button" className="zoom-btn" aria-label="Zoom out" onClick={() => rendererRef.current?.zoomBy(-1)}>
          −
        </button>
      </div>
    </div>
  );
}
