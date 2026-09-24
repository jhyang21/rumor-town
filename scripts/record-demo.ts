// Record the landing-page demo: 30 people, the 'cafe-closing' preset, townSeed 11, runSeed 5.
// Run: pnpm record:demo           (LocalOracle, no network)
//      pnpm record:demo --live    (Jev decides, GPT speaks; one request at a time)
// Writes public/demo-run.json as { config, oracleLog }.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine } from '@/sim/engine';
import { LocalOracle } from '@/sim/oracle/local';
import type { DecisionRequest, OracleSource, SpeechRequest } from '@/sim/oracle/types';
import { replayRun, runHeadless } from '@/sim/runHeadless';
import type { RunConfig } from '@/sim/types';
import { getPreset } from '@/data/presets';

const OUT = resolve(process.cwd(), 'public/demo-run.json');
const MAX_BYTES = 200 * 1024;

function demoConfig(): RunConfig {
  const p = getPreset('cafe-closing');
  if (!p) throw new Error('Preset cafe-closing is missing');
  return {
    population: 30,
    rumor: { presetId: p.presetId, text: p.text, truth: p.truth, verifiedText: p.verifiedText },
    townSeed: 11,
    runSeed: 5,
    overrides: {},
  };
}

async function recordLive(config: RunConfig): Promise<{ engine: Engine; calls: number; fallbacks: number; accountError: string | null }> {
  const { decidePair } = await import('@/ai/jev');
  const { speak } = await import('@/ai/gpt');
  const { ACCOUNT_ERROR_CODES, classifyAiError } = await import('@/ai/gateway');
  const local = new LocalOracle({ seed: config.runSeed });
  const engine = new Engine(config);
  let calls = 0;
  let fallbacks = 0;
  let accountError: string | null = null;

  const answer = async (req: DecisionRequest | SpeechRequest) => {
    const localAnswer = () => (req.kind === 'encounter' ? local.decideSync(req) : local.speakSync(req));
    if (accountError) return { ans: localAnswer(), source: 'fallback' as OracleSource };
    calls++;
    try {
      const ans = req.kind === 'encounter' ? await decidePair(req) : await speak(req);
      return { ans, source: (req.kind === 'encounter' ? 'jev' : 'gpt') as OracleSource };
    } catch (err) {
      const { code } = classifyAiError(err);
      if (ACCOUNT_ERROR_CODES.includes(code)) accountError = code;
      fallbacks++;
      console.log(`request ${req.requestId} (${req.kind}) fell back: ${code}`);
      return { ans: localAnswer(), source: 'fallback' as OracleSource };
    }
  };

  let lastLog = -1;
  while (!engine.finished) {
    for (const req of engine.pendingRequests()) {
      const { ans, source } = await answer(req);
      engine.deliver(req.requestId, ans, source);
    }
    engine.step();
    if (engine.tick % 60 === 0 && engine.tick !== lastLog) {
      lastLog = engine.tick;
      console.log(`tick ${engine.tick}: ${calls} calls, ${fallbacks} fallbacks`);
    }
  }
  return { engine, calls, fallbacks, accountError };
}

async function main() {
  const live = process.argv.includes('--live');
  const config = demoConfig();
  let oracleLog;
  let finalHash: string;
  let usedLocal = !live;

  if (live) {
    const res = await recordLive(config);
    console.log(`live: ${res.calls} calls, ${res.fallbacks} fallbacks`);
    if (res.accountError) {
      console.log(`Account error (${res.accountError}). Recording with the LocalOracle instead.`);
      usedLocal = true;
    } else {
      oracleLog = res.engine.oracleLog.slice();
      finalHash = res.engine.finalHash();
    }
  }
  if (usedLocal) {
    const rec = runHeadless(config, new LocalOracle({ seed: config.runSeed }), 'local');
    oracleLog = rec.oracleLog;
    finalHash = rec.finalHash;
  }

  // the file must replay to the same end state
  const check = replayRun(config, oracleLog!);
  if (check.finalHash !== finalHash!) throw new Error('Replay does not match the recording');

  const json = JSON.stringify({ config, oracleLog });
  writeFileSync(OUT, json);
  const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
  console.log(`wrote ${OUT}: ${oracleLog!.length} log entries, ${kb} KB (${usedLocal ? 'local' : 'live'})`);
  if (Buffer.byteLength(json) > MAX_BYTES) throw new Error(`demo-run.json is over 200 KB`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
