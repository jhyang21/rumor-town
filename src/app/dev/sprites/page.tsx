'use client';

import { useEffect, useRef } from 'react';
import type { Facing, Occupation } from '@/sim/types';
import { LOCATIONS } from '@/sim/town/mapSpec';
import {
  type Look,
  type Palette,
  type PixelMatrix,
  type SignalKind,
  type TileName,
  type WalkFrame,
  BUILDING_SIZES,
  BUILDING_VARIANTS,
  HAIR_STYLES,
  OCCUPATION_ACCESSORY,
  PALETTE,
  SIGNALS,
  TILES,
  TOWN_COLORS,
  WALK_FRAMES,
  characterPalette,
  composeBubble,
  composeBuilding,
  composeCharacter,
  composeLocation,
  rasterize,
  type BuildingKind,
} from '@/art';

const SCALE = 4;
const FACINGS: Facing[] = ['down', 'up', 'left', 'right'];
const OCCUPATIONS = Object.keys(OCCUPATION_ACCESSORY) as Occupation[];

interface Item {
  label: string;
  matrix: PixelMatrix;
  palette: Palette;
}

function Sprite({ matrix, palette, scale = SCALE }: { matrix: PixelMatrix; palette: Palette; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = matrix[0]?.length ?? 0;
  const h = matrix.length;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(rasterize(matrix, palette), 0, 0, w * scale, h * scale);
  }, [matrix, palette, scale, w, h]);
  return <canvas ref={ref} width={w * scale} height={h * scale} style={{ imageRendering: 'pixelated' }} />;
}

