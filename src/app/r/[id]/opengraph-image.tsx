import { ImageResponse } from 'next/og';
import { loadRecord } from '@/lib/blob';
import { BORDER, LOCATIONS, MAP_HEIGHT, MAP_WIDTH } from '@/sim/town/mapSpec';
import type { LocationSpec, Rect } from '@/sim/types';
import { INK, MAP_COLORS, SPLIT_COLORS } from '@/ui/results/colors';
import { beliefSplit, headline, variantById, type SplitKey } from '@/ui/results/format';

export const alt = 'How a rumor spread through Rumor Town';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const SHORT: Record<SplitKey, string> = { believe: 'Believe', unsure: 'Unsure', reject: 'Do not believe', unheard: 'Never heard' };

const TILE = 13; // 40 x 30 tiles -> 520 x 390

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function fill(loc: LocationSpec): string {
  switch (loc.kind) {
    case 'home':
      return MAP_COLORS.home[Number(loc.id.slice(4)) % MAP_COLORS.home.length];
    case 'cafe':
      return MAP_COLORS.cafe;
    case 'store':
      return MAP_COLORS.store;
    case 'office':
      return MAP_COLORS.office;
    case 'school':
      return MAP_COLORS.school;
    case 'square':
      return MAP_COLORS.fountain;
    default:
      return MAP_COLORS.park;
  }
}

function Block({ r, color, outline = false }: { r: Rect; color: string; outline?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: r.x * TILE,
        top: r.y * TILE,
        width: r.w * TILE,
        height: r.h * TILE,
        background: color,
        border: outline ? `3px solid ${MAP_COLORS.outline}` : 'none',
        borderRadius: outline ? 4 : 0,
      }}
    />
  );
}

function TownSilhouette() {
  const zones = LOCATIONS.filter((l) => l.kind === 'park' || l.kind === 'square');
  const buildings = LOCATIONS.filter((l) => l.footprint);
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: MAP_WIDTH * TILE,
        height: MAP_HEIGHT * TILE,
        background: MAP_COLORS.grass,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      <Block r={{ x: 1, y: 7, w: MAP_WIDTH - 2, h: 1 }} color="#dcbc8c" />
      <Block r={{ x: 1, y: 22, w: MAP_WIDTH - 2, h: 1 }} color="#dcbc8c" />
      {zones.map((l) => (
        <Block key={`z-${l.id}`} r={l.zone} color={l.kind === 'park' ? MAP_COLORS.park : MAP_COLORS.square} />
      ))}
      {BORDER.map((r, i) => (
        <Block key={`b-${i}`} r={r} color={MAP_COLORS.trees} />
      ))}
      {buildings.map((l) => (
        <Block key={l.id} r={l.footprint!} color={fill(l)} outline />
      ))}
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let record = null;
  try {
    record = await loadRecord(id);
  } catch {
    record = null;
  }

  if (!record) {
    return new ImageResponse(
      (
        <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 48, background: INK.surface, color: INK.text }}>
          <TownSilhouette />
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 700 }}>Rumor Town</div>
        </div>
      ),
      size,
    );
  }

  const { stats, variants } = record;
  const original = variantById(variants, 'v0')?.text ?? record.config.rumor.text;
  const ended = variantById(variants, stats.mostWidespreadVariantId)?.text ?? original;
  const split = beliefSplit(stats);

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', padding: 48, gap: 40, background: INK.surface, color: INK.text }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, color: INK.accent }}>Rumor Town</div>
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, lineHeight: 1.2 }}>{headline(stats)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 20, color: INK.muted }}>Started as:</div>
              <div style={{ display: 'flex', fontSize: 26, lineHeight: 1.25 }}>{`“${clip(original, 110)}”`}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 20, color: INK.muted }}>Ended as:</div>
              <div style={{ display: 'flex', fontSize: 26, lineHeight: 1.25, fontWeight: 600 }}>{`“${clip(ended, 110)}”`}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', width: '100%', height: 18, borderRadius: 9, overflow: 'hidden' }}>
              {split
                .filter((s) => s.count > 0)
                .map((s) => (
                  <div key={s.key} style={{ display: 'flex', flexGrow: s.count, flexBasis: 0, background: SPLIT_COLORS[s.key] }} />
                ))}
            </div>
            <div style={{ display: 'flex', gap: 18, fontSize: 18, color: INK.muted }}>
              {split.map((s) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', width: 12, height: 12, borderRadius: 3, background: SPLIT_COLORS[s.key] }} />
                  {`${SHORT[s.key]} ${s.count}`}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <TownSilhouette />
        </div>
      </div>
    ),
    size,
  );
}
