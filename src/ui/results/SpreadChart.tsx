'use client';
/**
 * How the rumor spread over the day: three lines (heard, believe, told someone), one y axis in people.
 * Plain SVG, no chart library. Hover or tap shows the time and the three counts.
 */
import { useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { formatTick, type SeriesPoint } from '@/sim/types';
import {
  CHART_BOX as B,
  areaPath,
  countTicks,
  hourTicks,
  linePath,
  pointAt,
  spreadLabels,
  tickForX,
  xForTick,
  yForCount,
  type SeriesKey,
} from './chartScale';
import { INK, SERIES } from './colors';

const KEYS: SeriesKey[] = ['heard', 'believing', 'shared'];

export interface SpreadChartProps {
  series: readonly SeriesPoint[];
  population: number;
}

export function SpreadChart({ series, population }: SpreadChartProps) {
  const uid = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverTick, setHoverTick] = useState<number | null>(null);
  const last = series[series.length - 1];
  const lastTick = last?.tick ?? 0;

  const endLabels = useMemo(() => {
    if (!last) return [];
    const ys = KEYS.map((k) => yForCount(last[k], population));
    const placed = spreadLabels(ys, 16, B.top + 6, B.height - B.bottom);
    return KEYS.map((k, i) => ({ key: k, y: placed[i], value: last[k] }));
  }, [last, population]);

  if (!last) return null;

  const hover = hoverTick === null ? null : pointAt(series, Math.min(hoverTick, lastTick));
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * B.width;
    setHoverTick(tickForX(x));
  };

  const plotRight = B.width - B.right;
  const plotBottom = B.height - B.bottom;
  const hx = hover ? xForTick(hover.tick) : 0;
  const tipW = 148;
  const tipX = hx + tipW + 12 > B.width ? hx - tipW - 10 : hx + 10;

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" style={{ color: INK.text }} aria-hidden="true">
        {KEYS.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: SERIES[k].color, height: 3 }} />
            {SERIES[k].label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${B.width} ${B.height}`}
          className="block w-full min-w-[560px] touch-pan-x select-none"
          role="img"
          aria-labelledby={`${uid}-t ${uid}-d`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHoverTick(null)}
        >
          <title id={`${uid}-t`}>How the rumor spread over the day</title>
          <desc id={`${uid}-d`}>
            {`By ${formatTick(last.tick)}, ${last.heard} of ${population} people had heard it, ${last.believing} believed it, and ${last.shared} had told someone.`}
          </desc>
          {countTicks(population).map((v) => (
            <g key={v}>
              <line x1={B.left} x2={plotRight} y1={yForCount(v, population)} y2={yForCount(v, population)} stroke={INK.grid} strokeWidth={1} />
              <text x={B.left - 8} y={yForCount(v, population) + 4} textAnchor="end" fontSize={11} fill={INK.muted}>
                {v}
              </text>
            </g>
          ))}
          {hourTicks().map((h) => (
            <text key={h.tick} x={xForTick(h.tick)} y={plotBottom + 20} textAnchor="middle" fontSize={11} fill={INK.muted}>
              {h.label}
            </text>
          ))}
          <line x1={B.left} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke={INK.line} strokeWidth={1} />
          {lastTick < 720 && (
            <line x1={xForTick(lastTick)} x2={xForTick(lastTick)} y1={B.top} y2={plotBottom} stroke={INK.line} strokeDasharray="3 4" />
          )}

          <path d={areaPath(series, 'heard', population)} fill={SERIES.heard.color} fillOpacity={0.12} />
          {KEYS.map((k) => (
            <path key={k} d={linePath(series, k, population)} fill="none" stroke={SERIES[k].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {endLabels.map((l) => (
            <g key={l.key}>
              <circle cx={xForTick(lastTick)} cy={yForCount(last[l.key], population)} r={4} fill={SERIES[l.key].color} stroke={INK.surface} strokeWidth={2} />
              <text x={xForTick(lastTick) + 10} y={l.y + 4} fontSize={12} fill={INK.text}>
                <tspan fontWeight={600}>{l.value}</tspan> {SERIES[l.key].label.toLowerCase()}
              </text>
            </g>
          ))}

          {hover && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={B.top} y2={plotBottom} stroke={INK.muted} strokeWidth={1} />
              {KEYS.map((k) => (
                <circle key={k} cx={hx} cy={yForCount(hover[k], population)} r={4} fill={SERIES[k].color} stroke={INK.surface} strokeWidth={2} />
              ))}
              <g transform={`translate(${tipX},${B.top + 4})`}>
                <rect width={tipW} height={78} rx={6} fill={INK.raised} stroke={INK.line} />
                <text x={10} y={18} fontSize={12} fontWeight={600} fill={INK.text}>
                  {formatTick(hover.tick)}
                </text>
                {KEYS.map((k, i) => (
                  <g key={k} transform={`translate(10,${36 + i * 16})`}>
                    <rect y={-8} width={10} height={3} rx={1} fill={SERIES[k].color} />
                    <text x={16} y={0} fontSize={12} fill={INK.text}>
                      {SERIES[k].label}: {hover[k]}
                    </text>
                  </g>
                ))}
              </g>
            </g>
          )}
        </svg>
      </div>
      <details className="mt-2 text-sm" style={{ color: INK.muted }}>
        <summary className="cursor-pointer">Show as a table</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-left" style={{ color: INK.text }}>
            <thead>
              <tr>
                <th className="pr-3 font-semibold">Time</th>
                {KEYS.map((k) => (
                  <th key={k} className="pr-3 font-semibold">
                    {SERIES[k].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series
                .filter((p, i) => p.tick % 60 === 0 || i === series.length - 1)
                .map((p) => (
                  <tr key={p.tick}>
                    <td className="pr-3">{formatTick(p.tick)}</td>
                    {KEYS.map((k) => (
                      <td key={k} className="pr-3 tabular-nums">
                        {p[k]}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