function Row({ title, items, scale }: { title: string; items: Item[]; scale?: number }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-[#5a4030]">{title}</h2>
      <div className="flex flex-wrap items-end gap-3">
        {items.map((it) => (
          <figure key={it.label} className="flex flex-col items-center">
            <Sprite matrix={it.matrix} palette={it.palette} scale={scale} />
            <figcaption className="mt-1 text-[10px] text-[#7c5233]">{it.label}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/* ---------- Static sheet data (pure, safe on the server) ---------- */

const tileItems: Item[] = (Object.keys(TILES) as TileName[]).map((name) => ({
  label: name,
  matrix: TILES[name],
  palette: PALETTE,
}));

const buildingItems: Item[] = (Object.keys(BUILDING_SIZES) as BuildingKind[]).flatMap((kind) => {
  const { w, h } = BUILDING_SIZES[kind];
  return Array.from({ length: BUILDING_VARIANTS[kind] }, (_, v) => ({
    label: `${kind} ${v}`,
    matrix: composeBuilding(kind, w, h, v),
    palette: PALETTE,
  }));
});

const rearItems: Item[] = LOCATIONS.filter((l) => l.id === 'home6' || l.id === 'home7' || l.kind === 'square')
  .map((l, i) => ({ label: `${l.id} (map)`, matrix: composeLocation(l, i % 4, 1) ?? [], palette: PALETTE }))
  .concat(
    (['cafe', 'store', 'office', 'school'] as const).map((kind) => ({
      label: `${kind} back`,
      matrix: composeBuilding(kind, BUILDING_SIZES[kind].w, BUILDING_SIZES[kind].h, 0, { doorSide: 'top' }),
      palette: PALETTE,
    })),
  );

const SAMPLE_LOOKS: Look[] = Array.from({ length: 12 }, (_, i) => ({
  hair: (i % 6) + 6 * ((i * 5) % 6),
  skin: i % 4,
  shirt: (i * 3) % 8,
  pants: (i * 7) % 4,
}));

const characterRows: { title: string; items: Item[] }[] = SAMPLE_LOOKS.map((look, i) => {
  const occupation = OCCUPATIONS[i % OCCUPATIONS.length];
  const palette = characterPalette(look);
  return {
    title: `${HAIR_STYLES[look.hair % 6]} hair, ${occupation.replace('_', ' ')}`,
    items: FACINGS.flatMap((facing) =>
      WALK_FRAMES.map((frame: WalkFrame) => ({
        label: `${facing} ${frame}`,
        matrix: composeCharacter({ look, occupation, facing, frame }),
        palette,
      })),
    ),
  };
});

const accessoryItems: Item[] = OCCUPATIONS.flatMap((occupation, i) => {
  const look: Look = { hair: i % 6, skin: (i + 1) % 4, shirt: (i + 5) % 8, pants: i % 4 };
  const palette = characterPalette(look);
  return FACINGS.map((facing) => ({
    label: `${OCCUPATION_ACCESSORY[occupation]} ${facing}`,
    matrix: composeCharacter({ look, occupation, facing, frame: 0 }),
    palette,
  }));
});

const signalItems: Item[] = [
  ...(Object.keys(SIGNALS) as SignalKind[]).map((k) => ({ label: k, matrix: SIGNALS[k], palette: PALETTE })),
  { label: 'bubble 40x14', matrix: composeBubble(40, 14), palette: PALETTE },
  { label: 'bubble 24x10', matrix: composeBubble(24, 10, 12), palette: PALETTE },
];

const swatches: Item[] = TOWN_COLORS.map((c) => ({
  label: `${c.letter} ${c.name}`,
  matrix: ['OOOOOO', 'OCCCCO', 'OCCCCO', 'OOOOOO'].map((r) => r.replace(/C/g, c.letter)),
  palette: PALETTE,
}));

/** A small scene: grass, path, props, a home and people, to judge the art together. */
const sceneItems: Item[] = (() => {
  const W = 12 * 16;
  const H = 8 * 16;
  let rows: PixelMatrix = Array.from({ length: H }, () => '.'.repeat(W));
  const put = (m: PixelMatrix, x: number, y: number) => {
    rows = rows.map((row, yy) => {
      const src = m[yy - y];
      if (!src) return row;
      const chars = row.split('');
      for (let xx = 0; xx < src.length; xx++) if (src[xx] !== '.' && x + xx < W) chars[x + xx] = src[xx];
      return chars.join('');
    });
  };
  for (let ty = 0; ty < 8; ty++)
    for (let tx = 0; tx < 12; tx++) {
      const g = ty === 5 ? TILES.path : [TILES.grass0, TILES.grass1, TILES.grass2][(tx * 7 + ty * 3) % 5 === 0 ? 1 : (tx + ty) % 7 === 0 ? 2 : 0];
      put(g, tx * 16, ty * 16);
    }
  for (let tx = 0; tx < 12; tx++) put(TILES.tree, tx * 16, 0);
  put(composeBuilding('home', 4, 3, 0), 16, 16);
  put(composeBuilding('home', 4, 3, 3), 96, 16);
  put(TILES.lampPost, 80, 48);
  put(TILES.bush, 160, 48);
  put(TILES.bench, 160, 96);
  put(TILES.flowerBed, 176, 64);
  return [{ label: 'scene (not a character palette, people drawn below)', matrix: rows, palette: PALETTE }];
})();

export default function SpritesPage() {
  return (
    <main className="min-h-screen bg-[#f6eedd] p-6 font-sans">
      <h1 className="mb-1 text-xl font-bold text-[#3d2b1f]">Rumor Town sprites</h1>
      <p className="mb-6 text-sm text-[#7c5233]">Every sprite at {SCALE}x. Walk frames: 0 stand, 1 step A, 2 step B.</p>
      <Row title="Palette" items={swatches} scale={3} />
      <Row title="Tiles and props" items={tileItems} />
      <Row title="Buildings (every kind and variant)" items={buildingItems} />
      <Row title="Back views and map-placed buildings" items={rearItems} />
      <Row title="Scene at 3x" items={sceneItems} scale={3} />
      {characterRows.map((r) => (
        <Row key={r.title} title={r.title} items={r.items} />
      ))}
      <Row title="Occupation accessories" items={accessoryItems} />
      <Row title="Signals and speech bubble" items={signalItems} scale={6} />
    </main>
  );
}
