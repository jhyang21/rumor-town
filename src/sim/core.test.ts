import { describe, expect, it } from 'vitest';
import { createStreams, probToBool, sfc32 } from './rng';
import { LOCATIONS, validateMapSpec } from './town/mapSpec';
import { clearPathCache, findPath } from './town/pathfind';
import { walkable, getGrid } from './town/grid';
import { generateTown, householdSizes, pickStarter } from './people/generate';
import { DEFAULT_RUMOR } from './rumor/presets';
import type { RunConfig } from './types';
import { applyDecision, beliefDelta, clampBelief, firstHearingBelief, verifiedBelief } from './rumor/belief';
import type { DecisionAnswer } from './oracle/types';
import { CORRECTION_KEY, MAX_VARIANTS, VariantLattice, keyString } from './rumor/variants';
import { MilestoneTracker } from './events';
import { parseTrait } from './oracle/local';
import { buildSchedules } from './schedule';

const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
  population: 50,
  rumor: DEFAULT_RUMOR,
  townSeed: 7,
  runSeed: 3,
  overrides: {},
  ...over,
});

describe('rng', () => {
  it('is deterministic per seed and stream', () => {
    const a = createStreams(42);
    const b = createStreams(42);
    const xs = Array.from({ length: 50 }, () => a.encounter.next());
    const ys = Array.from({ length: 50 }, () => b.encounter.next());
    expect(xs).toEqual(ys);
    // streams are independent
    const c = createStreams(42);
    c.town.next();
    expect(c.encounter.next()).toBe(xs[0]);
  });

  it('matches a known sfc32 sequence', () => {
    const r = sfc32(1, 2, 3, 4);
    expect([r.next(), r.next(), r.next()]).toEqual([7, 34, 56623200]);
  });

  it('int, chance, pick and shuffle stay in range', () => {
    const r = createStreams(9).meeting;
    for (let i = 0; i < 2000; i++) {
      const v = r.int(6, 9);
      expect(v).toBeGreaterThanOrEqual(6);
      expect(v).toBeLessThanOrEqual(9);
    }
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1000)).toBe(true);
    expect(probToBool(r, 0)).toBe(false);
    expect(probToBool(r, 1)).toBe(true);
    const arr = [1, 2, 3, 4, 5, 6];
    expect(r.shuffle(arr.slice()).sort()).toEqual(arr);
  });
});

describe('map and paths', () => {
  it('map spec is valid', () => {
    expect(validateMapSpec()).toEqual([]);
  });

  it('every door is reachable from every other door', () => {
    clearPathCache();
    for (const a of LOCATIONS) {
      for (const b of LOCATIONS) {
        const p = findPath(a.door, b.door);
        expect(p, `${a.id} -> ${b.id}`).not.toBeNull();
        const path = p!;
        let prev = a.door;
        for (const t of path) {
          expect(Math.abs(t.x - prev.x) + Math.abs(t.y - prev.y)).toBe(1);
          expect(walkable(getGrid(), t.x, t.y)).toBe(true);
          prev = t;
        }
        if (a !== b) expect(path[path.length - 1]).toEqual(b.door);
      }
    }
  });

  it('paths are stable and cached', () => {
    const a = findPath(LOCATIONS[0].door, LOCATIONS[15].door);
    clearPathCache();
    const b = findPath(LOCATIONS[0].door, LOCATIONS[15].door);
    expect(a).toEqual(b);
  });
});

describe('town generation', () => {
  it('is deterministic', () => {
    expect(generateTown(cfg())).toEqual(generateTown(cfg()));
    expect(pickStarter(cfg(), generateTown(cfg()))).toBe(pickStarter(cfg(), generateTown(cfg())));
    const t = generateTown(cfg());
    expect(buildSchedules(7, t)).toEqual(buildSchedules(7, t));
  });

  it('households hold 2..7 people across 12 homes', () => {
    for (const pop of [30, 50, 75] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const chars = generateTown(cfg({ population: pop, townSeed: seed }));
        expect(chars).toHaveLength(pop);
        const byHome = new Map<string, number>();
        for (const c of chars) byHome.set(c.homeId, (byHome.get(c.homeId) ?? 0) + 1);
        expect(byHome.size).toBe(12);
        for (const n of byHome.values()) {
          expect(n).toBeGreaterThanOrEqual(2);
          expect(n).toBeLessThanOrEqual(7);
        }
      }
    }
    const sizes = householdSizes(createStreams(1).town, 75);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(75);
  });

  it('builds sensible relationships and traits', () => {
    const chars = generateTown(cfg());
    const names = new Set(chars.map((c) => c.name));
    expect(names.size).toBe(chars.length);
    for (const c of chars) {
      for (const k of ['sociability', 'skepticism', 'shareWillingness', 'verifyTendency'] as const) {
        expect(Number.isInteger(c.traits[k])).toBe(true);
        expect(c.traits[k]).toBeGreaterThanOrEqual(0);
        expect(c.traits[k]).toBeLessThanOrEqual(1000);
      }
      for (const r of c.relationships) {
        if (r.kind === 'family') expect(chars[r.otherId].homeId).toBe(c.homeId);
        const back = chars[r.otherId].relationships.find((x) => x.otherId === c.id);
        expect(back?.kind).toBe(r.kind);
        expect(back?.strength).toBe(r.strength);
      }
      expect(c.relationships.filter((r) => r.kind === 'friend').length).toBeGreaterThanOrEqual(1);
    }
  });

  it('bias overrides shift traits', () => {
    const base = generateTown(cfg());
    const skewed = generateTown(cfg({ overrides: { skepticismBias: 2 } }));
    const sum = (cs: typeof base) => cs.reduce((a, c) => a + c.traits.skepticism, 0);
    expect(sum(skewed)).toBeGreaterThan(sum(base));
    expect(pickStarter(cfg({ overrides: { starterId: 4 } }), base)).toBe(4);
  });
});

