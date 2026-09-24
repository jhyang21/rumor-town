import { describe, expect, it } from 'vitest';
import type { RunStats, SeriesPoint, VariantNode } from '@/sim/types';
import { CHART_BOX, areaPath, countTicks, hourTicks, linePath, pointAt, spreadLabels, tickForX, xForTick, yForCount } from './chartScale';
import { beliefSplit, changeNote, headline, milestones, mutationWord, statItems, variantDepth } from './format';
import { layoutTree, nodeBadges } from './tree';

const stats = (over: Partial<RunStats> = {}): RunStats => ({
  population: 50,
  heard: 31,
  believed: 18,
  shared: 12,
  rejected: 4,
  rumorConversations: 40,
  variantCount: 5,
  longestChain: 3,
  mostWidespreadVariantId: 'v0',
  mostChangedVariantId: 'v4',
  firstCorrectionTick: null,
  dominantBelief: 'believes',
  endedAtTick: 640,
  endReason: 'quiet',
  gptCalls: 0,
  jevCalls: 0,
  ...over,
});

const node = (id: string, parentId: string | null, over: Partial<VariantNode> = {}): VariantNode => ({
  id,
  parentId,
  mutation: parentId === null ? 'unchanged' : 'distorted',
  claimStrength: 0,
  details: [],
  corrected: false,
  text: `text ${id}`,
  firstAuthorId: 0,
  createdTick: 0,
  heardCount: 1,
  repeatedCount: 0,
  ...over,
});

//   v0
//  /  \
// v1   v2
// |
// v3
// |
// v4
const tree: VariantNode[] = [node('v0', null), node('v1', 'v0'), node('v2', 'v0'), node('v3', 'v1'), node('v4', 'v3')];

describe('headline', () => {
  it('uses the end tick for a quiet ending', () => {
    expect(headline(stats())).toBe('By 6:40 PM, 31 of 50 people had heard it. 18 believed it.');
  });
  it('says 8:00 PM when the day ran out', () => {
    expect(headline(stats({ endReason: 'day_over', endedAtTick: 719 }))).toBe('By 8:00 PM, 31 of 50 people had heard it. 18 believed it.');
  });
  it('handles everyone and no one', () => {
    expect(headline(stats({ heard: 50, believed: 0 }))).toBe('By 6:40 PM, all 50 people had heard it. Nobody believed it.');
  });
});

describe('change count', () => {
  it('measures depth from the original', () => {
    expect(variantDepth(tree, 'v0')).toBe(0);
    expect(variantDepth(tree, 'v2')).toBe(1);
    expect(variantDepth(tree, 'v4')).toBe(3);
    expect(variantDepth(tree, 'missing')).toBe(0);
  });
  it('writes the note from the most widespread version', () => {
    expect(changeNote({ stats: stats(), variants: tree })).toBe('It reached people mostly unchanged.');
    expect(changeNote({ stats: stats({ mostWidespreadVariantId: 'v2' }), variants: tree })).toBe('It changed once along the way.');
    expect(changeNote({ stats: stats({ mostWidespreadVariantId: 'v4' }), variants: tree })).toBe('It changed 3 times along the way.');
  });
  it('survives a cycle in bad data', () => {
    const loop = [node('v0', null), node('v1', 'v2'), node('v2', 'v1')];
    expect(variantDepth(loop, 'v1')).toBeLessThanOrEqual(2);
  });
});

describe('words', () => {
  it('maps mutations to plain words', () => {
    expect(mutationWord('strengthened')).toBe('made stronger');
    expect(mutationWord('distorted')).toBe('changed a detail');
    expect(mutationWord('corrected')).toBe('set straight');
    expect(mutationWord('unchanged')).toBe('same');
    expect(mutationWord('unchanged', true)).toBe('the original');
  });
  it('builds the stats grid with plain values', () => {
    const items = statItems({ stats: stats({ firstCorrectionTick: 101 }), variants: tree });
    expect(items.find((i) => i.label === 'First set straight')?.value).toBe('9:41 AM');
    expect(items.find((i) => i.label === 'Most changed version')?.value).toBe('text v4');
    expect(statItems({ stats: stats(), variants: tree }).find((i) => i.label === 'First set straight')?.value).toBe('Never');
  });
  it('splits the town so the parts add up', () => {
    const split = beliefSplit(stats());
    expect(split.reduce((a, s) => a + s.count, 0)).toBe(50);
    expect(split.map((s) => s.count)).toEqual([18, 9, 4, 19]);
  });
  it('lists only milestones, with times', () => {
    const list = milestones([
      { tick: 6, type: 'milestone', milestone: 'first_transmission', text: 'Out.', characterIds: [] },
      { tick: 7, type: 'transmission', text: 'x', characterIds: [] },
    ]);
    expect(list).toEqual([{ tick: 6, time: '8:06 AM', text: 'Out.' }]);
  });
});

