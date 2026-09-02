import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Badge, Empty, fmt } from "@/components/ui";
import { isAdmin } from "@/lib/rbac";
import { incentiveMonth, currentMonthIST, STAGES, REAL_STAGES, type Stage } from "@/lib/incentiveMonth";
import { QUALITY_FLOOR, QUALITY_TARGET, SLOW_STD_MAX, type ShiftLetter } from "@/lib/shiftScoreMath";
import { AutoRefresh } from "../AutoRefresh";

// The month tracker behind the shift incentive: what the plant has counted,
// what is still waiting at QC, and what the pool becomes when it lands. Admin
// only — middleware gates /scoreboard/* and this is the in-page check every
// admin screen carries as well.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const pct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
const inr = (n: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n));
const lakh = (n: number) => (n >= 100_000 ? `₹${(n / 100_000).toFixed(n % 100_000 ? 1 : 0)} lakh` : inr(n));
const half = (n: number) => (Number.isInteger(n) ? fmt(n) : `${fmt(Math.floor(n))}½`);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const STAGE_LABEL: Record<Stage, string> = {
  "at-qc": "At QC, not graded",
  "at-polish": "On the polish line",
  pressed: "Pressed, not at polish yet",
  nowhere: "Never seen at any station",
  routed: "Routed to CTS / Printing",
};
const STAGE_TONE: Record<Stage, "brand" | "green" | "amber" | "red"> = {
  "at-qc": "green", "at-polish": "brand", pressed: "brand", nowhere: "red", routed: "amber",
};

