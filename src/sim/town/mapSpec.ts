/**
 * The town map. 40 x 30 tiles, 16 px each. Tile (0,0) is top-left.
 *
 * Rules
 * - A tile is walkable when it is inside the map, not in any `footprint`, and not in any BORDER strip.
 * - A location's `zone` is where its occupants stand and idle. Standable zone tiles = zone minus footprints.
 * - `door` is the tile a path ends on when a character travels to the location. It must be walkable.
 * - Homes are `canGoInside` (occupants hide after 19:00). Every other location keeps people outside so
 *   all conversations are visible.
 * - Art draws footprints as buildings and BORDER as trees/fence; this file has no colors.
 */
import type { LocationSpec, Rect } from '../types';

export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 30;
export const TILE_PX = 16;

/** Blocked strips around the edge (trees). */
export const BORDER: readonly Rect[] = [
  { x: 0, y: 0, w: MAP_WIDTH, h: 1 },
  { x: 0, y: MAP_HEIGHT - 1, w: MAP_WIDTH, h: 1 },
  { x: 0, y: 0, w: 1, h: MAP_HEIGHT },
  { x: MAP_WIDTH - 1, y: 0, w: 1, h: MAP_HEIGHT },
];

export const HOME_COUNT = 12;

function home(i: number): LocationSpec {
  const top = i < 6;
  const col = i % 6;
  const x = 2 + col * 6;
  return top
    ? { id: `home${i}`, kind: 'home', label: `House ${i + 1}`, footprint: { x, y: 1, w: 4, h: 3 }, zone: { x, y: 4, w: 4, h: 2 }, door: { x: x + 1, y: 4 }, canGoInside: true }
    : { id: `home${i}`, kind: 'home', label: `House ${i + 1}`, footprint: { x, y: 26, w: 4, h: 3 }, zone: { x, y: 24, w: 4, h: 2 }, door: { x: x + 1, y: 25 }, canGoInside: true };
}

export const LOCATIONS: readonly LocationSpec[] = [
  ...Array.from({ length: HOME_COUNT }, (_, i) => home(i)),
  { id: 'cafe', kind: 'cafe', label: 'Corner Café', footprint: { x: 1, y: 8, w: 6, h: 4 }, zone: { x: 1, y: 12, w: 6, h: 2 }, door: { x: 3, y: 12 } },
  { id: 'store', kind: 'store', label: 'General Store', footprint: { x: 1, y: 16, w: 6, h: 4 }, zone: { x: 1, y: 20, w: 6, h: 2 }, door: { x: 3, y: 20 } },
  { id: 'office', kind: 'office', label: 'Town Office', footprint: { x: 33, y: 8, w: 6, h: 4 }, zone: { x: 33, y: 12, w: 6, h: 2 }, door: { x: 35, y: 12 } },
  { id: 'school', kind: 'school', label: 'School', footprint: { x: 32, y: 16, w: 7, h: 4 }, zone: { x: 32, y: 20, w: 7, h: 2 }, door: { x: 35, y: 20 } },
  { id: 'park', kind: 'park', label: 'Park', footprint: null, zone: { x: 9, y: 8, w: 9, h: 7 }, door: { x: 13, y: 11 } },
  { id: 'square', kind: 'square', label: 'Town Square', footprint: { x: 23, y: 11, w: 2, h: 2 }, zone: { x: 19, y: 8, w: 10, h: 7 }, door: { x: 23, y: 14 } },
];

export const LOCATION_BY_ID: Readonly<Record<string, LocationSpec>> = Object.fromEntries(LOCATIONS.map((l) => [l.id, l]));

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function isBlocked(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return true;
  for (const b of BORDER) if (inRect(b, x, y)) return true;
  for (const l of LOCATIONS) if (l.footprint && inRect(l.footprint, x, y)) return true;
  return false;
}

export function isWalkable(x: number, y: number): boolean {
  return !isBlocked(x, y);
}

/** Standable tiles of a location, in row-major order (deterministic). */
export function zoneTiles(loc: LocationSpec): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let y = loc.zone.y; y < loc.zone.y + loc.zone.h; y++)
    for (let x = loc.zone.x; x < loc.zone.x + loc.zone.w; x++) if (isWalkable(x, y)) out.push({ x, y });
  return out;
}

/** Sanity checks; the test suite calls this and the generator may assert it once. */
export function validateMapSpec(): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const l of LOCATIONS) {
    if (ids.has(l.id)) problems.push(`duplicate id ${l.id}`);
    ids.add(l.id);
    if (!isWalkable(l.door.x, l.door.y)) problems.push(`${l.id}: door is not walkable`);
    if (!inRect(l.zone, l.door.x, l.door.y)) problems.push(`${l.id}: door is outside its zone`);
    if (zoneTiles(l).length < 4) problems.push(`${l.id}: fewer than 4 standable zone tiles`);
    for (const o of LOCATIONS) {
      if (o === l || !l.footprint || !o.footprint) continue;
      const overlap = l.footprint.x < o.footprint.x + o.footprint.w && o.footprint.x < l.footprint.x + l.footprint.w && l.footprint.y < o.footprint.y + o.footprint.h && o.footprint.y < l.footprint.y + l.footprint.h;
      if (overlap && l.id < o.id) problems.push(`${l.id} and ${o.id}: footprints overlap`);
    }
  }
  return problems;
}
