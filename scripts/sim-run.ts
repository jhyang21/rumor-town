/**
 * Headless simulation runner.
 *   pnpm sim:run --pop 50 --seed 7 [--runSeed 3] [--replay] [--sweep N] [--preset cafe-closing]
 */
import { Engine } from '../src/sim/engine';
import { LocalOracle } from '../src/sim/oracle/local';
import { driveToEnd, replayEngine } from '../src/sim/runHeadless';
import { DEFAULT_RUMOR, PRESETS } from '../src/sim/rumor/presets';
import type { Population, RunConfig, RumorSpec } from '../src/sim/types';
import { formatTick } from '../src/sim/types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? 'true' : v;
}

const pop = Number(arg('pop') ?? 50) as Population;
const seed = Number(arg('seed') ?? 7);
const runSeed = Number(arg('runSeed') ?? seed);
const replay = arg('replay') !== undefined;
const sweep = arg('sweep') !== undefined ? Number(arg('sweep')) : 0;
const presetId = arg('preset');
const rumor: RumorSpec = presetId ? (PRESETS.find((p) => p.presetId === presetId) ?? DEFAULT_RUMOR) : DEFAULT_RUMOR;

function config(population: Population, townSeed: number, rs: number): RunConfig {
  return { population, rumor, townSeed, runSeed: rs, overrides: {} };
}

function runLive(cfg: RunConfig): { engine: Engine; ms: number } {
  const t0 = performance.now();
  const engine = new Engine(cfg);
  driveToEnd(engine, new LocalOracle({ seed: cfg.runSeed }), () => 'local');
  return { engine, ms: performance.now() - t0 };
}

