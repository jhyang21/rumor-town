import { describe, expect, it, vi } from 'vitest';
import type { Driver, DriverState } from '@/runtime/driver';
import type { RunConfig } from '@/sim/types';
import { NO_LIVE_AI_TEXT, SHARE_FAILED_TEXT, createRunStore, customRumor, presetRumor, type RunStoreDeps } from './runStore';

function fakeDriver(): Driver {
  let state: DriverState = 'idle';
  return {
    get state() {
      return state;
    },
    fallbackIds: new Set<number>(),
    play: vi.fn(() => void (state = 'running')),
    pause: vi.fn(() => void (state = 'paused')),
    stop: vi.fn(() => void (state = 'idle')),
    setSpeed: vi.fn(),
    slow: vi.fn(),
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const START_OK = { runId: 'run-12345', token: 'tok', caps: { decide: 250, speak: 70 } };

function makeStore(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, extra: Partial<RunStoreDeps> = {}) {
  let n = 1;
  return createRunStore({
    fetch: fetchImpl as unknown as typeof fetch,
    random: () => ((n = (n * 31 + 7) % 101), n / 101),
    now: () => 0,
    createDriver: () => fakeDriver(),
    saveRun: vi.fn(async () => ({ id: 'r1', url: 'https://example.test/r/r1' })),
    copy: vi.fn(async () => {}),
    ...extra,
  });
}

const cfg: RunConfig = { population: 30, rumor: presetRumor('cafe-closing'), townSeed: 11, runSeed: 5, overrides: {} };
const noFetch = vi.fn(async () => {
  throw new Error('no network in this test');
});

describe('runStore', () => {
  it('goes setup → running → finished in local mode and builds a record', async () => {
    const store = makeStore(noFetch);
    expect(store.getState().phase).toBe('setup');
    await store.getState().start(cfg, 'local');
    expect(store.getState().phase).toBe('running');
    expect(store.getState().mode).toBe('local');
    expect(store.getState().driver?.play).toHaveBeenCalled();
    store.getState().endDay();
    const s = store.getState();
    expect(s.phase).toBe('finished');
    expect(s.engine?.finished).toBe(true);
    expect(s.record?.config).toEqual(cfg);
    expect(s.record?.finalHash).toBeTruthy();
    expect(s.counters.heard).toBeGreaterThan(0);
    s.dispose();
    expect(store.getState().phase).toBe('setup');
    expect(store.getState().engine).toBeNull();
  });

  it('runs live with the token from /api/runs/start', async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => json(200, START_OK));
    const store = makeStore(f);
    await store.getState().start(cfg);
    const s = store.getState();
    expect(f.mock.calls[0][0]).toBe('/api/runs/start');
    expect(JSON.parse(String(f.mock.calls[0][1]?.body)).config).toEqual(cfg);
    expect(s.phase).toBe('running');
    expect(s.mode).toBe('live');
    expect(s.runToken).toBe('tok');
    expect(s.banner).toBeNull();
    s.dispose();
  });

  it('shows the reason in the setup sheet when a rumor is blocked', async () => {
    const store = makeStore(async () => json(400, { error: 'blocked', reason: 'Please pick a kinder rumor.' }));
    await store.getState().start({ ...cfg, rumor: customRumor('something mean') });
    const s = store.getState();
    expect(s.phase).toBe('setup');
    expect(s.setupError).toBe('Please pick a kinder rumor.');
    expect(s.engine).toBeNull();
    expect(s.starting).toBe(false);
  });

  it('starts locally with a banner when the start call fails', async () => {
    const store = makeStore(async () => json(503, { error: 'unavailable' }));
    await store.getState().start(cfg);
    const s = store.getState();
    expect(s.phase).toBe('running');
    expect(s.mode).toBe('local');
    expect(s.banner).toBe(NO_LIVE_AI_TEXT);
    s.dispose();
  });

  it('starts locally with a banner when the network is down', async () => {
    const store = makeStore(noFetch);
    await store.getState().start(cfg);
    expect(store.getState().mode).toBe('local');
    expect(store.getState().banner).toBe(NO_LIVE_AI_TEXT);
    store.getState().dispose();
  });

  it('restart keeps the setup and changes the run seed', async () => {
    const store = makeStore(noFetch);
    await store.getState().start(cfg, 'local');
    await store.getState().restart();
    const s = store.getState();
    expect(s.phase).toBe('running');
    expect(s.config?.townSeed).toBe(cfg.townSeed);
    expect(s.config?.rumor).toEqual(cfg.rumor);
    expect(s.config?.runSeed).not.toBe(cfg.runSeed);
    s.dispose();
  });

  it('replays a record exactly at 2x and modify opens setup with its settings', async () => {
    const store = makeStore(noFetch);
    await store.getState().start(cfg, 'local');
    store.getState().endDay();
    const record = store.getState().record!;
    store.getState().replayRecord(record);
    expect(store.getState().mode).toBe('replay');
    expect(store.getState().speed).toBe(2);
    store.getState().endDay();
    expect(store.getState().record?.finalHash).toBe(record.finalHash);
    store.getState().modify(record);
    const s = store.getState();
    expect(s.phase).toBe('setup');
    expect(s.draft.population).toBe(cfg.population);
    expect(s.draft.runSeed).not.toBe(cfg.runSeed);
    s.dispose();
  });

  it('custom rumors are uncertain; presets keep their id and exact text', () => {
    expect(customRumor('  The mayor owns a llama.  ')).toEqual({ text: 'The mayor owns a llama.', truth: 'uncertain' });
    const p = presetRumor('cafe-closing');
    expect(p.presetId).toBe('cafe-closing');
    expect(p.text.length).toBeGreaterThan(0);
  });

  it('shares a finished run, asking for a token first when it has none', async () => {
    const saveRun = vi.fn(async () => ({ id: 'r1', url: 'https://example.test/r/r1' }));
    const store = makeStore(async () => json(200, START_OK), { saveRun });
    await store.getState().start(cfg, 'local');
    store.getState().endDay();
    expect(await store.getState().share()).toBe('https://example.test/r/r1');
    expect(saveRun).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok' }));
    store.getState().dispose();
  });

  it('returns null with a banner when sharing fails', async () => {
    const store = makeStore(async () => json(200, START_OK), {
      saveRun: vi.fn(async () => {
        throw new Error('save_failed_500');
      }),
    });
    await store.getState().start(cfg, 'local');
    store.getState().endDay();
    expect(await store.getState().share()).toBeNull();
    expect(store.getState().banner).toBe(SHARE_FAILED_TEXT);
    store.getState().dispose();
  });
});
