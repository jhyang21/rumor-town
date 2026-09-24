'use client';
/**
 * The family tree of versions, the original at the top. Cards sit on a laid-out grid with connector
 * lines drawn in SVG underneath. Pick a card to see who first said it and how far it went.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTick, type VariantNode } from '@/sim/types';
import { INK } from './colors';
import { mutationWord, personName, variantById } from './format';
import { layoutTree, nodeBadges } from './tree';

const CARD_W = 200;
const CARD_H = 112;
const GAP_X = 16;
const GAP_Y = 36;

export interface VariantTreeProps {
  variants: readonly VariantNode[];
  mostWidespreadId: string;
  mostChangedId: string;
  names?: readonly string[];
}

export function VariantTree({ variants, mostWidespreadId, mostChangedId, names }: VariantTreeProps) {
  const layout = useMemo(() => layoutTree(variants), [variants]);
  const [selected, setSelected] = useState<string>(mostWidespreadId);
  const width = layout.columns * (CARD_W + GAP_X) - GAP_X;
  const height = layout.rows * (CARD_H + GAP_Y) - GAP_Y;
  const pos = new Map(layout.nodes.map((n) => [n.id, { x: n.col * (CARD_W + GAP_X), y: n.depth * (CARD_H + GAP_Y) }]));
  const sel = variantById(variants, selected) ?? variants[0];
  const parent = sel?.parentId ? variantById(variants, sel.parentId) : undefined;
  const scroller = useRef<HTMLDivElement>(null);

  // A wide tree centres the original beyond the visible width; start with it in view.
  useEffect(() => {
    const el = scroller.current;
    const root = layout.nodes.find((n) => n.depth === 0);
    if (!el || !root) return;
    const centre = root.col * (CARD_W + GAP_X) + CARD_W / 2;
    el.scrollLeft = Math.max(0, centre - el.clientWidth / 2);
  }, [layout]);

  return (
    <div>
      <div ref={scroller} className="overflow-x-auto pb-2">
        <div className="relative mx-auto" style={{ width, height }}>
          <svg className="absolute inset-0" width={width} height={height} aria-hidden="true">
            {layout.edges.map((e) => {
              const a = pos.get(e.from)!;
              const b = pos.get(e.to)!;
              const x1 = a.x + CARD_W / 2;
              const y1 = a.y + CARD_H;
              const x2 = b.x + CARD_W / 2;
              const y2 = b.y;
              const my = (y1 + y2) / 2;
              return <path key={`${e.from}-${e.to}`} d={`M${x1},${y1}V${my}H${x2}V${y2}`} fill="none" stroke={INK.line} strokeWidth={2} />;
            })}
          </svg>
          {variants.map((v) => {
            const p = pos.get(v.id);
            if (!p) return null;
            const badges = nodeBadges(v.id, mostWidespreadId, mostChangedId);
            const isSel = v.id === sel?.id;
            const hot = badges.length > 0;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelected(v.id)}
                aria-pressed={isSel}
                className="absolute flex flex-col gap-1 overflow-hidden rounded-lg p-2 text-left text-xs transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{
                  left: p.x,
                  top: p.y,
                  width: CARD_W,
                  height: CARD_H,
                  background: INK.raised,
                  color: INK.text,
                  border: `${isSel ? 3 : hot ? 2 : 1}px solid ${isSel ? INK.accent : hot ? '#d0672c' : INK.line}`,
                  outlineColor: INK.accent,
                }}
              >
                <span className="flex flex-wrap items-center gap-1">
                  <span className="font-semibold" style={{ color: v.corrected ? '#2f6f4f' : INK.muted }}>
                    {v.corrected ? '✓ ' : ''}
                    {mutationWord(v.mutation, v.parentId === null)}
                  </span>
                  {badges.includes('widespread') && <Badge>Most heard</Badge>}
                  {badges.includes('changed') && <Badge>Changed most</Badge>}
                </span>
                <span className="line-clamp-4 leading-snug">{v.text}</span>
              </button>
            );
          })}
        </div>
      </div>
      {sel && (
        <div className="mt-3 rounded-lg p-3 text-sm" style={{ background: INK.raised, border: `1px solid ${INK.line}`, color: INK.text }} aria-live="polite">
          <p className="font-medium">“{sel.text}”</p>
          <p className="mt-1" style={{ color: INK.muted }}>
            {sel.parentId === null ? 'The original. ' : ''}
            {personName(names, sel.firstAuthorId)} first said it at {formatTick(sel.createdTick)}.{' '}
            {sel.heardCount === 1 ? '1 person heard this version.' : `${sel.heardCount} people heard this version.`}
          </p>
          {parent && (
            <p className="mt-1" style={{ color: INK.muted }}>
              It came from: “{parent.text}”
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: '#f6e0c8', color: '#7c3a1c' }}>
      {children}
    </span>
  );
}
