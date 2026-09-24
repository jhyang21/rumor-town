import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { loadRecord } from '@/lib/blob';
import { ResultsPanel } from '@/ui/results/ResultsPanel';
import { TownStill } from '@/ui/results/TownStill';
import { INK } from '@/ui/results/colors';

export const dynamic = 'force-dynamic';

const getRecord = cache(async (id: string) => {
  try {
    return await loadRecord(id);
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: PageProps<'/r/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const record = await getRecord(id);
  if (!record) return { title: 'Rumor Town' };
  const title = `Rumor Town — ${record.stats.heard} of ${record.stats.population} heard it`;
  const description = record.config.rumor.text;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function SharePage({ params }: PageProps<'/r/[id]'>) {
  const { id } = await params;
  const record = await getRecord(id);
  if (!record) notFound();
  // Send each client component only what it reads: the panel never needs the oracle log or the
  // dialogue, and the town still needs nothing else.
  const panelRecord = { ...record, oracleLog: [], conversations: [] };
  const stillRecord = { config: record.config, oracleLog: record.oracleLog, stats: record.stats };

  return (
    <main className="flex-1 px-4 py-6 sm:py-10" style={{ background: '#efe4cc' }}>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <p className="text-sm font-semibold" style={{ color: INK.text }}>
          <Link href="/" className="hover:underline">
            Rumor Town
          </Link>
        </p>
        <ResultsPanel record={panelRecord} actions={{}} standalone />
        <section className="space-y-3 rounded-2xl p-4 sm:p-6" style={{ background: INK.surface, color: INK.text }} aria-labelledby="town-still">
          <h2 id="town-still" className="text-base font-semibold">
            The town at the end of the day
          </h2>
          <TownStill record={stillRecord} />
        </section>
        <div className="flex justify-center pb-4">
          <Link
            href="/play"
            className="inline-flex min-h-11 items-center rounded-lg px-5 text-base font-semibold"
            style={{ background: INK.accent, color: INK.accentText }}
          >
            Start your own rumor
          </Link>
        </div>
      </div>
    </main>
  );
}
