import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Badge, Empty, fmt } from "@/components/ui";
import { isAdmin } from "@/lib/rbac";
import { incentiveMonth, currentMonthIST, STAGES, REAL_STAGES, MIN_GRADED_TO_SAY, type Stage } from "@/lib/incentiveMonth";
import { QUALITY_FLOOR, QUALITY_TARGET, SLOW_STD_MAX, type ShiftLetter } from "@/lib/shiftScoreMath";
import { AutoRefresh } from "../AutoRefresh";

// The month tracker behind the shift incentive: what the plant has counted,
// what is still waiting at QC, and what the pool becomes when it lands. Admin
// only — middleware gates /scoreboard/* and this is the in-page check every
// admin screen carries as well.
/** EVERY ANSWER TO "WHAT DOES MY SHIFT GET, AND HOW MUCH MONEY IS IT" — the
 *  per-shift share of the pool, the rupee amounts per pay band, and the pool's
 *  own rupee total wherever it appears. OFF at the owner's request (2026-09-03:
 *  "Don't show these numbers as of now. We'll show the numbers in this screen
 *  later.") until the scheme's three open decisions are settled: the step
 *  ladder, the equal-thirds salary split, and which quality method settles the
 *  month. The figures are still computed and tested; this only draws them.
 *
 *  THE FIRST ATTEMPT HID ONE CARD AND MISSED THE SCREEN. Its comment claimed
 *  "nothing else on the page reads it", and that was false twice over:
 *    - the visible "three shifts" table drew the IDENTICAL share-of-pool
 *      percentages in its last two columns, because incentiveMonth.ts's
 *      moneyFor() copies `share: r.share` straight through — money.weighted[i]
 *      .share IS shares.weighted[i].share, by construction; and
 *    - the pool's rupee total stayed on screen in the "Pool today" KPI, the
 *      green unlocked banner, the ladder labels and the projection, so a
 *      shift's rupee slice was share x pool, two figures on one page.
 *  A percentage of a pool whose size is printed beside it is a rupee figure.
 *  So anything answering either question goes behind THIS flag, not a new one.
 *
 *  WHAT DELIBERATELY STAYS: slab counts, the floor, grade shares, quality
 *  scores, the ladder's slab rungs, QC pace. They are the month's work and the
 *  reason the page exists; none of them is a promise of money. */
const SHOW_PAYOUT_AMOUNTS = false;

/** WHAT EACH RUNG OF THE LADDER PAYS — AND THIS ONE IS ON.
 *
 *  THE FLAG ABOVE WAS WIDENED TOO FAR AND THE OWNER SAID SO. Asked to hide the
 *  payout figures, the widening took the ladder's rupee labels with them, on
 *  the reasoning that a share of a pool whose size is printed beside it is a
 *  rupee figure. That reasoning is right about the MONTH'S OWN pool and wrong
 *  about the LADDER, and the owner's words on seeing the bare bar were "Where
 *  are the incentive amounts in this bar / Put the incentive amounts what we had
 *  previously".
 *
 *  THE DISTINCTION, and it is the whole reason this is a second flag and not a
 *  loosening of the first:
 *    - The ladder is the SCHEME. 7,000 slabs pays this, 8,000 pays that. It is
 *      published policy that every incharge on the floor is meant to know, it
 *      is the same numbers whatever this month does, and it promises nobody
 *      anything. incentiveLadder.TIERS is a constant in the repo.
 *    - The month's own pool, a shift's share of it, and a person's slice ARE
 *      promises of money about THIS month, and the three decisions behind them
 *      (step ladder vs interpolated, the equal-thirds salary split, which
 *      quality method settles the month) are still open. They stay behind
 *      SHOW_PAYOUT_AMOUNTS.
 *
 *  SO THE ARITHMETIC A READER CAN DO IS DELIBERATELY BOUNDED: they can see what
 *  the scheme pays at each rung and where the month sits against those rungs.
 *  They cannot see this month's pool, any shift's share of it, or any person's
 *  amount, so no shift's slice is derivable by multiplying two figures on the
 *  page — which was the actual defect the widening was fixing. If the owner
 *  wants the month's own pool back as well, that is SHOW_PAYOUT_AMOUNTS, not
 *  this one. */