describe('chart scales', () => {
  const plotW = CHART_BOX.width - CHART_BOX.left - CHART_BOX.right;
  it('maps the day to the plot width', () => {
    expect(xForTick(0)).toBe(CHART_BOX.left);
    expect(xForTick(720)).toBe(CHART_BOX.left + plotW);
    expect(xForTick(360)).toBeCloseTo(CHART_BOX.left + plotW / 2);
    expect(xForTick(-5)).toBe(CHART_BOX.left);
    expect(tickForX(xForTick(333))).toBe(333);
  });
  it('maps people to height, zero at the bottom', () => {
    expect(yForCount(0, 50)).toBe(CHART_BOX.height - CHART_BOX.bottom);
    expect(yForCount(50, 50)).toBe(CHART_BOX.top);
    expect(yForCount(99, 50)).toBe(CHART_BOX.top);
  });
  it('labels hours 8 AM to 8 PM and people up to the town size', () => {
    expect(hourTicks().map((h) => h.label)).toEqual(['8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM']);
    expect(countTicks(30)).toEqual([0, 10, 20, 30]);
    expect(countTicks(50)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(countTicks(75)).toEqual([0, 25, 50, 75]);
  });
  it('draws paths and finds the point under the cursor', () => {
    const s: SeriesPoint[] = [
      { tick: 0, heard: 1, believing: 1, shared: 0 },
      { tick: 10, heard: 3, believing: 2, shared: 1 },
      { tick: 20, heard: 5, believing: 2, shared: 2 },
    ];
    expect(linePath(s, 'heard', 50).startsWith('M')).toBe(true);
    expect(linePath(s, 'heard', 50).split('L')).toHaveLength(3);
    expect(areaPath(s, 'heard', 50).endsWith('Z')).toBe(true);
    expect(pointAt(s, 15)?.tick).toBe(10);
    expect(pointAt(s, 500)?.tick).toBe(20);
  });
  it('keeps end labels apart and inside the plot', () => {
    const out = spreadLabels([100, 102, 104], 16, 10, 290);
    const sorted = [...out].sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(16);
    expect(sorted[2] - sorted[1]).toBeGreaterThanOrEqual(16);
    const low = spreadLabels([288, 289, 290], 16, 10, 290);
    expect(Math.max(...low)).toBeLessThanOrEqual(290);
    expect(spreadLabels([50, 200], 16, 10, 290)).toEqual([50, 200]);
  });
});

describe('tree layout', () => {
  it('puts the original on top and centres parents over children', () => {
    const l = layoutTree(tree);
    const at = (id: string) => l.nodes.find((n) => n.id === id)!;
    expect(l.nodes.map((n) => n.id)).toEqual(['v0', 'v1', 'v2', 'v3', 'v4']);
    expect(at('v0').depth).toBe(0);
    expect(at('v4').depth).toBe(3);
    expect(l.rows).toBe(4);
    expect(l.columns).toBe(2);
    expect(at('v1').col).toBe(0);
    expect(at('v2').col).toBe(1);
    expect(at('v0').col).toBe(0.5);
    expect(l.edges).toHaveLength(4);
  });
  it('handles a lone original', () => {
    const l = layoutTree([node('v0', null)]);
    expect(l).toMatchObject({ columns: 1, rows: 1, edges: [] });
  });
  it('marks the most heard and most changed nodes', () => {
    expect(nodeBadges('v3', 'v3', 'v3')).toEqual(['widespread', 'changed']);
    expect(nodeBadges('v0', 'v0', 'v0')).toEqual(['widespread']);
    expect(nodeBadges('v1', 'v3', 'v4')).toEqual([]);
  });
});
