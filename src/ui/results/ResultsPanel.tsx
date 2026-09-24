'use client';
/**
 * Results panel contract. The results agent replaces the body; the town UI mounts it when a run ends
 * and on the share page. Props stay as declared here.
 */
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { generateTown } from '@/sim/people/generate';
import type { RunRecord } from '@/sim/types';
import { INK } from './colors';
import { changeNote, headline, statItems, variantById } from './format';
import { MilestoneList } from './MilestoneList';
import { SpreadChart } from './SpreadChart';
import { VariantTree } from './VariantTree';

export interface ResultsActions {
  /** replay this exact day (same config + oracle log) */
  replay?: () => void;
  /** same setup, new run seed */
  rerun?: () => void;
  /** open setup prefilled with this config */
  modify?: () => void;
  /** save and copy the share link; resolves to the share URL or null when saving failed */
  share?: () => Promise<string | null>;
}

export interface ResultsPanelProps {
  record: RunRecord;
  actions: ResultsActions;
  /** true on /r/[id] (shows "Start your own rumor" instead of replay controls that need the live engine) */
  standalone?: boolean;
}

const SAFETY_LINE =
  'This is a fictional AI simulation. Agent behavior should not be interpreted as a prediction of real human behavior.';

export function ResultsPanel({ record, actions, standalone = false }: ResultsPanelProps) {
  const { stats, variants } = record;
  const names = useMemo(() => {
    try {
      return generateTown(record.config).map((c) => c.name);
    } catch {
      return undefined;
    }
  }, [record.config]);
  const original = variantById(variants, 'v0') ?? variants[0];
  const widest = variantById(variants, stats.mostWidespreadVariantId) ?? original;
  const same = !widest || widest.id === original?.id;

  return (
    <section
      className="mx-auto w-full max-w-3xl space-y-6 rounded-2xl p-4 sm:p-6"
      style={{ background: INK.surface, color: INK.text }}
      aria-labelledby="results-headline"
    >
      <header className="space-y-1">
        <p className="text-sm font-medium" style={{ color: INK.muted }}>
          The day is over
        </p>
        <h2 id="results-headline" className="text-xl font-bold leading-snug sm:text-2xl">
          {headline(stats)}
        </h2>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Quote label="It started as" text={original?.text ?? record.config.rumor.text} />
        <Quote label={same ? 'Most people heard' : 'Most people heard this version'} text={widest?.text ?? ''} strong />
        <p className="text-sm sm:col-span-2" style={{ color: INK.muted }}>
          {changeNote(record)}
        </p>
      </div>

      <Block title="How it spread">
        <SpreadChart series={record.series} population={stats.population} />
      </Block>

      <Block title="How the story changed">
        <VariantTree variants={variants} mostWidespreadId={stats.mostWidespreadVariantId} mostChangedId={stats.mostChangedVariantId} names={names} />
      </Block>

      <Block title="The day in numbers">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {statItems(record).map((s) => (
            <div
              key={s.label}
              className={`rounded-lg p-3 ${s.wide ? 'col-span-2 sm:col-span-4' : ''}`}
              style={{ background: INK.raised, border: `1px solid ${INK.line}` }}
            >
              <dt className="text-xs" style={{ color: INK.muted }}>
                {s.label}
              </dt>
              <dd className={`m-0 font-semibold ${s.wide ? 'text-sm' : 'text-lg tabular-nums'}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </Block>

      <Block title="Key moments">
        <MilestoneList events={record.events} />
      </Block>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {standalone ? <StandaloneButtons id={record.id} /> : <LiveButtons actions={actions} />}
        </div>
        <p className="text-xs" style={{ color: INK.muted }}>
          {SAFETY_LINE}
        </p>
      </div>
    </section>
  );
}

function Quote({ label, text, strong = false }: { label: string; text: string; strong?: boolean }) {
  return (
    <figure className="m-0 rounded-lg p-3" style={{ background: INK.raised, border: `${strong ? 2 : 1}px solid ${strong ? '#d0672c' : INK.line}` }}>
      <figcaption className="text-xs font-medium" style={{ color: INK.muted }}>
        {label}
      </figcaption>
      <blockquote className="m-0 mt-1 text-base leading-snug">“{text}”</blockquote>
    </figure>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const primaryStyle = { background: INK.accent, color: INK.accentText };
const secondaryStyle = { background: INK.raised, color: INK.text, border: `1px solid ${INK.line}` };
const btn = 'inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2';

function LiveButtons({ actions }: { actions: ResultsActions }) {
  return (
    <>
      {actions.replay && (
        <button type="button" className={btn} style={secondaryStyle} onClick={actions.replay}>
          Replay this day
        </button>
      )}
      {actions.rerun && (
        <button type="button" className={btn} style={secondaryStyle} onClick={actions.rerun}>
          Run it again
        </button>
      )}
      {actions.modify && (
        <button type="button" className={btn} style={secondaryStyle} onClick={actions.modify}>
          Change one thing
        </button>
      )}
      {actions.share && <ShareButton share={actions.share} />}
    </>
  );
}

function ShareButton({ share }: { share: () => Promise<string | null> }) {
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'failed' } | { kind: 'done'; url: string }>({ kind: 'idle' });
  const onClick = async () => {
    setState({ kind: 'saving' });
    try {
      const url = await share();
      setState(url ? { kind: 'done', url } : { kind: 'failed' });
    } catch {
      setState({ kind: 'failed' });
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={btn} style={primaryStyle} onClick={onClick} disabled={state.kind === 'saving'}>
        {state.kind === 'saving' ? 'Saving…' : 'Share'}
      </button>
      <span role="status" className="text-sm" style={{ color: INK.muted }}>
        {state.kind === 'done' && (
          <>
            Link copied:{' '}
            <a href={state.url} className="underline" style={{ color: INK.text }}>
              {state.url}
            </a>
          </>
        )}
        {state.kind === 'failed' && 'Could not save this day. Please try again.'}
      </span>
    </span>
  );
}

function StandaloneButtons({ id }: { id: string }) {
  const q = encodeURIComponent(id);
  return (
    <>
      <Link href="/play" className={btn} style={primaryStyle}>
        Start your own rumor
      </Link>
      <Link href={`/play?replay=${q}`} className={btn} style={secondaryStyle}>
        Replay this day
      </Link>
      <Link href={`/play?rerun=${q}`} className={btn} style={secondaryStyle}>
        Run it again
      </Link>
      <Link href={`/play?modify=${q}`} className={btn} style={secondaryStyle}>
        Change one thing
      </Link>
      <CopyLinkButton />
    </>
  );
}

function CopyLinkButton() {
  const [done, setDone] = useState<boolean | null>(null);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setDone(true);
    } catch {
      setDone(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={btn} style={secondaryStyle} onClick={onClick}>
        Copy link
      </button>
      <span role="status" className="text-sm" style={{ color: INK.muted }}>
        {done === true && 'Link copied.'}
        {done === false && 'Could not copy. Copy the address bar instead.'}
      </span>
    </span>
  );
}
