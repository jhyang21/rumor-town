'use client';
/**
 * A still of the town at the end of the day. Replays the stored record in the browser (pure engine,
 * no network) and draws one frame with the canvas renderer, then a bar of what people ended up thinking.
 */
import { useEffect, useRef, useState } from 'react';
import type { Engine } from '@/sim/engine';
import { replayEngine } from '@/sim/runHeadless';
import { DAY_END_TICK, formatTick, type RunRecord } from '@/sim/types';
import { createTownRenderer, type TownRenderer } from '@/render/renderer';
import { INK, SPLIT_COLORS } from './colors';
import { beliefSplit } from './format';

const STILL_FRAME = { alpha: 0, paused: true, fast: false } as const;

export function TownStill({ record }: { record: Pick<RunRecord, 'config' | 'oracleLog' | 'stats'> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const { stats } = record;
  const at = stats.endReason === 'day_over' ? formatTick(DAY_END_TICK) : formatTick(stats.endedAtTick);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: Engine;
    let renderer: TownRenderer;
    try {
      engine = replayEngine(record.config, record.oracleLog);
      renderer = createTownRenderer(canvas, () => engine, { interactive: false, showLabels: false });
      renderer.resize();
      renderer.render(STILL_FRAME);
    } catch {
      // A failed replay only hides the picture; the results above still stand.
      queueMicrotask(() => setState('failed'));
      return;
    }
    queueMicrotask(() => setState('ready'));
    const observer = new ResizeObserver(() => {
      renderer.resize();
      renderer.render(STILL_FRAME);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      renderer.dispose();
    };
  }, [record]);

  const split = beliefSplit(stats);
  return (
    <figure className="m-0 space-y-3">
      <div className="relative overflow-hidden rounded-xl" style={{ background: '#2b2118', aspectRatio: '4 / 3' }}>
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          role="img"
          aria-label={`The town at ${at}, when the day ended.`}
          style={{ imageRendering: 'pixelated' }}
        />
        {state !== 'ready' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: INK.surface }}>
            {state === 'loading' ? 'Drawing the town…' : 'The town picture could not be drawn.'}
          </p>
        )}
      </div>
      <figcaption className="space-y-2 text-sm" style={{ color: INK.muted }}>
        <p>The town at {at}. Here is what people thought when the day ended.</p>
        <div className="flex h-3 w-full overflow-hidden rounded-full" aria-hidden="true">
          {split.map((s) =>
            s.count > 0 ? <span key={s.key} style={{ flexGrow: s.count, background: SPLIT_COLORS[s.key] }} /> : null,
          )}
        </div>
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0" style={{ color: INK.text }}>
          {split.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SPLIT_COLORS[s.key], border: `1px solid ${INK.line}` }} />
              {s.label}: <span className="font-semibold tabular-nums">{s.count}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
