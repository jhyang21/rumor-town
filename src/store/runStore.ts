/**
 * Play store: the bridge between React and the engine + driver.
 *
 * The engine and driver are plain objects kept in the store as refs; React reads only the small
 * derived fields (clock, counters, milestone, phase), refreshed at most 4 times a second.
 *
 * Oracle modes
 * - live: POST /api/runs/start for a token, then LiveOracle (wrapped so an account error switches the
 *   rest of the run to the LocalOracle). Any start failure other than "blocked" runs locally.
 * - local: LocalOracle only.
 * - replay: answers from a recorded oracle log, 2x.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Engine } from '@/sim/engine';
import { LocalOracle } from '@/sim/oracle/local';
import type { DecisionRequest, Oracle, OracleSource, SpeechRequest, SyncOracle } from '@/sim/oracle/types';
import { toRecord } from '@/sim/runHeadless';
import type { RunConfig, RunRecord, RumorSpec, SimEvent } from '@/sim/types';
import { LOCATION_BY_ID } from '@/sim/town/mapSpec';
import { DEFAULT_PRESET_ID, getPreset } from '@/data/presets';
import { runStartResponseSchema } from '@/ai/schemas';
import { createDriver, type Driver, type DriverOptions, type DriverState, type FrameInfo, type Speed } from '@/runtime/driver';
import { createLiveOracle, type LiveOracle } from '@/runtime/liveOracle';
import { saveRun, type SaveRunInput, type SaveRunResult } from '@/lib/runsClient';
import { ACCOUNT_ERROR_CODES, LocalSourceOracle, SafeReplayOracle, SwitchableOracle } from './oracles';

export type Phase = 'setup' | 'running' | 'finished';
export type OracleMode = 'live' | 'local' | 'replay';

export interface Counters {
  heard: number;
  believe: number;
  told: number;
}

export interface FocusRequest {
  seq: number;
  x: number;
  y: number;
  characterId: number | null;
  text: string;
}

export const NO_LIVE_AI_TEXT = 'Running without live AI.';
export const SHARE_FAILED_TEXT = 'Could not save this day. Try again in a bit.';
export const BLOCKED_FALLBACK_TEXT = 'That rumor can’t be used here. Try a different one.';
export const REPLAY_SPEED: Speed = 2;
const REFRESH_MS = 250;

export interface RunStoreState {
  phase: Phase;
  /** config of the current or last run */
  config: RunConfig | null;
  /** what the setup sheet shows */
  draft: RunConfig;
  engine: Engine | null;
  driver: Driver | null;
  /** idle town behind the setup sheet */
  previewEngine: Engine | null;
  mode: OracleMode;
  speed: Speed;
  paused: boolean;
  tick: number;
  driverState: DriverState;
  selectedCharacterId: number | null;
  focus: FocusRequest | null;
  counters: Counters;
  milestone: string | null;
  record: RunRecord | null;
  runToken: string | null;
  banner: string | null;
  setupError: string | null;
  starting: boolean;
  /** latest driver frame (mutated in place; not a React trigger) */
  frame: { current: FrameInfo };

  start(config: RunConfig, mode?: 'live' | 'local'): Promise<void>;
  pause(): void;
  resume(): void;
  setSpeed(s: Speed): void;
  restart(): Promise<void>;
  endDay(): void;
  select(id: number | null): void;
  focusEvent(ev: SimEvent): void;
  replayRecord(record: RunRecord): void;
  rerun(record: RunRecord): Promise<void>;
  modify(record: RunRecord): void;
  share(): Promise<string | null>;
  setDraft(draft: RunConfig): void;
  showPreview(): void;
  setBanner(text: string | null): void;
  dispose(): void;
}

export interface RunStoreDeps {
  fetch: typeof fetch;
  random: () => number;
  now: () => number;
  createDriver: (o: DriverOptions) => Driver;
  saveRun: (input: SaveRunInput) => Promise<SaveRunResult>;
  copy: (text: string) => Promise<void>;
}