function pct(n: number, d: number): string {
  return `${Math.round((n * 100) / d)}%`;
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function single(): void {
  const cfg = config(pop, seed, runSeed);
  const { engine, ms } = runLive(cfg);
  const st = engine.stats();
  const names = engine.characters;
  console.log(`Rumor Town  pop ${pop}  townSeed ${seed}  runSeed ${runSeed}`);
  console.log(`Rumor: "${cfg.rumor.text}" (${cfg.rumor.truth})  starter: ${names[engine.starterId].name}`);
  console.log('');
  console.log('Stats');
  console.log(`  heard ${st.heard}/${st.population} (${pct(st.heard, st.population)})  believed ${st.believed}  shared ${st.shared}  rejected ${st.rejected}`);
  console.log(`  rumor conversations ${st.rumorConversations}  variants ${st.variantCount}  longest chain ${st.longestChain}`);
  console.log(`  most widespread ${st.mostWidespreadVariantId}  most changed ${st.mostChangedVariantId}  dominant belief ${st.dominantBelief}`);
  console.log(`  first correction ${st.firstCorrectionTick === null ? '-' : formatTick(st.firstCorrectionTick)}  Jev calls ${st.jevCalls}  GPT calls ${st.gptCalls}`);
  console.log(`  ended ${formatTick(st.endedAtTick)} (tick ${st.endedAtTick}, ${st.endReason})`);
  console.log('');
  console.log('Milestones');
  for (const e of engine.events) if (e.type === 'milestone') console.log(`  ${formatTick(e.tick).padStart(8)}  ${e.text}`);
  console.log('');
  console.log('Variant tree');
  const kids = new Map<string | null, typeof engine.variants[number][]>();
  for (const v of engine.variants) kids.set(v.parentId, [...(kids.get(v.parentId) ?? []), v]);
  const walk = (parent: string | null, depth: number) => {
    for (const v of kids.get(parent) ?? []) {
      console.log(`  ${'  '.repeat(depth)}${v.id} [${v.mutation}, heard ${v.heardCount}, told ${v.repeatedCount}] ${v.text}`);
      walk(v.id, depth + 1);
    }
  };
  walk(null, 0);
  console.log('');
  console.log('Series (8 columns)');
  const s = engine.series;
  const cols = 8;
  const pick = Array.from({ length: cols }, (_, i) => s[Math.round((i * (s.length - 1)) / (cols - 1))]);
  console.log(`  time     ${pick.map((p) => formatTick(p.tick).padStart(9)).join('')}`);
  console.log(`  heard    ${pick.map((p) => String(p.heard).padStart(9)).join('')}`);
  console.log(`  believe  ${pick.map((p) => String(p.believing).padStart(9)).join('')}`);
  console.log(`  shared   ${pick.map((p) => String(p.shared).padStart(9)).join('')}`);
  console.log('');
  console.log(`Run length ${engine.tick} ticks  engine time ${ms.toFixed(1)} ms  final hash ${engine.finalHash()}`);

  if (replay) {
    const t0 = performance.now();
    const r = replayEngine(cfg, engine.oracleLog);
    const rms = performance.now() - t0;
    const same = r.finalHash() === engine.finalHash() && r.hashes.length === engine.hashes.length && r.hashes.every((h, i) => h === engine.hashes[i]);
    console.log(`Replay ${same ? 'OK' : 'MISMATCH'}  ${r.hashes.length} hashes  replay time ${rms.toFixed(1)} ms  log entries ${engine.oracleLog.length}  log bytes ${JSON.stringify(engine.oracleLog).length}`);
    if (!same) process.exit(1);
  }
}

function doSweep(n: number): void {
  const pops: Population[] = [30, 50, 75];
  console.log(`Sweep: ${n} seeds x ${pops.length} populations, rumor "${rumor.text}"`);
  console.log('pop  runs  heard% p10/med/p90   believed% med  variants med (min-max) <3   ended med  <400  quiet  zeroTx  corr%  maxJev maxGPT maxLogKB  ms/run');
  const t0 = performance.now();
  for (const p of pops) {
    const heard: number[] = [];
    const believed: number[] = [];
    const variants: number[] = [];
    const ended: number[] = [];
    const zero: number[] = [];
    let early = 0;
    let quiet = 0;
    let maxJ = 0;
    let maxG = 0;
    let maxKB = 0;
    let corr = 0;
    let ms = 0;
    for (let sd = 1; sd <= n; sd++) {
      const r = runLive(config(p, sd, sd * 7919));
      ms += r.ms;
      const st = r.engine.stats();
      heard.push((st.heard * 100) / p);
      believed.push((st.believed * 100) / p);
      variants.push(st.variantCount);
      ended.push(st.endedAtTick);
      if (st.endedAtTick < 400) early++;
      if (st.endReason === 'quiet') quiet++;
      if (st.heard <= 1) zero.push(sd);
      maxJ = Math.max(maxJ, st.jevCalls);
      maxG = Math.max(maxG, st.gptCalls);
      maxKB = Math.max(maxKB, JSON.stringify(r.engine.oracleLog).length / 1024);
      if (st.firstCorrectionTick !== null) corr++;
    }
    const q = (xs: number[], f: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(f * xs.length))];
    const few = variants.filter((v) => v < 3).length;
    console.log(
      [
        String(p).padEnd(4),
        String(n).padEnd(5),
        `${q(heard, 0.1).toFixed(0)}/${median(heard).toFixed(0)}/${q(heard, 0.9).toFixed(0)}`.padEnd(19),
        median(believed).toFixed(0).padEnd(14),
        `${median(variants)} (${Math.min(...variants)}-${Math.max(...variants)})`.padEnd(20),
        String(few).padEnd(4),
        String(median(ended)).padEnd(10),
        String(early).padEnd(5),
        String(quiet).padEnd(6),
        String(zero.length).padEnd(7),
        `${Math.round((corr * 100) / n)}`.padEnd(6),
        String(maxJ).padEnd(7),
        String(maxG).padEnd(7),
        maxKB.toFixed(0).padEnd(9),
        (ms / n).toFixed(1),
      ].join(' '),
    );
    if (zero.length) console.log(`     seeds with zero transmissions: ${zero.slice(0, 30).join(', ')}${zero.length > 30 ? ' …' : ''}`);
  }
  console.log(`total ${(performance.now() - t0).toFixed(0)} ms`);
}

if (sweep > 0) doSweep(sweep);
else single();
