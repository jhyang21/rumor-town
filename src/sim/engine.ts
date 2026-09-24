/**
 * The Rumor Town engine. Synchronous, pure, deterministic: the same RunConfig plus the same oracle
 * answers give the same hashes on every machine and at every playback speed.
 *
 * Oracle flow
 * - The engine issues DecisionRequests and SpeechRequests; the caller answers them with `deliver`.
 * - Answers are buffered and applied at the request's DEADLINE tick, in requestId order, never on
 *   arrival. That is what makes live play and replay identical.
 * - `canStep()` is false while any request whose deadline has come is still unanswered.
 *
 * Streams: townSeed -> `town` (people) and `schedule` (day plans). runSeed -> `encounter` (gates),
 * `smalltalk` (canned lines), `meeting` (durations, outcome rolls, details, verification delays) and
 * `schedule` (idle spots and shuffling).
 */
import type {
  Character,
  CharacterState,
  Conversation,
  Meeting,
  Relationship,
  RumorKnowledge,
  RunConfig,
  RunStats,
  SeriesPoint,
  SimEvent,
  VariantNode,
} from './types';
import { DAY_END_TICK, QUIET_END_TICKS, beliefBand, formatTick } from './types';
import type {
  ConversationSpeechAnswer,
  ConversationSpeechRequest,
  DecisionAnswer,
  DecisionRequest,
  OracleLogEntry,
  OracleSource,
  PairContext,
  SpeechAnswer,
  SpeechRequest,
  VerificationSpeechAnswer,
  VerificationSpeechRequest,
} from './oracle/types';
import { createStreams, probToBool, type Streams } from './rng';
import { acquaintance, generateTown, pickStarter } from './people/generate';
import { ARCHETYPE_BY_ID, traitLabel } from './people/archetypes';
import { buildSchedules, targetAt, type DayPlan } from './schedule';
import { LOCATION_BY_ID } from './town/mapSpec';
import { chooseSpot, faceEachOther, headTo, stepAlongPath, standable, wander } from './movement';
import { chebyshev, chooseSpeaker, gateChance, pairKey, type SpeakerView } from './encounters';
import { smallTalkLines } from './smalltalk';
import { VariantLattice, CORRECTION_KEY, type RetellPlan } from './rumor/variants';
import { applyDecision, firstHearingBelief } from './rumor/belief';
import { applyVerification, verificationDelay, type PendingVerification } from './rumor/verification';
import { MILESTONE_TEXT, MilestoneTracker, milestoneEvent } from './events';
import { SERIES_EVERY, computeStats, seriesPoint } from './stats';
import { fnv1a } from './hash';
import { maxSpeechFor, TUNING } from './tuning';
import { OCCUPATION_WORD, clip, placeLabel, placePhrase, relationshipWord, shortRelationship } from './words';
import { variantWording, verificationText } from './oracle/local';

export type SignalKind = '!' | '?' | '✓';

export interface Bubble {
  speakerId: number;
  text: string;
  fromTick: number;
  untilTick: number;
}

export interface Signal {
  id: number; // character id
  kind: SignalKind;
  untilTick: number;
}

export interface EngineSnapshot {
  tick: number;
  finished: boolean;
  characters: readonly Character[];
  states: readonly CharacterState[];
  meetings: readonly Meeting[];
  bubbles: readonly Bubble[];
  signals: readonly Signal[];
  variants: readonly VariantNode[];
  events: readonly SimEvent[];
  conversations: readonly Conversation[];
}

type AnyRequest = DecisionRequest | SpeechRequest;
type AnyAnswer = DecisionAnswer | SpeechAnswer;

interface Outstanding {
  req: AnyRequest;
  deadline: number;
}

interface MeetingRec {
  m: Meeting;
  kind: 'rumor' | 'small';
  releaseTick: number;
  // rumor meetings, filled at decision time
  mention?: boolean;
  answer?: DecisionAnswer;
  challenge?: boolean;
  willShare?: boolean;
  verify?: boolean;
  isCorrection?: boolean;
  plan?: RetellPlan;
  toldFromText?: string;
}

interface Inner {
  wantsToShare: boolean;
  toldRumor: Set<number>;
  toldCorrection: Set<number>;
  hasVerified: boolean;
  verifyPending: boolean;
  wanderAt: number;
}

export class Engine {
  readonly config: RunConfig;
  readonly characters: readonly Character[];
  readonly starterId: number;
  readonly states: CharacterState[];
  readonly plans: readonly DayPlan[];

  tick = 0;
  finished = false;
  endReason: 'day_over' | 'quiet' | null = null;

  readonly series: SeriesPoint[] = [];
  readonly hashes: string[] = [];
  readonly events: SimEvent[] = [];
  readonly conversations: Conversation[] = [];

  private readonly streams: Streams;
  private readonly rel: Array<Map<number, Relationship>>;
  private readonly inner: Inner[];
  private readonly lattice: VariantLattice;
  private readonly milestones = new MilestoneTracker();

  private readonly outstanding = new Map<number, Outstanding>();
  private readonly answers = new Map<number, { answer: AnyAnswer; source: OracleSource }>();
  private readonly log: OracleLogEntry[] = [];
  private readonly meetings = new Map<number, MeetingRec>();
  private readonly verifications: PendingVerification[] = [];
  private readonly verificationTexts = new Map<number, string>();
  private readonly rumorCooldown = new Map<number, number>();
  private readonly smallCooldown = new Map<number, number>();
  private bubbles: Bubble[] = [];
  private signals: Signal[] = [];