const defaultDeps = (): RunStoreDeps => ({
  fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
  random: Math.random,
  now: () => Date.now(),
  createDriver,
  saveRun,
  copy: async (text) => {
    await navigator.clipboard?.writeText(text);
  },
});

export function presetRumor(id: string = DEFAULT_PRESET_ID): RumorSpec {
  const p = getPreset(id) ?? getPreset(DEFAULT_PRESET_ID)!;
  return { text: p.text, truth: p.truth, presetId: p.presetId, ...(p.verifiedText ? { verifiedText: p.verifiedText } : {}) };
}

export function customRumor(text: string): RumorSpec {
  return { text: text.trim(), truth: 'uncertain' };
}

export function seedFrom(random: () => number): number {
  return Math.floor(random() * 0x100000000) >>> 0;
}

export function defaultConfig(random: () => number = Math.random): RunConfig {
  return { population: 50, rumor: presetRumor(), townSeed: seedFrom(random), runSeed: seedFrom(random), overrides: {} };
}

export function countersOf(engine: Engine): Counters {
  let heard = 0;
  let believe = 0;
  let told = 0;
  for (const s of engine.states) {
    const k = s.rumor;
    if (!k) continue;
    heard++;
    if (k.belief >= 600) believe++;
    if (k.sharedWithIds.length > 0) told++;
  }
  return { heard, believe, told };
}

function latestMilestone(engine: Engine): string | null {
  const ev = engine.events;
  for (let i = ev.length - 1; i >= 0; i--) if (ev[i].type === 'milestone' && ev[i].text) return ev[i].text;
  return null;
}

/** Where the camera should go for a timeline event. */
export function eventFocus(engine: Engine | null, ev: SimEvent): { x: number; y: number; characterId: number | null } | null {
  const loc = ev.locationId ? LOCATION_BY_ID[ev.locationId] : undefined;
  const cid = ev.characterIds[0] ?? null;
  if (loc) return { x: loc.zone.x + Math.floor(loc.zone.w / 2), y: loc.zone.y + Math.floor(loc.zone.h / 2), characterId: cid };
  if (cid !== null && engine?.states[cid]) return { x: engine.states[cid].x, y: engine.states[cid].y, characterId: cid };
  return null;
}

const IDLE_FRAME: FrameInfo = { tick: 0, alpha: 0, state: 'idle', clockScale: 1 };
const ZERO: Counters = { heard: 0, believe: 0, told: 0 };

