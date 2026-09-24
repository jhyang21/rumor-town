'use client';
/** The day's turning points, with times. */
import type { SimEvent } from '@/sim/types';
import { INK } from './colors';
import { milestones } from './format';

export function MilestoneList({ events }: { events: readonly SimEvent[] }) {
  const items = milestones(events);
  if (items.length === 0) return null;
  return (
    <ol className="m-0 list-none space-y-2 p-0">
      {items.map((m, i) => (
        <li key={`${m.tick}-${i}`} className="flex gap-3 text-sm">
          <span className="w-20 shrink-0 whitespace-nowrap tabular-nums font-semibold" style={{ color: INK.muted }}>
            {m.time}
          </span>
          <span style={{ color: INK.text }}>{m.text}</span>
        </li>
      ))}
    </ol>
  );
}