  private nextRequestId = 0;
  private nextMeetingId = 0;
  private decisionsIssued = 0;
  private speechIssued = 0;
  private speechReserved = 0;
  private logBytesEstimate = 0;
  private rumorMeetingsInFlight = 0;
  private lastRumorActivity = 0;
  private firstTransmissionTick: number | null = null;
  private firstCorrectionTick: number | null = null;
  private final: string | null = null;

  constructor(config: RunConfig) {
    this.config = config;
    this.characters = generateTown(config);
    this.plans = buildSchedules(config.townSeed, this.characters);
    this.streams = createStreams(config.runSeed);
    this.starterId = pickStarter(config, this.characters);
    this.rel = this.characters.map((c) => new Map(c.relationships.map((r) => [r.otherId, r])));
    this.lattice = new VariantLattice(clip(config.rumor.text, 240), this.starterId, config.rumor.truth !== 'true');

    // everyone starts idle at home
    const occupied = new Map<string, Array<{ x: number; y: number }>>();
    this.states = this.characters.map((c) => {
      const loc = LOCATION_BY_ID[c.homeId];
      const occ = occupied.get(loc.id) ?? [];
      const spot = chooseSpot(loc, this.streams.schedule, occ);
      occ.push(spot);
      occupied.set(loc.id, occ);
      return {
        id: c.id,
        x: spot.x,
        y: spot.y,
        facing: 'down',
        activity: 'idle',
        locationId: loc.id,
        path: [],
        rumor: null,
        rumorCooldownUntil: 0,
        meetingId: null,
      } satisfies CharacterState;
    });
    this.inner = this.characters.map(() => ({
      wantsToShare: false,
      toldRumor: new Set<number>(),
      toldCorrection: new Set<number>(),
      hasVerified: false,
      verifyPending: false,
      wanderAt: this.streams.schedule.int(TUNING.wanderMinTicks, TUNING.wanderMaxTicks),
    }));
    const s = this.states[this.starterId];
    s.rumor = {
      variantId: 'v0',
      heardFromId: null,
      heardAtTick: 0,
      exposures: 1,
      sourceIds: [],
      belief: TUNING.starterBelief,
      sharedWithIds: [],
      timesChallenged: 0,
      verified: 'none',
      knowsCorrection: false,
    };
    this.inner[this.starterId].wantsToShare = true;
    this.lattice.markHeard('v0', this.starterId);
  }

  /* ================= public API ================= */

  /** Issued requests that have no answer yet (idempotent: callers track what they already sent). */
  pendingRequests(): Array<DecisionRequest | SpeechRequest> {
    if (this.finished) return [];
    const out: AnyRequest[] = [];
    for (const [id, o] of this.outstanding) if (!this.answers.has(id)) out.push(o.req);
    out.sort((a, b) => a.requestId - b.requestId);
    return out;
  }

  deadlineOf(requestId: number): number | undefined {
    return this.outstanding.get(requestId)?.deadline;
  }

  canStep(): boolean {
    if (this.finished) return false;
    for (const [id, o] of this.outstanding) if (o.deadline <= this.tick && !this.answers.has(id)) return false;
    return true;
  }

  /** Buffer an answer. Returns false when the request is unknown, already answered or already applied. */
  deliver(requestId: number, answer: AnyAnswer, source: OracleSource): boolean {
    const o = this.outstanding.get(requestId);
    if (!o || this.answers.has(requestId)) return false;
    this.answers.set(requestId, { answer, source });
    const entry: OracleLogEntry = {
      requestId,
      kind: o.req.kind === 'encounter' ? 'decide' : 'speak',
      request: o.req,
      response: answer,
      source,
    };
    let i = this.log.length;
    while (i > 0 && this.log[i - 1].requestId > requestId) i--;
    this.log.splice(i, 0, entry);
    return true;
  }

  /** Every delivered answer, sorted by requestId. */
  get oracleLog(): readonly OracleLogEntry[] {
    return this.log;
  }

  step(): void {
    if (this.finished) throw new Error('engine: run is finished');
    if (!this.canStep()) throw new Error(`engine: tick ${this.tick} is waiting for an oracle answer`);
    const t = this.tick;
    this.applyDueAnswers(t);
    this.runVerifications(t);
    this.releaseMeetings(t);
    this.moveEveryone(t);
    this.encounters(t);
    this.bubbles = this.bubbles.filter((b) => b.untilTick > t);
    this.signals = this.signals.filter((s) => s.untilTick > t);
    const quiet = this.trackQuiet(t);
    this.observeMilestones(t, quiet);
    if (t % SERIES_EVERY === 0) {
      this.series.push(seriesPoint(t, this.states));
      this.hashes.push(this.hashState());
    }
    this.tick = t + 1;
    if (this.tick >= DAY_END_TICK) this.finish('day_over');
    else if (quiet >= QUIET_END_TICKS && this.tick >= TUNING.quietEndEarliestTick) this.finish('quiet');
  }

