<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Rumor Town

A Vercel-hosted Next.js app. A visitor starts one rumor in a pixel-art town of 30/50/75 characters and
watches it spread, change, get doubted, and get corrected over one simulated day (8:00 AM to 8:00 PM).

**Jev decides. GPT speaks.** Jev (`typesafe-ai/jev`, an evaluation model on Vercel AI Gateway) answers
behavior questions with probabilities. GPT (`openai/gpt-4.1-mini` via the same gateway) writes dialogue
and variant wording. A deterministic `LocalOracle` runs the whole product with no credentials.

## Read first

- `src/sim/types.ts` and `src/sim/oracle/types.ts` are contracts. Do not change them without the lead.
- `src/ai/schemas.ts` validates every API body. `src/sim/people/archetypes.ts` and `src/sim/town/mapSpec.ts` are data.
- Next.js 16 docs live in `node_modules/next/dist/docs/`. Read the relevant page before writing any Next code.
- AI SDK 7: `experimental_evaluate` for Jev, `generateText` + `Output.object` for GPT. Docs in `node_modules/ai/docs/`.
  Working example: `scripts/smoke-gateway.ts` (`pnpm smoke`).

## Layout

```
src/sim/       pure engine: rng, town (map, A*), people, schedule, movement, encounters, rumor, oracle (types, local, replay, jevQuestions), events, stats, engine, hash
src/runtime/   wall-clock driver (deadlines, holds, 3 s fallback) and LiveOracle (fetch). Only place the engine meets time and network.
src/ai/        server-only: gateway.ts, jev.ts, gpt.ts, moderation.ts, token.ts, schemas.ts
src/art/       palettes, pixel matrices, building compositor, rasterizer
src/render/    canvas renderer, camera, view model (interpolation, bubbles, signals)
src/ui/        React components; src/store/ Zustand bridge
src/app/       routes: /, /play, /r/[id], /dev/sprites, /api/*
scripts/       sim-run.ts, calibrate-jev.ts, record-demo.ts, smoke-gateway.ts
```

## Determinism rules (enforced by ESLint on `src/sim/**`)

- 1 tick = 1 simulated minute. Tick 0 = 8:00 AM, 720 = 8:00 PM.
- No `Math.random`, `Date`, `performance`, `fetch`, timers, or transcendental `Math.*` in `src/sim`. Use the seeded
  sfc32 streams (`town`, `schedule`, `encounter`, `smalltalk`, `meeting`). Integer-only arithmetic for anything that
  feeds a decision (traits, belief 0..1000).
- `townSeed` builds the town (people, homes, relationships, schedules). `runSeed` drives behavior.
- Characters live in arrays indexed by id. Pairs are keyed `(minId, maxId)`. Iterate in id order.
- Oracle answers go into a pending buffer and apply only at tick boundaries, sorted by `requestId`.
- Deadlines: a rumor meeting at tick T with seeded duration D (6..9) needs its decision at T+2 and its speech at T+D.
  The driver holds the tick until the answer is in; after 3 s wall-clock the LocalOracle answers (`source: 'fallback'`).
  Replay at any speed is bit-identical.
- `hash(state)` every 10 ticks. Live-mocked run and replay must produce the same hashes.

## Product rules

- Never show prompts, raw model output, probabilities, or numeric traits in the UI. Show belief bands and trait words.
- Every line of UI copy is plain English, short, and kind. No jargon. Follow Orwell's rules.
- Safety line appears only on results and share pages: "This is a fictional AI simulation. Agent behavior should not be
  interpreted as a prediction of real human behavior."
- Caps per run: 70 GPT calls, 250 Jev decisions, 12 variants, 3..6 shares per character by archetype.

## Secrets

`.env.local` holds `AI_GATEWAY_API_KEY`, `AI_GATEWAY_LANGUAGE_MODEL`, `AI_GATEWAY_EVALUATION_MODEL`, `BLOB_READ_WRITE_TOKEN`,
`VERCEL_OIDC_TOKEN`. Never print, log, or commit any of them. Never inspect the environment with `env`, `set`, or `printenv`.
Server code reads them; the browser never sees them. Vercel deployments use OIDC automatically.

## Working agreements for subagents

- Use `pnpm`. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before reporting done.
- If you are not confident you can finish a task well, stop and report the question to the parent instead of guessing.
  Say what you could not decide and why.
- Commit only when asked. Keep the tree runnable (`pnpm dev` must always start).
