/**
 * The twelve archetypes. Trait ranges are integers 0..1000; the generator draws each trait
 * uniformly from its range with the `town` stream. `weight` is the relative frequency in a town.
 * `maxShares` caps how many people a character will pass the rumor to in one day.
 * Persona lines are what prompts see; they must read as plain, kind descriptions of a person.
 */
import type { ArchetypeId, Occupation, Traits } from '../types';

export type TraitRange = [min: number, max: number];

export interface ArchetypeSpec {
  id: ArchetypeId;
  label: string; // shown in the inspector
  weight: number;
  traits: { [K in keyof Traits]: TraitRange };
  maxShares: number;
  /** persona sentences; the generator picks one with the town stream */
  personas: string[];
  /** occupations this archetype leans toward (empty = any) */
  prefers: Occupation[];
}

export const ARCHETYPES: readonly ArchetypeSpec[] = [
  {
    id: 'social_butterfly',
    label: 'Social butterfly',
    weight: 12,
    traits: { sociability: [800, 1000], skepticism: [200, 500], shareWillingness: [700, 950], verifyTendency: [100, 400] },
    maxShares: 6,
    personas: ['knows everyone and stops to chat with all of them', 'never walks past a friend without a word'],
    prefers: ['cafe_worker', 'student', 'shopkeeper'],
  },
  {
    id: 'skeptic',
    label: 'Skeptic',
    weight: 10,
    traits: { sociability: [300, 600], skepticism: [800, 1000], shareWillingness: [200, 450], verifyTendency: [500, 800] },
    maxShares: 3,
    personas: ['doubts most things until shown proof', 'asks "who told you that?" before anything else'],
    prefers: ['office_worker', 'teacher', 'retiree'],
  },
  {
    id: 'gossip',
    label: 'Gossip',
    weight: 10,
    traits: { sociability: [650, 900], skepticism: [100, 350], shareWillingness: [850, 1000], verifyTendency: [0, 250] },
    maxShares: 6,
    personas: ['loves a good story and tells it with extra flavor', 'cannot keep news to themselves for more than an hour'],
    prefers: ['cafe_worker', 'retiree', 'student'],
  },
  {
    id: 'quiet_observer',
    label: 'Quiet observer',
    weight: 10,
    traits: { sociability: [100, 350], skepticism: [450, 700], shareWillingness: [100, 350], verifyTendency: [300, 600] },
    maxShares: 3,
    personas: ['listens far more than they talk', 'keeps thoughts to themselves and watches how things unfold'],
    prefers: ['office_worker', 'delivery_worker', 'student'],
  },
  {
    id: 'fact_checker',
    label: 'Fact checker',
    weight: 7,
    traits: { sociability: [350, 650], skepticism: [700, 950], shareWillingness: [350, 600], verifyTendency: [800, 1000] },
    maxShares: 4,
    personas: ['looks things up before repeating them', 'would rather be right than first'],
    prefers: ['teacher', 'office_worker', 'shopkeeper'],
  },
  {
    id: 'trusting_friend',
    label: 'Trusting friend',
    weight: 10,
    traits: { sociability: [500, 800], skepticism: [100, 350], shareWillingness: [500, 800], verifyTendency: [100, 350] },
    maxShares: 5,
    personas: ['believes friends at their word', 'takes people as they come and rarely doubts them'],
    prefers: ['student', 'retiree', 'cafe_worker'],
  },
  {
    id: 'contrarian',
    label: 'Contrarian',
    weight: 6,
    traits: { sociability: [400, 700], skepticism: [650, 900], shareWillingness: [500, 800], verifyTendency: [200, 500] },
    maxShares: 4,
    personas: ['pushes back on whatever the room believes', 'enjoys being the one who disagrees'],
    prefers: ['delivery_worker', 'office_worker', 'student'],
  },
  {
    id: 'cautious_sharer',
    label: 'Cautious sharer',
    weight: 9,
    traits: { sociability: [400, 700], skepticism: [500, 750], shareWillingness: [250, 500], verifyTendency: [400, 700] },
    maxShares: 3,
    personas: ['only passes on what they are fairly sure about', 'adds "but I am not certain" to most stories'],
    prefers: ['teacher', 'shopkeeper', 'office_worker'],
  },
  {
    id: 'connector',
    label: 'Connector',
    weight: 7,
    traits: { sociability: [750, 950], skepticism: [350, 600], shareWillingness: [600, 850], verifyTendency: [300, 550] },
    maxShares: 6,
    personas: ['moves between groups and links people up', 'knows the café crowd and the office crowd both'],
    prefers: ['delivery_worker', 'shopkeeper', 'cafe_worker'],
  },
  {
    id: 'newcomer',
    label: 'Newcomer',
    weight: 5,
    traits: { sociability: [300, 600], skepticism: [300, 600], shareWillingness: [300, 600], verifyTendency: [200, 500] },
    maxShares: 3,
    personas: ['moved to town last month and is still learning names', 'new here and not sure whom to trust yet'],
    prefers: ['office_worker', 'student', 'delivery_worker'],
  },
  {
    id: 'authority',
    label: 'Authority',
    weight: 4,
    traits: { sociability: [450, 700], skepticism: [600, 850], shareWillingness: [400, 650], verifyTendency: [700, 950] },
    maxShares: 4,
    personas: ['people come to them for the real story', 'has been in town so long that their word carries weight'],
    prefers: ['teacher', 'shopkeeper', 'retiree'],
  },
  {
    id: 'average',
    label: 'Regular townsperson',
    weight: 10,
    traits: { sociability: [400, 650], skepticism: [400, 650], shareWillingness: [400, 650], verifyTendency: [300, 550] },
    maxShares: 4,
    personas: ['easygoing and neither chatty nor shy', 'gets on with the day and hears things now and then'],
    prefers: [],
  },
] as const;

export const ARCHETYPE_BY_ID: Readonly<Record<ArchetypeId, ArchetypeSpec>> = Object.fromEntries(
  ARCHETYPES.map((a) => [a.id, a]),
) as Record<ArchetypeId, ArchetypeSpec>;

/** Map a 0..1000 trait to the word a prompt uses. Never show the number in the UI. */
export function traitWord(value: number): 'very low' | 'low' | 'medium' | 'high' | 'very high' {
  if (value < 200) return 'very low';
  if (value < 400) return 'low';
  if (value < 600) return 'medium';
  if (value < 800) return 'high';
  return 'very high';
}

/** Prompt presentation: word plus one-decimal number, e.g. "high (0.8)". Calibration may drop the number. */
export function traitLabel(value: number, withNumber = true): string {
  const word = traitWord(value);
  if (!withNumber) return word;
  return `${word} (${(Math.round(value / 100) / 10).toFixed(1)})`;
}