  snapshot(): EngineSnapshot {
    const t = this.tick;
    return {
      tick: t,
      finished: this.finished,
      characters: this.characters,
      states: this.states,
      meetings: [...this.meetings.values()].map((r) => r.m),
      bubbles: this.bubbles.filter((b) => b.fromTick <= t && b.untilTick > t),
      signals: this.signals,
      variants: this.lattice.nodes,
      events: this.events,
      conversations: this.conversations,
    };
  }

  stats(): RunStats {
    return computeStats({
      states: this.states,
      lattice: this.lattice,
      rumorConversations: this.conversations.length,
      firstCorrectionTick: this.firstCorrectionTick,
      endedAtTick: this.tick,
      endReason: this.endReason ?? 'day_over',
      gptCalls: this.speechIssued,
      jevCalls: this.decisionsIssued,
    });
  }

  get variants(): readonly VariantNode[] {
    return this.lattice.nodes;
  }

  finalHash(): string {
    return this.final ?? this.hashState();
  }

  /* ================= oracle application ================= */

  private applyDueAnswers(t: number): void {
    const due: number[] = [];
    for (const [id, o] of this.outstanding) if (o.deadline === t) due.push(id);
    due.sort((a, b) => a - b);
    for (const id of due) {
      const o = this.outstanding.get(id)!;
      const a = this.answers.get(id)!.answer;
      this.outstanding.delete(id);
      this.answers.delete(id);
      if (o.req.kind === 'encounter') this.applyDecision(t, o.req, a as DecisionAnswer);
      else if (o.req.kind === 'conversation') this.applySpeech(t, o.req, a as ConversationSpeechAnswer);
      else this.verificationTexts.set(id, cleanText((a as VerificationSpeechAnswer).authoritativeText, 240));
    }
  }

  private issue(req: AnyRequest, deadline: number): void {
    this.outstanding.set(req.requestId, { req, deadline });
    // deterministic estimate of the uploaded log size: request JSON plus a fixed allowance per answer
    this.logBytesEstimate += JSON.stringify(req).length + (req.kind === 'encounter' ? TUNING.decisionAnswerBytes : TUNING.speechAnswerBytes);
  }

  /* ================= meetings ================= */

  private startRumorMeeting(t: number, speakerId: number, listenerId: number): void {
    const rng = this.streams.meeting;
    const D = rng.int(TUNING.meetingMinTicks, TUNING.meetingMaxTicks);
    const requestId = this.nextRequestId++;
    const m: Meeting = {
      id: this.nextMeetingId++,
      aId: speakerId,
      bId: listenerId,
      startTick: t,
      endTick: t + D,
      rumorRelevant: true,
      decisionRequestId: requestId,
      speechRequestId: null,
      decided: false,
      spoken: false,
    };
    this.meetings.set(m.id, { m, kind: 'rumor', releaseTick: t + D });
    this.rumorMeetingsInFlight++;
    this.decisionsIssued++;
    this.speechReserved++;
    this.lastRumorActivity = t;
    this.joinMeeting(m);
    this.bubbles.push({ speakerId, text: '…', fromTick: t, untilTick: t + TUNING.decisionDelay });
    const req: DecisionRequest = { requestId, kind: 'encounter', tick: t, meetingId: m.id, pair: this.pairContext(t, speakerId, listenerId) };
    this.issue(req, t + TUNING.decisionDelay);
  }

  private startSmallTalk(t: number, aId: number, bId: number): void {
    const m: Meeting = {
      id: this.nextMeetingId++,
      aId,
      bId,
      startTick: t,
      endTick: t + TUNING.smalltalkTicks,
      rumorRelevant: false,
      decisionRequestId: null,
      speechRequestId: null,
      decided: true,
      spoken: true,
    };
    this.meetings.set(m.id, { m, kind: 'small', releaseTick: m.endTick });
    this.joinMeeting(m);
    const lines = smallTalkLines(this.streams.smalltalk, aId, bId);
    this.queueLines(t, lines, 2);
  }

  private joinMeeting(m: Meeting): void {
    const a = this.states[m.aId];
    const b = this.states[m.bId];
    for (const s of [a, b]) {
      s.activity = 'meeting';
      s.meetingId = m.id;
      s.path = [];
    }
    faceEachOther(a, b);
  }

  private queueLines(t: number, lines: ReadonlyArray<{ speakerId: number; text: string }>, gap: number): number {
    for (let i = 0; i < lines.length; i++) {
      this.bubbles.push({ speakerId: lines[i].speakerId, text: lines[i].text, fromTick: t + i * gap, untilTick: t + (i + 1) * gap + (i === lines.length - 1 ? 1 : 0) });
    }
    return t + lines.length * gap;
  }

  private releaseMeetings(t: number): void {
    const ids = [...this.meetings.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const r = this.meetings.get(id)!;
      if (r.releaseTick > t) continue;
      // a rumor meeting whose speech has not been applied yet stays open
      if (r.kind === 'rumor' && r.mention && !r.m.spoken) continue;
      this.meetings.delete(id);
      const k = pairKey(r.m.aId, r.m.bId);
      if (r.kind === 'rumor') {
        this.rumorMeetingsInFlight--;
        this.rumorCooldown.set(k, t + TUNING.rumorPairCooldown);
        this.lastRumorActivity = t;
      } else this.smallCooldown.set(k, t + TUNING.smalltalkCooldown);
      for (const cid of [r.m.aId, r.m.bId]) {
        const s = this.states[cid];
        s.activity = 'idle';
        s.meetingId = null;
        if (r.kind === 'rumor') s.rumorCooldownUntil = t + TUNING.characterRumorCooldown;
      }
    }
  }

