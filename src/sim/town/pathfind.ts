/**
 * A* on the 4-neighbour grid with Manhattan heuristic. Ties in the open set break by
 * (f, h, y, x) so paths are stable across runs. Results are cached by `${from}->${to}`.
 * The returned path excludes the start tile and includes the goal.
 */
import { getGrid, walkable, type Grid } from './grid';

// packed heap keys assume fewer than 4096 tiles


export type Tile = { x: number; y: number };

const cache = new Map<string, readonly Tile[]>();

const DIRS: ReadonlyArray<[number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

export function findPath(from: Tile, to: Tile, grid: Grid = getGrid()): Tile[] | null {
  const key = `${from.x},${from.y}->${to.x},${to.y}`;
  const hit = cache.get(key);
  if (hit) return hit.slice();
  const p = astar(from, to, grid);
  if (p) cache.set(key, p);
  return p ? p.slice() : null;
}

export function clearPathCache(): void {
  cache.clear();
}

function astar(from: Tile, to: Tile, g: Grid): Tile[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  if (!walkable(g, to.x, to.y)) return null;
  const W = g.width;
  const N = W * g.height;
  const gScore = new Int32Array(N).fill(-1);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = from.y * W + from.x;
  const goal = to.y * W + to.x;
  gScore[start] = 0;
  // binary min-heap of packed keys: ((f * 128 + h) * 4096 + index); ties break by (f, h, y, x)
  const hOf = (i: number) => Math.abs((i % W) - to.x) + Math.abs(Math.floor(i / W) - to.y);
  const keyOf = (i: number) => ((gScore[i] + hOf(i)) * 128 + hOf(i)) * 4096 + i;
  const heap: number[] = [keyOf(start)];
  const push = (key: number) => {
    heap.push(key);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[k] >= heap[p]) break;
      [heap[k], heap[p]] = [heap[p], heap[k]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l] < heap[m]) m = l;
        if (r < heap.length && heap[r] < heap[m]) m = r;
        if (m === k) break;
        [heap[k], heap[m]] = [heap[m], heap[k]];
        k = m;
      }
    }
    return top % 4096;
  };
  while (heap.length > 0) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(g, nx, ny)) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const ng = gScore[cur] + 1;
      if (gScore[ni] === -1 || ng < gScore[ni]) {
        gScore[ni] = ng;
        came[ni] = cur;
        push(keyOf(ni));
      }
    }
  }
  if (gScore[goal] === -1) return null;
  const out: Tile[] = [];
  for (let i = goal; i !== start; i = came[i]) out.push({ x: i % W, y: Math.floor(i / W) });
  out.reverse();
  return out;
}
