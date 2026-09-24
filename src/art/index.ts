/**
 * Public art API. Pure matrix builders work anywhere; the *Canvas helpers need a browser.
 */
import type { LocationSpec } from '../sim/types';
import { buildingOptionsFor, composeLocation } from './buildings';
import { type CharacterSpec, composeCharacter } from './characters';
import { PALETTE, characterPalette } from './palette';
import { type SpriteCanvas, getSprite, rasterize, spriteKey } from './rasterize';
import { type SignalKind, SIGNALS, composeBubble } from './signals';
import { type TileName, TILES } from './tiles';

export * from './palette';
export * from './matrix';
export * from './tiles';
export * from './buildings';
export * from './characters';
export * from './signals';
export * from './rasterize';

export function tileCanvas(name: TileName): SpriteCanvas {
  return getSprite(spriteKey.tile(name), () => rasterize(TILES[name], PALETTE));
}

export function characterCanvas(spec: CharacterSpec): SpriteCanvas {
  return getSprite(spriteKey.character(spec.look, spec.occupation, spec.facing, spec.frame), () =>
    rasterize(composeCharacter(spec), characterPalette(spec.look)),
  );
}

/** Building canvas for a mapSpec location; null for the park. */
export function locationCanvas(loc: LocationSpec, variant = 0, frame = 0): SpriteCanvas | null {
  if (!loc.footprint || loc.kind === 'park') return null;
  const o = buildingOptionsFor(loc);
  const key = spriteKey.building(loc.kind, loc.footprint.w, loc.footprint.h, variant, o.doorTile, o.doorSide, frame);
  return getSprite(key, () => rasterize(composeLocation(loc, variant, frame) ?? [], PALETTE));
}

export function signalCanvas(kind: SignalKind): SpriteCanvas {
  return getSprite(spriteKey.signal(kind), () => rasterize(SIGNALS[kind], PALETTE));
}

export function bubbleCanvas(w: number, h: number, tailX = -1): SpriteCanvas {
  return getSprite(spriteKey.bubble(w, h, tailX), () =>
    rasterize(composeBubble(w, h, tailX < 0 ? undefined : tailX), PALETTE),
  );
}
