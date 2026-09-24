/**
 * Build the cast from `townSeed` with the `town` stream. Everything here is integer math and
 * id-ordered iteration, so the same config always gives the same town.
 */
import type { ArchetypeId, Character, Occupation, Relationship, RelationshipKind, RunConfig, Traits } from '../types';
import { ARCHETYPES, ARCHETYPE_BY_ID } from './archetypes';
import { NAMES } from './names';
import { HOME_COUNT } from '../town/mapSpec';
import { createStreams, type Rng } from '../rng';
import { TUNING } from '../tuning';

const ALL_OCCUPATIONS: readonly Occupation[] = [
  'student', 'teacher', 'cafe_worker', 'shopkeeper', 'office_worker', 'retiree', 'delivery_worker',
];

export function workplaceFor(o: Occupation): string | null {
  switch (o) {
    case 'student':
    case 'teacher':
      return 'school';
    case 'cafe_worker':
      return 'cafe';
    case 'shopkeeper':
      return 'store';
    case 'office_worker':
      return 'office';
    default:
      return null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return rng.int(0, weights.length - 1);
  let r = rng.int(0, total - 1);
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) return i;
    r -= weights[i];
  }
  return weights.length - 1;
}

/** Household sizes 2..7 summing to `population` over HOME_COUNT homes. */
export function householdSizes(rng: Rng, population: number): number[] {
  const sizes = new Array<number>(HOME_COUNT).fill(2);
  let left = population - 2 * HOME_COUNT;
  if (left < 0) throw new Error('population too small for 12 homes');
  if (left > 5 * HOME_COUNT) throw new Error('population too large for 12 homes');
  while (left > 0) {
    const open: number[] = [];
    for (let i = 0; i < HOME_COUNT; i++) if (sizes[i] < 7) open.push(i);
    sizes[rng.pick(open)]++;
    left--;
  }
  return sizes;
}

const RANK: Record<RelationshipKind, number> = { family: 5, friend: 4, coworker: 3, classmate: 2, neighbor: 1, acquaintance: 0 };
const STRENGTH: Record<Exclude<RelationshipKind, 'acquaintance'>, [number, number]> = {
  family: [800, 1000],
  friend: [550, 850],
  coworker: [400, 650],
  classmate: [350, 600],
  neighbor: [300, 500],
};
const TRUST: Record<Exclude<RelationshipKind, 'acquaintance'>, [number, number]> = {
  family: [700, 950],
  friend: [550, 850],
  coworker: [450, 700],
  classmate: [400, 650],
  neighbor: [400, 650],
};

export function generateTown(config: RunConfig): Character[] {
  const rng = createStreams(config.townSeed).town;
  const n = config.population;
  const skewS = clamp(config.overrides.skepticismBias ?? 0, -2, 2) * 200;
  const skewSoc = clamp(config.overrides.sociabilityBias ?? 0, -2, 2) * 200;

  const names = rng.shuffle(NAMES.slice()).slice(0, n);
  const sizes = householdSizes(rng, n);
  const homeOf: string[] = [];
  for (let h = 0; h < HOME_COUNT; h++) for (let k = 0; k < sizes[h]; k++) homeOf.push(`home${h}`);
  rng.shuffle(homeOf);

  const weights = ARCHETYPES.map((a) => a.weight);
  const chars: Character[] = [];
  for (let id = 0; id < n; id++) {
    const arch = ARCHETYPES[weightedIndex(rng, weights)];
    const t = arch.traits;
    const traits: Traits = {
      sociability: clamp(rng.int(t.sociability[0], t.sociability[1]) + skewSoc, 0, 1000),
      skepticism: clamp(rng.int(t.skepticism[0], t.skepticism[1]) + skewS, 0, 1000),
      shareWillingness: rng.int(t.shareWillingness[0], t.shareWillingness[1]),
      verifyTendency: rng.int(t.verifyTendency[0], t.verifyTendency[1]),
    };
    const occupation = arch.prefers.length > 0 ? rng.pick(arch.prefers) : rng.pick(ALL_OCCUPATIONS);
    chars.push({
      id,
      name: names[id],
      occupation,
      archetype: arch.id as ArchetypeId,
      persona: rng.pick(arch.personas),
      homeId: homeOf[id],
      workplaceId: workplaceFor(occupation),
      traits,
      relationships: [],
      look: { hair: rng.int(0, 35), skin: rng.int(0, 3), shirt: rng.int(0, 7), pants: rng.int(0, 3) },
    });
  }

  // kind matrix, highest rank wins
  const kind: (RelationshipKind | null)[][] = Array.from({ length: n }, () => new Array<RelationshipKind | null>(n).fill(null));
  const setKind = (a: number, b: number, k: RelationshipKind) => {
    if (a === b) return;
    const cur = kind[a][b];
    if (cur === null || RANK[k] > RANK[cur]) {
      kind[a][b] = k;
      kind[b][a] = k;
    }
  };
  const homeIndex = (c: Character) => Number(c.homeId.slice(4));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const A = chars[a];
      const B = chars[b];
      if (A.homeId === B.homeId) setKind(a, b, 'family');
      if (A.workplaceId && A.workplaceId === B.workplaceId) {
        if (A.occupation === 'student' && B.occupation === 'student') setKind(a, b, 'classmate');
        else if (A.occupation !== 'student' && B.occupation !== 'student') setKind(a, b, 'coworker');
      }
      const ha = homeIndex(A);
      const hb = homeIndex(B);
      if (Math.abs(ha - hb) === 1 && Math.floor(ha / 6) === Math.floor(hb / 6)) setKind(a, b, 'neighbor');
    }
  }
  // friends: 2..5 each, drawn from the whole town weighted by sociability
  const socW = chars.map((c) => 50 + c.traits.sociability);
  for (let a = 0; a < n; a++) {
    const want = rng.int(TUNING.minFriends, TUNING.maxFriends);
    let have = 0;
    for (let b = 0; b < n; b++) if (kind[a][b] === 'friend') have++;
    for (let tries = 0; have < want && tries < 40; tries++) {
      const b = weightedIndex(rng, socW);
      if (b === a || kind[a][b] === 'friend' || kind[a][b] === 'family') continue;
      setKind(a, b, 'friend');
      have++;
    }
  }
  // strengths symmetric, trust per direction; iterate pairs in id order
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const k = kind[a][b];
      if (k === null || k === 'acquaintance') continue;
      const [s0, s1] = STRENGTH[k];
      const [t0, t1] = TRUST[k];
      const strength = rng.int(s0, s1);
      const ab: Relationship = { otherId: b, kind: k, strength, trust: rng.int(t0, t1) };
      const ba: Relationship = { otherId: a, kind: k, strength, trust: rng.int(t0, t1) };
      chars[a].relationships.push(ab);
      chars[b].relationships.push(ba);
    }
  }
  for (const c of chars) c.relationships.sort((x, y) => x.otherId - y.otherId);
  return chars;
}

export function acquaintance(otherId: number): Relationship {
  return { otherId, kind: 'acquaintance', strength: TUNING.acquaintanceStrength, trust: TUNING.acquaintanceTrust };
}

/** Starter: override or a pick weighted by shareWillingness (town stream, after generation). */
export function pickStarter(config: RunConfig, chars: readonly Character[]): number {
  const o = config.overrides.starterId;
  if (o !== undefined && o >= 0 && o < chars.length) return o;
  const rng = createStreams(config.townSeed ^ 0x5ad5ad).town;
  return weightedIndex(rng, chars.map((c) => c.traits.shareWillingness));
}

export { ARCHETYPE_BY_ID };
