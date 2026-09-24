/**
 * Movement: one tile per tick along a cached A* path; idle people stand on a seeded tile of their
 * location's zone and sometimes shuffle one tile. Uses the runSeed `schedule` stream.
 */
import type { CharacterState, Facing, LocationSpec } from './types';
import { LOCATION_BY_ID, inRect, zoneTiles } from './town/mapSpec';
import { findPath, type Tile } from './town/pathfind';
import type { Rng } from './rng';
import { TUNING } from './tuning';
import { getGrid, walkable } from './town/grid';

const zoneCache = new Map<string, Tile[]>();

export function standable(loc: LocationSpec): Tile[] {
  let z = zoneCache.get(loc.id);
  if (!z) {
    z = zoneTiles(loc);
    zoneCache.set(loc.id, z);
  }
  return z;
}

export function facingFrom(dx: number, dy: number, fallback: Facing): Facing {
  if (dx > 0) return 'right';
  if (dx < 0) return 'left';
  if (dy > 0) return 'down';
  if (dy < 0) return 'up';
  return fallback;
}

/**
 * Pick where to stand at `loc`. With `joinSomeonePerMille` chance, stand next to someone already
 * idle there (so conversations can happen); otherwise any standable zone tile.
 */
export function chooseSpot(loc: LocationSpec, rng: Rng, occupants: readonly Tile[]): Tile {
  const tiles = standable(loc);
  if (occupants.length > 0 && rng.chance(TUNING.joinSomeonePerMille)) {
    const o = rng.pick(occupants);
    const near: Tile[] = [];
    for (const t of tiles) {
      const d = Math.max(Math.abs(t.x - o.x), Math.abs(t.y - o.y));
      if (d === 1) near.push(t);
    }
    if (near.length > 0) return rng.pick(near);
  }
  return rng.pick(tiles);
}

/** Start walking `s` to `loc`. Returns false when no path exists (the person stays put). */
export function headTo(s: CharacterState, loc: LocationSpec, spot: Tile): boolean {
  const path = findPath({ x: s.x, y: s.y }, spot);
  s.locationId = loc.id;
  if (path === null) return false;
  s.path = path;
  s.activity = path.length > 0 ? 'walking' : 'idle';
  return true;
}

/** Advance one tile. Returns true when the walker arrived this tick. */
export function stepAlongPath(s: CharacterState): boolean {
  const next = s.path.shift();
  if (!next) {
    s.activity = 'idle';
    return true;
  }
  s.facing = facingFrom(next.x - s.x, next.y - s.y, s.facing);
  s.x = next.x;
  s.y = next.y;
  if (s.path.length === 0) {
    s.activity = 'idle';
    return true;
  }
  return false;
}

const DIRS: ReadonlyArray<[number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

/** Shuffle one tile inside the zone, or just turn around. */
export function wander(s: CharacterState, rng: Rng): void {
  const loc = LOCATION_BY_ID[s.locationId];
  if (!loc) return;
  const g = getGrid();
  const options: Tile[] = [];
  for (const [dx, dy] of DIRS) {
    const x = s.x + dx;
    const y = s.y + dy;
    if (walkable(g, x, y) && inRect(loc.zone, x, y)) options.push({ x, y });
  }
  const i = rng.int(0, options.length); // == length: turn in place
  if (i === options.length) {
    s.facing = (['down', 'up', 'left', 'right'] as const)[rng.int(0, 3)];
    return;
  }
  const t = options[i];
  s.facing = facingFrom(t.x - s.x, t.y - s.y, s.facing);
  s.x = t.x;
  s.y = t.y;
}

export function faceEachOther(a: CharacterState, b: CharacterState): void {
  a.facing = facingFrom(b.x - a.x, b.y - a.y, a.facing);
  b.facing = facingFrom(a.x - b.x, a.y - b.y, b.facing);
}