  private applyDecision(t: number, req: DecisionRequest, raw: DecisionAnswer): void {
    const rec = this.meetings.get(req.meetingId);
    if (!rec) return;
    const a = sanitizeDecision(raw);
    const rng = this.streams.meeting;
    const m = rec.m;
    m.decided = true;
    rec.answer = a;
    rec.mention = probToBool(rng, a.mention);
    if (!rec.mention) {
      this.speechReserved--;
      const lines = smallTalkLines(this.streams.smalltalk, m.aId, m.bId);
      const gap = Math.max(1, Math.trunc((m.endTick - t) / 2));
      this.queueLines(t, lines, gap);
      return;
    }
    const S = this.states[m.aId];
    const L = this.states[m.bId];
    const listener = this.characters[m.bId];
    const sk = S.rumor!;
    rec.challenge = probToBool(rng, a.challenges);
    // Jev does not see the listener's own willingness to share, so the engine scales by it:
    // per-mille = round(p * 1000) * (500 + shareWillingness) / 1000
    const wsPm = Math.min(1000, Math.trunc((Math.round(a.willShare * 1000) * (500 + listener.traits.shareWillingness)) / 1000));
    rec.willShare = rng.int(0, 999) < wsPm;
    rec.verify = probToBool(rng, a.verify);
    rec.isCorrection = sk.knowsCorrection;
    rec.toldFromText = this.lattice.get(sk.variantId).text;
    if (rec.isCorrection) {
      const cid = this.lattice.correctionNodeId() ?? sk.variantId;
      rec.plan = { key: CORRECTION_KEY, mutation: 'unchanged', parentId: cid, nodeId: cid };
      rec.toldFromText = this.lattice.get(cid).text;
    } else {
      rec.plan = this.lattice.planRetelling(sk.variantId, a.retelling, rng, false);
    }

    // signals right away
    const until = t + TUNING.signalTicks;
    if (!L.rumor) this.signals.push({ id: m.bId, kind: '!', untilTick: until });
    if (rec.challenge) this.signals.push({ id: m.bId, kind: '?', untilTick: until });
    if (rec.isCorrection) this.signals.push({ id: m.bId, kind: '✓', untilTick: until });

    // projected belief change for the speech flags
    const { before, after } = this.projectBelief(m.aId, m.bId, rec);
    const gain = rec.isCorrection ? before - after : after - before;
    const flags = { challenges: rec.challenge, listenerConvinced: gain >= 60, listenerDoubts: rec.challenge || gain <= -30 };

    const plan = rec.plan;
    const from = this.lattice.get(plan.parentId);
    const newVariant: ConversationSpeechRequest['newVariant'] =
      plan.nodeId === null
        ? {
            mutation: plan.mutation,
            parentText: from.text,
            claimStrength: plan.key.claimStrength,
            details: plan.key.details.slice(),
            ...(plan.key.corrected ? { correctionText: this.correctionText() } : {}),
          }
        : null;

    const requestId = this.nextRequestId++;
    m.speechRequestId = requestId;
    this.speechReserved--;
    this.speechIssued++;
    const speaker = this.characters[m.aId];
    const req2: ConversationSpeechRequest = {
      requestId,
      kind: 'conversation',
      tick: t,
      meetingId: m.id,
      speaker: { id: speaker.id, name: speaker.name, persona: speaker.persona, belief: beliefBand(sk.belief) },
      listener: {
        id: listener.id,
        name: listener.name,
        persona: listener.persona,
        belief: L.rumor ? beliefBand(L.rumor.belief) : 'never heard it',
        alreadyHeard: L.rumor !== null,
      },
      variantText: rec.toldFromText,
      flags,
      newVariant,
    };
    this.issue(req2, m.endTick);
    this.bubbles.push({ speakerId: m.aId, text: '…', fromTick: t, untilTick: m.endTick });
  }

  private projectBelief(speakerId: number, listenerId: number, rec: MeetingRec): { before: number; after: number } {
    const L = this.states[listenerId].rumor;
    const lc = this.characters[listenerId];
    const trust = this.relation(listenerId, speakerId).trust;
    const node = this.lattice.get(rec.plan!.nodeId ?? rec.plan!.parentId);
    const strength = rec.plan!.nodeId ? node.claimStrength : rec.plan!.key.claimStrength;
    const isCorr = rec.isCorrection === true;
    const base = L ? L.belief : firstHearingBelief(trust, lc.traits.skepticism, strength, isCorr);
    const exposures = L ? L.exposures : 0;
    const newSource = L ? !L.sourceIds.includes(speakerId) : true;
    const after = applyDecision(base, rec.answer!, exposures, newSource, rec.challenge === true, isCorr);
    return { before: L ? L.belief : 500, after };
  }

