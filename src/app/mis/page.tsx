import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Empty, Badge, fmt } from "@/components/ui";
import { getDowntimeReport, fmtDur } from "@/lib/downtime";
import { getDowntimeResponses } from "@/lib/downtimeResponse";
import { photosForRecords } from "@/lib/entryPhoto";
import { canRespondDowntime } from "@/lib/rbac";
import { DowntimeLogCard } from "./DowntimeLogCard";
import { getLastShiftReport, getCurrentShiftReport, getPreviousShiftReport, currentShiftAnchor } from "@/lib/misShift";
import { SHIFT_WINDOW } from "@/lib/misShiftHours";

export const dynamic = "force-dynamic";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</div>
    <div className="mt-0.5 font-semibold text-gray-900">{children}</div>
  </div>
);

function ShiftCard({ s, title, live = false }: {
  s: Awaited<ReturnType<typeof getLastShiftReport>> & object; title: string; live?: boolean;
}) {
  const graded = s.gradeA + s.gradeB + s.gradeC;
  return (
    <Card className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <H2>{title}</H2>
        <Badge tone="brand">Shift {s.shift} · {s.date} · {s.window}</Badge>
        {live && <Badge tone="amber">in progress · {s.hoursLogged}/{s.hoursTotal} hrs logged</Badge>}
      </div>
      {/* Press line — everything here describes what came off the press. */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <F label="Production incharge">
          {s.prodIncharge ?? (s.submitters.length ? s.submitters.join(", ") : "—")}
          {!s.prodIncharge && s.submitters.length > 0 && <div className="text-[11px] font-normal text-gray-400">from who submitted the entries</div>}
        </F>
        <F label="Electrical incharge">{s.elecIncharge ?? "—"}</F>
        <F label="Mechanical incharge">{s.mechIncharge ?? "—"}</F>
        <F label="Hours logged">{s.hoursLogged}/{s.hoursTotal}</F>
        <F label="Slabs pressed">{fmt(s.slabs)}</F>
        <F label="Downtime">
          <span className={s.delayMin > 0 ? "text-amber-700" : ""}>{s.delayMin > 0 ? fmtDur(s.delayMin) : "none"}</span>
        </F>
        <F label="Batch / design pressed">{[...s.batches, ...s.designs].slice(0, 4).join(", ") || "—"}</F>
      </div>

      {/* Polish line — kept separate on purpose. Polish runs behind the press, so
          these slabs are usually a different batch from the one being pressed. */}
      <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-gray-100 pt-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <F label="Slabs polished">{fmt(s.polished)}</F>
        <F label="Grade A">{fmt(s.gradeA)}</F>
        <F label="Grade B">{fmt(s.gradeB)}</F>
        <F label="Grade C">{fmt(s.gradeC)}</F>
        <div className="col-span-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Last polished batch / design</div>
          <div className="mt-0.5 font-semibold text-gray-900">
            {[s.lastPolishedBatch, s.lastPolishedDesign].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      </div>
      {s.polished > 0 && graded < s.polished && (
        <p className="mt-3 text-xs text-gray-400">{fmt(s.polished - graded)} of {fmt(s.polished)} polished slabs are ungraded or graded A2/CTS/Printing.</p>
      )}
      {s.areas.length > 0 && <p className="mt-3 text-xs text-amber-700">Problem areas: {s.areas.join(", ")}</p>}
    </Card>
  );
}

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
  // null with incidents present = the LOOKUP failed (not "nobody responded"). Show the
  // saved-response column as unknown and disable responding for this load — a fresh save
  // against an unseen earlier response would overwrite it blind.
  const respFailed = !!r && r.incidents.length > 0 && respMap === null;
  const canRespond = (await canRespondDowntime()) && !respFailed;
  // Map -> plain object: props crossing into the client log card must be serializable.
  const responses: Record<string, import("@/lib/downtimeResponse").DowntimeResp> = {};
  if (respMap) for (const [k, v] of respMap) responses[k] = v;
  // Response photos, one query for the whole log (best-effort — an empty map just means
  // no 📷 chips). Stored against the MIS row in entry_photo, served by /api/photo.
  const photoMap = r ? await photosForRecords("Mis", r.incidents.map((i) => i.id)) : new Map<string, { id: string; filename: string }[]>();
  const photos: Record<string, { id: string; filename: string }[]> = {};
  for (const [k, v] of photoMap) photos[k] = v;
  // Both cards are keyed off the CLOCK, not off which shift logged most
  // recently — for most of any shift the newest MIS row belongs to the running
  // shift, so recency would label the shift in progress "last shift report"
  // and there would be nothing left to show as current.
  const nowShift = currentShiftAnchor();
  const [currentShift, prevShift] = await Promise.all([
    getCurrentShiftReport(),
    getPreviousShiftReport(),
  ]);
  // Normally the shift immediately before this one. If it logged nothing (plant
  // idle, missed entries) fall back to the most recent shift that did report,
  // which is what this card showed before — but never the running shift, or it
  // would appear twice.
  let lastShift = prevShift;
  if (!lastShift) {
    const logged = await getLastShiftReport();
    if (logged && !(logged.shift === nowShift.shift && logged.date === nowShift.anchor)) lastShift = logged;
  }

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
  // (The Excel export link lives in DowntimeLogCard now, so it follows the client-side type filter.)

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
      {currentShift && <ShiftCard s={currentShift} title="Current shift" live />}
      {!currentShift && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <H2>Current shift</H2>
            <Badge tone="brand">Shift {nowShift.shift} · {nowShift.anchor} · {SHIFT_WINDOW[nowShift.shift]}</Badge>
            <Badge tone="amber">no entries logged yet</Badge>
          </div>
          <p className="mt-2 text-xs text-gray-500">Figures appear here as the shift logs its hourly MIS entries.</p>
        </Card>
      )}
      {lastShift && <ShiftCard s={lastShift} title="Last shift report" />}
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
              <Kpi label="Target" value={fmt(r.target)} sub={r.stdRate != null ? `${r.productiveHours}h productive · Std on ${fmt(r.stdHours)}/${fmt(r.ratedHours)} h` : `24/12 per hr × ${r.productiveHours}h productive`} />
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
              <p className="mt-2 text-[11px] text-gray-400">Target = capacity: 21 productive h/day (3 h cleaning) over {fmt(r.daysCounted)} day(s) = {r.productiveHours} productive h (the in-progress day is prorated to hours elapsed), at the Slabs/hr Std entered on the MIS form{r.stdRate != null ? <> — each day rated on the Std entered THAT day, so no single rate multiplies out to the total. {fmt(r.stdHours)} of {fmt(r.ratedHours)} logged rows carry a Std (mean <b>{r.stdRate}/hr</b>); a day with none — Std entry began 9 Jul 2026 — falls back to 24/hr normal · 12/hr robo, as does a day with no MIS rows at all</> : <> — no row in this range carries a Std, so the 24/hr normal · 12/hr robo blend was used throughout</>}. Achievable subtracts unplanned downtime + cleaning beyond 3 h/day. Lost = Achievable - Actual. {fmt(r.pressBatches - r.unloggedBatches)} of {fmt(r.pressBatches)} pressed batches have MIS entries.</p>
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

          {/* Type filtering happens inside the card, client-side — a chip click must not
              navigate (the searchParams change re-keys the segment, the root loading
              skeleton swaps in, and the collapse throws the scroll to the top). */}
          <DowntimeLogCard
            incidents={r.incidents}
            incidentsTotal={r.incidentsTotal}
            typeTotals={Object.fromEntries(r.byType.map((t) => [t.key, t.incidents]))}
            initialType={r.typeFilter}
            from={from} to={to} batch={batch}
            canRespond={canRespond}
            respFailed={respFailed}
            responses={responses}
            photos={photos}
          />
        </div>
      )}
    </Shell>
  );
}
