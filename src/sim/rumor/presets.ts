/**
 * Starter rumors come from src/data/presets.ts (the one list the UI, the server and the CLI share).
 * DEFAULT_RUMOR is what the CLI and tests use.
 */
import type { RumorSpec } from '../types';
import { PRESETS } from '../../data/presets';

export { PRESETS };
export const DEFAULT_RUMOR: RumorSpec = PRESETS[0];
