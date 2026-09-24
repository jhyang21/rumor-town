/**
 * The variant lattice. A node is keyed by (claimStrength, sorted details, corrected).
 * Retelling moves from the speaker's node to a target key; an existing node with that key is reused,
 * otherwise a new node is born (its text comes from the speech answer). Cap: 12 nodes; past the cap the
 * target snaps to the nearest existing node by key distance. There is one correction node
 * (strength 0, no details, corrected) and a correction is always retold unchanged.
 */
import type { MutationClass, VariantNode } from '../types';
import type { Rng } from '../rng';

export const MAX_VARIANTS = 12;
export const MAX_DETAILS = 2;

export const DETAILS: readonly string[] = [
  'last Tuesday',
  'near the school',
  'the mayor was there',
  'it cost a fortune',
  'late at night',
  'it happened twice',
];

export interface VariantKey {
  claimStrength: number;
  details: string[]; // sorted
  corrected: boolean;
}

export const CORRECTION_KEY: VariantKey = { claimStrength: 0, details: [], corrected: true };

export function keyString(k: VariantKey): string {
  return `${k.corrected ? 'C' : 'R'}|${k.claimStrength}|${k.details.slice().sort().join(',')}`;
}

export function keyDistance(a: VariantKey, b: VariantKey): number {
  let d = Math.abs(a.claimStrength - b.claimStrength);
  for (const x of a.details) if (!b.details.includes(x)) d++;
  for (const x of b.details) if (!a.details.includes(x)) d++;
  if (a.corrected !== b.corrected) d += 100;
  return d;
}

/** Where a retelling lands. `nodeId` is set when the target already exists (or after snapping). */
export interface RetellPlan {
  key: VariantKey;
  mutation: MutationClass;
  parentId: string;
  nodeId: string | null;
}

export class VariantLattice {
  readonly nodes: VariantNode[] = [];
  private readonly byKey = new Map<string, string>();
  private readonly byId = new Map<string, VariantNode>();
  private readonly heardBy = new Map<string, Set<number>>();

  /** when true, the last slot stays free for the correction node */
  private readonly reserveCorrection: boolean;

  constructor(rootText: string, starterId: number, reserveCorrection = false) {
    this.reserveCorrection = reserveCorrection;
    this.add({ claimStrength: 0, details: [], corrected: false }, null, 'unchanged', rootText, starterId, 0);
  }

  get(id: string): VariantNode {
    const n = this.byId.get(id);
    if (!n) throw new Error(`unknown variant ${id}`);
    return n;
  }

  keyOf(n: VariantNode): VariantKey {
    return { claimStrength: n.claimStrength, details: n.details.slice().sort(), corrected: n.corrected };
  }

  findKey(k: VariantKey): string | null {
    return this.byKey.get(keyString(k)) ?? null;
  }

  correctionNodeId(): string | null {
    return this.findKey(CORRECTION_KEY);
  }

  /**
   * Plan a retelling from `fromId`. `rng` picks a distortion detail. A 'corrected' retelling is only
   * possible when `correctionKnown`; otherwise it falls back to 'softened'.
   */
  planRetelling(fromId: string, mutation: MutationClass, rng: Rng, correctionKnown: boolean): RetellPlan {
    const from = this.get(fromId);
    const base = this.keyOf(from);
    if (from.corrected) return { key: base, mutation: 'unchanged', parentId: fromId, nodeId: fromId };
    let m: MutationClass = mutation;
    if (m === 'corrected' && !correctionKnown) m = 'softened';
    const key: VariantKey = { claimStrength: base.claimStrength, details: base.details.slice(), corrected: false };
    switch (m) {
      case 'unchanged':
      case 'shortened':
        return { key: base, mutation: m, parentId: fromId, nodeId: fromId };
      case 'softened':
        if (key.claimStrength <= -2) return { key: base, mutation: 'unchanged', parentId: fromId, nodeId: fromId };
        key.claimStrength -= 1;
        break;
      case 'strengthened':
        if (key.claimStrength >= 2) return { key: base, mutation: 'unchanged', parentId: fromId, nodeId: fromId };
        key.claimStrength += 1;
        break;
      case 'distorted': {
        if (key.details.length >= MAX_DETAILS) return { key: base, mutation: 'unchanged', parentId: fromId, nodeId: fromId };
        const pool = DETAILS.filter((d) => !key.details.includes(d));
        key.details.push(rng.pick(pool));
        key.details.sort();
        break;
      }
      case 'corrected':
        key.claimStrength = 0;
        key.details = [];
        key.corrected = true;
        break;
    }
    const existing = this.findKey(key);
    if (existing) return { key, mutation: m, parentId: fromId, nodeId: existing };
    if (this.full(key)) return { key, mutation: m, parentId: fromId, nodeId: this.nearest(key) };
    return { key, mutation: m, parentId: fromId, nodeId: null };
  }