export function createRunStore(overrides: Partial<RunStoreDeps> = {}): StoreApi<RunStoreState> {
  const deps: RunStoreDeps = { ...defaultDeps(), ...overrides };
  // run-scoped refs that React never reads
  let live: LiveOracle | null = null;
  let switchable: SwitchableOracle | null = null;
  let previewDriver: Driver | null = null;
  let lastRefresh = 0;
  let requestedMode: 'live' | 'local' = 'live';
  let runSerial = 0;
  let replaySource: SafeReplayOracle | null = null;

  const store = createStore<RunStoreState>()((set, get) => {
    function teardown(): void {
      get().driver?.stop();
      live = null;
      switchable = null;
    }

    function stopPreview(): void {
      previewDriver?.stop();
      previewDriver = null;
    }

    function refresh(force = false): void {
      const { engine, driver } = get();
      if (!engine) return;
      const t = deps.now();
      if (!force && t - lastRefresh < REFRESH_MS) return;
      lastRefresh = t;
      if (live && switchable && !switchable.isLocal) {
        const code = live.lastError?.code;
        if (code && ACCOUNT_ERROR_CODES.includes(code)) {
          switchable.switchToLocal();
          set({ banner: NO_LIVE_AI_TEXT, mode: 'local' });
        }
      }
      set({
        tick: engine.tick,
        counters: countersOf(engine),
        milestone: latestMilestone(engine),
        driverState: driver?.state ?? 'idle',
      });
    }

    function finish(): void {
      const { engine, phase } = get();
      if (!engine || phase !== 'running') return;
      get().driver?.stop();
      refresh(true);
      get().driver?.slow(false);
      set({ phase: 'finished', record: toRecord(engine), driverState: 'finished', paused: false });
    }

    function launch(args: {
      config: RunConfig;
      engine: Engine;
      oracle: Oracle;
      fallback: SyncOracle;
      mode: OracleMode;
      token: string | null;
      speed: Speed;
      banner?: string | null;
    }): void {
      teardown();
      stopPreview();
      const serial = ++runSerial;
      const frame = get().frame;
      frame.current = { ...IDLE_FRAME };
      const driver = deps.createDriver({
        engine: args.engine,
        oracle: args.oracle,
        fallback: args.fallback,
        speed: args.speed,
        onFrame: (f) => {
          if (serial !== runSerial) return;
          frame.current = f;
          if (f.state === 'finished') finish();
          else refresh();
        },
      });
      set({
        phase: 'running',
        config: args.config,
        engine: args.engine,
        driver,
        mode: args.mode,
        speed: args.speed,
        paused: false,
        tick: 0,
        driverState: 'running',
        selectedCharacterId: null,
        focus: null,
        counters: countersOf(args.engine),
        milestone: null,
        record: null,
        runToken: args.token,
        banner: args.banner ?? null,
        setupError: null,
        starting: false,
      });
      driver.play();
    }

    async function requestToken(config: RunConfig): Promise<{ token: string } | { blocked: string } | { failed: true }> {
      try {
        const res = await deps.fetch('/api/runs/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config }),
          cache: 'no-store',
        });
        const body = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
        if (res.status === 400 && body?.error === 'blocked') return { blocked: body.reason?.trim() || BLOCKED_FALLBACK_TEXT };
        if (!res.ok) return { failed: true };
        const parsed = runStartResponseSchema.safeParse(body);
        return parsed.success ? { token: parsed.data.token } : { failed: true };
      } catch {
        return { failed: true };
      }
    }

    function localLaunch(config: RunConfig, banner: string | null): void {
      const local = new LocalSourceOracle({ seed: config.runSeed });
      launch({ config, engine: new Engine(config), oracle: local, fallback: local, mode: 'local', token: null, speed: get().speed, banner });
    }

    return {
      phase: 'setup',
      config: null,
      draft: defaultConfig(deps.random),
      engine: null,
      driver: null,
      previewEngine: null,
      mode: 'live',
      speed: 1,
      paused: false,
      tick: 0,
      driverState: 'idle',
      selectedCharacterId: null,
      focus: null,
      counters: ZERO,
      milestone: null,
      record: null,
      runToken: null,
      banner: null,
      setupError: null,
      starting: false,
      frame: { current: { ...IDLE_FRAME } },

      async start(config, mode = 'live') {
        if (get().starting) return;
        requestedMode = mode;
        set({ starting: true, setupError: null });
        if (mode === 'local') {
          localLaunch(config, null);
          return;
        }
        const serial = runSerial;
        const r = await requestToken(config);
        if (serial !== runSerial) {
          set({ starting: false }); // the page went away or another run began
          return;
        }
        if ('blocked' in r) {
          set({ starting: false, setupError: r.blocked, phase: 'setup' });
          return;
        }
        if ('failed' in r) {
          localLaunch(config, NO_LIVE_AI_TEXT);
          return;
        }
        live = null;
        const liveOracle = createLiveOracle({ token: r.token });
        const local = new LocalOracle({ seed: config.runSeed });
        const sw = new SwitchableOracle(liveOracle, local);
        launch({ config, engine: new Engine(config), oracle: sw, fallback: local, mode: 'live', token: r.token, speed: get().speed });
        live = liveOracle;
        switchable = sw;
      },

      pause() {
        const { driver, phase } = get();
        if (!driver || phase !== 'running') return;
        driver.pause();
        set({ paused: true });
      },

      resume() {
        const { driver, phase } = get();
        if (!driver || phase !== 'running') return;
        driver.play();
        set({ paused: false });
      },

      setSpeed(s) {
        get().driver?.setSpeed(s);
        set({ speed: s });
      },

      async restart() {
        const { config } = get();
        if (!config) return;
        teardown();
        await get().start({ ...config, runSeed: seedFrom(deps.random) }, requestedMode);
      },

      endDay() {
        const { engine, driver, mode, phase } = get();
        if (!engine || phase !== 'running') return;
        driver?.stop();
        const cfg = engine.config;
        const fb: SyncOracle & { sourceOf?: (id: number) => OracleSource | undefined } =
          mode === 'replay' && replaySource ? replaySource : new LocalOracle({ seed: cfg.runSeed });
        const src = (req: DecisionRequest | SpeechRequest): OracleSource =>
          mode === 'replay' ? (fb.sourceOf?.(req.requestId) ?? 'replay') : mode === 'local' ? 'local' : 'fallback';
        while (!engine.finished) {
          for (const req of engine.pendingRequests()) {
            const ans = req.kind === 'encounter' ? fb.decideSync(req) : fb.speakSync(req);
            engine.deliver(req.requestId, ans, src(req));
          }
          engine.step();
        }
        finish();
      },

      select(id) {
        get().driver?.slow(id !== null);
        set({ selectedCharacterId: id });
      },

      focusEvent(ev) {
        const f = eventFocus(get().engine, ev);
        if (!f) return;
        const seq = (get().focus?.seq ?? 0) + 1;
        set({ focus: { seq, ...f, text: ev.text } });
      },

      replayRecord(record) {
        const oracle = new SafeReplayOracle(record.oracleLog, record.config.runSeed);
        replaySource = oracle;
        launch({ config: record.config, engine: new Engine(record.config), oracle, fallback: oracle, mode: 'replay', token: null, speed: REPLAY_SPEED });
      },

      async rerun(record) {
        teardown();
        await get().start({ ...record.config, runSeed: seedFrom(deps.random) }, 'live');
      },

      modify(record) {
        teardown();
        set({
          phase: 'setup',
          engine: null,
          driver: null,
          record: null,
          selectedCharacterId: null,
          focus: null,
          draft: { ...record.config, overrides: { ...record.config.overrides }, runSeed: seedFrom(deps.random) },
          setupError: null,
        });
        get().showPreview();
      },

      async share() {
        const { record, config } = get();
        if (!record || !config) return null;
        let token = get().runToken;
        if (!token) {
          const r = await requestToken(config);
          if (!('token' in r)) {
            set({ banner: SHARE_FAILED_TEXT });
            return null;
          }
          token = r.token;
        }
        try {
          const saved = await deps.saveRun({ token, config, oracleLog: record.oracleLog, finalHash: record.finalHash });
          try {
            await deps.copy(saved.url);
          } catch {
            /* the panel still shows the link */
          }
          return saved.url;
        } catch {
          set({ banner: SHARE_FAILED_TEXT });
          return null;
        }
      },

      setDraft(draft) {
        const prev = get().draft;
        set({ draft, setupError: null });
        if (prev.population !== draft.population || prev.townSeed !== draft.townSeed || !get().previewEngine) get().showPreview();
      },

      showPreview() {
        stopPreview();
        const { draft } = get();
        const cfg: RunConfig = { ...draft, overrides: { ...draft.overrides } };
        const engine = new Engine(cfg);
        const local = new LocalOracle({ seed: cfg.runSeed });
        const frame = get().frame;
        previewDriver = deps.createDriver({
          engine,
          oracle: local,
          fallback: local,
          speed: 1,
          onFrame: (f) => {
            if (get().phase === 'setup') frame.current = f;
          },
        });
        previewDriver.play();
        set({ previewEngine: engine });
      },

      setBanner(text) {
        set({ banner: text });
      },

      dispose() {
        teardown();
        stopPreview();
        runSerial++;
        set({
          phase: 'setup',
          engine: null,
          driver: null,
          previewEngine: null,
          record: null,
          selectedCharacterId: null,
          focus: null,
          paused: false,
          tick: 0,
          counters: ZERO,
          milestone: null,
          starting: false,
          setupError: null,
          banner: null,
          driverState: 'idle',
        });
      },
    };
  });

  return store;
}

export const runStore = createRunStore();

export function useRunStore<T>(selector: (s: RunStoreState) => T): T {
  return useStore(runStore, selector);
}
