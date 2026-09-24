import Link from 'next/link';

export default function RunNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center" style={{ background: '#efe4cc', color: '#3d2b1f' }}>
      <h1 className="text-xl font-bold">We could not find that day.</h1>
      <p className="text-sm">The link may be wrong, or the day was never saved.</p>
      <Link href="/play" className="inline-flex min-h-11 items-center rounded-lg px-5 font-semibold" style={{ background: '#a2433a', color: '#fbf6ea' }}>
        Start your own rumor
      </Link>
    </main>
  );
}