const answer = (probs: [number, number, number, number, number]): DecisionAnswer => ({
  mention: 1,
  beliefShift: probs.reduce((a, p, i) => a + p * i, 0),
  beliefShiftProbs: probs,
  retelling: 'unchanged',
  challenges: 0,
  willShare: 0,
  verify: 0,
});

describe('belief math', () => {
  it('stays inside 0..1000 and integer', () => {
    for (const trust of [0, 300, 1000])
      for (const skep of [0, 500, 1000])
        for (const cs of [-2, 0, 2]) {
          const b = firstHearingBelief(trust, skep, cs);
          expect(Number.isInteger(b)).toBe(true);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(1000);
        }
    expect(clampBelief(-50)).toBe(0);
    expect(clampBelief(1400)).toBe(1000);
    expect(applyDecision(990, answer([0, 0, 0, 0, 1]), 0, true, false)).toBe(1000);
    expect(applyDecision(10, answer([1, 0, 0, 0, 0]), 0, true, true)).toBe(0);
  });

  it('is monotonic in trust, skepticism, strength and the rung', () => {
    expect(firstHearingBelief(800, 500, 0)).toBeGreaterThan(firstHearingBelief(200, 500, 0));
    expect(firstHearingBelief(500, 800, 0)).toBeLessThan(firstHearingBelief(500, 200, 0));
    expect(firstHearingBelief(500, 500, 2)).toBeGreaterThan(firstHearingBelief(500, 500, -2));
    let prev = -Infinity;
    for (let i = 0; i < 5; i++) {
      const p: [number, number, number, number, number] = [0, 0, 0, 0, 0];
      p[i] = 1;
      const d = beliefDelta(answer(p), 0, true);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
    expect(beliefDelta(answer([0, 0, 0, 0, 1]), 0, true)).toBe(400);
    expect(beliefDelta(answer([0, 0, 1, 0, 0]), 3, false)).toBe(0);
  });

  it('dampens repeated exposure and repeated sources', () => {
    const up = answer([0, 0, 0, 1, 0]);
    expect(beliefDelta(up, 0, true)).toBeGreaterThan(beliefDelta(up, 2, true));
    expect(beliefDelta(up, 1, true)).toBeGreaterThan(beliefDelta(up, 1, false));
    expect(beliefDelta(up, 0, true, true)).toBe(-beliefDelta(up, 0, true));
  });

  it('applies challenges and verification', () => {
    const flat = answer([0, 0, 1, 0, 0]);
    expect(applyDecision(500, flat, 0, true, true)).toBe(460);
    expect(verifiedBelief(300, 'true')).toBe(950);
    expect(verifiedBelief(900, 'false')).toBe(80);
    expect(verifiedBelief(900, 'uncertain')).toBe(700);
    expect(verifiedBelief(100, 'uncertain')).toBe(300);
  });
});

describe('variant lattice', () => {
  const rng = () => createStreams(5).meeting;

  it('reuses nodes with the same key', () => {
    const l = new VariantLattice('The café is closing.', 0);
    const p1 = l.planRetelling('v0', 'softened', rng(), false);
    expect(p1.nodeId).toBeNull();
    const a = l.resolve(p1, 'Some say the café is closing.', 1, 5);
    expect(a.born).toBe(true);
    const p2 = l.planRetelling('v0', 'softened', rng(), false);
    expect(p2.nodeId).toBe(a.id);
    expect(l.planRetelling('v0', 'shortened', rng(), false).nodeId).toBe('v0');
    expect(l.planRetelling('v0', 'unchanged', rng(), false).nodeId).toBe('v0');
    // corrected without a known correction falls back to softened
    expect(l.planRetelling('v0', 'corrected', rng(), false).nodeId).toBe(a.id);
    expect(keyString({ claimStrength: 1, details: ['b', 'a'], corrected: false })).toBe(keyString({ claimStrength: 1, details: ['a', 'b'], corrected: false }));
  });

  it('caps at 12 nodes and snaps to the nearest', () => {
    const l = new VariantLattice('Root.', 0);
    const r = rng();
    let from = 'v0';
    const muts = ['softened', 'softened', 'distorted', 'strengthened', 'strengthened', 'strengthened', 'distorted', 'softened'] as const;
    for (let round = 0; round < 10; round++) {
      for (const m of muts) {
        const p = l.planRetelling(from, m, r, false);
        const res = l.resolve(p, `text ${l.nodes.length}`, 1, round);
        from = res.id;
      }
      from = 'v0';
    }
    expect(l.nodes.length).toBeLessThanOrEqual(MAX_VARIANTS);
    const keys = new Set(l.nodes.map((n) => keyString(l.keyOf(n))));
    expect(keys.size).toBe(l.nodes.length);
    for (const n of l.nodes) expect(n.details.length).toBeLessThanOrEqual(2);
  });

  it('keeps a slot for the correction when asked', () => {
    const l = new VariantLattice('Root.', 0, true);
    const r = rng();
    for (let i = 0; i < 40; i++) {
      const from = l.nodes[i % l.nodes.length].id;
      l.resolve(l.planRetelling(from, (['softened', 'strengthened', 'distorted'] as const)[i % 3], r, false), `t${i}`, 0, i);
    }
    expect(l.nodes.length).toBe(MAX_VARIANTS - 1);
    l.add(CORRECTION_KEY, 'v0', 'corrected', 'Not true.', 3, 50);
    expect(l.nodes.length).toBe(MAX_VARIANTS);
    expect(l.correctionNodeId()).toBe('v11');
    // a correction is always retold as itself
    expect(l.planRetelling('v11', 'distorted', r, true).nodeId).toBe('v11');
  });

  it('measures the longest chain, most changed and most widespread', () => {
    const l = new VariantLattice('Root.', 0);
    const r = rng();
    expect(l.longestChain()).toBe(1);
    const a = l.resolve(l.planRetelling('v0', 'softened', r, false), 'a', 1, 1).id;
    const b = l.resolve(l.planRetelling(a, 'softened', r, false), 'b', 2, 2).id;
    const c = l.resolve(l.planRetelling('v0', 'strengthened', r, false), 'c', 3, 3).id;
    expect(l.longestChain()).toBe(3);
    expect(l.mostChanged()).toBe(b);
    l.markHeard(c, 1);
    l.markHeard(c, 2);
    l.markHeard(c, 2);
    l.markHeard(a, 4);
    expect(l.get(c).heardCount).toBe(2);
    expect(l.mostWidespread()).toBe(c);
  });
});

describe('milestones', () => {
  const base = { tick: 0, population: 40, heard: 1, dominantVariantId: 'v0', dominantHolders: 1, quietTicks: 0 };

  it('fires heard thresholds once each, in order', () => {
    const m = new MilestoneTracker();
    expect(m.observe({ ...base, heard: 9 })).toEqual([]);
    expect(m.observe({ ...base, heard: 10 }).map((x) => x.kind)).toEqual(['heard_25']);
    expect(m.observe({ ...base, heard: 12 })).toEqual([]);
    expect(m.observe({ ...base, heard: 31 }).map((x) => x.kind)).toEqual(['heard_50', 'heard_75']);
    expect(m.observe({ ...base, heard: 40 })).toEqual([]);
  });

  it('announces a new dominant variant only after 5 holders and only once per variant', () => {
    const m = new MilestoneTracker();
    expect(m.observe({ ...base, dominantVariantId: 'v0', dominantHolders: 5 })).toEqual([]);
    expect(m.observe({ ...base, dominantVariantId: 'v2', dominantHolders: 4 })).toEqual([]);
    expect(m.observe({ ...base, dominantVariantId: 'v2', dominantHolders: 6 })).toEqual([{ kind: 'new_dominant_variant', variantId: 'v2' }]);
    expect(m.observe({ ...base, dominantVariantId: 'v0', dominantHolders: 7 })).toEqual([]);
    expect(m.observe({ ...base, dominantVariantId: 'v2', dominantHolders: 8 })).toEqual([]);
  });

  it('fires fading after 60 quiet ticks and re-arms after activity', () => {
    const m = new MilestoneTracker();
    expect(m.observe({ ...base, quietTicks: 59 })).toEqual([]);
    expect(m.observe({ ...base, quietTicks: 60 })).toEqual([{ kind: 'fading' }]);
    expect(m.observe({ ...base, quietTicks: 61 })).toEqual([]);
    m.observe({ ...base, quietTicks: 0 });
    expect(m.observe({ ...base, quietTicks: 60 })).toEqual([{ kind: 'fading' }]);
  });

  it('once() is one-shot', () => {
    const m = new MilestoneTracker();
    expect(m.once('first_mutation')).toBe(true);
    expect(m.once('first_mutation')).toBe(false);
  });
});

describe('local oracle trait parsing', () => {
  it('reads both "high (0.8)" and bare words', () => {
    expect(parseTrait('high (0.8)')).toBe(0.8);
    expect(parseTrait('very low')).toBe(0.1);
    expect(parseTrait('medium')).toBe(0.5);
    expect(parseTrait('???')).toBe(0.5);
  });
});
