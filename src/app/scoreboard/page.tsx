import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Empty, Badge, fmt } from "@/components/ui";
import { fmtDur } from "@/lib/downtime";
import { ShiftCard, F } from "@/components/ShiftCard";
import { getShiftReport } from "@/lib/misShift";
import { scoreRange, scoreStations, MIN_SHIFTS_TO_RANK, type ShiftScore, type PersonScore } from "@/lib/shiftScore";
import { isAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

export default async function ScoreboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  // Admin only — this ranks named people and drives money. Middleware gates the
  // route as well; this is the in-page check other admin screens also carry.
  if (!(await isAdmin())) redirect("/");

  const sp = await searchParams;
  const istToday = ymd(new Date(Date.now() + 330 * 60000));
  const dayAgo = (n: number) => ymd(new Date(Date.now() + 330 * 60000 - n * 864e5));
  const from = sp.from?.trim() || dayAgo(6);
  const to = sp.to?.trim() || istToday;

  const data = await scoreRange(from, to).catch(() => null);
  // Incharges are ranked in their own tables above; excluding them here stops
  // the same shifts being counted twice on two boards.
  const inchargeNames = data
    ? [...new Set([...data.byRole.production, ...data.byRole.electrical, ...data.byRole.mechanical].map((p) => p.person))]
    : [];
  const stations = await scoreStations(from, to, inchargeNames).catch(() => []);

  // The cards are the same component the MIS page draws, one per shift that
  // actually recorded something in the range.
  const cards = data
    ? (await Promise.all(
        data.shifts.map(async (s) => ({ s, report: await getShiftReport(s.anchor, s.shift).catch(() => null) })),
      ))
        .filter((x) => x.report)
        // newest first — the shift people care about is the one that just ended
        .sort((a, b) => (b.s.anchor + b.s.shift).localeCompare(a.s.anchor + a.s.shift))
    : [];

  const presets = [
    { label: "Last 7 days", f: dayAgo(6), t: istToday },
    { label: "Last 14 days", f: dayAgo(13), t: istToday },
    { label: "This month", f: istToday.slice(0, 8) + "01", t: istToday },
    { label: "Last 30 days", f: dayAgo(29), t: istToday },
  ];
  const href = (f: string, t: string) => `/scoreboard?from=${f}&to=${t}`;


  const uptimeBoard = (rows: PersonScore[], empty: string) => rows.length === 0 ? <Empty>{empty}</Empty> : (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
            <th className="py-2 pr-4">#</th><th className="py-2 pr-4">Person</th>
            <th className="py-2 pr-4">Shifts</th><th className="py-2 pr-4">Stoppage</th>
            <th className="py-2 pr-4">Per shift</th><th className="py-2 pr-4">Uptime</th>
            <th className="py-2">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.person} className="border-t border-gray-100">
              <td className="py-2 pr-4 text-gray-400">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</td>
              <td className="py-2 pr-4 font-medium text-gray-900">{p.person}</td>
              <td className="py-2 pr-4 text-gray-600">{fmt(p.shifts)}</td>
              <td className="py-2 pr-4 text-gray-600">{fmtDur(p.downtimeMin)}</td>
              <td className="py-2 pr-4 text-gray-600">{fmtDur(Math.round(p.downtimePerShift))}</td>
              <td className={`py-2 pr-4 font-semibold ${(p.uptime ?? 0) >= 0.95 ? "text-green-700" : (p.uptime ?? 0) >= 0.9 ? "text-amber-700" : "text-red-600"}`}>{pct(p.uptime)}</td>
              <td className="py-2 text-gray-900">{p.share ? `${(p.share * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const board = (rows: PersonScore[], empty: string) => rows.length === 0 ? <Empty>{empty}</Empty> : (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
            <th className="py-2 pr-4">#</th>
            <th className="py-2 pr-4">Person</th>
            <th className="py-2 pr-4">Shifts</th>
            <th className="py-2 pr-4">Slabs</th>
            <th className="py-2 pr-4">Quality</th>
            <th className="py-2 pr-4">Points</th>
            <th className="py-2 pr-4">Per shift</th>
            <th className="py-2">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.person} className={`border-t border-gray-100 ${p.qualified ? "" : "text-gray-400"}`}>
              <td className="py-2 pr-4 text-gray-400">{!p.qualified ? "—" : i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</td>
              <td className={`py-2 pr-4 font-medium ${p.qualified ? "text-gray-900" : ""}`}>
                {p.person}
                {!p.qualified && <div className="text-[11px] font-normal">no shifts recorded</div>}
              </td>
              <td className="py-2 pr-4">{fmt(p.shifts)}</td>
              <td className="py-2 pr-4">{fmt(p.quantity)}</td>
              <td className="py-2 pr-4">{pct(p.quality)}</td>
              <td className="py-2 pr-4">{fmt(p.points)}</td>
              <td className={`py-2 pr-4 font-semibold ${p.qualified ? "text-brand" : ""}`}>{p.pointsPerShift.toFixed(0)}</td>
              <td className="py-2">{p.share ? `${(p.share * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const scoreLine = (s: ShiftScore) => (
    <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-gray-100 pt-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
      <F label="Pressed (quantity)">{fmt(s.quantity)}</F>
      <F label="Quality">
        <span className={s.quality == null ? "text-gray-400" : s.quality >= 0.7 ? "text-green-700" : s.quality >= 0.4 ? "text-amber-700" : "text-red-600"}>
          {pct(s.quality)}
        </span>
      </F>
      <F label="A / B / C">{fmt(s.gradeA)} / {fmt(s.gradeB)} / {fmt(s.gradeC)}</F>
      <F label="Graded / awaiting QC">{fmt(s.graded)}{s.ungraded ? ` / ${fmt(s.ungraded)}` : ""}</F>
      <F label="Points"><span className="text-brand">{fmt(s.points)}</span></F>
      <F label="Team">{s.crew.production.join(", ") || "—"}{s.crew.electrical.length || s.crew.mechanical.length ? <div className="text-[11px] font-normal text-gray-400">E: {s.crew.electrical.join(", ") || "—"} · M: {s.crew.mechanical.join(", ") || "—"}</div> : null}</F>
    </div>
  );

  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">Shift scoreboard</h1>
      <p className="mb-5 max-w-3xl text-sm text-gray-500">
        Scored on the only two things that say how good a shift was: <b>quantity</b> (slabs it pressed) and
        <b>quality</b> (what QC finally graded those same slabs — A 100%, B 50%, C 0%). Quality follows the slab,
        not the clock: polishing runs days behind the press, so grading by window would score another shift&rsquo;s
        work. The two are multiplied, never added — a shift cannot buy a bad axis with a good one. Everyone named
        on a shift shares that shift&rsquo;s score, because production is a team result.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {presets.map((p) => {
          const active = from === p.f && to === p.t;
          return <Link key={p.label} href={href(p.f, p.t)} className={`rounded-full px-3 py-1 text-xs font-medium transition ${active ? "bg-brand text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{p.label}</Link>;
        })}
      </div>
      <form method="GET" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">From</span><input type="date" name="from" defaultValue={from} className="rounded-md border border-gray-300 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">To</span><input type="date" name="to" defaultValue={to} className="rounded-md border border-gray-300 px-3 py-2 text-sm" /></label>
        <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Apply</button>
      </form>

      {!data && <Empty>Could not build the scoreboard.</Empty>}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Shifts scored" value={fmt(data.shifts.length)} />
            <Kpi label="Slabs pressed" value={fmt(data.totals.quantity)} />
            <Kpi label="Quality (QC)" value={pct(data.totals.quality)} sub="A = 100% · B = 50% · C = 0%" />
            <Kpi label="Total points" value={fmt(data.totals.points)} />
            <Kpi label="Graded by QC" value={fmt(data.totals.graded)} sub={data.totals.quantity ? `${Math.round(data.totals.graded / data.totals.quantity * 100)}% of pressed` : undefined} />
          </div>

          {data.totals.quantity > 0 && data.totals.graded / data.totals.quantity < 0.75 && (
            <Card className="mb-6 border-amber-300 bg-amber-50">
              <p className="text-sm text-amber-900">
                <b>Incomplete — QC has not caught up.</b> Only {fmt(data.totals.graded)} of {fmt(data.totals.quantity)} slabs
                ({Math.round(data.totals.graded / data.totals.quantity * 100)}%) pressed in this range have been graded.
                Polishing runs days behind the press, so a range ending today will always look thin. Score a month
                only once QC has worked through it — {fmt(data.totals.ungraded)} slab(s) here are still awaiting a grade
                and are excluded from quality rather than counted as bad.
              </p>
            </Card>
          )}

          {(["production", "electrical", "mechanical"] as const).map((role) => {
            const rows = data.byRole[role];
            const label = role === "production" ? "Production incharge"
              : role === "electrical" ? "Electrical incharge" : "Mechanical incharge";
            return (
              <Card key={role} className="mb-6">
                <H2>{label}</H2>
                <p className="mb-3 mt-1 text-xs text-gray-500">
                  {role === "production"
                    ? "Runs the shift and carries its full score. This is the ranking the shift incentive is built on."
                    : "Ranked on UPTIME, not slabs — this role's job is keeping the line running. MIS records breakdown as one “mechanical or electrical” figure, so both trades are measured on the same stoppage; powerout counts against electrical only."}
                  {" "}Ranked on <b>points per shift</b>, not the total — 3 shifts making 300 good slabs beats 10
                  making 500, however many shifts each person worked. <b>Share</b> is the slice of this role&rsquo;s per-shift points; payroll applies it to
                  each person&rsquo;s own salary.
                </p>
                {role === "production"
                  ? board(rows, "Nobody recorded in this role for the range.")
                  : uptimeBoard(rows, "Nobody recorded in this role for the range.")}
              </Card>
            );
          })}

          {stations.some((st) => st.operators.length > 0) && (
            <>
              <H2>Operators by station</H2>
              <p className="mb-3 mt-1 text-xs text-gray-500">
                The individual at the machine, not the shift team: the slabs they personally recorded there and how
                QC graded those same slabs. Attribution is their own name on their own row, so it does not depend on
                the MIS slab range. Incharges are left out here — they are ranked in their own tables above, and
                counting them in both would score the same shifts twice.
              </p>
              {stations.filter((st) => st.operators.length > 0).map((st) => (
                <Card key={st.key} className="mb-6">
                  <H2>{st.label}</H2>
                  <div className="mt-3">{board(st.operators, "No operator recorded here in this range.")}</div>
                </Card>
              ))}
            </>
          )}

          <H2>Shifts in this range</H2>
          <p className="mb-3 mt-1 text-xs text-gray-500">{cards.length} shift(s) recorded between {from} and {to}.</p>
          {cards.length === 0 && <Empty>No shift recorded anything in this range.</Empty>}
          {cards.map(({ s, report }) => (
            <ShiftCard
              key={`${s.anchor}-${s.shift}`}
              s={report!}
              title={`Shift ${s.shift} · ${s.anchor}`}
              extra={scoreLine(s)}
            />
          ))}
        </>
      )}
    </Shell>
  );
}
