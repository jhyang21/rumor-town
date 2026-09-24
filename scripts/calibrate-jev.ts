/**
 * Jev calibration. Varies one field at a time from a neutral PairContext and checks that Jev's
 * answers move the way people would expect. Runs every case under two trait presentations:
 *   labeled: "high (0.7)"   (traitLabel(v, true))
 *   bare:    "high"         (traitLabel(v, false))
 *
 *   pnpm calibrate              read scripts/fixtures/jev-calibration.json, assert, print verdict
 *   pnpm calibrate -- --live    call Jev (about 54 calls) and rewrite the fixture first
 *
 * The fixture holds inputs and answers only. No secrets, no prompts beyond the state itself.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DecisionAnswer, PairContext } from '../src/sim/oracle/types';
import type { BeliefBand } from '../src/sim/types';
import { traitLabel } from '../src/sim/people/archetypes';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'jev-calibration.json');
const PRESENTATIONS = ['labeled', 'bare'] as const;
type Presentation = (typeof PRESENTATIONS)[number];

const LEVELS = [100, 300, 500, 700, 900];
const CLOSENESS = [
  'strangers, never spoken before',
  'acquaintances, nod in passing',
  'neighbors, friendly, talk weekly',
  'close friends, talk every day',
];
const LISTENER_BANDS: BeliefBand[] = ['rejects', 'skeptical', 'unsure', 'believes', 'strongly_believes'];
const RUMOR = 'The Corner Café is closing at the end of the month.';

interface Knobs {
  speakerSociability: number;
  willingnessToShare: number;
  speakerSkepticism: number;
  listenerSkepticism: number;
  tendencyToVerify: number;
  trustInSpeaker: number;
  relationship: string;
  speakerVerified: 'no' | 'confirmed' | 'debunked';
  listenerBelief: BeliefBand | 'never heard it';
}

const NEUTRAL: Knobs = {
  speakerSociability: 500,
  willingnessToShare: 500,
  speakerSkepticism: 500,
  listenerSkepticism: 500,
  tendencyToVerify: 500,
  trustInSpeaker: 500,
  relationship: CLOSENESS[2],
  speakerVerified: 'no',
  listenerBelief: 'never heard it',
};

function buildPair(k: Knobs, p: Presentation): PairContext {
  const t = (v: number) => traitLabel(v, p === 'labeled');
  const heard = k.listenerBelief !== 'never heard it';
  const source =
    k.speakerVerified === 'debunked'
      ? 'heard it from Mina (close friend), then asked the café owner, who said it is not true'
      : k.speakerVerified === 'confirmed'
        ? 'heard it from Mina (close friend), then asked the café owner, who said it is true'
        : 'heard it from Mina (close friend)';
  return {
    scene: { time: '10:30 AM', place: 'the town square', setting: 'quiet' },
    rumor: { text: RUMOR, speakerSource: source, speakerVerified: k.speakerVerified, timesSpeakerHeard: 1 },
    speaker: {
      name: 'Rosa',
      occupation: 'shopkeeper',
      persona: 'easygoing and neither chatty nor shy',
      traits: { sociability: t(k.speakerSociability), willingnessToShare: t(k.willingnessToShare), skepticism: t(k.speakerSkepticism) },
      belief: 'believes',
    },
    listener: {
      name: 'Tom',
      occupation: 'office worker',
      persona: 'gets on with the day and hears things now and then',
      traits: { skepticism: t(k.listenerSkepticism), tendencyToVerify: t(k.tendencyToVerify), trustInSpeaker: t(k.trustInSpeaker) },
      alreadyHeard: heard ? 'yes: The Corner Café might close soon.' : 'no',
      belief: k.listenerBelief,
    },
    relationship: k.relationship,
  };
}

interface SweepSpec {
  id: string;
  label: string;
  levels: Array<{ level: string; knobs: Partial<Knobs> }>;
}

const traitSweep = (id: string, label: string, key: keyof Knobs): SweepSpec => ({
  id,
  label,
  levels: LEVELS.map((v) => ({ level: traitLabel(v, true), knobs: { [key]: v } as Partial<Knobs> })),
});

const SWEEPS: SweepSpec[] = [
  traitSweep('listenerSkepticism', 'Listener skepticism', 'listenerSkepticism'),
  traitSweep('trustInSpeaker', 'Listener trust in speaker', 'trustInSpeaker'),
  traitSweep('willingnessToShare', 'Speaker willingness to share', 'willingnessToShare'),
  traitSweep('tendencyToVerify', 'Listener tendency to verify', 'tendencyToVerify'),
  {
    id: 'closeness',
    label: 'Relationship closeness',
    levels: CLOSENESS.map((r) => ({ level: r.split(',')[0], knobs: { relationship: r } })),
  },
  {
    id: 'speakerVerified',
    label: 'Speaker checked the facts',
    levels: (['no', 'confirmed', 'debunked'] as const).map((v) => ({ level: v, knobs: { speakerVerified: v } })),
  },
  {
    id: 'listenerBelief',
    label: 'Listener already heard it (belief band)',
    levels: [
      { level: 'never heard it', knobs: {} },
      ...LISTENER_BANDS.map((b) => ({ level: b, knobs: { listenerBelief: b } })),
    ],
  },
];

interface FixtureCase {
  sweep: string;
  level: string;
  presentation: Presentation;
  pair: PairContext;
  answer?: DecisionAnswer;
  error?: string;
}
interface Fixture {
  version: 1;
  generatedAt: string;
  model: string;
  liveCalls: number;
  cases: FixtureCase[];
}

/* ---------- live mode ---------- */

