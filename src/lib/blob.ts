/**
 * Run record storage (server only). Used by /api/runs and the /r/[id] share page.
 *
 * - With BLOB_READ_WRITE_TOKEN: Vercel Blob at `runs/{id}.json`, access 'private' (the store must be a
 *   private store; set RUNS_BLOB_ACCESS=public only if the project's store is public). Reads go through
 *   the server, so a record is visible only through /r/{id} and /api/runs?id=.
 * - Without it (local dev and tests): JSON files under `.data/runs/` (git-ignored), or RUNS_DATA_DIR.
 * - RUNS_STORE=disk forces the disk store even when a Blob token exists.
 *
 * A small in-memory LRU keeps the last 50 records so the share page and its OG image do not read
 * the store twice.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { get, put } from '@vercel/blob';
import type { RunRecord } from '@/sim/types';

export const RUN_ID_RE = /^[0-9A-Za-z]{10}$/;
const LRU_MAX = 50;
const lru = new Map<string, RunRecord>();

function remember(record: RunRecord): void {
  lru.delete(record.id);
  lru.set(record.id, record);
  while (lru.size > LRU_MAX) {
    const oldest = lru.keys().next().value;
    if (oldest === undefined) break;
    lru.delete(oldest);
  }
}

function storeKind(): 'blob' | 'disk' {
  if (process.env.RUNS_STORE === 'disk') return 'disk';
  return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'disk';
}

function blobAccess(): 'private' | 'public' {
  return process.env.RUNS_BLOB_ACCESS === 'public' ? 'public' : 'private';
}

function diskDir(): string {
  return process.env.RUNS_DATA_DIR || path.join(process.cwd(), '.data', 'runs');
}

const blobPath = (id: string) => `runs/${id}.json`;

export async function saveRecord(record: RunRecord): Promise<void> {
  if (!RUN_ID_RE.test(record.id)) throw new Error('saveRecord: bad id');
  const body = JSON.stringify(record);
  if (storeKind() === 'blob') {
    await put(blobPath(record.id), body, {
      access: blobAccess(),
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } else {
    const dir = diskDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${record.id}.json`), body, { encoding: 'utf8', flag: 'wx' });
  }
  remember(record);
}

/** The stored record, or null when the id is malformed or nothing is stored under it. */
export async function loadRecord(id: string): Promise<RunRecord | null> {
  if (!RUN_ID_RE.test(id)) return null;
  const hit = lru.get(id);
  if (hit) {
    remember(hit);
    return hit;
  }
  const text = storeKind() === 'blob' ? await readBlob(id) : await readDisk(id);
  if (text === null) return null;
  let record: RunRecord;
  try {
    record = JSON.parse(text) as RunRecord;
  } catch {
    return null;
  }
  if (record?.version !== 1 || record.id !== id) return null;
  remember(record);
  return record;
}

async function readBlob(id: string): Promise<string | null> {
  const res = await get(blobPath(id), { access: blobAccess() });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return await new Response(res.stream).text();
}

async function readDisk(id: string): Promise<string | null> {
  try {
    return await readFile(path.join(diskDir(), `${id}.json`), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A new record id: 10 unbiased base62 characters (rejection sampling on random bytes). */
export function newRunId(): string {
  let out = '';
  while (out.length < 10) {
    for (const b of randomBytes(16)) {
      if (b < 248) out += BASE62[b % 62];
      if (out.length === 10) break;
    }
  }
  return out;
}

/** One saved record per run token, so a retried save returns the same id. Per instance only. */
const savedByRun = new Map<string, string>();

export function savedIdFor(runId: string): string | undefined {
  return savedByRun.get(runId);
}

export function markSaved(runId: string, id: string): void {
  savedByRun.set(runId, id);
  if (savedByRun.size > 5_000) {
    const oldest = savedByRun.keys().next().value;
    if (oldest !== undefined) savedByRun.delete(oldest);
  }
}

/** Test helper: forget cached records and saved-run ids. */
export function clearRecordCacheForTests(): void {
  lru.clear();
  savedByRun.clear();
}