  private applySpeech(t: number, req: ConversationSpeechRequest, raw: ConversationSpeechAnswer): void {
    const rec = this.meetings.get(req.meetingId);
    if (!rec || !rec.answer || !rec.plan) return;
    const m = rec.m;
    m.spoken = true;
    const sId = m.aId;
    const lId = m.bId;
    const S = this.states[sId];
    const L = this.states[lId];
    const sk = S.rumor!;
    const speaker = this.characters[sId];
    const listener = this.characters[lId];

    // lines -> bubbles; the pair stays together while they talk
    let lines = (Array.isArray(raw?.lines) ? raw.lines : [])
      .filter((l) => l && (l.speakerId === sId || l.speakerId === lId) && typeof l.text === 'string' && l.text.trim().length > 0)
      .slice(0, 4)
      .map((l) => ({ speakerId: l.speakerId, text: cleanText(l.text, 120) }));
    if (lines.length === 0) lines = [{ speakerId: sId, text: clip(req.variantText, 120) }];
    rec.releaseTick = this.queueLines(t, lines, TUNING.bubbleGap);

    // variant
    const plan = rec.plan;
    const fallbackText = plan.key.corrected ? this.correctionText() : variantWording(this.lattice.get(plan.parentId).text, plan.key.claimStrength, plan.key.details);
    const text = typeof raw?.newVariantText === 'string' && raw.newVariantText.trim() ? cleanText(raw.newVariantText, 240) : fallbackText;
    const { id: toldId, born } = this.lattice.resolve(plan, text, sId, t);
    const told = this.lattice.get(toldId);
    const place = placePhrase(S.locationId);
    this.lattice.markRepeated(toldId);
    this.lattice.markHeard(toldId, lId);

    // speaker bookkeeping
    const si = this.inner[sId];
    if (rec.isCorrection) si.toldCorrection.add(lId);
    else si.toldRumor.add(lId);
    if (!sk.sharedWithIds.includes(lId)) sk.sharedWithIds.push(lId);
    if (rec.challenge) {
      sk.timesChallenged++;
      this.events.push({ tick: t, type: 'challenge', text: `${listener.name} questioned ${speaker.name}’s story ${place}.`, characterIds: [lId, sId], locationId: S.locationId, variantId: toldId });
    }

    // listener belief and knowledge
    const trust = this.relation(lId, sId).trust;
    const isCorr = rec.isCorrection === true || told.corrected;
    const first = L.rumor === null;
    const before = L.rumor ? L.rumor.belief : -1;
    let k: RumorKnowledge;
    if (L.rumor === null) {
      const base = firstHearingBelief(trust, listener.traits.skepticism, told.claimStrength, isCorr);
      k = {
        variantId: toldId,
        heardFromId: sId,
        heardAtTick: t,
        exposures: 0,
        sourceIds: [],
        belief: base,
        sharedWithIds: [],
        timesChallenged: 0,
        verified: 'none',
        knowsCorrection: false,
      };
      L.rumor = k;
    } else k = L.rumor;
    const newSource = !k.sourceIds.includes(sId);
    k.belief = applyDecision(k.belief, rec.answer, k.exposures, newSource, rec.challenge === true, isCorr);
    k.exposures++;
    if (newSource) k.sourceIds.push(sId);
    let learnedCorrection = false;
    if (isCorr) {
      if (!k.knowsCorrection && k.belief <= 600) {
        k.knowsCorrection = true;
        k.variantId = toldId;
        learnedCorrection = true;
      } else if (first) k.variantId = toldId;
    } else if (first) {
      k.variantId = toldId;
    } else if (k.knowsCorrection) {
      if (k.belief > 600) {
        k.knowsCorrection = false;
        k.variantId = toldId;
      }
    } else k.variantId = toldId;
    this.inner[lId].wantsToShare = rec.willShare === true;

    if (first) {
      this.events.push({ tick: t, type: 'transmission', text: `${speaker.name} told ${listener.name} ${isCorr ? 'the real story' : 'the rumor'} ${place}.`, characterIds: [sId, lId], locationId: S.locationId, variantId: toldId });
      if (this.firstTransmissionTick === null) this.firstTransmissionTick = t;
      if (this.milestones.once('first_transmission')) {
        this.events.push(milestoneEvent(t, 'first_transmission', `The rumor is out. ${speaker.name} was the first to pass it on.`, [sId, lId]));
      }
    }
    if (born) {
      this.events.push({ tick: t, type: 'mutation', text: `${speaker.name} ${MUTATION_VERB[plan.mutation]} when telling ${listener.name}.`, characterIds: [sId, lId], locationId: S.locationId, variantId: toldId });
      if (this.milestones.once('first_mutation')) {
        this.events.push(milestoneEvent(t, 'first_mutation', `The story changed for the first time: “${clip(told.text, 80)}”`, [sId], { variantId: toldId }));
      }
    }
    if (learnedCorrection) {
      this.events.push({ tick: t, type: 'correction_spread', text: `${speaker.name} set ${listener.name} straight ${place}.`, characterIds: [sId, lId], locationId: S.locationId, variantId: toldId });
      if (before >= 850 && this.milestones.once('major_contradiction')) {
        this.events.push(milestoneEvent(t, 'major_contradiction', `${listener.name} was sure the rumor was true, until ${speaker.name} said otherwise.`, [lId, sId]));
      }
    }

    // verification
    const li = this.inner[lId];
    if (rec.verify && !li.hasVerified && !li.verifyPending) this.scheduleVerification(t, lId);

    this.conversations.push({ meetingId: m.id, tick: m.startTick, aId: sId, bId: lId, rumorRelevant: true, lines, variantId: toldId });
    this.lastRumorActivity = t;
  }

