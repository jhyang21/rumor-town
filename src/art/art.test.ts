import { describe, expect, it } from 'vitest';
import type { Facing, Occupation } from '../sim/types';
import { LOCATIONS } from '../sim/town/mapSpec';
import {
  BUILDING_VARIANTS,
  BUILDING_SIZES,
  CHARACTER_LAYERS,
  CHAR_SIZE,
  HAIR_STYLES,
  LEG_ROW,
  LOOK_RANGES,
  OCCUPATION_ACCESSORY,
  PALETTE,
  SIGNALS,
  TILES,
  TOWN_COLORS,
  WALK_FRAMES,
  BUBBLE,
  characterPalette,
  composeBubble,
  composeBuilding,
  composeCharacter,
  composeLocation,
  hairStyleOf,
  height,
  matrixToRGBA,
  mirrorX,
  overrideRows,
  pixelText,
  rotateCW,
  stack,
  stamp,
  tilePattern,
  validateMatrix,
  width,
  type BuildingKind,
} from './index';

const OCCUPATIONS = Object.keys(OCCUPATION_ACCESSORY) as Occupation[];
const FACINGS: Facing[] = ['down', 'up', 'left', 'right'];

describe('palette', () => {
  it('has unique single letters and valid hex', () => {
    const letters = TOWN_COLORS.map((c) => c.letter);
    expect(new Set(letters).size).toBe(letters.length);
    for (const c of TOWN_COLORS) {
      expect(c.letter).toHaveLength(1);
      expect(c.letter).not.toBe('.');
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('character palettes cover every look index and wrap out-of-range values', () => {
    for (let hair = 0; hair < LOOK_RANGES.hair; hair++)
      for (let skin = 0; skin < LOOK_RANGES.skin; skin++)
        for (let shirt = 0; shirt < LOOK_RANGES.shirt; shirt++)
          for (let pants = 0; pants < LOOK_RANGES.pants; pants++) {
            const p = characterPalette({ hair, skin, shirt, pants });
            for (const hex of Object.values(p)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
          }
    expect(characterPalette({ hair: -1, skin: 99, shirt: -9, pants: 5 })).toBeTruthy();
    expect(hairStyleOf({ hair: 7, skin: 0, shirt: 0, pants: 0 })).toBe('long');
  });
});

describe('matrix helpers', () => {
  const m = ['ab.', 'c.d'];
  it('validateMatrix reports ragged rows and unknown letters', () => {
    expect(validateMatrix(['OO', 'O'], PALETTE)).toHaveLength(1);
    expect(validateMatrix(['O?'], PALETTE)[0]).toMatch(/unknown letter/);
    expect(validateMatrix(['O.'], PALETTE)).toEqual([]);
  });
  it('mirrorX round-trips', () => {
    expect(mirrorX(mirrorX(m))).toEqual(m);
    expect(mirrorX(m)).toEqual(['.ba', 'd.c']);
    for (const t of Object.values(TILES)) expect(mirrorX(mirrorX(t))).toEqual(t);
  });
  it('rotateCW four times is identity', () => {
    expect(rotateCW(rotateCW(rotateCW(rotateCW(TILES.pathEdgeN))))).toEqual(TILES.pathEdgeN);
  });
  it('stack lets later layers win on non-transparent pixels', () => {
    expect(stack([['ab', 'cd'], ['.X', 'Y.']])).toEqual(['aX', 'Yd']);
    expect(() => stack([['a'], ['ab']])).toThrow();
  });
  it('stamp clips to the base', () => {
    expect(stamp(['...', '...'], ['XY', 'ZW'], 2, 1)).toEqual(['...', '..X']);
  });
  it('overrideRows replaces rows and checks bounds', () => {
    expect(overrideRows(['aa', 'bb', 'cc'], 1, ['XX'])).toEqual(['aa', 'XX', 'cc']);
    expect(() => overrideRows(['aa'], 1, ['XX'])).toThrow();
  });
  it('tilePattern fills w x h', () => {
    expect(tilePattern(['ab', 'cd'], 3, 3)).toEqual(['aba', 'cdc', 'aba']);
  });
  it('pixelText renders 5 rows', () => {
    const t = pixelText('STORE', 'X');
    expect(t).toHaveLength(5);
    expect(width(t)).toBe(5 * 4 - 1);
  });
  it('matrixToRGBA writes opaque pixels and leaves transparent ones at zero', () => {
    const data = matrixToRGBA(['O.'], PALETTE);
    expect(Array.from(data)).toEqual([0x3d, 0x2b, 0x1f, 255, 0, 0, 0, 0]);
  });
});

describe('tiles and signals', () => {
  it('every tile validates', () => {
    for (const [name, t] of Object.entries(TILES)) {
      expect(validateMatrix(t, PALETTE), name).toEqual([]);
    }
  });
  it('ground tiles are 16x16 and fully opaque', () => {
    for (const name of ['grass0', 'grass1', 'grass2', 'path', 'pathEdgeN', 'pathEdgeE', 'pathEdgeS', 'pathEdgeW', 'water0', 'water1', 'stone'] as const) {
      const t = TILES[name];
      expect([width(t), height(t)], name).toEqual([16, 16]);
      expect(t.join('').includes('.'), name).toBe(false);
    }
  });
  it('fountain frames are 32x32 and differ', () => {
    expect([width(TILES.fountain0), height(TILES.fountain0)]).toEqual([32, 32]);
    expect(TILES.fountain0).not.toEqual(TILES.fountain1);
  });
  it('signals and bubble parts validate', () => {
    for (const [k, s] of Object.entries(SIGNALS)) {
      expect(validateMatrix(s, PALETTE), k).toEqual([]);
      expect([width(s), height(s)]).toEqual([10, 10]);
    }
    for (const [k, part] of Object.entries(BUBBLE)) {
      if (Array.isArray(part)) expect(validateMatrix(part, PALETTE), k).toEqual([]);
    }
    for (const [w, h] of [[9, 9], [40, 14], [63, 20]]) {
      const b = composeBubble(w, h);
      expect(validateMatrix(b, PALETTE)).toEqual([]);
      expect([width(b), height(b)]).toEqual([w, h + 2]);
    }
  });
});

describe('buildings', () => {
  it('match every mapSpec footprint in size and validate', () => {
    for (const loc of LOCATIONS) {
      if (!loc.footprint) continue;
      const variants = BUILDING_VARIANTS[loc.kind as BuildingKind];
      for (let v = 0; v < variants; v++) {
        const m = composeLocation(loc, v);
        expect(m, loc.id).not.toBeNull();
        expect([width(m!), height(m!)], loc.id).toEqual([loc.footprint.w * 16, loc.footprint.h * 16]);
        expect(validateMatrix(m!, PALETTE), `${loc.id} v${v}`).toEqual([]);
      }
    }
  });
  it('every kind and variant validates at its default size, front and back', () => {
    for (const kind of Object.keys(BUILDING_SIZES) as BuildingKind[]) {
      const { w, h } = BUILDING_SIZES[kind];
      for (let v = 0; v < BUILDING_VARIANTS[kind]; v++)
        for (const doorSide of ['bottom', 'top'] as const) {
          const m = composeBuilding(kind, w, h, v, { doorSide });
          expect([width(m), height(m)]).toEqual([w * 16, h * 16]);
          expect(validateMatrix(m, PALETTE), `${kind} v${v} ${doorSide}`).toEqual([]);
        }
    }
  });
  it('the park has no building', () => {
    expect(() => composeBuilding('park', 2, 2)).toThrow();
  });
});

describe('characters', () => {
  it('every layer validates against a character palette', () => {
    const pal = characterPalette({ hair: 0, skin: 0, shirt: 0, pants: 0 });
    for (const f of Object.values(CHARACTER_LAYERS.BODY)) expect(validateMatrix(f, pal)).toEqual([]);
    for (const style of Object.values(CHARACTER_LAYERS.HAIR))
      for (const f of Object.values(style)) {
        expect(validateMatrix(f, pal)).toEqual([]);
        expect([width(f), height(f)]).toEqual([16, 16]);
      }
    for (const acc of Object.values(CHARACTER_LAYERS.ACCESSORY))
      for (const f of Object.values(acc)) expect(validateMatrix(f, pal)).toEqual([]);
  });

  it('composeCharacter is 16x16 and valid for every hair, occupation, facing and frame', () => {
    for (let hair = 0; hair < LOOK_RANGES.hair; hair++) {
      const look = { hair, skin: hair % 4, shirt: hair % 8, pants: hair % 4 };
      const pal = characterPalette(look);
      for (const occupation of OCCUPATIONS)
        for (const facing of FACINGS)
          for (const frame of WALK_FRAMES) {
            const m = composeCharacter({ look, occupation, facing, frame });
            expect(width(m)).toBe(CHAR_SIZE);
            expect(height(m)).toBe(CHAR_SIZE);
            const problems = validateMatrix(m, pal);
            if (problems.length) throw new Error(`${hair}/${occupation}/${facing}/${frame}: ${problems.join('; ')}`);
          }
    }
  });

  it('walk frames differ from stand only in leg rows, and do differ there', () => {
    for (let style = 0; style < HAIR_STYLES.length; style++) {
      const look = { hair: style, skin: 0, shirt: 0, pants: 0 };
      for (const occupation of OCCUPATIONS)
        for (const facing of FACINGS) {
          const stand = composeCharacter({ look, occupation, facing, frame: 0 });
          for (const frame of [1, 2] as const) {
            const step = composeCharacter({ look, occupation, facing, frame });
            for (let y = 0; y < LEG_ROW; y++) expect(step[y], `${occupation} ${facing} row ${y}`).toBe(stand[y]);
            expect(step.slice(LEG_ROW)).not.toEqual(stand.slice(LEG_ROW));
          }
        }
    }
  });

  it('left is the mirror of right', () => {
    const look = { hair: 3, skin: 1, shirt: 2, pants: 3 };
    for (const occupation of OCCUPATIONS) {
      const r = composeCharacter({ look, occupation, facing: 'right', frame: 1 });
      const l = composeCharacter({ look, occupation, facing: 'left', frame: 1 });
      expect(l).toEqual(mirrorX(r));
    }
  });
});