  /** No room for a node with this key (one slot is kept for the correction when reserved). */
  full(k: VariantKey): boolean {
    const cap = this.reserveCorrection && !k.corrected && this.correctionNodeId() === null ? MAX_VARIANTS - 1 : MAX_VARIANTS;
    return this.nodes.length >= cap;
  }

  /** Nearest existing node by key distance; ties go to the older node. */
  nearest(k: VariantKey): string {
    let best = this.nodes[0];
    let bestD = Number.MAX_SAFE_INTEGER;
    for (const n of this.nodes) {
      const d = keyDistance(k, this.keyOf(n));
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best.id;
  }

  /** Resolve a plan at speech time: reuse, snap past the cap, or create with `text`. */
  resolve(plan: RetellPlan, text: string, authorId: number, tick: number): { id: string; born: boolean } {
    if (plan.nodeId) return { id: plan.nodeId, born: false };
    const existing = this.findKey(plan.key);
    if (existing) return { id: existing, born: false };
    if (this.full(plan.key)) return { id: this.nearest(plan.key), born: false };
    const n = this.add(plan.key, plan.parentId, plan.mutation, text, authorId, tick);
    return { id: n.id, born: true };
  }

  add(key: VariantKey, parentId: string | null, mutation: MutationClass, text: string, authorId: number, tick: number): VariantNode {
    const node: VariantNode = {
      id: `v${this.nodes.length}`,
      parentId,
      mutation,
      claimStrength: key.claimStrength,
      details: key.details.slice().sort(),
      corrected: key.corrected,
      text,
      firstAuthorId: authorId,
      createdTick: tick,
      heardCount: 0,
      repeatedCount: 0,
    };
    this.nodes.push(node);
    this.byId.set(node.id, node);
    this.byKey.set(keyString(key), node.id);
    this.heardBy.set(node.id, new Set());
    return node;
  }

  /** Count a distinct person hearing this node. */
  markHeard(id: string, characterId: number): void {
    const s = this.heardBy.get(id)!;
    if (!s.has(characterId)) {
      s.add(characterId);
      this.get(id).heardCount = s.size;
    }
  }

  markRepeated(id: string): void {
    this.get(id).repeatedCount++;
  }

  depth(id: string): number {
    let d = 0;
    for (let n = this.get(id); n.parentId !== null; n = this.get(n.parentId)) d++;
    return d;
  }

  /** Number of versions on the deepest root-to-leaf path (the root alone = 1). */
  longestChain(): number {
    let best = 0;
    for (const n of this.nodes) best = Math.max(best, this.depth(n.id));
    return best + 1;
  }

  /** Deepest node (most mutations from the root); ties: most heard, then oldest. */
  mostChanged(): string {
    let best = this.nodes[0];
    let bd = -1;
    for (const n of this.nodes) {
      const d = this.depth(n.id);
      if (d > bd || (d === bd && n.heardCount > best.heardCount)) {
        bd = d;
        best = n;
      }
    }
    return best.id;
  }

  /** Highest heardCount; ties: oldest. */
  mostWidespread(): string {
    let best = this.nodes[0];
    for (const n of this.nodes) if (n.heardCount > best.heardCount) best = n;
    return best.id;
  }
}
