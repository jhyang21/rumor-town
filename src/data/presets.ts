/**
 * Preset rumors. Presets skip moderation and ship an authoritative `verifiedText`
 * so verification never needs a GPT call. Custom rumors are always `uncertain`.
 */
import type { RumorSpec } from '@/sim/types';

export interface RumorPreset extends RumorSpec {
  presetId: string;
  label: string;
}

export const PRESETS: readonly RumorPreset[] = [
  {
    presetId: 'cafe-closing',
    label: 'The café is closing',
    text: 'The Corner Café is closing at the end of the month.',
    truth: 'false',
    verifiedText: 'The café is not closing. The owner is only repainting the front room next week.',
  },
  {
    presetId: 'school-snow-day',
    label: 'No school on Friday',
    text: 'The school is giving everyone Friday off.',
    truth: 'true',
    verifiedText: 'The school confirmed it: Friday is a staff training day and classes are off.',
  },
  {
    presetId: 'mayor-moving',
    label: 'The mayor is moving away',
    text: 'The mayor has already sold their house and is moving to the city.',
    truth: 'uncertain',
    verifiedText: 'Nobody at the town office will say whether the mayor is moving. The house is not listed for sale.',
  },
  {
    presetId: 'store-lottery',
    label: 'Someone won the lottery',
    text: 'Someone bought a winning lottery ticket at the General Store.',
    truth: 'false',
    verifiedText: 'The store checked with the lottery office. No winning ticket was sold here.',
  },
  {
    presetId: 'park-festival',
    label: 'A festival in the park',
    text: 'There is going to be a big music festival in the park next weekend.',
    truth: 'true',
    verifiedText: 'The park sign has the notice: a small music afternoon next Saturday from 2 to 6.',
  },
  {
    presetId: 'water-off',
    label: 'The water is shutting off',
    text: 'The water is going to be shut off all day tomorrow for repairs.',
    truth: 'false',
    verifiedText: 'The town office says the water stays on. A pipe on one side street is being fixed at night.',
  },
  {
    presetId: 'teacher-leaving',
    label: 'A teacher is leaving',
    text: 'The favorite teacher at the school is leaving town at the end of the term.',
    truth: 'uncertain',
    verifiedText: 'The school says no teacher has handed in notice, but it will not comment on next term.',
  },
  {
    presetId: 'stray-dog',
    label: 'A dog found a purse',
    text: 'A stray dog dug up a purse full of old coins near the fountain.',
    truth: 'true',
    verifiedText: 'The town office has the purse. A dog did find it by the fountain, and the coins are being checked.',
  },
];

export const DEFAULT_PRESET_ID = 'cafe-closing';

export function getPreset(id: string | undefined): RumorPreset | undefined {
  return PRESETS.find((p) => p.presetId === id);
}
