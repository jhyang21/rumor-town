/**
 * One day's plan per character, from the `schedule` stream of townSeed.
 * Tick 0 = 8:00 AM. Everyone stays outdoors (visible) except at home after 19:00, when they may go inside.
 */
import type { Character, ScheduleEntry } from './types';
import { createStreams, type Rng } from './rng';

export interface DayPlan {
  entries: ScheduleEntry[]; // sorted by startTick; first entry at tick 0 is home
  /** tick at which they go inside their home, or -1 if they stay out */
  insideTick: number;
}

const T = (h: number, m = 0) => (h - 8) * 60 + m;

const LEISURE = ['park', 'square'] as const;
const LUNCH = ['cafe', 'square', 'park'] as const;

function afternoon(rng: Rng, plan: ScheduleEntry[], from: number, homeAt: number): void {
  // an errand (store) or leisure (park/square), sometimes both
  let t = from;
  if (rng.chance(400)) {
    plan.push({ startTick: t, locationId: 'store' });
    t += rng.int(20, 45);
  }
  if (t < homeAt - 20) plan.push({ startTick: t, locationId: rng.pick(LEISURE) });
}

export function buildSchedules(townSeed: number, chars: readonly Character[]): DayPlan[] {
  const rng = createStreams(townSeed).schedule;
  const plans: DayPlan[] = [];
  for (const c of chars) {
    const e: ScheduleEntry[] = [{ startTick: 0, locationId: c.homeId }];
    const homeAt = rng.int(T(18), T(19, 30));
    switch (c.occupation) {
      case 'student': {
        e.push({ startTick: rng.int(0, 25), locationId: 'school' });
        const out = T(15) + rng.int(0, 10);
        e.push({ startTick: out, locationId: rng.pick(LEISURE) });
        if (rng.chance(450)) e.push({ startTick: out + rng.int(60, 120), locationId: rng.pick(LEISURE) });
        break;
      }
      case 'teacher': {
        e.push({ startTick: rng.int(0, 25), locationId: 'school' });
        if (rng.chance(500)) {
          const l = T(12) + rng.int(0, 30);
          e.push({ startTick: l, locationId: rng.pick(LUNCH) });
          e.push({ startTick: l + rng.int(40, 60), locationId: 'school' });
        }
        afternoon(rng, e, T(15, 30) + rng.int(0, 30), homeAt);
        break;
      }
      case 'cafe_worker':
      case 'shopkeeper':
      case 'office_worker': {
        const work = c.workplaceId!;
        e.push({ startTick: rng.int(0, 60), locationId: work });
        const l = T(12) + rng.int(0, 45);
        if (c.occupation === 'office_worker' || rng.chance(500)) {
          const spot = c.occupation === 'cafe_worker' ? rng.pick(['square', 'park'] as const) : rng.pick(LUNCH);
          e.push({ startTick: l, locationId: spot });
          e.push({ startTick: l + rng.int(40, 60), locationId: work });
        }
        afternoon(rng, e, T(16, 30) + rng.int(0, 45), homeAt);
        break;
      }
      case 'retiree': {
        e.push({ startTick: rng.int(T(9), T(10, 30)), locationId: 'cafe' });
        const noon = T(12) + rng.int(0, 60);
        e.push({ startTick: noon, locationId: rng.pick(LUNCH) });
        if (rng.chance(500)) e.push({ startTick: noon + rng.int(45, 90), locationId: 'store' });
        e.push({ startTick: T(14, 30) + rng.int(0, 30), locationId: 'square' });
        if (rng.chance(400)) e.push({ startTick: T(16, 30) + rng.int(0, 30), locationId: 'park' });
        break;
      }
      case 'delivery_worker': {
        const stops = ['store', 'cafe', 'office', 'square', 'school'];
        let t = rng.int(0, 45);
        let last = '';
        while (t < T(17)) {
          let stop = rng.chance(100) ? `home${rng.int(0, 11)}` : rng.pick(stops);
          if (stop === last) stop = 'square';
          e.push({ startTick: t, locationId: stop });
          last = stop;
          t += rng.int(30, 55);
        }
        afternoon(rng, e, t, homeAt);
        break;
      }
    }
    e.push({ startTick: homeAt, locationId: c.homeId });
    e.sort((a, b) => a.startTick - b.startTick);
    // drop entries that would begin after going home or share a start tick
    const clean: ScheduleEntry[] = [];
    for (const x of e) {
      if (x.startTick > homeAt) continue;
      if (clean.length && clean[clean.length - 1].startTick === x.startTick) clean[clean.length - 1] = x;
      else clean.push(x);
    }
    const inside = rng.chance(700) ? Math.max(homeAt + 20, T(19)) + rng.int(0, 20) : -1;
    plans.push({ entries: clean, insideTick: inside });
  }
  return plans;
}

/** Location the plan wants at `tick`. */
export function targetAt(plan: DayPlan, tick: number): string {
  let loc = plan.entries[0].locationId;
  for (const e of plan.entries) {
    if (e.startTick <= tick) loc = e.locationId;
    else break;
  }
  return loc;
}