  /* ================= verification ================= */

  private correctionText(): string {
    const id = this.lattice.correctionNodeId();
    if (id) return this.lattice.get(id).text;
    const r = this.config.rumor;
    return clip(r.verifiedText ?? verificationText(r.truth, r.text, 'town office'), 240);
  }

  private scheduleVerification(t: number, cid: number): void {
    const at = t + verificationDelay(this.streams.meeting);
    const s = this.states[cid];
    const c = this.characters[cid];
    let requestId: number | null = null;
    if (!this.config.rumor.verifiedText && this.speechIssued + this.speechReserved < maxSpeechFor(this.config.population)) {
      requestId = this.nextRequestId++;
      this.speechIssued++;
      const req: VerificationSpeechRequest = {
        requestId,
        kind: 'verification',
        tick: t,
        characterName: c.name,
        rumorText: clip(this.config.rumor.text, 240),
        truth: this.config.rumor.truth,
        place: placeLabel(s.locationId),
      };
      this.issue(req, at);
    }
    this.verifications.push({ characterId: cid, tick: at, locationId: s.locationId, requestId });
    this.inner[cid].verifyPending = true;
  }

  private runVerifications(t: number): void {
    const due = this.verifications.filter((v) => v.tick === t).sort((a, b) => a.characterId - b.characterId);
    if (due.length === 0) return;
    for (const v of due) {
      this.verifications.splice(this.verifications.indexOf(v), 1);
      const cid = v.characterId;
      const inner = this.inner[cid];
      inner.verifyPending = false;
      inner.hasVerified = true;
      const k = this.states[cid].rumor;
      const c = this.characters[cid];
      if (!k) continue;
      const truth = this.config.rumor.truth;
      const fromVariant = k.variantId;
      const { correction } = applyVerification(k, truth);
      const place = placePhrase(v.locationId);
      if (!correction) {
        this.events.push({ tick: t, type: 'verification', text: `${c.name} checked the story ${place} and found it was true.`, characterIds: [cid], locationId: v.locationId });
        this.lastRumorActivity = t;
        continue;
      }
      let text = v.requestId !== null ? this.verificationTexts.get(v.requestId) : undefined;
      if (v.requestId !== null) this.verificationTexts.delete(v.requestId);
      if (!text) text = this.correctionText();
      let nodeId = this.lattice.correctionNodeId();
      if (!nodeId) {
        const src = this.lattice.get(fromVariant).corrected ? 'v0' : fromVariant;
        nodeId = this.lattice.add(CORRECTION_KEY, src, 'corrected', text, cid, t).id;
      }
      k.variantId = nodeId;
      this.lattice.markHeard(nodeId, cid);
      inner.wantsToShare = true;
      const found = truth === 'false' ? 'found it was not true' : 'found that nobody can confirm it';
      this.events.push({ tick: t, type: 'verification', text: `${c.name} checked the story ${place} and ${found}.`, characterIds: [cid], locationId: v.locationId, variantId: nodeId });
      if (this.firstCorrectionTick === null) this.firstCorrectionTick = t;
      if (this.milestones.once('first_correction')) {
        this.events.push(milestoneEvent(t, 'first_correction', `${c.name} found out the real story and can now set others straight.`, [cid], { variantId: nodeId }));
      }
      this.lastRumorActivity = t;
    }
  }

  /* ================= movement ================= */

  private moveEveryone(t: number): void {
    const rng = this.streams.schedule;
    for (let id = 0; id < this.states.length; id++) {
      const s = this.states[id];
      if (s.activity === 'meeting' || s.activity === 'inside') continue;
      const plan = this.plans[id];
      const target = targetAt(plan, t);
      if (target !== s.locationId) {
        const loc = LOCATION_BY_ID[target];
        const spot = chooseSpot(loc, rng, this.idleAt(target, id));
        headTo(s, loc, spot);
        if (s.activity === 'idle') this.inner[id].wanderAt = t + rng.int(TUNING.wanderMinTicks, TUNING.wanderMaxTicks);
        continue;
      }
      if (s.activity === 'walking') {
        if (stepAlongPath(s)) this.inner[id].wanderAt = t + rng.int(TUNING.wanderMinTicks, TUNING.wanderMaxTicks);
        continue;
      }
      // idle at the right place
      if (plan.insideTick >= 0 && t >= plan.insideTick && s.locationId === this.characters[id].homeId) {
        const home = LOCATION_BY_ID[s.locationId];
        s.x = home.door.x;
        s.y = home.door.y;
        s.facing = 'up';
        s.activity = 'inside';
        continue;
      }
      if (t >= this.inner[id].wanderAt) {
        wander(s, rng);
        this.inner[id].wanderAt = t + rng.int(TUNING.wanderMinTicks, TUNING.wanderMaxTicks);
      }
    }
  }

