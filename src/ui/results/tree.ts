/** Pure layout for the version family tree: leaves take columns in creation order, parents sit centred. */
import type { VariantNode } from '@/sim/types';

export interface TreeNodeLayout {
  id: string;
  depth: number;
  /** column centre in slot units (0-based, may end in .5) */
  col: number;
}

export interface TreeLayout {
  /** in the same order as the input variants */
  nodes: TreeNodeLayout[];
  edges: Array<{ from: string; to: string }>;
  columns: number;
  rows: number;
}

export function layoutTree(variants: readonly VariantNode[]): TreeLayout {
  const ids = new Set(variants.map((v) => v.id));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const v of variants) {
    if (v.parentId !== null && ids.has(v.parentId) && v.parentId !== v.id) {
      const list = children.get(v.parentId) ?? [];
      list.push(v.id);
      children.set(v.parentId, list);
    } else roots.push(v.id);
  }
  const nodes: TreeNodeLayout[] = [];
  const edges: TreeLayout['edges'] = [];
  const seen = new Set<string>();
  let nextLeaf = 0;
  let rows = 0;
  const visit = (id: string, depth: number): number => {
    seen.add(id);
    rows = Math.max(rows, depth + 1);
    const kids = (children.get(id) ?? []).filter((k) => !seen.has(k));
    let col: number;
    if (kids.length === 0) col = nextLeaf++;
    else {
      const cols = kids.map((k) => {
        edges.push({ from: id, to: k });
        return visit(k, depth + 1);
      });
      col = (cols[0] + cols[cols.length - 1]) / 2;
    }
    nodes.push({ id, depth, col });
    return col;
  };
  for (const r of roots) if (!seen.has(r)) visit(r, 0);
  const order = new Map(variants.map((v, i) => [v.id, i]));
  nodes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { nodes, edges, columns: Math.max(1, nextLeaf), rows: Math.max(1, rows) };
}

export type NodeBadge = 'widespread' | 'changed';

export function nodeBadges(id: string, mostWidespreadId: string, mostChangedId: string): NodeBadge[] {
  const out: NodeBadge[] = [];
  if (id === mostWidespreadId) out.push('widespread');
  if (id === mostChangedId && id !== 'v0') out.push('changed');
  return out;
}
