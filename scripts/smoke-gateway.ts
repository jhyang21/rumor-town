// One live Jev evaluate + one GPT structured call through Vercel AI Gateway.
// Run: pnpm smoke   (loads .env.local via node --env-file)
import { experimental_evaluate as evaluate, generateText, Output } from 'ai';
import { z } from 'zod';

const evalModel = process.env.AI_GATEWAY_EVALUATION_MODEL ?? 'typesafe-ai/jev';
const langModel = process.env.AI_GATEWAY_LANGUAGE_MODEL ?? 'openai/gpt-4.1-mini';

async function main() {
  const t0 = Date.now();
  const ev = await evaluate({
    model: evalModel,
    state: {
      speaker: { name: 'Maya', traits: { willingnessToShare: 'very high (0.9)' }, belief: 'believes' },
      listener: { name: 'Leo', traits: { skepticism: 'high (0.8)', trustInSpeaker: 'moderate (0.5)' }, belief: 'unsure' },
      rumor: { text: 'The café might be closing.' },
      relationship: 'coworkers, friendly',
    },
    questions: {
      mention: { type: 'boolean', instructions: 'Does the speaker bring up the rumor in this chat?' },
      beliefShift: {
        type: 'score',
        instructions: 'How does the listener\'s belief in the rumor change after hearing it?',
        criteria: ['much less convinced', 'somewhat less convinced', 'no change', 'somewhat more convinced', 'much more convinced'],
      },
      retelling: {
        type: 'choice',
        instructions: 'If the listener later repeats the rumor, how does the wording change?',
        criteria: { unchanged: 'same claim', softened: 'more hedged', strengthened: 'more certain', distorted: 'adds a new detail' },
      },
    },
  });
  console.log('JEV ms', Date.now() - t0, JSON.stringify(ev.answers), 'usage', JSON.stringify(ev.usage));

  const t1 = Date.now();
  const { output, usage } = await generateText({
    model: langModel,
    output: Output.object({
      schema: z.object({ lines: z.array(z.object({ speaker: z.string(), text: z.string() })).min(2).max(4) }),
    }),
    prompt: 'Write a 2-3 line chat where Maya tells Leo the rumor "The café might be closing." Leo is skeptical and asks who said so. Keep each line under 15 words.',
  });
  console.log('GPT ms', Date.now() - t1, JSON.stringify(output), 'usage', JSON.stringify(usage));
}
main().catch((e) => { console.error('SMOKE FAILED:', e?.message ?? e); process.exit(1); });
