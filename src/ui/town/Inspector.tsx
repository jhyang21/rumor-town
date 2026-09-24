'use client';

import { beliefBand, formatTick } from '@/sim/types';
import { traitWord } from '@/sim/people/archetypes';
import { OCCUPATION_WORD } from '@/sim/words';
import { runStore, useRunStore } from '@/store/runStore';
import { BELIEF_STEPS, BELIEF_WORDS, TRAIT_LABELS, TRAIT_WORDS } from './words';

function names(ids: readonly number[], all: readonly { name: string }[]): string {
  if (ids.length === 0) return 'No one yet';
  const list = ids.map((id) => all[id]?.name ?? 'someone');
  if (list.length <= 4) return list.join(', ');
  return `${list.slice(0, 4).join(', ')} and ${list.length - 4} more`;
}

/** Character card. Desktop: a panel on the right. Mobile: a bottom sheet. */
export function Inspector() {
  const id = useRunStore((s) => s.selectedCharacterId);
  const engine = useRunStore((s) => s.engine);
  useRunStore((s) => s.tick); // refresh with the clock
  if (id === null || !engine) return null;
  const c = engine.characters[id];
  const st = engine.states[id];
  if (!c || !st) return null;
  const k = st.rumor;
  const band = k ? beliefBand(k.belief) : null;
  const step = band ? BELIEF_STEPS.indexOf(band) : -1;
  const variant = k ? engine.variants.find((v) => v.id === k.variantId) : undefined;
  const close = () => runStore.getState().select(null);

  return (
    <aside
      className="inspector z-30 flex flex-col gap-3 p-4 text-sm"
      role="dialog"
      aria-label={`About ${c.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-stone-50">{c.name}</h2>
          <p className="text-stone-300 first-letter:uppercase">{OCCUPATION_WORD[c.occupation]}</p>
        </div>
        <button type="button" onClick={close} className="ctl" aria-label="Close">
          ✕
        </button>
      </div>
      <p className="italic text-stone-300 first-letter:uppercase">{c.persona}</p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {TRAIT_LABELS.map(([key, label]) => (
          <div key={key} className="contents">
            <dt className="text-stone-400">{label}</dt>
            <dd className="text-stone-100">{TRAIT_WORDS[traitWord(c.traits[key])]}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h3 className="mb-1 text-xs uppercase tracking-wide text-stone-400">What they think</h3>
        {k && band ? (
          <>
            <div className="flex gap-1" aria-label={BELIEF_WORDS[band]}>
              {BELIEF_STEPS.map((b, i) => (
                <span key={b} className={`h-2 flex-1 rounded-sm ${i <= step ? 'bg-amber-300' : 'bg-stone-700'}`} />
              ))}
            </div>
            <p className="mt-1 text-stone-100">{BELIEF_WORDS[band]}</p>
          </>
        ) : (
          <p className="text-stone-300">Hasn’t heard it yet.</p>
        )}
      </section>

      {k ? (
        <dl className="flex flex-col gap-2">
          <div>
            <dt className="text-xs text-stone-400">Heard from</dt>
            <dd className="text-stone-100">
              {k.heardFromId === null ? 'Started it' : `${engine.characters[k.heardFromId]?.name ?? 'Someone'} at ${formatTick(k.heardAtTick)}`}
            </dd>
          </div>
          {variant ? (
            <div>
              <dt className="text-xs text-stone-400">Their version</dt>
              <dd className="text-stone-100">“{variant.text}”</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-stone-400">Told</dt>
            <dd className="text-stone-100">{names(k.sharedWithIds, engine.characters)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-400">Checked the facts</dt>
            <dd className="text-stone-100">{k.verified === 'none' ? 'No' : 'Yes'}</dd>
          </div>
          {k.knowsCorrection ? <p className="text-emerald-300">✓ Knows the real story</p> : null}
        </dl>
      ) : null}
    </aside>
  );
}
