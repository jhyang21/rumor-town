/**
 * Wall-clock driver. The only place the engine meets real time.
 *
 * - 1x = 4 sim-minutes (ticks) per real second; speeds 1, 2, 5; `slow(true)` halves it (inspector).
 * - Every new pending request goes to `oracle.decide/speak` at once; answers are delivered as they land.
 * - When the engine cannot step (a due answer is missing) the driver holds the tick and eases the
 *   clock toward 0.5x over 300 ms. A due request outstanding for 3 s is answered by `fallback`
 *   (source 'fallback'); a real answer that lands later is ignored.
 * - Uses requestAnimationFrame in a browser and setInterval(16 ms) elsewhere.
 */
import type { Engine } from '@/sim/engine';
import type { DecisionRequest, Oracle, OracleSource, SpeechRequest, SyncOracle } from '@/sim/oracle/types';

export type DriverState = 'idle' | 'running' | 'paused' | 'holding' | 'finished';
export type Speed = 1 | 2 | 5;

export interface FrameInfo {
  tick: number;
  /** fraction of the way to the next tick, 0..1, for interpolation */
  alpha: number;
  state: DriverState;
  /** current clock multiplier (1 normally, easing toward 0.5 while holding) */
  clockScale: number;
}

export interface DriverOptions {
  engine: Engine;
  oracle: Oracle;
  fallback: SyncOracle;
  speed?: Speed;
  onFrame?: (f: FrameInfo) => void;
  /** wall clock in ms; defaults to Date.now (tests fake it) */
  now?: () => number;
  /** ms before the fallback answers a due request */
  fallbackAfterMs?: number;
}

export interface Driver {
  readonly state: DriverState;
  play(): void;
  pause(): void;
  stop(): void;
  setSpeed(s: Speed): void;
  slow(on: boolean): void;
  /** requestIds answered by the fallback */
  readonly fallbackIds: ReadonlySet<number>;
}

export const TICKS_PER_SECOND_1X = 4;
const HOLD_EASE_MS = 300;
const HOLD_SCALE = 0.5;

type SourceAware = { sourceOf?: (requestId: number) => OracleSource | undefined };

export function createDriver(opts: DriverOptions): Driver {
  const { engine, oracle, fallback } = opts;
  const now = opts.now ?? (() => Date.now());
  const fallbackAfter = opts.fallbackAfterMs ?? 3000;
  let speed: Speed = opts.speed ?? 1;
  let slowOn = false;
  let state: DriverState = 'idle';
  let stopped = false;
  let acc = 0; // banked fraction of a tick
  let clockScale = 1;
  let lastFrame = 0;
  let handle: { cancel: () => void } | null = null;

  const issuedAt = new Map<number, number>();
  const settled = new Set<number>(); // delivered (by oracle or fallback) or ignored
  const fallbackIds = new Set<number>();

  const liveSource = (req: DecisionRequest | SpeechRequest): OracleSource => {
    const s = (oracle as SourceAware).sourceOf?.(req.requestId);
    return s ?? (req.kind === 'encounter' ? 'jev' : 'gpt');
  };

  function dispatch(): void {
    for (const req of engine.pendingRequests()) {
      if (issuedAt.has(req.requestId)) continue;
      issuedAt.set(req.requestId, now());
      const p = req.kind === 'encounter' ? oracle.decide(req) : oracle.speak(req);
      p.then(
        (ans) => {
          // Read the source first, every time: LiveOracle drops the entry on read, so late answers must still clear it.
          const source = liveSource(req);
          if (stopped || settled.has(req.requestId)) return; // late answer after fallback: ignored
          settled.add(req.requestId);
          engine.deliver(req.requestId, ans, source);
        },
        () => {
          /* the fallback will answer it when it is due */
        },
      );
    }
  }

  function fallbackDue(): void {
    const t = now();
    for (const req of engine.pendingRequests()) {
      const id = req.requestId;
      if (settled.has(id)) continue;
      const deadline = engine.deadlineOf(id);
      if (deadline === undefined || deadline > engine.tick) continue;
      const at = issuedAt.get(id) ?? t;
      if (t - at < fallbackAfter) continue;
      const ans = req.kind === 'encounter' ? fallback.decideSync(req) : fallback.speakSync(req);
      settled.add(id);
      fallbackIds.add(id);
      engine.deliver(id, ans, 'fallback');
    }
  }

  function ease(target: number, dt: number): void {
    const stepSize = ((1 - HOLD_SCALE) * dt) / HOLD_EASE_MS;
    if (clockScale < target) clockScale = Math.min(target, clockScale + stepSize);
    else if (clockScale > target) clockScale = Math.max(target, clockScale - stepSize);
  }

  function frame(): void {
    if (stopped) return;
    const t = now();
    const dt = Math.min(250, Math.max(0, t - lastFrame));
    lastFrame = t;
    dispatch();
    fallbackDue();
    if (engine.finished) {
      state = 'finished';
      emit();
      cancel();
      return;
    }
    if (state === 'paused' || state === 'idle') {
      emit();
      return;
    }
    const rate = (TICKS_PER_SECOND_1X * speed * (slowOn ? 0.5 : 1)) / 1000; // ticks per ms
    if (!engine.canStep()) {
      state = 'holding';
      ease(HOLD_SCALE, dt);
      acc = Math.min(acc, 0.999);
    } else {
      state = 'running';
      ease(1, dt);
      acc += dt * rate * clockScale;
      while (acc >= 1 && engine.canStep()) {
        engine.step();
        acc -= 1;
        dispatch(); // new requests go out the same frame
        if (engine.finished) break;
      }
      if (!engine.finished && !engine.canStep()) {
        state = 'holding';
        acc = Math.min(acc, 0.999);
      }
      if (engine.finished) {
        state = 'finished';
        emit();
        cancel();
        return;
      }
    }
    emit();
  }

  function emit(): void {
    opts.onFrame?.({ tick: engine.tick, alpha: Math.min(1, Math.max(0, acc)), state, clockScale });
  }

  function schedule(): void {
    if (handle) return;
    lastFrame = now();
    const g = globalThis as unknown as {
      requestAnimationFrame?: (cb: () => void) => number;
      cancelAnimationFrame?: (id: number) => void;
      window?: unknown;
    };
    if (g.window !== undefined && typeof g.requestAnimationFrame === 'function') {
      let id = 0;
      let live = true;
      const loop = () => {
        if (!live) return;
        frame();
        if (live) id = g.requestAnimationFrame!(loop);
      };
      id = g.requestAnimationFrame(loop);
      handle = {
        cancel: () => {
          live = false;
          g.cancelAnimationFrame?.(id);
        },
      };
    } else {
      const iv = setInterval(frame, 16);
      handle = { cancel: () => clearInterval(iv) };
    }
  }

  function cancel(): void {
    handle?.cancel();
    handle = null;
  }

  return {
    get state() {
      return state;
    },
    get fallbackIds() {
      return fallbackIds;
    },
    play() {
      if (stopped || state === 'finished') return;
      state = 'running';
      schedule();
    },
    pause() {
      if (state === 'running' || state === 'holding') state = 'paused';
    },
    stop() {
      stopped = true;
      cancel();
      state = 'idle';
    },
    setSpeed(s: Speed) {
      speed = s;
    },
    slow(on: boolean) {
      slowOn = on;
    },
  };
}