export default async function IncentiveMonthPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  if (!(await isAdmin())) redirect("/");
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : currentMonthIST();

  let m: Awaited<ReturnType<typeof incentiveMonth>> | null = null;
  let failure: string | null = null;
  try { m = await incentiveMonth(month); }
  catch (e) { failure = e instanceof Error ? e.message : String(e); }

  const asOfIST = m ? new Date(new Date(m.asOf).getTime() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ") + " IST" : null;

  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/scoreboard" className="text-sm text-brand hover:underline">← Shift scoreboard</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">Shift incentive — {monthLabel(month)}</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Counted good slabs against the 7,000 floor, and every claimed slab QC has not graded yet — with where it actually is.
            Figures come from the same scoring as the scoreboard; a slab graded today moves this page today.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/scoreboard/incentive?month=${shiftMonth(month, -1)}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">← {monthLabel(shiftMonth(month, -1))}</Link>
          {month < currentMonthIST() && (
            <Link href={`/scoreboard/incentive?month=${shiftMonth(month, 1)}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">{monthLabel(shiftMonth(month, 1))} →</Link>
          )}
          <AutoRefresh seconds={300} />
        </div>
      </div>

      {failure && (
        <Card className="mb-4 border-red-300 bg-red-50">
          <div className="text-sm font-semibold text-red-800">The month could not be scored</div>
          <p className="mt-1 text-sm text-red-700">{failure}</p>
          <p className="mt-1 text-xs text-red-600">This is a failure, not an empty month. Nothing on this page is missing because nobody worked.</p>
        </Card>
      )}

      {m && (() => {
        const { pool, projection, outstanding, plant, qc } = m;
        const belowFloor = pool.counted < pool.floor;
        const ladderMax = pool.ladder[pool.ladder.length - 1].slabs;
        const at = (n: number) => `${Math.max(0, Math.min(100, (n / ladderMax) * 100)).toFixed(2)}%`;
        const stageRow = (rec: Record<Stage, number>) => STAGES.filter((s) => rec[s] > 0).map((s) => (
          <Badge key={s} tone={STAGE_TONE[s]}>{fmt(rec[s])} {STAGE_LABEL[s].toLowerCase()}</Badge>
        ));
        return (
          <>
            {/* ---- Where the month stands ------------------------------------ */}
            {!m.monthEnded ? (
              <Card className="mb-4 border-brand/30 bg-brand/[0.04]">
                <div className="text-sm font-semibold text-brand">Month in progress</div>
                <p className="mt-1 text-sm text-gray-700">Only shifts that have ended are scored. The running shift appears here after it closes.</p>
              </Card>
            ) : belowFloor ? (
              <Card className={`mb-4 ${projection.projectedReal >= pool.floor ? "border-amber-300 bg-amber-50" : "border-red-300 bg-red-50"}`}>
                <div className={`text-sm font-semibold ${projection.projectedReal >= pool.floor ? "text-amber-800" : "text-red-800"}`}>
                  Not yet payable — {half(pool.counted)} counted, {fmt(pool.floor)} needed
                </div>
                <p className="mt-1 text-sm text-gray-700">
                  {fmt(outstanding.real)} real slabs are still to grade. At the month&apos;s grade share of {pct(projection.share)} they add about {fmt(Math.round(projection.addReal))},
                  taking the month to <b>{fmt(Math.round(projection.projectedReal))}</b>
                  {projection.projectedReal >= pool.floor
                    ? <> — over the line, into the <b>{lakh(projection.poolReal)}</b> pool.</>
                    : <> — still short of the floor. The pool is unlocked only by grading, not by projecting.</>}
                  {outstanding.byStage.nowhere > 0 && <> Counting the {fmt(outstanding.byStage.nowhere)} never-seen numbers as well would say {fmt(Math.round(projection.projectedAll))}; they are left out here because a number no station has seen will not grade.</>}
                </p>
              </Card>
            ) : (
              <Card className="mb-4 border-green-300 bg-green-50">
                <div className="text-sm font-semibold text-green-800">Pool unlocked — {lakh(pool.poolNow)} on {half(pool.counted)} counted slabs</div>
                {pool.next && <p className="mt-1 text-sm text-gray-700">{fmt(pool.next.slabs - Math.floor(pool.counted))} more counted slabs reach the {lakh(pool.next.pool)} row.</p>}
              </Card>
            )}

            {/* ---- The six numbers ------------------------------------------- */}
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <Kpi label="Counted good slabs" value={half(pool.counted)} sub={`floor ${fmt(pool.floor)} · ${half(plant.credit)} good slabs + ${fmt(plant.slowSlabs)} counted a second time`} />
              <Kpi label="Counted twice" value={fmt(plant.slowSlabs)} sub={`good slabs from hours with a standard of ${SLOW_STD_MAX}/hr or less — each added once more, so +${fmt(plant.slowSlabs)} to the count`} />
              <Kpi label="Pool today" value={pool.poolNow ? lakh(pool.poolNow) : "—"} sub={pool.poolNow ? "unlocked" : `${fmt(pool.floor - Math.floor(pool.counted))} short of the floor`} />
              <Kpi label="Still to grade" value={fmt(outstanding.real)} sub={`${fmt(outstanding.total)} claimed and uncounted · ${fmt(outstanding.byStage.nowhere)} never seen · ${fmt(outstanding.byStage.routed)} routed`} />
              <Kpi label="Projected" value={fmt(Math.round(projection.projectedReal))} sub={`if the real ones grade at ${pct(projection.share)} → ${projection.poolReal ? lakh(projection.poolReal) : "no pool"}`} />
              <Kpi label="Grade share" value={pct(plant.rawShare)} sub={`${fmt(plant.gradeA)} A · ${fmt(plant.gradeB)} B · ${fmt(plant.gradeC)} rejects of ${fmt(plant.graded)} graded`} />
              <Kpi label="QC pace" value={qc.avgPerDay7 ? `${fmt(Math.round(qc.avgPerDay7))}/day` : "—"} sub={qc.daysToClear != null ? `≈ ${qc.daysToClear} day${qc.daysToClear === 1 ? "" : "s"} to clear the backlog` : "no grading in the last 7 days"} />
            </div>

            {/* ---- The ladder ------------------------------------------------ */}
            <Card className="mb-4">
              <H2>Where the month sits on the ladder</H2>
              <div className="relative mt-4 h-9 w-full overflow-hidden rounded-lg bg-gray-100">
                {/* projected, with the never-seen numbers — the outer, fainter bar */}
                <div className="absolute inset-y-0 left-0 bg-brand/10" style={{ width: at(projection.projectedAll) }} title={`Projected including never-seen numbers: ${fmt(Math.round(projection.projectedAll))}`} />
                {/* projected on real slabs only */}
                <div className="absolute inset-y-0 left-0 bg-brand/30" style={{ width: at(projection.projectedReal) }} title={`Projected on real slabs: ${fmt(Math.round(projection.projectedReal))}`} />
                {/* counted */}
                <div className="absolute inset-y-0 left-0 bg-brand" style={{ width: at(pool.counted) }} title={`Counted: ${half(pool.counted)}`} />
                {pool.ladder.map((t) => (
                  <div key={t.slabs} className="absolute inset-y-0 border-l border-gray-500/60" style={{ left: at(t.slabs) }} />
                ))}
              </div>
              <div className="relative mt-1 h-9 w-full text-[11px] text-gray-500">
                {pool.ladder.map((t) => (
                  <div key={t.slabs} className="absolute -translate-x-1/2 text-center leading-tight" style={{ left: at(t.slabs) }}>
                    <div className="font-semibold text-gray-700">{fmt(t.slabs / 1000)}k</div>
                    <div>{lakh(t.pool)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-brand align-middle" />counted {half(pool.counted)}</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-brand/30 align-middle" />projected on real slabs {fmt(Math.round(projection.projectedReal))}</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-brand/10 align-middle" />with never-seen numbers {fmt(Math.round(projection.projectedAll))}</span>
              </div>
            </Card>

            {/* ---- The three shifts ------------------------------------------ */}
            <Card className="mb-4">
              <H2>The three shifts</H2>
              <p className="mb-3 text-xs text-gray-500">
                Counted slabs already carry both rules: B = ½, reject = 0, and a slab from an hour whose standard is {SLOW_STD_MAX}/hr or less counts twice.
                Per shift divides by shifts the line was actually running. Quality is scored between the {Math.round(QUALITY_FLOOR * 100)}% floor and the {Math.round(QUALITY_TARGET * 100)}% target —
                two ways, because the scoreboard and the August notice did it differently: the scoreboard averages each shift instance&apos;s score, the notice scored the month&apos;s whole grade share once.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="py-2 pr-3">Shift</th><th className="py-2 pr-3">Shifts</th><th className="py-2 pr-3">Running</th>
                      <th className="py-2 pr-3">Pressed</th><th className="py-2 pr-3">Graded</th><th className="py-2 pr-3">To grade</th>
                      <th className="py-2 pr-3">A / B / C</th><th className="py-2 pr-3">Good</th><th className="py-2 pr-3">Counted twice</th><th className="py-2 pr-3">Counted</th>
                      <th className="py-2 pr-3">Per shift</th><th className="py-2 pr-3">Grade share</th>
                      <th className="py-2 pr-3">Quality<br /><span className="normal-case text-gray-400">per-shift avg</span></th>
                      <th className="py-2 pr-3">Quality<br /><span className="normal-case text-gray-400">month share</span></th>
                      <th className="py-2 pr-3">Share<br /><span className="normal-case text-gray-400">per-shift avg</span></th>
                      <th className="py-2">Share<br /><span className="normal-case text-gray-400">month share</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.letters.map((l) => {
                      const w = m.shares.weighted.find((s) => s.shift === l.shift)!;
                      const a = m.shares.aggregate.find((s) => s.shift === l.shift)!;
                      return (
                        <tr key={l.shift} className="border-t border-gray-100">
                          <td className="py-2 pr-3 font-semibold text-gray-900">Shift {l.shift}</td>
                          <td className="py-2 pr-3">{fmt(l.instances)}</td>
                          <td className="py-2 pr-3 text-gray-600">{l.effectiveShifts.toFixed(1)}</td>
                          <td className="py-2 pr-3">{fmt(l.claimed)}</td>
                          <td className="py-2 pr-3">{fmt(l.graded)}</td>
                          <td className="py-2 pr-3">{fmt(l.ungraded)}</td>
                          <td className="py-2 pr-3 text-gray-600">{fmt(l.gradeA)} / {fmt(l.gradeB)} / {fmt(l.gradeC)}</td>
                          <td className="py-2 pr-3">{half(l.credit)}</td>
                          <td className="py-2 pr-3 text-gray-600">{fmt(l.slowSlabs)}</td>
                          <td className="py-2 pr-3 font-semibold text-gray-900">{fmt(l.points)}</td>
                          <td className="py-2 pr-3">{l.pointsPerShift.toFixed(1)}</td>
                          <td className="py-2 pr-3">{pct(l.rawShare)}</td>
                          <td className="py-2 pr-3">{pct(l.qualityWeighted, 0)}</td>
                          <td className="py-2 pr-3">{pct(l.qualityAggregate, 0)}</td>
                          <td className="py-2 pr-3">{pct(w.share)}</td>
                          <td className="py-2">{pct(a.share)}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-gray-200 font-medium">
                      <td className="py-2 pr-3">Plant</td>
                      <td className="py-2 pr-3">{fmt(plant.instances)}</td><td className="py-2 pr-3 text-gray-600">{m.letters.reduce((x, l) => x + l.effectiveShifts, 0).toFixed(1)}</td>
                      <td className="py-2 pr-3">{fmt(plant.claimed)}</td><td className="py-2 pr-3">{fmt(plant.graded)}</td><td className="py-2 pr-3">{fmt(plant.ungraded)}</td>
                      <td className="py-2 pr-3 text-gray-600">{fmt(plant.gradeA)} / {fmt(plant.gradeB)} / {fmt(plant.gradeC)}</td>
                      <td className="py-2 pr-3">{half(plant.credit)}</td><td className="py-2 pr-3 text-gray-600">{fmt(plant.slowSlabs)}</td><td className="py-2 pr-3 font-semibold">{fmt(plant.points)}</td>
                      <td className="py-2 pr-3">—</td><td className="py-2 pr-3">{pct(plant.rawShare)}</td><td className="py-2 pr-3">—</td><td className="py-2 pr-3">—</td><td className="py-2 pr-3">100%</td><td className="py-2">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ---- What each person would take --------------------------------- */}
            <Card className="mb-4">
              <H2>What it pays{m.money.pool ? ` on the ${lakh(m.money.pool)} pool` : ""}</H2>
              {!m.money.pool ? (
                <Empty>Nothing to share out — the projection on real slabs does not reach {fmt(pool.floor)}.</Empty>
              ) : (
                <>
                  <p className="mb-3 text-xs text-gray-500">
                    {belowFloor ? "A planning figure: the pool the real projection reaches, not one the counted total has unlocked. " : ""}
                    Each shift&apos;s slice is turned into a percentage of salary on a third of the ₹41 lakh bill, and everyone on the shift takes that percentage of their own pay.
                    Two columns per band: <b>per-shift avg</b> is how the scoreboard scores quality, <b>month share</b> is how the August notice did.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                          <th className="py-2 pr-3">Shift</th>
                          <th className="py-2 pr-3">Share of pool</th>
                          <th className="py-2 pr-3">Of own salary</th>
                          {m.money.roles.map((r) => <th key={r.key} className="py-2 pr-3">{r.label}<br /><span className="normal-case text-gray-400">{inr(r.pay)}</span></th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {m.money.weighted.map((w) => {
                          const a = m.money.aggregate.find((x) => x.shift === w.shift)!;
                          const cell = (x: number, y: number) => (
                            <span>{inr(x)}{Math.round(x) !== Math.round(y) && <span className="ml-1 text-xs text-gray-400" title="month-share method">/ {inr(y)}</span>}</span>
                          );
                          return (
                            <tr key={w.shift} className="border-t border-gray-100">
                              <td className="py-2 pr-3 font-semibold text-gray-900">Shift {w.shift}</td>
                              <td className="py-2 pr-3">{pct(w.share)}<span className="ml-1 text-xs text-gray-400">/ {pct(a.share)}</span></td>
                              <td className="py-2 pr-3">{pct(w.pctSalary, 2)}<span className="ml-1 text-xs text-gray-400">/ {pct(a.pctSalary, 2)}</span></td>
                              {m.money.roles.map((r) => <td key={r.key} className="py-2 pr-3">{cell(w.bands[r.key], a.bands[r.key])}</td>)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>

            {/* ---- The slabs still to come ------------------------------------- */}
            <Card className="mb-4">
              <H2>Claimed, not yet counted — {fmt(outstanding.total)}</H2>
              <p className="mb-3 text-xs text-gray-500">
                Every slab a shift&apos;s MIS range claimed that has no A / B / C verdict yet, checked against the press, jot, oven and polish tables.
                A slab QC routed to CTS or Printing has been through QC and will not grade; a number no station has ever seen was claimed by a mistyped range and will not either.
              </p>
              <div className="mb-4 flex flex-wrap gap-2">{stageRow(outstanding.byStage)}</div>
              <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-3">
                {(["A", "B", "C"] as ShiftLetter[]).map((s) => (
                  <div key={s} className="rounded-xl border border-gray-200 p-3">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Shift {s} · {fmt(Object.values(outstanding.byLetter[s]).reduce((x, y) => x + y, 0))}</div>
                    <div className="flex flex-wrap gap-1.5">{stageRow(outstanding.byLetter[s])}</div>
                  </div>
                ))}
              </div>

              {outstanding.phantomRuns.length > 0 && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
                  <div className="text-sm font-semibold text-red-800">{fmt(outstanding.byStage.nowhere)} claimed numbers no station has seen — the MIS hours to correct</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {outstanding.phantomRuns.slice(0, 40).map((r) => {
                      const slab = outstanding.slabs.find((s) => s.slab === r.from);
                      const inner = <>
                        <span className="font-semibold">{r.from === r.to ? fmt(r.from) : `${fmt(r.from)}–${fmt(r.to)}`}</span>
                        <span className="text-red-500"> · {r.count} · {r.anchor} shift {r.shift}{r.hour ? ` · ${r.hour}` : ""}{r.design ? ` · ${r.design}` : ""}</span>
                      </>;
                      return slab?.rowId
                        ? <Link key={`${r.from}-${r.anchor}`} href={`/tables/Mis/${slab.rowId}`} className="rounded-md border border-red-300 bg-white px-2.5 py-1.5 text-xs text-red-900 hover:border-red-500">{inner}</Link>
                        : <span key={`${r.from}-${r.anchor}`} className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs text-red-900">{inner}</span>;
                    })}
                    {outstanding.phantomRuns.length > 40 && <span className="text-xs text-red-600">… and {outstanding.phantomRuns.length - 40} more runs</span>}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="py-2 pr-3">Design</th><th className="py-2 pr-3">Batch</th><th className="py-2 pr-3">Waiting</th>
                      <th className="py-2 pr-3">Counts ×2</th>
                      {STAGES.map((s) => <th key={s} className="py-2 pr-3">{STAGE_LABEL[s]}</th>)}
                      <th className="py-2">Design&apos;s grade share so far</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.groups.map((g) => (
                      <tr key={`${g.design} ${g.batch}`} className="border-t border-gray-100">
                        <td className="py-1.5 pr-3 font-medium text-gray-900">{g.design}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{g.batch}</td>
                        <td className="py-1.5 pr-3 font-semibold">{fmt(g.count)}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{g.slow ? fmt(g.slow) : "—"}</td>
                        {STAGES.map((s) => <td key={s} className={`py-1.5 pr-3 ${g.stages[s] ? (s === "nowhere" ? "text-red-700" : s === "routed" ? "text-amber-700" : "text-gray-700") : "text-gray-300"}`}>{g.stages[s] || "—"}</td>)}
                        <td className="py-1.5 text-gray-600">{g.designShare != null ? `${pct(g.designShare)} on ${fmt(g.designGraded)}` : g.designGraded ? `${fmt(g.designGraded)} graded — too few to say` : "none graded yet"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ---- QC pace --------------------------------------------------- */}
            <Card className="mb-4">
              <H2>QC grading, last 14 days</H2>
              <p className="mb-3 text-xs text-gray-500">Slabs given an A / B / C verdict per production day, whatever month they were pressed in. The backlog clears at this pace or not at all.</p>
              {qc.perDay.length === 0 ? <Empty>No grading recorded in the last 14 days.</Empty> : (
                <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
                  {qc.perDay.map((d) => {
                    const max = Math.max(...qc.perDay.map((x) => x.graded), 1);
                    return (
                      <div key={d.day} className="flex w-12 shrink-0 flex-col items-center gap-1 text-[10px] text-gray-500">
                        <div className="text-gray-700">{fmt(d.graded)}</div>
                        <div className="w-full rounded-t bg-brand/70" style={{ height: `${Math.max(2, (d.graded / max) * 72)}px` }} />
                        <div>{d.day.slice(5)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {(m.flaggedRows > 0 || m.openDisputes > 0 || m.unattributed > 0) && (
              <Card className="mb-4 border-amber-300 bg-amber-50">
                <div className="text-sm font-semibold text-amber-800">Entries the scoreboard is still waiting on</div>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                  {m.flaggedRows > 0 && <li>{fmt(m.flaggedRows)} MIS hours flagged (too wide, or claimed by two shifts) — see the <Link href={`/scoreboard?from=${m.from}&to=${m.to}`} className="text-brand underline">scoreboard</Link>.</li>}
                  {m.openDisputes > 0 && <li>{fmt(m.openDisputes)} slabs claimed by two shifts, awaiting a ruling — they score for nobody until then.</li>}
                  {m.unattributed > 0 && <li>{fmt(m.unattributed)} shift instances filed MIS but named no production incharge.</li>}
                </ul>
              </Card>
            )}

            <p className="text-xs text-gray-400">
              As of {asOfIST}. Scored {m.from} to {m.scoredTo}. Assumes the ₹41 lakh production salary bill (112 people, still marked provisional in the notice) is split equally across the three shifts;
              any lost-time accident in a shift removes that shift&apos;s incentive for the month, and nothing on this page checks for one.
            </p>
          </>
        );
      })()}
    </Shell>
  );
}