async function runLive(): Promise<void> {
  const { decidePair } = await import('../src/ai/jev');
  const { classifyAiError, evaluationModelId } = await import('../src/ai/gateway');
  const cases: FixtureCase[] = [];
  for (const p of PRESENTATIONS)
    for (const s of SWEEPS)
      for (const l of s.levels)
        cases.push({ sweep: s.id, level: l.level, presentation: p, pair: buildPair({ ...NEUTRAL, ...l.knobs }, p) });

  // Resume: reuse answers already in the fixture for identical states.
  const previous = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture) : null;
  const known = new Map<string, DecisionAnswer>();
  for (const c of previous?.cases ?? []) if (c.answer) known.set(JSON.stringify(c.pair), c.answer);

  // Same state -> one call (the neutral baseline appears in several sweeps).
  const unique = new Map<string, FixtureCase[]>();
  for (const c of cases) {
    const key = JSON.stringify(c.pair);
    const hit = known.get(key);
    if (hit) {
      c.answer = hit;
      continue;
    }
    unique.set(key, [...(unique.get(key) ?? []), c]);
  }
  const groups = [...unique.values()];
  console.log(`Calling Jev for ${groups.length} distinct states (${cases.length} cases, ${known.size} reused)...`);
  let next = 0;
  let calls = 0;
  const worker = async () => {
    while (next < groups.length) {
      const group = groups[next++];
      calls++;
      try {
        const answer = await decidePair({ requestId: calls, kind: 'encounter', tick: 150, meetingId: calls, pair: group[0].pair });
        for (const c of group) c.answer = answer;
      } catch (err) {
        const code = classifyAiError(err).code;
        for (const c of group) c.error = code;
      }
    }
  };
  // One at a time: four in flight hit the gateway's Jev rate limit (429) on the first run.
  await worker();
  const fixture: Fixture = {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: evaluationModelId(),
    liveCalls: (previous?.liveCalls ?? 0) + calls,
    cases,
  };
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2) + '\n');
  const errors = cases.filter((c) => c.error).map((c) => c.error);
  console.log(`Wrote ${FIXTURE} (${calls} calls, ${errors.length} errors${errors.length ? ': ' + [...new Set(errors)].join(', ') : ''}).`);
}

/* ---------- assertions ---------- */

type Metric = 'mention' | 'beliefShift' | 'challenges' | 'willShare' | 'verify';
const EPS = 0.02; // Jev reports two decimals

interface Check {
  name: string;
  sweep: string;
  metric: Metric;
  direction: 1 | -1;
}
const CHECKS: Check[] = [
  { name: 'Higher listener skepticism -> smaller belief shift', sweep: 'listenerSkepticism', metric: 'beliefShift', direction: -1 },
  { name: 'Higher listener skepticism -> more challenges', sweep: 'listenerSkepticism', metric: 'challenges', direction: 1 },
  { name: 'Higher trust -> larger belief shift', sweep: 'trustInSpeaker', metric: 'beliefShift', direction: 1 },
  { name: 'Higher willingness to share -> more mention', sweep: 'willingnessToShare', metric: 'mention', direction: 1 },
  { name: 'Closer relationship -> more mention', sweep: 'closeness', metric: 'mention', direction: 1 },
  { name: 'Higher tendency to verify -> more verify', sweep: 'tendencyToVerify', metric: 'verify', direction: 1 },
];

interface CheckResult {
  name: string;
  pass: boolean;
  effect: number; // signed in the expected direction, on a 0..1 scale
  violations: number; // adjacent steps that move the wrong way by more than EPS
  violationSize: number;
  values: number[];
}

function series(fx: Fixture, p: Presentation, sweep: string, metric: Metric): number[] {
  const spec = SWEEPS.find((s) => s.id === sweep)!;
  return spec.levels.map((l) => {
    const c = fx.cases.find((x) => x.presentation === p && x.sweep === sweep && x.level === l.level);
    if (!c?.answer) throw new Error(`Fixture is missing ${p}/${sweep}/${l.level}. Run with --live.`);
    return c.answer[metric];
  });
}

