import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/blob', () => ({ put: vi.fn(), get: vi.fn() }));

import { get, put } from '@vercel/blob';
import { GET, POST } from './route';
import { issueRunToken, resetTokenStateForTests } from '@/ai/token';
import { runsPostResponseSchema } from '@/ai/schemas';
import { clearRecordCacheForTests, loadRecord } from '@/lib/blob';
import { LocalOracle } from '@/sim/oracle/local';
import type { DecisionAnswer } from '@/sim/oracle/types';
import { DEFAULT_RUMOR } from '@/sim/rumor/presets';
import { runHeadless } from '@/sim/runHeadless';
import type { RunConfig, RunRecord } from '@/sim/types';

const putMock = vi.mocked(put);
const getMock = vi.mocked(get);

const config: RunConfig = { population: 30, rumor: DEFAULT_RUMOR, townSeed: 11, runSeed: 5, overrides: {} };
let client: RunRecord;
let dir: string;
let n = 0;

const token = () => issueRunToken({ runId: `run-test-${++n}-abcdef` });
const body = (over: Record<string, unknown> = {}) => ({
  token: token(),
  config: client.config,
  oracleLog: client.oracleLog,
  finalHash: client.finalHash,
  ...over,
});

function post(b: unknown, ip = `10.1.0.${++n % 250}`): Request {
  return new Request('http://localhost:3000/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof b === 'string' ? b : JSON.stringify(b),
  });
}
const getReq = (id: string) => new Request(`http://localhost:3000/api/runs?id=${encodeURIComponent(id)}`);

beforeAll(() => {
  client = runHeadless(config, new LocalOracle({ seed: config.runSeed }));
  dir = mkdtempSync(path.join(tmpdir(), 'rumor-runs-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.RUNS_DATA_DIR;
});
beforeEach(() => {
  resetTokenStateForTests();
  clearRecordCacheForTests();
  putMock.mockReset();
  getMock.mockReset();
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.RUNS_STORE;
  process.env.RUNS_DATA_DIR = dir;
});

describe('POST /api/runs', () => {
  it('400 on a bad body, 401 without a good token', async () => {
    expect((await POST(post('not json'))).status).toBe(400);
    expect((await POST(post({ ...body(), finalHash: 3 }))).status).toBe(400);
    const noToken = await POST(post({ config, oracleLog: [], finalHash: 'abcdefgh' }));
    expect(noToken.status).toBe(401);
    expect(await noToken.json()).toEqual({ code: 'token' });
    expect((await POST(post(body({ token: 'x'.repeat(40) })))).status).toBe(401);
  });

  it('413 when the body is over 200 KB', async () => {
    const res = await POST(post({ ...body(), pad: 'x'.repeat(210 * 1024) }));
    expect(res.status).toBe(413);
  });

  it('replays the log, stores the record on disk, and serves it back', async () => {
    const t0 = Date.now();
    const res = await POST(post(body()));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(res.status).toBe(200);
    const { id, url } = runsPostResponseSchema.parse(await res.json());
    expect(id).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(url).toBe(`http://localhost:3000/r/${id}`);
    expect(putMock).not.toHaveBeenCalled();

    clearRecordCacheForTests();
    const stored = await loadRecord(id);
    expect(stored?.stats).toEqual(client.stats);
    expect(stored?.finalHash).toBe(client.finalHash);
    expect(stored?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    const got = await GET(getReq(id));
    expect(got.status).toBe(200);
    const rec = (await got.json()) as RunRecord;
    expect(rec.id).toBe(id);
    expect(rec.stats).toEqual(client.stats);
    expect(rec.series).toEqual(client.series);
  });

  it('returns the same id when the same run is saved twice', async () => {
    const t = token();
    const a = await (await POST(post(body({ token: t })))).json();
    const b = await (await POST(post(body({ token: t })))).json();
    expect(b.id).toBe(a.id);
  });

  it('rejects a tampered log or hash', async () => {
    const log = structuredClone(client.oracleLog);
    const i = log.findIndex((e) => e.kind === 'decide');
    const ans = log[i].response as DecisionAnswer;
    log[i].response = { ...ans, mention: ans.mention > 0.5 ? 0 : 1, willShare: ans.willShare > 0.5 ? 0 : 1 };
    const tampered = await POST(post(body({ oracleLog: log })));
    expect([400, 409]).toContain(tampered.status);

    const cut = await POST(post(body({ oracleLog: client.oracleLog.slice(0, 5) })));
    expect([400, 409]).toContain(cut.status);

    const wrongHash = await POST(post(body({ finalHash: 'deadbeefdeadbeef' })));
    expect(wrongHash.status).toBe(409);
    expect(await wrongHash.json()).toEqual({ code: 'hash_mismatch' });
  });

  it('uses private Vercel Blob when a token is set', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token';
    putMock.mockResolvedValue({} as never);
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(putMock).toHaveBeenCalledTimes(1);
    const [pathname, content, opts] = putMock.mock.calls[0];
    expect(pathname).toBe(`runs/${id}.json`);
    expect(opts).toMatchObject({ access: 'private', addRandomSuffix: false, contentType: 'application/json' });

    clearRecordCacheForTests();
    getMock.mockResolvedValue({ statusCode: 200, stream: new Response(content as string).body } as never);
    const got = await GET(getReq(id));
    expect(got.status).toBe(200);
    expect(getMock).toHaveBeenCalledWith(`runs/${id}.json`, { access: 'private' });

    getMock.mockResolvedValue(null);
    expect((await GET(getReq('ZZZZZZZZZZ'))).status).toBe(404);
  });

  it('500 when the store fails', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token';
    putMock.mockRejectedValue(new Error('store down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await POST(post(body()))).status).toBe(500);
    spy.mockRestore();
  });
});

describe('GET /api/runs', () => {
  it('404 when missing, 400 on a bad id', async () => {
    const missing = await GET(getReq('AAAAAAAAAA'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ code: 'not_found' });
    expect((await GET(getReq('../etc/passwd'))).status).toBe(400);
    expect((await GET(getReq(''))).status).toBe(400);
  });
});
