/** Plain-English words for places, jobs and relationships, used in events and prompts. */
import type { Occupation, Relationship } from './types';
import { LOCATION_BY_ID } from './town/mapSpec';

export function placePhrase(locationId: string): string {
  const loc = LOCATION_BY_ID[locationId];
  if (!loc) return 'in town';
  switch (loc.kind) {
    case 'cafe':
      return 'at the café';
    case 'store':
      return 'at the store';
    case 'office':
      return 'at the town office';
    case 'school':
      return 'at the school';
    case 'park':
      return 'in the park';
    case 'square':
      return 'in the square';
    case 'home':
      return `outside ${loc.label}`;
  }
}

export function placeLabel(locationId: string): string {
  return LOCATION_BY_ID[locationId]?.label ?? 'Town';
}

export const OCCUPATION_WORD: Record<Occupation, string> = {
  student: 'student',
  teacher: 'teacher',
  cafe_worker: 'café worker',
  shopkeeper: 'shopkeeper',
  office_worker: 'office worker',
  retiree: 'retiree',
  delivery_worker: 'delivery worker',
};

export function relationshipWord(r: Relationship): string {
  const close = r.strength >= 750 ? 'close' : r.strength >= 450 ? 'friendly' : 'casual';
  switch (r.kind) {
    case 'family':
      return `family, live together, ${close}`;
    case 'friend':
      return r.strength >= 750 ? 'close friends' : 'friends';
    case 'coworker':
      return `coworkers, ${close}`;
    case 'classmate':
      return `classmates, ${close}`;
    case 'neighbor':
      return `neighbors, ${close}`;
    case 'acquaintance':
      return 'know each other by sight';
  }
}

export function shortRelationship(r: Relationship): string {
  switch (r.kind) {
    case 'family':
      return 'family';
    case 'friend':
      return r.strength >= 750 ? 'close friend' : 'friend';
    case 'coworker':
      return 'coworker';
    case 'classmate':
      return 'classmate';
    case 'neighbor':
      return 'neighbor';
    case 'acquaintance':
      return 'someone they know by sight';
  }
}

/** Cut text to at most `max` chars on a word boundary, adding an ellipsis when cut. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, '')}…`;
}
