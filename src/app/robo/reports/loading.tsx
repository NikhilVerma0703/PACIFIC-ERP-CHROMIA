/** Shown the instant Robo Reports is opened, while the server renders the page.
 * Mirrors the app frame the way PageSkeleton does (Shell renders per-page, so a
 * route-level loading screen has to ghost the sidebar itself), with content
 * shaped like the reports page: filter bar, KPI cards, and chart cards. */
export default function RoboReportsLoading() {
  const card = "rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
  const bar = "animate-pulse rounded bg-slate-100";
  return (
    <div className="flex min-h-screen">
      {/* sidebar ghost (desktop) */}
      <aside className="pacific-rail sticky top-0 hidden h-screen w-64 shrink-0 overflow-hidden border-r border-gray-200/70 bg-white/70 supports-[height:100dvh]:h-dvh md:flex">
        {/* same frame as PageSkeleton: pacific-rail collapses with the real rail
            when the sidebar is hidden, the padding sits on an inner fixed column */}
        <div className="flex h-full w-64 flex-col px-4 py-5">
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
        </div>
      </aside>

      {/* content shimmer, shaped like the reports page */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-[61px] border-b border-gray-200/70 bg-white/70 md:hidden" />
        <main className="shell-main mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="mb-2 flex items-center gap-3">
            <svg className="h-5 w-5 animate-spin text-brand" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
            </svg>
            <div className="h-6 w-48 animate-pulse rounded-lg bg-gray-200" />
          </div>
          <div className="mb-6 h-4 w-72 animate-pulse rounded bg-gray-100" />

          {/* date filter ghost */}
          <div className={`${bar} h-10 w-64`} />

          {/* KPI card ghosts */}
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map(i => (
              <div key={i} className={card}>
                <div className={`${bar} h-3 w-28`} />
                <div className={`${bar} mt-2 h-7 w-20`} />
              </div>
            ))}
          </div>

          {/* chart card ghosts */}
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {[0, 1].map(i => (
              <div key={i} className={card}>
                <div className={`${bar} h-4 w-44`} />
                <div className={`${bar} mt-4 h-[230px]`} />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
