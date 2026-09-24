import Link from 'next/link';
import { DemoTown } from '@/ui/town/DemoTown';

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-8 px-4 pb-12 pt-12 md:pt-16">
        <header className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-[var(--accent)] md:text-5xl">Rumor Town</h1>
          <p className="max-w-xl text-lg text-stone-200">
            Start a rumor. Watch a whole town pass it on, twist it, doubt it, and set it straight.
          </p>
        </header>

        <DemoTown />

        <div className="flex flex-col items-center gap-3">
          <Link href="/play" className="btn-primary px-8 text-lg">
            Start a Rumor
          </Link>
          <a href="#how" className="text-sm text-stone-300 underline-offset-4 hover:underline">
            How it works
          </a>
        </div>

        <section id="how" className="w-full max-w-md scroll-mt-8 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-400">How it works</h2>
          <ol className="flex flex-col gap-2 text-stone-100">
            <li>1. Someone hears it.</li>
            <li>2. They tell others, and the story shifts as it goes.</li>
            <li>3. Some check the facts and set people straight.</li>
          </ol>
        </section>
      </main>
      <footer className="py-6 text-center text-xs text-stone-500">Made with Vercel AI Gateway</footer>
    </div>
  );
}
