/** Canned small talk for pairs who meet without a rumor to share. No AI. */
import type { Rng } from './rng';

const OPENERS: readonly string[] = [
  'Nice day, isn’t it?',
  'Hi! How are you doing?',
  'Busy morning?',
  'Good to see you!',
  'Have you tried the new bread at the store?',
  'The park looks lovely today.',
  'Off somewhere nice?',
  'How is the family?',
  'Long time no see!',
  'Did you sleep well?',
];

const REPLIES: readonly string[] = [
  'Not bad at all, thanks.',
  'Pretty good! You?',
  'Can’t complain.',
  'Yes, it’s a nice one.',
  'Same as ever, and that’s fine.',
  'Just running a few errands.',
  'All good here.',
  'I was just thinking the same.',
  'Busy, but in a good way.',
  'Great, thanks for asking!',
];

export function smallTalkLines(rng: Rng, aId: number, bId: number): Array<{ speakerId: number; text: string }> {
  return [
    { speakerId: aId, text: rng.pick(OPENERS) },
    { speakerId: bId, text: rng.pick(REPLIES) },
  ];
}
