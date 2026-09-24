import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '@/sim/types';
import { RUN_NOT_FOUND_TEXT, loadPlayIntent, pickParam } from './urlParams';

const record = { id: 'abc', config: { population: 30 }, oracleLog: [] } as unknown as RunRecord;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = { kind: 'error', message: RUN_NOT_FOUND_TEXT };

afterEach(() => vi.unstubAllGlobals());

describe('pickParam', () => {
  it('prefers replay, then rerun, then modify', () => {
    expect(pickParam({ modify: 'c', rerun: 'b', replay: 'a' })).toEqual({ kind: 'replay', id: 'a' });
    expect(pickParam({ modify: 'c', rerun: 'b' })).toEqual({ kind: 'rerun', id: 'b' });
    expect(pickParam({})).toBeNull();
  });
});

describe('loadPlayIntent with a mocked fetch', () => {
  it('loads a saved run', async () => {
    const f = vi.fn<(url: string) => Promise<Response>>(async () => json(200, record));
    vi.stubGlobal('fetch', f);
    expect(await loadPlayIntent({ rerun: 'abc' })).toEqual({ kind: 'rerun', record });
    expect(f.mock.calls[0][0]).toBe('/api/runs?id=abc');
  });

  it('says the run could not be found on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { error: 'not_found' })));
    expect(await loadPlayIntent({ replay: 'nope' })).toEqual(notFound);
  });

  it('says the same on a server or network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(500, {})));
    expect(await loadPlayIntent({ modify: 'x' })).toEqual(notFound);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await loadPlayIntent({ modify: 'x' })).toEqual(notFound);
  });

  it('rejects a bad id or a malformed record', async () => {
    const f = vi.fn(async () => json(200, { nope: true }));
    vi.stubGlobal('fetch', f);
    expect(await loadPlayIntent({ replay: '../etc' })).toEqual(notFound);
    expect(f).not.toHaveBeenCalled();
    expect(await loadPlayIntent({ replay: 'ok' })).toEqual(notFound);
  });

  it('does nothing without params', async () => {
    expect(await loadPlayIntent({})).toEqual({ kind: 'none' });
  });
});
