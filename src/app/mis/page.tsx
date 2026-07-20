import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Empty, Badge, fmt } from "@/components/ui";
import { getDowntimeReport, fmtDur, DELAY_FIELDS } from "@/lib/downtime";
import { getDowntimeResponses } from "@/lib/downtimeResponse";
import { canRespondDowntime } from "@/lib/rbac";
import { DowntimeRespond } from "@/components/DowntimeRespond";
import { getLastShiftReport } from "@/lib/misShift";

export const dynamic = "force-dynamic";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default async function MisPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; b?: string; type?: string }> }) {
  const sp = await searchParams;
  const istToday = ymd(new Date(Date.now() + 330 * 60000)); // IST calendar day
  const from = sp.from?.trim() || istToday; // default: today (IST)
  const to = sp.to?.trim() || istToday;
  const batch = sp.b?.trim() || "";

  let r: Awaited<ReturnType<typeof getDowntimeReport>> | null = null;
  let error: string | null = null;
  try { r = await getDowntimeReport({ from, to, batch: batch || undefined, type: sp.type }); }
  catch { error = "Could not read the MIS log."; }
  const respMap = r ? await getDowntimeResponses(r.incidents.map((i) => i.id)) : null;
  const canRespond = await canRespondDowntime();
  const lastShift = await getLastShiftReport();

  // link to this page preserving the active filters, with overrides
  const link = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (batch) q.set("b", batch);
    for (const [k, v] of Object.entries(extra)) { if (v) q.set(k, v); }
    const s = q.toString();
    return s ? `/mis?${s}` : "/mis";
  };

  // quick-range presets (preserve the batch filter)
  const today = istToday;
  const dayAgo = (n: number) => ymd(new Date(Date.now() + 330 * 60000 - n * 864e5));
  const mStart = istToday.slice(0, 8) + "01";
  const presets = [
    { label: "Today", f: today, t: today },
    { label: "Yesterday", f: dayAgo(1), t: dayAgo(1) },
    { label: "Last 7 days", f: dayAgo(6), t: today },
    { label: "Last 30 days", f: dayAgo(29), t: today },
    { label: "This month", f: mStart, t: today },
  ];
  const presetHref = (f: string, t: string) => { const q = new URLSearchParams(); q.set("from", f); q.set("to", t); if (batch) q.set("b", batch); return `/mis?${q.toString()}`; };
  // Excel export of the breakdown log — SAME filters as the current view (incl. any type filter)
  const exportHref = (() => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (batch) q.set("b", batch);
    if (r?.typeFilter) q.set("type", r.typeFilter);
    return `/api/mis/export?${q.toString()}`;
  })();

  const maxReason = r ? Math.max(1, ...r.byReason.map((x) => x.minutes)) : 1;
  const maxTrend = r ? Math.max(1, ...r.trend.map((x) => x.minutes)) : 1;
  const maxHour = r ? Math.max(1, ...r.byHour.map((x) => x.minutes)) : 1;
  const maxDesign = r ? Math.max(1, ...r.designs.map((x) => x.slabs)) : 1;
  const outBase = r ? Math.max(1, r.achievable, r.target, r.actualSlabs) : 1;

  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">Production downtime</h1>
      <p className="mb-5 max-w-3xl text-sm text-gray-500">
        From the MIS hourly log — stoppage time by type and reason, the daily trend, output (slabs &amp; designs made, achievable vs actual), and the breakdown/RCA log.{" "}
        {batch ? `Showing batch ${r?.batch}.` : `Range ${from} to ${to}.`}
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {presets.map((pp) => {
          const active = from === pp.f && to === pp.t;
          return <Link key={pp.label} href={presetHref(pp.f, pp.t)} className={`rounded-full px-3 py-1 text-xs font-medium transition ${active ? "bg-brand text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{pp.label}</Link>;
        })}
      </div>
      <form method="GET" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">From</span><input type="date" name="from" defaultValue={from} className="rounded-md border border-gray-300 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">To</span><input type="date" name="to" defaultValue={to} className="rounded-md border border-gray-300 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Batch (optional)</span><input name="b" defaultValue={batch} placeholder="e.g. 1347" className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm" /></label>
        <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Apply</button>
        {batch && <Link href="/mis" className="text-sm text-brand hover:underline">clear batch</Link>}
      </form>

      {error && <Empty>{error}</Empty>}
      {lastShift && (
        <Card className="mb-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <H2>Last shift report</H2>
            <Badge tone="brand">Shift {lastShift.shift} · {lastShift.date} · {lastShift.window}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div><div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Production incharge</div>
              <div className="mt-0.5 font-semibold text-gray-900">{lastShift.prodIncharge ?? (lastShift.submitters.length ? lastShift.submitters.join(", ") : "—")}</div>
              {!lastShift.prodIncharge && lastShift.submitters.length > 0 && <div className="text-[11px] text-gray-400">from who submitted the entries</div>}</div>
            <div><div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Electrical incharge</div>
              <div className="mt-0.5 font-semibold text-gray-900">{lastShift.elecIncharge ?? "—"}</div></div>
            <div><div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Mechanical incharge</div>
              <div className="mt-0.5 font-semibold text-gray-900">{lastShift.mechIncharge ?? "—"}</div></div>
            <div><div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Hours logged</div>
              <div className="mt-0.5 font-semibold text-gray-900">{lastShift.hoursLogged}/{lastShift.hoursTotal}</div></div>
            <div><div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Slabs pressed</div>
              <div className="mt-0.5 font-semibold text-gray-900">{fmt(lastShift.slabs)}</div></div>
            <div><div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Downtime</div>
              <div className={`mt-0.5 font-semibold ${lastShift.delayMin > 0 ? "text-amber-700" : "text-gray-900"}`}>{lastShift.delayMin > 0 ? fmtDur(lastShift.delayMin) : "none"}</div></div>
            <div><div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Batch / design</div>
              <div className="mt-0.5 font-semibold text-gray-900">{[...lastShift.batches, ...lastShift.designs].slice(0, 4).join(", ") || "—"}</div></div>
          </div>
          {lastShift.areas.length > 0 && <p className="mt-3 text-xs text-amber-700">Problem areas: {lastShift.areas.join(", ")}</p>}
        </Card>
      )}
      {!error && r && (
        <div className="space-y-6">
          {r.overCap > 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              ⚠ {r.overCap} hour-row(s) log more than 60 min of delay — impossible in a 60-minute hour, so these are entry errors. They&apos;re flagged ⚠ in the log below; fix them in the MIS table.
            </div>
          )}
          {r.unloggedBatches > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ⚠ {fmt(r.unloggedBatches)} of {fmt(r.pressBatches)} pressed batch(es) have <strong>no MIS entry</strong> — their downtime, target and reasons aren&apos;t tracked. Log MIS for: {r.unloggedBatchList.slice(0, 30).join(", ")}{r.unloggedBatches > 30 ? ` +${r.unloggedBatches - 30} more` : ""}.
            </div>
          )}
          {/* ---- Output: slabs & designs made, achievable vs actual ---- */}
          <div>
            <H2>Output</H2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <Kpi label="Slabs made (actual)" value={fmt(r.actualSlabs)} sub={r.misFallbackSlabs > 0 ? `incl. ${fmt(r.misFallbackSlabs)} from MIS hourly log — press entry pending` : "distinct slabs pressed"} />
              <Kpi label="Achievable" value={fmt(r.achievable)} sub="target − downtime" />
              <Kpi label="Target" value={fmt(r.target)} sub={`24/12 per hr × ${r.productiveHours}h productive`} />
              <Kpi label="Lost to downtime" value={fmt(r.lost)} sub="achievable - actual" className={r.lost > 0 ? "ring-1 ring-amber-300" : ""} />
              <Kpi label="Designs made" value={fmt(r.designs.length)} sub={r.designs.length === 0 ? "distinct designs" : r.designs.length <= 2 ? r.designs.map((d) => d.design).join(", ") : `${fmt(r.designs.length)} distinct designs`} />
            </div>
            <Card className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Achievable vs actual</div>
              <div className="space-y-1.5 text-sm">
                {[{ k: "Target", v: r.target, c: "bg-gray-300" }, { k: "Achievable", v: r.achievable, c: "bg-brand/60" }, { k: "Actual made", v: r.actualSlabs, c: "bg-green-500" }].map((b) => (
                  <div key={b.k} className="flex items-center gap-3">
                    <div className="w-28 shrink-0 text-gray-600">{b.k}</div>
                    <div className="h-4 flex-1 rounded bg-gray-100"><div className={`h-4 rounded ${b.c}`} style={{ width: `${Math.max(2, Math.round((100 * b.v) / outBase))}%` }} /></div>
                    <div className="w-16 shrink-0 text-right font-medium text-gray-700">{fmt(b.v)}</div>
                  </div>
                ))}
              </div>
              {r.lost > 0 && <p className="mt-2 text-xs text-amber-700">~{fmt(r.lost)} slab(s) lost to downtime (achievable - actual). Total downtime {fmtDur(r.totalMinutes)}.</p>}
              <p className="mt-2 text-[11px] text-gray-400">Target = capacity: 21 productive h/day (3 h cleaning) at the rate that ran each hour - 24 slabs/hr normal, 12/hr robo - over {fmt(r.daysCounted)} day(s) = {r.productiveHours} productive h (the in-progress day is prorated to hours elapsed) (this period: {fmt(r.roboHours)} robo hr @ 12, {fmt(r.normalHours)} normal hr @ 24). Achievable subtracts unplanned downtime + cleaning beyond 3 h/day. Lost = Achievable - Actual. {fmt(r.pressBatches - r.unloggedBatches)} of {fmt(r.pressBatches)} pressed batches have MIS entries.</p>
            </Card>
          </div>

          {/* ---- Downtime KPIs (clickable type cards) ---- */}
          <div>
            <H2>Downtime {batch ? `· batch ${r.batch}` : ""}</H2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <Link href={link({})} className="block h-full rounded-2xl transition hover:ring-2 hover:ring-brand/30">
                <Kpi label="Total downtime" value={fmtDur(r.totalMinutes)} sub={`${r.hoursLogged} logged hour(s)`} />
              </Link>
              {r.byType.map((t) => (
                <Link key={t.key} href={link({ type: t.key })} className={`block h-full rounded-2xl transition hover:ring-2 hover:ring-brand/30 ${r.typeFilter === t.key ? "ring-2 ring-brand" : ""}`}>
                  <Kpi label={t.label} value={fmtDur(t.minutes)} sub={`${t.incidents} incident(s) · view`} />
                </Link>
              ))}
            </div>
          </div>

          <Card>
            <H2>Downtime by reason</H2>
            {r.byReason.length === 0 ? <p className="text-sm text-gray-400">No deviations logged in this range.</p> : (
              <div className="space-y-1.5">
                {r.byReason.slice(0, 20).map((x) => (
                  <div key={x.reason} className="flex items-center gap-3 text-sm">
                    <div className="w-56 shrink-0 truncate text-gray-700" title={x.reason}>{x.reason}</div>
                    <div className="h-4 flex-1 rounded bg-gray-100"><div className="h-4 rounded bg-brand" style={{ width: `${Math.max(2, Math.round((100 * x.minutes) / maxReason))}%` }} /></div>
                    <div className="w-28 shrink-0 text-right text-gray-600">{fmtDur(x.minutes)} · {x.incidents}&times;</div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] text-gray-400">Minutes = downtime of the hours that cited each reason (an hour with two reasons counts toward both); incident count is exact.</p>
          </Card>

          <Card>
            <H2>Daily downtime</H2>
            {r.trend.length === 0 ? <p className="text-sm text-gray-400">No downtime in this range.</p> : (
              <div className="space-y-1.5">
                {r.trend.map((x) => (
                  <div key={x.day} className="flex items-center gap-3 text-sm">
                    <div className="w-24 shrink-0 text-gray-500">{x.day}</div>
                    <div className="h-4 flex-1 rounded bg-gray-100"><div className="h-4 rounded bg-amber-400" style={{ width: `${Math.max(2, Math.round((100 * x.minutes) / maxTrend))}%` }} /></div>
                    <div className="w-20 shrink-0 text-right text-gray-600">{fmtDur(x.minutes)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <H2>Downtime by hour of day</H2>
            {r.byHour.length === 0 ? <p className="text-sm text-gray-400">No downtime in this range.</p> : (
              <div className="space-y-1.5">
                {r.byHour.map((x) => (
                  <div key={x.hour} className="flex items-center gap-3 text-sm">
                    <div className="w-20 shrink-0 text-gray-500">{x.hour}</div>
                    <div className="h-4 flex-1 rounded bg-gray-100"><div className="h-4 rounded bg-rose-400" style={{ width: `${Math.max(2, Math.round((100 * x.minutes) / maxHour))}%` }} /></div>
                    <div className="w-24 shrink-0 text-right text-gray-600">{fmtDur(x.minutes)} · {x.incidents}&times;</div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] text-gray-400">Each hour-of-day slot is summed across every matching hour in the range (e.g. all the 06–07 hours in the period) — not one hour, which caps at 60 min. For a one-day range it&apos;s that day&apos;s hourly downtime.</p>
          </Card>

          <Card>
            <H2>Designs made · {r.designs.length}</H2>
            {r.designs.length === 0 ? <p className="text-sm text-gray-400">No press records in this range.</p> : (
              <div className="space-y-1.5">
                {r.designs.slice(0, 25).map((x) => (
                  <Link key={x.design} href={x.design === "—" ? link({}) : `/batch?d=${encodeURIComponent(x.design)}`} className="flex items-center gap-3 rounded text-sm hover:bg-gray-50">
                    <div className="w-56 shrink-0 truncate text-brand hover:underline" title={x.design}>{x.design}</div>
                    <div className="h-4 flex-1 rounded bg-gray-100"><div className="h-4 rounded bg-green-500" style={{ width: `${Math.max(2, Math.round((100 * x.slabs) / maxDesign))}%` }} /></div>
                    <div className="w-20 shrink-0 text-right text-gray-600">{fmt(x.slabs)} slab(s)</div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <H2>Breakdown &amp; deviation log · {r.incidents.length}</H2>
              {r.incidents.length > 0 && (
                <a href={exportHref} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">↓ Download (Excel)</a>
              )}
            </div>
            {/* Sub-filter: narrow the log to one delay type (preserves the date/batch view) */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium uppercase tracking-wider text-gray-400">Type</span>
              <Link href={link({ type: null })} scroll={false} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${!r.typeFilter ? "border-brand bg-brand text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>All</Link>
              {DELAY_FIELDS.map((d) => (
                <Link key={d.key} href={link({ type: d.key })} scroll={false} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${r.typeFilter === d.key ? "border-brand bg-brand text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>{d.label}</Link>
              ))}
            </div>
            {r.incidents.length === 0 ? <p className="text-sm text-gray-400">No incidents logged in this range.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500">
                    <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Hour</th><th className="py-2 pr-3">Batch</th>
                    <th className="py-2 pr-3">Down</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Reason(s)</th><th className="py-2 pr-3">Details / RCA / action</th><th className="py-2 pr-3">Electrical incharge</th><th className="py-2 pr-3">Mechanical incharge</th><th className="py-2">Maintenance response</th>
                  </tr></thead>
                  <tbody>
                    {r.incidents.map((i, k) => (
                      <tr key={k} className="border-t border-gray-100 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{i.date ?? "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{i.hour ?? "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.batch ? <Link href={`/batch?b=${encodeURIComponent(i.batch)}`} className="text-brand hover:underline">{i.batch}</Link> : "—"}</td>
                        <td className={`py-2 pr-3 whitespace-nowrap font-medium ${i.over ? "text-red-600" : "text-gray-900"}`} title={i.over ? "Over 60 min in one hour — entry error" : undefined}>{(() => { const m = r.typeFilter ? i.minutesByType[r.typeFilter] ?? 0 : i.minutes; return m > 0 ? fmtDur(m) : "—"; })()}{i.over ? " ⚠" : ""}</td>
                        <td className="py-2 pr-3 text-gray-600">{r.typeFilter
                          ? (DELAY_FIELDS.find((d) => d.key === r.typeFilter)?.label ?? "—")
                          : Object.keys(i.minutesByType).length > 1
                            ? DELAY_FIELDS.filter((d) => i.minutesByType[d.key]).map((d) => `${d.label} ${fmtDur(i.minutesByType[d.key])}`).join(" · ")
                            : i.types.join(", ") || "—"}</td>
                        <td className="py-2 pr-3 text-gray-600">{(r.typeFilter ? i.reasonsByType[r.typeFilter] ?? [] : i.reasons).join(", ") || "—"}</td>
                        <td className="py-2 pr-3 text-gray-600">{[i.details, i.rca ? `RCA ${i.rca}` : null, i.action, i.spares ? `spares: ${i.spares}` : null].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.elecIncharge || "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.mechIncharge || "—"}</td>
                        <td className="py-2 align-top"><DowntimeRespond misId={i.id} canRespond={canRespond} status={respMap?.get(i.id)?.status ?? null} note={respMap?.get(i.id)?.note ?? null} by={respMap?.get(i.id)?.by ?? null} at={respMap?.get(i.id)?.at ?? null} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
