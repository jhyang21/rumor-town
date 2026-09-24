/**
 * /play URL params: ?replay=<id> plays a saved run exactly, ?rerun=<id> runs its setup again with a
 * new run seed, ?modify=<id> opens setup prefilled. A missing run shows a plain note and the setup.
 */
import type { RunRecord } from '@/sim/types';
import { fetchRun } from '@/lib/runsClient';

export const RUN_NOT_FOUND_TEXT = 'That run could not be found.';

export interface PlayParams {
  replay?: string;
  rerun?: string;
  modify?: string;
}

export type PlayIntent =
  | { kind: 'none' }
  | { kind: 'replay' | 'rerun' | 'modify'; record: RunRecord }
  | { kind: 'error'; message: string };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function pickParam(params: PlayParams): { kind: 'replay' | 'rerun' | 'modify'; id: string } | null {
  for (const kind of ['replay', 'rerun', 'modify'] as const) {
    const id = params[kind];
    if (typeof id === 'string' && id.length > 0) return { kind, id };
  }
  return null;
}

export async function loadPlayIntent(
  params: PlayParams,
  load: (id: string) => Promise<RunRecord | null> = fetchRun,
): Promise<PlayIntent> {
  const p = pickParam(params);
  if (!p) return { kind: 'none' };
  if (!ID_RE.test(p.id)) return { kind: 'error', message: RUN_NOT_FOUND_TEXT };
  try {
    const record = await load(p.id);
    if (!record || !record.config || !Array.isArray(record.oracleLog)) return { kind: 'error', message: RUN_NOT_FOUND_TEXT };
    return { kind: p.kind, record };
  } catch {
    return { kind: 'error', message: RUN_NOT_FOUND_TEXT };
  }
}
