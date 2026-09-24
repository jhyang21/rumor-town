import type { Metadata } from 'next';
import { PlayScreen } from '@/ui/town/PlayScreen';

export const metadata: Metadata = {
  title: 'Play · Rumor Town',
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PlayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <PlayScreen params={{ replay: one(sp.replay), rerun: one(sp.rerun), modify: one(sp.modify) }} />;
}