  private idleAt(locationId: string, except: number): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (const s of this.states) if (s.id !== except && s.locationId === locationId && (s.activity === 'idle' || s.activity === 'meeting')) out.push({ x: s.x, y: s.y });
    return out;
  }

  /* ================= encounters ================= */

  private view(id: number): SpeakerView {
    const c = this.characters[id];
    const i = this.inner[id];
    return { character: c, state: this.states[id], wantsToShare: i.wantsToShare, maxShares: ARCHETYPE_BY_ID[c.archetype].maxShares, toldRumor: i.toldRumor, toldCorrection: i.toldCorrection };
  }

  private relation(a: number, b: number): Relationship {
    return this.rel[a].get(b) ?? acquaintance(b);
  }

  private encounters(t: number): void {
    const idle: number[] = [];
    for (const s of this.states) if (s.activity === 'idle') idle.push(s.id);
    const rng = this.streams.encounter;
    const capsOk = () =>
      this.decisionsIssued < TUNING.maxDecisions &&
      this.speechIssued + this.speechReserved < maxSpeechFor(this.config.population) &&
      this.logBytesEstimate < TUNING.logBudgetBytes &&
      this.rumorMeetingsInFlight < TUNING.maxRumorMeetingsInFlight;
    for (let i = 0; i < idle.length; i++) {
      const a = idle[i];
      if (this.states[a].activity !== 'idle') continue;
      for (let j = i + 1; j < idle.length; j++) {
        const b = idle[j];
        if (this.states[b].activity !== 'idle') continue;
        if (chebyshev(this.states[a], this.states[b]) > 1) continue;
        const key = pairKey(a, b);
        const A = this.characters[a];
        const B = this.characters[b];
        const strength = this.relation(a, b).strength;

        const rumorReady =
          (this.rumorCooldown.get(key) ?? 0) <= t && this.states[a].rumorCooldownUntil <= t && this.states[b].rumorCooldownUntil <= t;
        const speaker = rumorReady && (this.states[a].rumor || this.states[b].rumor) ? chooseSpeaker(this.view(a), this.view(b)) : null;
        if (speaker) {
          if (!capsOk()) continue; // they walk on; nothing is consumed
          if (!rng.chance(gateChance(A, B, strength, speaker.character))) continue;
          const sId = speaker.character.id;
          this.startRumorMeeting(t, sId, sId === a ? b : a);
          break;
        }
        if ((this.smallCooldown.get(key) ?? 0) > t) continue;
        if (!rng.chance(gateChance(A, B, strength, null))) continue;
        this.startSmallTalk(t, a, b);
        break;
      }
    }
  }

  /* ================= context for Jev ================= */

  private pairContext(t: number, sId: number, lId: number): PairContext {
    const S = this.characters[sId];
    const L = this.characters[lId];
    const sk = this.states[sId].rumor!;
    const lk = this.states[lId].rumor;
    const locId = this.states[sId].locationId;
    const loc = LOCATION_BY_ID[locId];
    let crowd = 0;
    for (const s of this.states) if (s.locationId === locId && s.activity !== 'walking' && s.activity !== 'inside') crowd++;
    const setting: PairContext['scene']['setting'] = loc?.kind === 'home' ? 'private' : crowd >= 4 ? 'busy' : 'quiet';
    const toldText = sk.knowsCorrection ? this.lattice.get(this.lattice.correctionNodeId() ?? sk.variantId).text : this.lattice.get(sk.variantId).text;
    const src =
      sk.heardFromId === null
        ? 'started it'
        : clip(`heard it from ${this.characters[sk.heardFromId].name} (${shortRelationship(this.relation(sId, sk.heardFromId))})`, 80);
    return {
      scene: { time: formatTick(t), place: placeLabel(locId), setting },
      rumor: {
        text: clip(toldText, 240),
        speakerSource: src,
        speakerVerified: sk.verified === 'confirmed' ? 'confirmed' : sk.verified === 'debunked' || sk.knowsCorrection ? 'debunked' : 'no',
        timesSpeakerHeard: Math.min(50, sk.exposures),
      },
      speaker: {
        name: S.name,
        occupation: OCCUPATION_WORD[S.occupation],
        persona: clip(S.persona, 120),
        traits: { sociability: traitLabel(S.traits.sociability), willingnessToShare: traitLabel(S.traits.shareWillingness), skepticism: traitLabel(S.traits.skepticism) },
        belief: beliefBand(sk.belief),
      },
      listener: {
        name: L.name,
        occupation: OCCUPATION_WORD[L.occupation],
        persona: clip(L.persona, 120),
        traits: { skepticism: traitLabel(L.traits.skepticism), tendencyToVerify: traitLabel(L.traits.verifyTendency), trustInSpeaker: traitLabel(this.relation(lId, sId).trust) },
        alreadyHeard: lk ? clip(`yes: ${this.lattice.get(lk.variantId).text}`, 260) : 'no',
        belief: lk ? beliefBand(lk.belief) : 'never heard it',
      },
      relationship: clip(relationshipWord(this.relation(sId, lId)), 80),
    };
  }

  /* ================= quiet, milestones, end ================= */

  private trackQuiet(t: number): number {
    if (this.rumorMeetingsInFlight > 0 || this.verifications.length > 0) this.lastRumorActivity = t;
    if (TUNING.quietCountsAfterFirstTransmission && this.firstTransmissionTick === null) return 0;
    return t - this.lastRumorActivity;
  }

  private observeMilestones(t: number, quiet: number): void {
    let heard = 0;
    const holders = new Map<string, number>();
    for (const s of this.states) {
      if (!s.rumor) continue;
      heard++;
      holders.set(s.rumor.variantId, (holders.get(s.rumor.variantId) ?? 0) + 1);
    }
    let dom: string | null = null;
    let domN = 0;
    for (const n of this.lattice.nodes) {
      const c = holders.get(n.id) ?? 0;
      if (c > domN) {
        domN = c;
        dom = n.id;
      }
    }
    for (const ms of this.milestones.observe({ tick: t, population: this.states.length, heard, dominantVariantId: dom, dominantHolders: domN, quietTicks: quiet })) {
      if (ms.kind === 'new_dominant_variant') {
        const v = this.lattice.get(ms.variantId!);
        this.events.push(milestoneEvent(t, ms.kind, `A new version is now the one most people know: “${clip(v.text, 80)}”`, [], { variantId: v.id }));
      } else this.events.push(milestoneEvent(t, ms.kind, MILESTONE_TEXT[ms.kind] ?? ''));
    }
  }

  private finish(reason: 'day_over' | 'quiet'): void {
    this.finished = true;
    this.endReason = reason;
    const last = this.series[this.series.length - 1];
    if (!last || last.tick !== this.tick) this.series.push(seriesPoint(this.tick, this.states));
    const text = reason === 'day_over' ? 'The day is over. Everyone heads home for the night.' : 'Talk of the rumor has died down.';
    this.events.push(milestoneEvent(this.tick, 'ended', text));
    this.final = this.hashState();
  }

  /* ================= hashing ================= */

  private hashState(): string {
    const parts: string[] = [`t${this.tick}|r${this.nextRequestId}|m${this.nextMeetingId}|d${this.decisionsIssued}|s${this.speechIssued}/${this.speechReserved}`];
    for (const s of this.states) {
      const k = s.rumor;
      const i = this.inner[s.id];
      parts.push(
        `${s.x},${s.y},${s.facing[0]},${s.activity[0]},${s.locationId},${s.path.length},${s.rumorCooldownUntil},${s.meetingId ?? '-'},` +
          (k ? `${k.variantId}:${k.belief}:${k.exposures}:${k.sourceIds.join('.')}:${k.sharedWithIds.join('.')}:${k.timesChallenged}:${k.verified}:${k.knowsCorrection ? 1 : 0}` : '-') +
          `,${i.wantsToShare ? 1 : 0}${i.hasVerified ? 1 : 0}${i.verifyPending ? 1 : 0},${i.wanderAt}`,
      );
    }
    const cd = (m: Map<number, number>) =>
      [...m.entries()]
        .filter(([, v]) => v > this.tick)
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => `${k}:${v}`)
        .join(',');
    parts.push(`rc[${cd(this.rumorCooldown)}]`, `sc[${cd(this.smallCooldown)}]`);
    for (const id of [...this.meetings.keys()].sort((a, b) => a - b)) {
      const r = this.meetings.get(id)!;
      parts.push(`M${id}:${r.m.aId}:${r.m.bId}:${r.m.startTick}:${r.m.endTick}:${r.releaseTick}:${r.m.decided ? 1 : 0}${r.m.spoken ? 1 : 0}:${r.mention ? 1 : 0}`);
    }
    for (const v of this.lattice.nodes) parts.push(`${v.id}:${v.parentId}:${v.mutation}:${v.claimStrength}:${v.details.join('+')}:${v.corrected ? 1 : 0}:${v.heardCount}:${v.repeatedCount}:${v.text}`);
    for (const v of this.verifications) parts.push(`V${v.characterId}:${v.tick}:${v.requestId}`);
    for (const name of ['encounter', 'smalltalk', 'meeting', 'schedule'] as const) parts.push(this.streams[name].state().join('.'));
    return fnv1a(parts.join('\n'));
  }
}

