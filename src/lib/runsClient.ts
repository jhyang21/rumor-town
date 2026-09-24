/**
 * Browser-side helpers for saving and loading runs. The server (src/app/api/runs) replays the
 * oracle log itself and stores its own derived record; the client sends only config + log + hash.
 */
import type { RunConfig, RunRecord } from '@/sim/types';
import type { OracleLogEntry } from '@/sim/oracle/types';

export interface SaveRunInput {
  token: string;
  config: RunConfig;
  oracleLog: OracleLogEntry[];
  finalHash: string;
}

export interface SaveRunResult {
  id: string;
  url: string; // absolute share URL
}

export async function saveRun(input: SaveRunInput): Promise<SaveRunResult> {
  const res = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    throw new Error(body.code ?? `save_failed_${res.status}`);
  }
  return (await res.json()) as SaveRunResult;
}

export async function fetchRun(id: string): Promise<RunRecord | null> {
  const res = await fetch(`/api/runs?id=${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`load_failed_${res.status}`);
  return (await res.json()) as RunRecord;
}
