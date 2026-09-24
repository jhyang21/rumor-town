'use client';

import { useMemo, useState } from 'react';
import type { Population, RunConfig } from '@/sim/types';
import { PRESETS } from '@/data/presets';
import { RUMOR_MAX_CHARS } from '@/ai/schemas';
import { customRumor, presetRumor, runStore, useRunStore } from '@/store/runStore';

const SIZES: Population[] = [30, 50, 75];
const MOOD: Array<[number, string]> = [
  [-1, 'More trusting'],
  [0, 'As is'],
  [1, 'More skeptical'],
];
const CHATTER: Array<[number, string]> = [
  [-1, 'Quieter'],
  [0, 'As is'],
  [1, 'Chattier'],
];

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<[T, string]>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex overflow-hidden rounded-lg border border-stone-600">
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`flex-1 px-3 py-1.5 text-sm ${value === v ? 'bg-amber-300 font-semibold text-stone-900' : 'text-stone-200 hover:bg-stone-700'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function SetupSheet() {
  const draft = useRunStore((s) => s.draft);
  const starting = useRunStore((s) => s.starting);
  const error = useRunStore((s) => s.setupError);
  const preview = useRunStore((s) => s.previewEngine);
  const [customText, setCustomText] = useState(draft.rumor.presetId ? '' : draft.rumor.text);
  const custom = !draft.rumor.presetId;
  const set = (patch: Partial<RunConfig>) => runStore.getState().setDraft({ ...draft, ...patch });
  const setOverride = (k: 'skepticismBias' | 'sociabilityBias' | 'starterId', v: number | undefined) => {
    const overrides = { ...draft.overrides };
    if (v === undefined || (k !== 'starterId' && v === 0)) delete overrides[k];
    else overrides[k] = v;
    set({ overrides });
  };

  const people = useMemo(() => {
    if (!preview || preview.config.population !== draft.population) return [];
    return preview.characters.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [preview, draft.population]);

  const canStart = !starting && (!custom || customText.trim().length > 0);
  const onStart = () => {
    if (!canStart) return;
    const rumor = custom ? customRumor(customText) : draft.rumor;
    void runStore.getState().start({ ...draft, rumor, runSeed: draft.runSeed });
  };

  return (
    <div className="sheet-backdrop absolute inset-0 z-40 flex items-end justify-center overflow-y-auto md:items-center">
      <form
        className="sheet w-full max-w-lg rounded-t-2xl p-5 md:rounded-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          onStart();
        }}
        aria-label="Set up your rumor"
      >
        <h2 className="text-xl font-semibold text-stone-50">Start a rumor</h2>
        <p className="mb-4 text-sm text-stone-300">Pick one, or write your own.</p>

        <fieldset className="mb-4">
          <legend className="mb-2 text-xs uppercase tracking-wide text-stone-400">Rumor</legend>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const on = draft.rumor.presetId === p.presetId;
              return (
                <button
                  key={p.presetId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ rumor: presetRumor(p.presetId) })}
                  className={`chip ${on ? 'chip-on' : ''}`}
                  title={p.text}
                >
                  {p.label}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={custom}
              onClick={() => set({ rumor: customRumor(customText || ' ') })}
              className={`chip ${custom ? 'chip-on' : ''}`}
            >
              Write your own
            </button>
          </div>
          {custom ? (
            <div className="mt-3">
              <textarea
                className="w-full resize-none rounded-lg border border-stone-600 bg-stone-900/70 p-2 text-stone-100 placeholder:text-stone-500"
                rows={2}
                maxLength={RUMOR_MAX_CHARS}
                placeholder="Someone saw a bear by the school."
                value={customText}
                autoFocus
                onChange={(e) => setCustomText(e.target.value)}
                aria-label="Your rumor"
              />
              <div className="flex justify-between text-xs text-stone-400">
                <span className="rounded bg-stone-700 px-1.5 py-0.5 text-stone-200">Unverified</span>
                <span>
                  {customText.length}/{RUMOR_MAX_CHARS}
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-stone-200">“{draft.rumor.text}”</p>
          )}
          {error ? (
            <p className="mt-2 rounded bg-rose-900/60 px-2 py-1 text-sm text-rose-100" role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="mb-4">
          <legend className="mb-2 text-xs uppercase tracking-wide text-stone-400">Town size</legend>
          <Segmented
            label="Town size"
            options={SIZES.map((n) => [n, `${n} people`] as [Population, string])}
            value={draft.population}
            onChange={(population) => {
              const overrides = { ...draft.overrides };
              delete overrides.starterId;
              set({ population, overrides });
            }}
          />
        </fieldset>

        <details className="mb-5">
          <summary className="cursor-pointer text-sm text-stone-300">More options</summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-stone-300">
              Who starts it
              <select
                className="rounded-lg border border-stone-600 bg-stone-900/70 p-2 text-stone-100"
                value={draft.overrides.starterId ?? ''}
                onChange={(e) => setOverride('starterId', e.target.value === '' ? undefined : Number(e.target.value))}
              >
                <option value="">Random</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1 text-sm text-stone-300">
              Town mood
              <Segmented label="Town mood" options={MOOD} value={draft.overrides.skepticismBias ?? 0} onChange={(v) => setOverride('skepticismBias', v)} />
            </div>
            <div className="flex flex-col gap-1 text-sm text-stone-300">
              How much people talk
              <Segmented label="How much people talk" options={CHATTER} value={draft.overrides.sociabilityBias ?? 0} onChange={(v) => setOverride('sociabilityBias', v)} />
            </div>
          </div>
        </details>

        <button type="submit" disabled={!canStart} className="btn-primary w-full">
          {starting ? 'Starting…' : 'Start the day'}
        </button>
      </form>
    </div>
  );
}