function runCheck(fx: Fixture, p: Presentation, ch: Check): CheckResult {
  const values = series(fx, p, ch.sweep, ch.metric);
  const scale = ch.metric === 'beliefShift' ? 4 : 1;
  let violations = 0;
  let violationSize = 0;
  for (let i = 1; i < values.length; i++) {
    const step = (ch.direction * (values[i] - values[i - 1])) / scale;
    if (step < -EPS / scale) {
      violations++;
      violationSize += -step;
    }
  }
  const effect = (ch.direction * (values[values.length - 1] - values[0])) / scale;
  return { name: ch.name, pass: violations === 0 && effect > 0, effect, violations, violationSize, values };
}

function correctedCheck(fx: Fixture, p: Presentation): CheckResult {
  const c = fx.cases.find((x) => x.presentation === p && x.sweep === 'speakerVerified' && x.level === 'debunked');
  if (!c?.answer) throw new Error('Fixture is missing the debunked case. Run with --live.');
  const pass = c.answer.retelling === 'corrected';
  return { name: 'Speaker debunked it -> retelling "corrected"', pass, effect: pass ? 1 : 0, violations: pass ? 0 : 1, violationSize: 0, values: [] };
}

/* ---------- report ---------- */

const f2 = (n: number) => n.toFixed(2);

function printTables(fx: Fixture, p: Presentation) {
  console.log(`\n=== Presentation: ${p} (${p === 'labeled' ? 'e.g. "high (0.7)"' : 'e.g. "high"'}) ===`);
  for (const s of SWEEPS) {
    console.log(`\n${s.label}`);
    console.log('  level                  mention  E[shift]  challenges  willShare  verify  retelling');
    for (const l of s.levels) {
      const a = fx.cases.find((x) => x.presentation === p && x.sweep === s.id && x.level === l.level)?.answer;
      if (!a) {
        console.log(`  ${l.level.padEnd(22)} (missing)`);
        continue;
      }
      console.log(
        `  ${l.level.padEnd(22)} ${f2(a.mention).padStart(7)}  ${f2(a.beliefShift).padStart(8)}  ${f2(a.challenges).padStart(10)}  ${f2(a.willShare).padStart(9)}  ${f2(a.verify).padStart(6)}  ${a.retelling}`,
      );
    }
  }
}

function main() {
  const live = process.argv.includes('--live');
  const go = async () => {
    if (live) await runLive();
    if (!existsSync(FIXTURE)) {
      console.error(`No fixture at ${FIXTURE}. Run: pnpm calibrate -- --live`);
      process.exit(1);
    }
    const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
    console.log(`Fixture: ${fx.model}, ${fx.liveCalls} live calls, generated ${fx.generatedAt}`);

    const results = {} as Record<Presentation, CheckResult[]>;
    for (const p of PRESENTATIONS) {
      printTables(fx, p);
      results[p] = [...CHECKS.map((c) => runCheck(fx, p, c)), correctedCheck(fx, p)];
    }

    console.log('\n=== Monotone checks ===');
    console.log('  check                                                labeled                 bare');
    for (let i = 0; i < results.labeled.length; i++) {
      const cell = (r: CheckResult) =>
        `${r.pass ? 'PASS' : 'FAIL'} eff ${f2(r.effect)} viol ${r.violations}`.padEnd(22);
      console.log(`  ${results.labeled[i].name.padEnd(52)} ${cell(results.labeled[i])}  ${cell(results.bare[i])}`);
    }

    const score = (rs: CheckResult[]) => ({
      passes: rs.filter((r) => r.pass).length,
      violations: rs.reduce((s, r) => s + r.violations, 0),
      violationSize: rs.reduce((s, r) => s + r.violationSize, 0),
      effect: rs.slice(0, CHECKS.length).reduce((s, r) => s + r.effect, 0),
    });
    const sl = score(results.labeled);
    const sb = score(results.bare);
    const better: Presentation =
      sl.passes !== sb.passes
        ? sl.passes > sb.passes ? 'labeled' : 'bare'
        : sl.violations !== sb.violations
          ? sl.violations < sb.violations ? 'labeled' : 'bare'
          : sl.effect >= sb.effect ? 'labeled' : 'bare';
    for (const [p, s] of [['labeled', sl], ['bare', sb]] as const) {
      console.log(`  ${p.padEnd(8)} passes ${s.passes}/${results[p].length}, wrong-way steps ${s.violations} (size ${f2(s.violationSize)}), total effect ${f2(s.effect)}`);
    }
    console.log(`\nVerdict: use the "${better}" presentation (traitLabel(value, ${better === 'labeled'})). It gives cleaner monotone effects.`);

    const failed = results[better].filter((r) => !r.pass);
    if (failed.length) {
      console.error(`\n${failed.length} check(s) fail for the recommended presentation:`);
      for (const r of failed) console.error(`  - ${r.name}: ${r.values.map(f2).join(' -> ')}`);
      process.exit(1);
    }
    console.log('All checks pass for the recommended presentation.');
  };
  go().catch((e) => {
    console.error('Calibration failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

main();
