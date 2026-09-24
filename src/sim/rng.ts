/**
 * Seeded sfc32 PRNG. Pure integer math (uint32), identical on every JS engine.
 * createStreams(seed) gives five named streams so that consuming one never shifts another.
 */

export interface Rng {
  /** next uint32 */
  next(): number;
  /** integer in [min, maxInclusive] */
  int(min: number, maxInclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  /** true with probability pPerMille / 1000 (integer 0..1000) */
  chance(pPerMille: number): boolean;
  /** Fisher-Yates in place; returns the same array */
  shuffle<T>(arr: T[]): T[];
  /** internal state, for hashing */
  state(): [number, number, number, number];
}

export function sfc32(a: number, b: number, c: number, d: number): Rng {
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const next = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  const int = (min: number, maxInclusive: number): number => {
    const span = maxInclusive - min + 1;
    if (span <= 0) throw new Error(`rng.int: empty range ${min}..${maxInclusive}`);
    // span is small in this project; modulo bias is negligible and deterministic
    return min + (next() % span);
  };
  return {
    next,
    int,
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error('rng.pick: empty array');
      return arr[int(0, arr.length - 1)];
    },
    chance(pPerMille: number): boolean {
      return int(0, 999) < pPerMille;
    },
    shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = int(0, i);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    },
    state: () => [a, b, c, d],
  };
}

/** Seed an sfc32 from one uint32 plus a salt; warms up 12 rounds. */
export function seeded(seed: number, salt: number): Rng {
  const r = sfc32(0x9e3779b9, seed >>> 0, salt >>> 0, (seed ^ salt ^ 0x85ebca6b) >>> 0);
  for (let i = 0; i < 12; i++) r.next();
  return r;
}

export const STREAM_SALTS = {
  town: 0x1a2b3c4d,
  schedule: 0x5e6f7081,
  encounter: 0x92a3b4c5,
  smalltalk: 0xd6e7f809,
  meeting: 0x1b2c3d4e,
} as const;

export type StreamName = keyof typeof STREAM_SALTS;
export type Streams = Record<StreamName, Rng>;

export function createStreams(seed: number): Streams {
  return {
    town: seeded(seed, STREAM_SALTS.town),
    schedule: seeded(seed, STREAM_SALTS.schedule),
    encounter: seeded(seed, STREAM_SALTS.encounter),
    smalltalk: seeded(seed, STREAM_SALTS.smalltalk),
    meeting: seeded(seed, STREAM_SALTS.meeting),
  };
}

/** Oracle probability (float 0..1) to a seeded boolean, integer compare only. */
export function probToBool(rng: Rng, p: number): boolean {
  const pm = Math.round(Math.min(1, Math.max(0, p)) * 1000);
  return rng.int(0, 999) < pm;
}
