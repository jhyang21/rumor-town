/**
 * Every tuning constant for the engine in one place. Integers only (per-mille, ticks).
 * Calibrated with `pnpm sim:run --sweep 200` against the targets in the engine brief.
 */
export const TUNING = {
  /* ---------- encounter gate (per-mille per tick for an eligible adjacent idle pair) ---------- */
  gateBase: 20,
  /** added: avg sociability (0..1000) * gateSociability / 1000 */
  gateSociability: 60,
  /** added: relationship strength (0..1000) * gateStrength / 1000 */
  gateStrength: 50,
  /** added for rumor pairs: speaker shareWillingness * gateRumorShare / 1000 */
  gateRumorShare: 80,

  smalltalkCooldown: 30,
  smalltalkTicks: 6,
  rumorPairCooldown: 120,
  /** after a rumor meeting, each person waits this long before another rumor talk */
  characterRumorCooldown: 4,
  maxRumorMeetingsInFlight: 4,
  meetingMinTicks: 6,
  meetingMaxTicks: 9,
  decisionDelay: 2,
  /** ticks between spoken lines after the speech lands */
  bubbleGap: 3,
  signalTicks: 8,

  /* ---------- per-run AI caps (AGENTS.md) ---------- */
  maxDecisions: 250,
  maxSpeech: 70,
  /** 75-person towns get more GPT calls so the cap does not throttle the spread */
  maxSpeechLarge: 100,
  /** stop starting rumor meetings once the estimated oracle log passes this (upload cap is 200 KB) */
  logBudgetBytes: 185_000,
  /** fixed per-answer size allowance used in that estimate (real answers vary by source) */
  decisionAnswerBytes: 330,
  speechAnswerBytes: 520,

  /* ---------- verification ---------- */
  verifyMinDelay: 20,
  verifyMaxDelay: 40,

  /* ---------- movement ---------- */
  wanderMinTicks: 4,
  wanderMaxTicks: 10,
  /** per-mille: when picking an idle spot, stand next to someone already there */
  joinSomeonePerMille: 650,

  /* ---------- relationships ---------- */
  acquaintanceStrength: 150,
  acquaintanceTrust: 300,
  minFriends: 2,
  maxFriends: 5,

  /* ---------- belief ---------- */
  starterBelief: 850,
  /** belief drop for a listener who challenges */
  challengePenalty: 40,

  /* ---------- run end ---------- */
  /** rumor-quiet ticks are counted only after the first transmission */
  quietCountsAfterFirstTransmission: true,
  /** a rumor-quiet run may end early only from this tick on (2:00 PM), so a slow start is not cut short */
  quietEndEarliestTick: 360,
} as const;

/** GPT dialogue cap for a town size. Must match the server's run-token caps (src/ai/token.ts). */
export function maxSpeechFor(population: number): number {
  return population >= 75 ? TUNING.maxSpeechLarge : TUNING.maxSpeech;
}
