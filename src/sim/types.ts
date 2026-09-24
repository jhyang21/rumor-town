/**
 * Core domain types for the Rumor Town simulation.
 * This file is a CONTRACT shared by the engine, the AI layer, the renderer and the UI.
 * Change it only with the lead's approval.
 *
 * Conventions
 * - Time is measured in ticks. 1 tick = 1 simulated minute. Tick 0 = 8:00 AM, tick 720 = 8:00 PM.
 * - Every scalar that feeds a decision is an integer 0..1000 (never a float) so replays are bit-identical.
 * - Character ids are small integers 0..population-1. Location ids are short strings ("cafe", "home3").
 */

import type { OracleLogEntry } from './oracle/types';

export const DAY_START_TICK = 0;
export const DAY_END_TICK = 720; // 8:00 PM
export const QUIET_END_TICKS = 90; // end early after this many rumor-quiet minutes
export const FADING_TICKS = 60; // "rumor is fading" milestone

export type Population = 30 | 50 | 75;
export type TruthState = 'true' | 'false' | 'uncertain';

export type Occupation =
  | 'student'
  | 'teacher'
  | 'cafe_worker'
  | 'shopkeeper'
  | 'office_worker'
  | 'retiree'
  | 'delivery_worker';

export type ArchetypeId =
  | 'social_butterfly'
  | 'skeptic'
  | 'gossip'
  | 'quiet_observer'
  | 'fact_checker'
  | 'trusting_friend'
  | 'contrarian'
  | 'cautious_sharer'
  | 'connector'
  | 'newcomer'
  | 'authority'
  | 'average';

/** All traits are integers 0..1000. */
export interface Traits {
  sociability: number;
  skepticism: number;
  shareWillingness: number;
  verifyTendency: number;
}

export type RelationshipKind = 'family' | 'coworker' | 'classmate' | 'friend' | 'neighbor' | 'acquaintance';

export interface Relationship {
  otherId: number;
  kind: RelationshipKind;
  /** closeness 0..1000 */
  strength: number;
  /** trust toward the other person 0..1000 (asymmetric) */
  trust: number;
}

export type LocationKind = 'home' | 'cafe' | 'school' | 'office' | 'store' | 'park' | 'square';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A place in town. `footprint` tiles are blocked; `zone` tiles are where occupants stand and idle. */
export interface LocationSpec {
  id: string;
  kind: LocationKind;
  label: string;
  footprint: Rect | null;
  zone: Rect;
  /** tile in front of the door where paths end (must be walkable) */
  door: { x: number; y: number };
  /** homes only: occupants may go inside (hidden) after 19:00 */
  canGoInside?: boolean;
}

export type Facing = 'down' | 'up' | 'left' | 'right';

/** Public belief bands (the only belief representation the UI may show). */
export type BeliefBand = 'rejects' | 'skeptical' | 'unsure' | 'believes' | 'strongly_believes';

export function beliefBand(belief: number): BeliefBand {
  if (belief < 150) return 'rejects';
  if (belief < 400) return 'skeptical';
  if (belief < 600) return 'unsure';
  if (belief < 850) return 'believes';
  return 'strongly_believes';
}

export type MutationClass = 'unchanged' | 'shortened' | 'softened' | 'strengthened' | 'distorted' | 'corrected';

/** One meaningful version of the rumor. Nodes form a tree rooted at the original. */
export interface VariantNode {
  id: string; // "v0" is the original
  parentId: string | null;
  mutation: MutationClass; // how it differs from its parent ("unchanged" for the root)
  /** -2 (very hedged) .. +2 (stated as certain) */
  claimStrength: number;
  /** short contextual details added by distortions, max 2 */
  details: string[];
  /** true when this node carries verified/authoritative information */
  corrected: boolean;
  text: string;
  firstAuthorId: number;
  createdTick: number;
  heardCount: number;
  repeatedCount: number;
}

/** What a character currently knows about the rumor. null until they first hear it. */
export interface RumorKnowledge {
  variantId: string;
  heardFromId: number | null; // null for the starter
  heardAtTick: number;
  exposures: number;
  /** distinct people they heard it from (source independence) */
  sourceIds: number[];
  belief: number; // 0..1000
  sharedWithIds: number[];
  timesChallenged: number;
  verified: 'none' | 'confirmed' | 'debunked';
  knowsCorrection: boolean;
}

