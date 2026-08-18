/** Branded loading screen shown by route-level loading.tsx files while the
 * server renders the page. Mirrors the app frame (sidebar + content shimmer)
 * so navigation feels instant instead of blank. */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex min-h-screen">
      {/* sidebar ghost (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-gray-200/70 bg-white/70 px-4 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pacific-dark shadow-sm"><img src="/logo-white.png" alt="" className="h-5 w-5 object-contain" /></div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-gray-900">Pacific ERP</div>
            <div className="text-[11px] text-gray-400">loading…</div>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2">
              <div className="h-[18px] w-[18px] animate-pulse rounded bg-gray-200" />
              <div className="h-3.5 animate-pulse rounded bg-gray-200" style={{ width: `${60 + ((i * 23) % 35)}%`, animationDelay: `${i * 80}ms` }} />
            </div>
          ))}
        </div>
      </aside>

      {/* content shimmer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <div className="mb-2 flex items-center gap-3">
            <svg className="h-5 w-5 animate-spin text-brand" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
            </svg>
            <div className="h-6 w-48 animate-pulse rounded-lg bg-gray-200" />
          </div>
          <div className="mb-6 h-4 w-72 animate-pulse rounded bg-gray-100" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl border border-gray-100 bg-white/80" style={{ animationDelay: `${i * 100}ms` }} />
            ))}
          </div>
          <div className="mt-5 space-y-3">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl border border-gray-100 bg-white/80" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
