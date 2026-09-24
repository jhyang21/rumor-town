import { describe, expect, it } from 'vitest';
import type { CharacterState } from '@/sim/types';
import type { Bubble } from '@/sim/engine';
import { TILE_PX } from '@/sim/town/mapSpec';
import { BUBBLE_MIN_MS, BubbleTimer, PositionTracker, pickCharacter, wrapText } from './viewModel';

const st = (id: number, x: number, y: number, activity: CharacterState['activity'] = 'walking') =>
  ({ id, x, y, facing: 'down', activity }) as unknown as CharacterState;
const bubble = (speakerId: number, text: string, fromTick: number): Bubble =>
  ({ speakerId, text, fromTick, untilTick: fromTick + 3 }) as Bubble;

describe('PositionTracker', () => {
  it('interpolates between the last tile and the current one', () => {
    const t = new PositionTracker();
    t.update([st(0, 2, 3)], 0, 0);
    t.update([st(0, 3, 3)], 1, 0);
    expect(t.views[0].px).toBe(2 * TILE_PX);
    t.update([st(0, 3, 3)], 1, 0.5);
    expect(t.views[0].px).toBe(2.5 * TILE_PX);
    expect(t.views[0].moving).toBe(true);
    t.update([st(0, 3, 3)], 1, 1);
    expect(t.views[0].px).toBe(3 * TILE_PX);
  });

  it('snaps long jumps and hides people who are inside', () => {
    const t = new PositionTracker();
    t.update([st(0, 2, 3)], 0, 0);
    t.update([st(0, 20, 3, 'inside')], 1, 0.2);
    expect(t.views[0].px).toBe(20 * TILE_PX);
    expect(t.views[0].visible).toBe(false);
  });

  it('steps through walk frames while moving and stands still otherwise', () => {
    const t = new PositionTracker();
    t.update([st(0, 0, 0)], 0, 0);
    const frames = new Set<number>();
    for (let tick = 1; tick <= 4; tick++) {
      t.update([st(0, tick, 0)], tick, 0.25);
      frames.add(t.views[0].frame);
      t.update([st(0, tick, 0)], tick, 0.75);
      frames.add(t.views[0].frame);
    }
    expect(frames.size).toBeGreaterThan(1);
    t.update([st(0, 4, 0)], 5, 0.5);
    expect(t.views[0].frame).toBe(0);
  });

  it('resets when the tick goes back (a new run)', () => {
    const t = new PositionTracker();
    t.update([st(0, 5, 5)], 100, 0);
    t.update([st(0, 1, 1)], 0, 0.5);
    expect(t.views[0].px).toBe(1 * TILE_PX);
  });
});

describe('pickCharacter', () => {
  it('finds the nearest visible sprite within the radius', () => {
    const t = new PositionTracker();
    const views = t.update([st(0, 1, 1), st(1, 3, 1), st(2, 1, 1, 'inside')], 0, 0);
    expect(pickCharacter(views, 1 * TILE_PX + 8, 1 * TILE_PX + 8, 12)).toBe(0);
    expect(pickCharacter(views, 3 * TILE_PX + 6, 1 * TILE_PX + 10, 12)).toBe(1);
    expect(pickCharacter(views, 10 * TILE_PX, 10 * TILE_PX, 12)).toBeNull();
  });
});

describe('BubbleTimer', () => {
  it('keeps each line up at least 1.1 s even when the engine drops it sooner', () => {
    const b = new BubbleTimer();
    const a = bubble(0, 'Did you hear?', 10);
    expect(b.update([a], 10, 0, false).map((x) => x.text)).toEqual(['Did you hear?']);
    expect(b.update([], 11, 200, false)).toHaveLength(1);
    expect(b.update([], 12, BUBBLE_MIN_MS - 1, false)).toHaveLength(1);
    expect(b.update([], 12, BUBBLE_MIN_MS, false)).toHaveLength(0);
  });

  it('queues the next line from the same speaker until the first has had its time', () => {
    const b = new BubbleTimer();
    b.update([bubble(0, 'one', 10)], 10, 0, false);
    expect(b.update([bubble(0, 'two', 11)], 11, 300, false)[0].text).toBe('one');
    expect(b.update([bubble(0, 'two', 11)], 11, 1100, false)[0].text).toBe('two');
  });

  it('shows two speakers at once', () => {
    const b = new BubbleTimer();
    expect(b.update([bubble(0, 'hi', 10), bubble(1, 'hey', 10)], 10, 0, false)).toHaveLength(2);
  });

  it('at 5x keeps only the newest waiting line, still for at least 1.1 s', () => {
    const b = new BubbleTimer();
    b.update([bubble(0, 'one', 10)], 10, 0, true);
    b.update([bubble(0, 'two', 11)], 11, 100, true);
    b.update([bubble(0, 'three', 12)], 12, 200, true);
    expect(b.update([], 13, 1100, true).map((x) => x.text)).toEqual(['three']);
    expect(b.update([], 14, 2199, true)).toHaveLength(1);
    expect(b.update([], 14, 2200, true)).toHaveLength(0);
  });

  it('skips the thinking marker', () => {
    const b = new BubbleTimer();
    expect(b.update([bubble(0, '…', 10)], 10, 0, false)).toHaveLength(0);
  });
});

describe('wrapText', () => {
  it('wraps to at most 3 lines of 24 chars and marks a cut', () => {
    const lines = wrapText('I heard from Rosa that the café on the square is closing for good at the end of the month, no joke');
    expect(lines.length).toBe(3);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(24);
    expect(lines[2].endsWith('…')).toBe(true);
  });

  it('leaves short text alone', () => {
    expect(wrapText('Really?')).toEqual(['Really?']);
  });
});