const SHOW_LADDER_AMOUNTS = true;

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
/** The same five stages, short enough to head a column in a seventeen-column
 *  table. The long labels above still head the chips, where there is room. */
const STAGE_SHORT: Record<Stage, string> = {
  "at-qc": "At QC", "at-polish": "On polish", pressed: "Pressed", nowhere: "Never seen", routed: "Routed",
};
/** ROUTED IS NOT WAITING AND IT IS NOT A GRADE. A slab QC sent to cut-to-size
 *  or printing has been through QC and will never grade, so it belongs in
 *  neither the four grade columns nor the "still to come" subtotal — it gets a
 *  column of its own, outside both, and the row still adds up to Claimed. */
const WAIT_STAGES = STAGES.filter((s) => s !== "routed");

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
        // The batch table's own totals, summed from the rows the reader can
        // see rather than from the month-wide figures beside them. That is the
        // point of a totals line here: if a column of rows and its total came
        // from two different places, the total could be right while the column
        // was wrong, and nobody would know which to believe.
        const sum = (f: (g: (typeof outstanding.groups)[number]) => number) => outstanding.groups.reduce((a, g) => a + f(g), 0);
        const tot = {
          claimed: sum((g) => g.claimed), graded: sum((g) => g.graded),
          A: sum((g) => g.gradeA), A2: sum((g) => g.gradeA2), B: sum((g) => g.gradeB), C: sum((g) => g.gradeC),
          decided: sum((g) => g.decidedB), slow: sum((g) => g.slow),
          waiting: sum((g) => g.count - g.stages.routed), routed: sum((g) => g.stages.routed),
          stage: (s: Stage) => sum((g) => g.stages[s]),
        };
        const totShare = tot.graded ? (tot.A + tot.A2 + tot.B * 0.5) / tot.graded : null;
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
                    ? <> — over the line{SHOW_PAYOUT_AMOUNTS ? <>, into the <b>{lakh(projection.poolReal)}</b> pool</> : <>, into the pool</>}.</>
                    : <> — still short of the floor. The pool is unlocked only by grading, not by projecting.</>}
                  {outstanding.byStage.nowhere > 0 && <> Counting the {fmt(outstanding.byStage.nowhere)} never-seen numbers as well would say {fmt(Math.round(projection.projectedAll))}; they are left out here because a number no station has seen will not grade.</>}
                </p>
              </Card>
            ) : (
              <Card className="mb-4 border-green-300 bg-green-50">
                {/* The unlocking is the news and stays; its rupee size is the
                    figure SHOW_PAYOUT_AMOUNTS is holding back. Same for the
                    next rung — named by its slab count instead. */}
                <div className="text-sm font-semibold text-green-800">Pool unlocked{SHOW_PAYOUT_AMOUNTS ? ` — ${lakh(pool.poolNow)}` : ""} on {half(pool.counted)} counted slabs</div>
                {/* The NEXT RUNG is a ladder figure, not this month's pool — the
                    same distinction the two flags draw. It names a rung the
                    scheme publishes, so it reads with the amount. */}
                {pool.next && <p className="mt-1 text-sm text-gray-700">{fmt(pool.next.slabs - Math.floor(pool.counted))} more counted slabs reach the {fmt(pool.next.slabs / 1000)}k row{SHOW_LADDER_AMOUNTS ? <> — {lakh(pool.next.pool)}</> : null}.</p>}
              </Card>
            )}

            {/* ---- The six numbers ------------------------------------------- */}
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <Kpi label="Counted good slabs" value={half(pool.counted)} sub={`floor ${fmt(pool.floor)} · ${half(plant.credit)} good slabs + ${fmt(plant.slowSlabs)} counted a second time`} />
              <Kpi label="Counted twice" value={fmt(plant.slowSlabs)} sub={`good slabs from hours with a standard of ${SLOW_STD_MAX}/hr or less — each added once more, so +${fmt(plant.slowSlabs)} to the count`} />
              {/* Whether the pool is open is a fact about the month's count and
                  stays on screen; what it is worth does not, while the flag is
                  off — it was the largest rupee figure on the page. */}
              <Kpi label="Pool today" value={!pool.poolNow ? "—" : SHOW_PAYOUT_AMOUNTS ? lakh(pool.poolNow) : "Unlocked"}
                sub={pool.poolNow ? (SHOW_PAYOUT_AMOUNTS ? "unlocked" : `the count is over the ${fmt(pool.floor)} floor`) : `${fmt(pool.floor - Math.floor(pool.counted))} short of the floor`} />
              <Kpi label="Still to grade" value={fmt(outstanding.real)} sub={`${fmt(outstanding.total)} claimed and uncounted · ${fmt(outstanding.byStage.nowhere)} never seen · ${fmt(outstanding.byStage.routed)} routed`} />
              <Kpi label="Projected" value={fmt(Math.round(projection.projectedReal))} sub={`if the real ones grade at ${pct(projection.share)} → ${projection.poolReal ? (SHOW_PAYOUT_AMOUNTS ? lakh(projection.poolReal) : "over the floor") : "no pool"}`} />
              {/* "A" HERE IS A AND A2 TOGETHER, AND THE SCREEN NOW SAYS SO.
                  scoreShift buckets on u.startsWith("A"), so plant.gradeA is
                  the two passes added — correct, and not something to change:
                  gradeCredit pays A and A2 the same 1. What was wrong was
                  silence. The batch table below splits them into their own
                  columns, so on live August 2026 (measured 2026-09-03) this
                  KPI read "5,000 A" and the table's footer read A 4,577 +
                  A2 423 — the same 5,000 slabs printed as two different values
                  of "A", 423 apart, on one screen. Same reason the three-shifts
                  table's grade column is headed "A+A2". */}
              <Kpi label="Grade share" value={pct(plant.rawShare)}
                sub={`${fmt(plant.gradeA)} A and A2 · ${fmt(plant.gradeB)} B · ${fmt(plant.gradeC)} rejects of ${fmt(plant.graded)} graded`}
                working={<>
                  <b className="text-gray-900">Good slabs ÷ graded slabs.</b> Not A ÷ graded — a
                  B is half a good slab, a reject is none.
                  <div className="mt-2 font-mono text-[11px] leading-5 text-gray-700">
                    ({fmt(plant.gradeA)} × 1) + ({fmt(plant.gradeB)} × ½) + ({fmt(plant.gradeC)} × 0)<br />
                    = {half(plant.credit)} good<br />
                    ÷ {fmt(plant.graded)} graded = <b>{pct(plant.rawShare)}</b>
                  </div>
                  <div className="mt-2">
                    The {fmt(plant.gradeA)} counts <b>A and A2 together</b> — the score does not
                    separate them, because both are passes and both earn a whole slab of credit. The
                    batch table lower down does separate them, so its A column is smaller than this
                    number and its A + A2 add back to it.
                  </div>
                  <div className="mt-2">
                    Dividing {fmt(plant.gradeA)} A and A2 by {fmt(plant.graded)} gives{" "}
                    {pct(plant.graded ? plant.gradeA / plant.graded : null)} — that is the share that
                    came out a pass at all, a different question.
                  </div>
                </>} />
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
                    {/* The rungs AND what each one pays — the published scheme,
                        which is what the bar is for. Behind SHOW_LADDER_AMOUNTS,
                        not SHOW_PAYOUT_AMOUNTS: see both flags' comments for why
                        these two rupee figures are not the same kind of thing as
                        this month's pool or a shift's slice of it. */}
                    <div className="font-semibold text-gray-700">{fmt(t.slabs / 1000)}k</div>
                    {SHOW_LADDER_AMOUNTS && <div>{lakh(t.pool)}</div>}
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
                      {/* A+A2, not A: scoreShift buckets both passes together
                          (u.startsWith("A")), and the batch table below splits
                          them — so an unqualified "A" here is 423 slabs adrift
                          of the A column down there on live August 2026. */}
                      <th className="py-2 pr-3">A+A2 / B / C</th><th className="py-2 pr-3">Good</th><th className="py-2 pr-3">Counted twice</th><th className="py-2 pr-3">Counted</th>
                      <th className="py-2 pr-3">Per shift</th><th className="py-2 pr-3">Grade share</th>
                      <th className="py-2 pr-3">Quality<br /><span className="normal-case text-gray-400">per-shift avg</span></th>
                      <th className="py-2 pr-3">Quality<br /><span className="normal-case text-gray-400">month share</span></th>
                      {/* SHARE OF THE POOL — the same numbers the hidden payout
                          card draws, not merely similar ones (see the flag).
                          Quality and grade share above are scores out of 100%
                          and stay; these two are slices of a pot. */}
                      {SHOW_PAYOUT_AMOUNTS && <>
                        <th className="py-2 pr-3">Share<br /><span className="normal-case text-gray-400">per-shift avg</span></th>
                        <th className="py-2">Share<br /><span className="normal-case text-gray-400">month share</span></th>
                      </>}
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
                          {SHOW_PAYOUT_AMOUNTS && <>
                            <td className="py-2 pr-3">{pct(w.share)}</td>
                            <td className="py-2">{pct(a.share)}</td>
                          </>}
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-gray-200 font-medium">
                      <td className="py-2 pr-3">Plant</td>
                      <td className="py-2 pr-3">{fmt(plant.instances)}</td><td className="py-2 pr-3 text-gray-600">{m.letters.reduce((x, l) => x + l.effectiveShifts, 0).toFixed(1)}</td>
                      <td className="py-2 pr-3">{fmt(plant.claimed)}</td><td className="py-2 pr-3">{fmt(plant.graded)}</td><td className="py-2 pr-3">{fmt(plant.ungraded)}</td>
                      <td className="py-2 pr-3 text-gray-600">{fmt(plant.gradeA)} / {fmt(plant.gradeB)} / {fmt(plant.gradeC)}</td>
                      <td className="py-2 pr-3">{half(plant.credit)}</td><td className="py-2 pr-3 text-gray-600">{fmt(plant.slowSlabs)}</td><td className="py-2 pr-3 font-semibold">{fmt(plant.points)}</td>
                      <td className="py-2 pr-3">—</td><td className="py-2 pr-3">{pct(plant.rawShare)}</td><td className="py-2 pr-3">—</td><td className="py-2 pr-3">—</td>
                      {/* The two 100% cells are the giveaway that the columns
                          above them are shares of a whole, so they go with
                          those columns — and they must, or the plant row runs
                          two cells wider than the header. */}
                      {SHOW_PAYOUT_AMOUNTS && <><td className="py-2 pr-3">100%</td><td className="py-2">100%</td></>}
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ---- What each person would take --------------------------------- */}
            {/* HIDDEN ON THE OWNER'S INSTRUCTION — see SHOW_PAYOUT_AMOUNTS at
                the top of this file for the instruction, the three unsettled
                decisions behind it, and the rest of the page it also governs.
                This card is the densest of the money, not the only of it.

                The whole card is behind the flag rather than deleted: every
                figure it draws is still computed, still tested, and comes back
                by setting the flag to true. */}
            {SHOW_PAYOUT_AMOUNTS && (
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
            )}

            {/* ---- The slabs still to come ------------------------------------- */}
            <Card className="mb-4">
              <H2>Claimed, not yet counted — {fmt(outstanding.total)}</H2>
              <p className="mb-3 text-xs text-gray-500">
                Every slab a shift&apos;s MIS range claimed that has no A / B / C verdict yet, checked against the press, jot, oven and polish tables.
                A slab QC routed to CTS or Printing has been through QC and will not grade; a number no station has ever seen was claimed by a mistyped range and will not either.
                These are the month&apos;s backlog only — the table below puts them next to what the same batches have already graded.
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

            </Card>

            {/* ---- One row per batch: what graded and what is still waiting ---- */}
            {/* ONE TABLE, NOT TWO. The owner asked for A / A2 / B / C columns on
                the table above and was told every row on it is a WAITING slab
                and so ungraded by definition; he answered "Maybe make a table
                to show graded slabs or show graded slabs in the same table
                instead of keeping it in different tables" (2026-09-03). This is
                that table. It is NOT the waiting list with four columns bolted
                on: its POPULATION is every design+batch the month claimed, so
                the batch that graded best — which by definition has nothing
                left waiting — is on it too. For August 2026, 41 rows against
                the waiting list's 33 (measured on live Neon 2026-09-03). */}
            <Card className="mb-4">
              <H2>The month by design and batch — {fmt(tot.claimed)} slabs</H2>
              <p className="mb-1 text-xs text-gray-500">
                Every slab the month&apos;s MIS ranges claimed, one row per design and batch: the {fmt(tot.graded)} QC has graded
                and the {fmt(tot.waiting)} still to come, side by side. Each row adds up two ways —
                <b> A + A2 + B + C = graded</b>, and <b> graded + still waiting + routed = claimed</b> — and so does the total line at the foot.
              </p>
              <p className="mb-3 text-xs text-gray-500">
                CTS and Printing are ROUTINGS, not verdicts: a slab sent to cut-to-size was diverted before anyone judged it, so it sits in its own
                column and in none of the four grades — it is never counted twice. Nothing here is capped or collapsed; all {fmt(outstanding.groups.length)} batches
                are listed, the ones with slabs still waiting first.
              </p>
              <p className="mb-3 text-xs text-gray-500">
                <b>A and A2 are separate columns here and nowhere else on this page.</b> The scoring counts both as passes worth a whole slab and does not tell
                them apart, so the Grade share figure at the top of the page and the A+A2 column in the three-shifts table each report {fmt(plant.gradeA)} where
                this table reports {fmt(tot.A)} A and {fmt(tot.A2)} A2. They are the same slabs — {fmt(tot.A)} + {fmt(tot.A2)} = {fmt(tot.A + tot.A2)} — split
                because the plant sells them as different products and a batch drifting from A to A2 is worth seeing.
              </p>
              {outstanding.unreconciled > 0 && (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  {fmt(outstanding.unreconciled)} claimed slabs are in neither half of this table — the score and this table disagree about what the month
                  claimed. They are left out of every figure above so the columns still add up, but the difference is real and needs looking at.
                </p>
              )}
              {/* THE DRIFT THAT USED TO BE SILENT. `unreconciled` above only ever
                  caught slabs the rebuild believed in and the score did not; a
                  slab drifting the other way reached no row, so the "Claimed,
                  not yet counted — N" card above and this table's "Still
                  waiting" total would print different numbers with nothing on
                  the page to say why. Both are 0 on live August 2026: measured
                  three times on 2026-09-03 as QC kept grading (954, then 953,
                  then 952 outstanding) and the rows summed to the same figure
                  every time. */}
              {outstanding.unclaimed > 0 && (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  {fmt(outstanding.unclaimed)} of the {fmt(outstanding.total)} slabs on the backlog card above are on no row of this table — the score has them
                  and this table&apos;s rebuild of the month&apos;s claim does not. That is why the {fmt(tot.waiting + tot.routed)} still-outstanding slabs counted
                  here are fewer than the {fmt(outstanding.total)} counted there. The backlog card is the one to believe; this needs looking at.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400">
                      <th className="py-1 pr-3" colSpan={3} />
                      <th className="border-l border-gray-200 py-1 pl-2 pr-3 text-gray-500" colSpan={6}>Graded — {fmt(tot.graded)}</th>
                      <th className="border-l border-gray-200 py-1 pl-2 pr-3 text-gray-500" colSpan={5}>Still waiting — {fmt(tot.waiting)}</th>
                      <th className="border-l border-gray-200 py-1 pl-2 pr-3" colSpan={2} />
                    </tr>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="py-2 pr-3">Design</th><th className="py-2 pr-3">Batch</th><th className="py-2 pr-3">Claimed</th>
                      <th className="border-l border-gray-200 py-2 pl-2 pr-3">A</th><th className="py-2 pr-3">A2</th>
                      <th className="py-2 pr-3">B</th><th className="py-2 pr-3">C</th>
                      <th className="py-2 pr-3">Graded</th><th className="py-2 pr-3">Batch share</th>
                      <th className="border-l border-gray-200 py-2 pl-2 pr-3">Waiting</th>
                      {WAIT_STAGES.map((s) => <th key={s} className="py-2 pr-3">{STAGE_SHORT[s]}</th>)}
                      <th className="border-l border-gray-200 py-2 pl-2 pr-3">Routed</th>
                      {/* THERE WAS A "DESIGN'S SHARE, ALL BATCHES" COLUMN HERE
                          UNTIL 2026-09-03. It joined the MIS design spelling to
                          QC's, and on live August 2026 it read "none graded
                          yet" on 7 of the 41 rows whose own Graded column, on
                          the same line, read 115 / 19 / 7 / 6 / 5 / 5 / 4 —
                          161 graded slabs denied — while the rows it DID match
                          borrowed each other's slabs (GLENCO / D1411, 50 graded
                          of its own, printed "95.4% on 206"). The Batch share
                          column, in the graded block, is this row's own four
                          grade counts and needs no name join at all; see
                          incentiveMonth.ts for the full measurement. */}
                      <th className="py-2">Waiting ×2</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.groups.map((g) => {
                      const waiting = g.count - g.stages.routed;
                      return (
                      <tr key={`${g.design} ${g.batch}`} className="border-t border-gray-100">
                        <td className="py-1.5 pr-3 font-medium text-gray-900">{g.design}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{g.batch}</td>
                        <td className="py-1.5 pr-3 font-semibold">{fmt(g.claimed)}</td>
                        <td className="border-l border-gray-200 py-1.5 pl-2 pr-3 text-gray-700">{g.gradeA || <span className="text-gray-300">—</span>}</td>
                        <td className="py-1.5 pr-3 text-gray-700">{g.gradeA2 || <span className="text-gray-300">—</span>}</td>
                        <td className="py-1.5 pr-3 text-gray-700">
                          {g.gradeB || <span className="text-gray-300">—</span>}
                          {g.decidedB > 0 && <span className="text-amber-700" title={`${g.decidedB} of these were graded B by decision, not by inspection — see the note below the table`}> †{g.decidedB}</span>}
                        </td>
                        <td className={`py-1.5 pr-3 ${g.gradeC ? "text-red-700" : "text-gray-300"}`}>{g.gradeC || "—"}</td>
                        <td className="py-1.5 pr-3 text-gray-500">{fmt(g.graded)}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{g.share != null ? pct(g.share) : <span className="text-gray-400">{g.graded ? `${fmt(g.graded)} graded — too few to say` : "none graded yet"}</span>}</td>
                        <td className="border-l border-gray-200 py-1.5 pl-2 pr-3 font-semibold">{waiting || <span className="font-normal text-gray-300">—</span>}</td>
                        {WAIT_STAGES.map((s) => <td key={s} className={`py-1.5 pr-3 ${g.stages[s] ? (s === "nowhere" ? "text-red-700" : "text-gray-700") : "text-gray-300"}`}>{g.stages[s] || "—"}</td>)}
                        <td className={`border-l border-gray-200 py-1.5 pl-2 pr-3 ${g.stages.routed ? "text-amber-700" : "text-gray-300"}`}>{g.stages.routed || "—"}</td>
                        <td className="py-1.5 text-gray-600">{g.slow ? fmt(g.slow) : <span className="text-gray-300">—</span>}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 font-semibold text-gray-900">
                      <td className="py-2 pr-3">All batches</td>
                      <td className="py-2 pr-3 font-normal text-gray-500">{fmt(outstanding.groups.length)} rows</td>
                      <td className="py-2 pr-3">{fmt(tot.claimed)}</td>
                      <td className="border-l border-gray-200 py-2 pl-2 pr-3">{fmt(tot.A)}</td>
                      <td className="py-2 pr-3">{fmt(tot.A2)}</td>
                      <td className="py-2 pr-3">{fmt(tot.B)}{tot.decided > 0 && <span className="font-normal text-amber-700"> †{tot.decided}</span>}</td>
                      <td className="py-2 pr-3">{fmt(tot.C)}</td>
                      <td className="py-2 pr-3">{fmt(tot.graded)}</td>
                      <td className="py-2 pr-3">{pct(totShare)}</td>
                      <td className="border-l border-gray-200 py-2 pl-2 pr-3">{fmt(tot.waiting)}</td>
                      {WAIT_STAGES.map((s) => <td key={s} className="py-2 pr-3">{fmt(tot.stage(s))}</td>)}
                      <td className="border-l border-gray-200 py-2 pl-2 pr-3">{fmt(tot.routed)}</td>
                      <td className="py-2">{fmt(tot.slow)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                {tot.decided > 0 && (
                  <>
                    <span className="text-amber-700">†</span> {fmt(tot.decided)} of the {fmt(tot.B)} B slabs were graded B by a DECISION, not by an inspection: they were cut to size
                    and their real verdict was destroyed and could not be recovered, so the owner set them to B (scripts/0071 and 0072, applied 2026-09-03).
                    The payout pays each of them the same half slab of credit any other B earns, so they are counted as B here too — the dagger is how the table
                    says which ones they are without putting them anywhere twice.{" "}
                    {/* AND WHY THE CEO REPORT PRINTS A DIFFERENT B FOR THE SAME MONTH.
                        Said out loud because somebody will hold the two screens up beside
                        each other: measured 2026-09-03, this table reads B 171 for August
                        and the monthly report reads B 146, and 171 - 146 is exactly these
                        25 decided slabs. The report answers "how did the stone we inspected
                        grade", where a destroyed verdict is not a measured B; this screen
                        answers "what does the month pay", where gradeCredit() pays it like
                        any B. Changing either to match the other would break the screen that
                        was changed. verify-grade-columns.mts asserts the gap is exactly the
                        cut count, so a drift means one of them is genuinely wrong. */}
                    The CEO monthly report asks the opposite question — how the stone that was actually <em>inspected</em> graded — so it keeps these{" "}
                    {fmt(tot.decided)} out of its B column and shows them under <b>Cut</b>. Its B for the month reads exactly that much lower than the{" "}
                    {fmt(tot.B)} here, and neither figure is wrong.{" "}
                  </>
                )}
                <b>Batch share</b> is this row&apos;s own A / A2 / B / C on the payout&apos;s scale (A and A2 = 1, B = ½, C = 0), shown once the row has at least{" "}
                {fmt(MIN_GRADED_TO_SAY)} graded slabs behind it — below that one C in eight reads as a disaster and one A in eight as a triumph, and neither is true.
                It is built from the four numbers on its own line and from nothing else, so a reader can check it with the row in front of them.
              </p>
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

            {/* The salary-bill assumption describes how the payout card turns a
                share into a percentage of pay — it is a rupee figure and only
                means anything when that card is drawn, so it travels with it.
                The lost-time-accident warning is about the scheme itself and is
                shown either way. */}
            <p className="text-xs text-gray-400">
              As of {asOfIST}. Scored {m.from} to {m.scoredTo}.{" "}
              {SHOW_PAYOUT_AMOUNTS && <>Assumes the ₹41 lakh production salary bill (112 people, still marked provisional in the notice) is split equally across the three shifts. </>}
              Any lost-time accident in a shift removes that shift&apos;s incentive for the month, and nothing on this page checks for one.
            </p>
          </>
        );
      })()}
    </Shell>
  );
}