const MUTATION_VERB: Record<string, string> = {
  unchanged: 'told the story as heard',
  shortened: 'cut the story short',
  softened: 'made the story sound less sure',
  strengthened: 'made the story sound more certain',
  distorted: 'added a new detail',
  corrected: 'passed on the real story',
};

function cleanText(s: string, max: number): string {
  return clip(String(s).replace(/\s+/g, ' ').trim(), max);
}

function prob(x: unknown): number {
  const v = typeof x === 'number' && x === x ? x : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function sanitizeDecision(a: DecisionAnswer): DecisionAnswer {
  const p = Array.isArray(a?.beliefShiftProbs) ? a.beliefShiftProbs : [0, 0, 1, 0, 0];
  const probs = [0, 1, 2, 3, 4].map((i) => prob(p[i])) as DecisionAnswer['beliefShiftProbs'];
  const allowed = ['unchanged', 'shortened', 'softened', 'strengthened', 'distorted', 'corrected'];
  return {
    mention: prob(a?.mention),
    beliefShift: typeof a?.beliefShift === 'number' && a.beliefShift === a.beliefShift ? Math.min(4, Math.max(0, a.beliefShift)) : 2,
    beliefShiftProbs: probs,
    retelling: allowed.includes(a?.retelling) ? a.retelling : 'unchanged',
    challenges: prob(a?.challenges),
    willShare: prob(a?.willShare),
    verify: prob(a?.verify),
  };
}

export function createEngine(config: RunConfig): Engine {
  return new Engine(config);
}

// re-exported for the renderer's convenience
export { standable };