export type Activity = 'walking' | 'idle' | 'meeting' | 'inside';

export interface Character {
  id: number;
  name: string;
  occupation: Occupation;
  archetype: ArchetypeId;
  /** one short sentence used in prompts, e.g. "chatty retiree who loves news" */
  persona: string;
  homeId: string;
  workplaceId: string | null;
  traits: Traits;
  relationships: Relationship[];
  /** sprite variation indices chosen at generation: hair style, palette slots */
  look: { hair: number; skin: number; shirt: number; pants: number };
}

/** Mutable per-character simulation state (separate from the immutable Character). */
export interface CharacterState {
  id: number;
  x: number; // tile coords, integer
  y: number;
  facing: Facing;
  activity: Activity;
  locationId: string; // where they currently are / are heading
  path: Array<{ x: number; y: number }>; // remaining path
  rumor: RumorKnowledge | null;
  /** tick until which this character will not start a rumor talk */
  rumorCooldownUntil: number;
  meetingId: number | null;
}

export interface ScheduleEntry {
  startTick: number;
  locationId: string;
}

export interface Meeting {
  id: number;
  aId: number; // speaker for rumor meetings
  bId: number;
  startTick: number;
  endTick: number; // startTick + seeded duration 6..9
  rumorRelevant: boolean;
  decisionRequestId: number | null;
  speechRequestId: number | null;
  /** filled after the decision applies */
  decided: boolean;
  spoken: boolean;
}

/* ---------- Events ---------- */

export type SimEventType =
  | 'transmission' // listener heard the rumor (first time or again)
  | 'mutation' // a new variant node was created
  | 'challenge'
  | 'verification'
  | 'correction_spread'
  | 'milestone';

export type MilestoneKind =
  | 'first_transmission'
  | 'first_mutation'
  | 'heard_25'
  | 'heard_50'
  | 'heard_75'
  | 'first_correction'
  | 'new_dominant_variant'
  | 'major_contradiction'
  | 'fading'
  | 'ended';

export interface SimEvent {
  tick: number;
  type: SimEventType;
  milestone?: MilestoneKind;
  /** one plain sentence for the timeline, written by the engine (no AI) */
  text: string;
  characterIds: number[];
  locationId?: string;
  variantId?: string;
}

export interface Conversation {
  meetingId: number;
  tick: number;
  aId: number;
  bId: number;
  rumorRelevant: boolean;
  lines: Array<{ speakerId: number; text: string }>;
  variantId?: string;
}

/* ---------- Run configuration and results ---------- */

export interface RumorSpec {
  text: string;
  truth: TruthState;
  presetId?: string;
  /** authoritative statement a verifier learns; presets ship one, custom rumors get one from GPT */
  verifiedText?: string;
}

export interface RunOverrides {
  /** -2..2, shifts every character's skepticism by 200 per step (clamped) */
  skepticismBias?: number;
  /** -2..2, same for sociability */
  sociabilityBias?: number;
  /** who starts the rumor; default chosen by the engine from townSeed */
  starterId?: number;
}

export interface RunConfig {
  population: Population;
  rumor: RumorSpec;
  townSeed: number;
  runSeed: number;
  overrides: RunOverrides;
}

export interface SeriesPoint {
  tick: number;
  heard: number;
  believing: number; // believes or strongly_believes
  shared: number; // has shared at least once
}

export interface RunStats {
  population: number;
  heard: number;
  believed: number; // final band believes/strongly_believes
  shared: number;
  rejected: number; // final band rejects
  rumorConversations: number;
  variantCount: number;
  longestChain: number;
  mostWidespreadVariantId: string;
  mostChangedVariantId: string;
  firstCorrectionTick: number | null;
  dominantBelief: BeliefBand;
  endedAtTick: number;
  endReason: 'day_over' | 'quiet';
  gptCalls: number;
  jevCalls: number;
}

/** Everything needed to reproduce and display a finished run. Stored in Blob as runs/{id}.json. */
export interface RunRecord {
  id: string;
  version: 1;
  config: RunConfig;
  oracleLog: OracleLogEntry[];
  stats: RunStats;
  events: SimEvent[];
  conversations: Conversation[];
  variants: VariantNode[];
  series: SeriesPoint[];
  finalHash: string;
  createdAt: string; // ISO, set by the server
}

export function formatTick(tick: number): string {
  const total = 8 * 60 + tick;
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
