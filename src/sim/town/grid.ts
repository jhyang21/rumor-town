/** Walkability grid built once from mapSpec. */
import { MAP_HEIGHT, MAP_WIDTH, isWalkable } from './mapSpec';

export interface Grid {
  width: number;
  height: number;
  /** row-major, 1 = walkable */
  walk: Uint8Array;
}

let cached: Grid | null = null;

export function getGrid(): Grid {
  if (cached) return cached;
  const walk = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  for (let y = 0; y < MAP_HEIGHT; y++) for (let x = 0; x < MAP_WIDTH; x++) walk[y * MAP_WIDTH + x] = isWalkable(x, y) ? 1 : 0;
  cached = { width: MAP_WIDTH, height: MAP_HEIGHT, walk };
  return cached;
}

export function walkable(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.width && y < g.height && g.walk[y * g.width + x] === 1;
}
