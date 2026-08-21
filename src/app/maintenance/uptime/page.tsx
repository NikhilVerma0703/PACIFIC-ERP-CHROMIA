import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Empty, fmt } from "@/components/ui";
import { fmtDur } from "@/lib/downtime";
import { currentUser } from "@/lib/rbac";
import { scoreRange, type PersonScore } from "@/lib/shiftScore";

export const dynamic = "force-dynamic";
// A month of shifts is several hundred queries; the default 10s is not enough.
export const maxDuration = 60;
export const metadata: Metadata = { title: "Uptime by trade | Pacific ERP" };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

/** Who may open this. The full scoreboard stays ADMIN-only. */
const ALLOWED = new Set(["ADMIN", "MAINTENANCE", "LINE_MANAGER"]);

/**
 * Uptime by trade — the maintenance half of the shift scoreboard, and nothing
 * else.
 *
 * WHY THIS IS A SEPARATE PAGE AND NOT A FLAG ON /scoreboard.
 *
 * The scoreboard is admin-only for a stated reason: "it ranks named individuals
 * and drives an incentive payout, so it must not be visible to the people it
 * scores" (middleware.ts). Most of what makes it sensitive is the PRODUCTION
 * ranking — each person's share of the monthly pool, applied to their own
 * salary — plus the per-station operator boards and the dispute rulings.
 *
 * Adding a "if role is MAINTENANCE, hide these bits" branch to that page would
 * put the sensitive half one editing mistake away from the wrong reader, on a
 * 600-line page that already renders eleven sections. This page instead SELECTS
 * what it shows: it reads two arrays out of the same scoring function and can
 * never render a third, because there is no code here that could. Same shape as
 * /office/batch-lookup, which exists so the office gets a batch view that
 * structurally cannot carry mix weights.
 *
 * SHOWS: electrical and mechanical in-charges ranked on uptime — how much of the
 * hours MIS recorded their shifts kept the line running. The maintenance
 * manager's own team, on his own measure.
 *
 * DOES NOT SHOW: the production ranking, the operator boards, the incentive pool
 * split, the disputes, or anything expressed as a share of somebody's salary.
 */
export default async function MaintenanceUptimePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await currentUser();
  const role = String((user as { role?: string } | null)?.role ?? "");
  const branch = String((user as { branch?: string } | null)?.branch ?? "");
  // Branch matters: a FABRICATION line manager is capped to their own module and
  // has no business in shop-floor shift data.
  if (!ALLOWED.has(role) || (role !== "ADMIN" && branch !== "SHOP_FLOOR")) {
    redirect(`/no-access?from=${encodeURIComponent("/maintenance/uptime")}`);
  }

  const sp = await searchParams;
  const istToday = ymd(new Date(Date.now() + 330 * 60000));
  const dayAgo = (n: number) => ymd(new Date(Date.now() + 330 * 60000 - n * 864e5));
  const from = sp.from?.trim() || dayAgo(29);
  const to = sp.to?.trim() || istToday;

  // A failure shows as a failure. Falling through to an empty board would be
  // indistinguishable from "the line never stopped", which is the one reading
  // this page must never give by accident.
  let data: Awaited<ReturnType<typeof scoreRange>> | null = null;
  let failure: string | null = null;
  try {
    data = await scoreRange(from, to);
  } catch (e) {
    // The RAW message stays on the server. scoreRange runs straight at Prisma
    // with no try/catch of its own (deliberately, see shiftScore.ts), so what
    // arrives here is a Prisma error: the model, the invocation, the
    // where-clause, and for P1001 the database host and port. /scoreboard
    // prints its equivalent verbatim and gets away with it because middleware
    // makes that page ADMIN-only. This page is read by MAINTENANCE and
    // LINE_MANAGER, so it is the first non-admin surface this could reach.
    // Caught errors are ordinary data to Next, so its production error masking
    // never applies - this line is the only thing standing in the way.
    console.error("[maintenance/uptime] scoreRange failed", e);
    failure = e instanceof Error ? e.message : String(e);
  }

  const board = (rows: PersonScore[], empty: string) =>
    rows.length === 0 ? <Empty>{empty}</Empty> : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
              <th className="py-2 pr-4">#</th>
              <th className="py-2 pr-4">Person</th>
              <th className="py-2 pr-4">Shifts</th>
              <th className="py-2 pr-4">Stoppage</th>
              <th className="py-2 pr-4">Per shift</th>
              <th className="py-2">Uptime</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.person} className="border-t border-gray-100">
                <td className="py-2 pr-4 text-gray-400">
                  {i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : i + 1}
                </td>
                <td className="py-2 pr-4 font-medium text-gray-900">{p.person}</td>
                <td className="py-2 pr-4 text-gray-600">{fmt(p.shifts)}</td>
                <td className="py-2 pr-4 text-gray-600">{fmtDur(p.downtimeMin)}</td>
                <td className="py-2 pr-4 text-gray-600">{fmtDur(Math.round(p.downtimePerShift))}</td>
                <td className={`py-2 font-semibold ${
                  (p.uptime ?? 0) >= 0.95 ? "text-green-700"
                    : (p.uptime ?? 0) >= 0.9 ? "text-amber-700" : "text-red-600"
                }`}>
                  {pct(p.uptime)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const electrical = data?.byRole.electrical ?? [];
  const mechanical = data?.byRole.mechanical ?? [];
  // NO PLANT-WIDE STOPPAGE FIGURE, and no cross-trade "best", because neither
  // can be computed correctly from what scoreRange returns.
  //
  // MIS records ONE combined "mechanical or electrical" breakdown column
  // (shiftScore.ts:122) - the trades are not split in the data - so the SAME
  // minutes are charged to the electrical incharge AND the mechanical one.
  // Summing downtimeMin across both trades therefore counts every stoppage
  // twice, and again per extra person named on the same shift. It read as a
  // plant total and was closer to double one.
  //
  // Ranking the two trades against each other is wrong for a second reason:
  // electrical is scored WITH power-out and mechanical without (the "true"
  // flag on shiftScore.ts:649), so a mechanical name wins by construction.
  // Best-within-a-trade compares like with like and is the honest version.
  const bestOf = (rows: PersonScore[]) =>
    rows.filter((r) => r.uptime != null)
        .sort((a, b) => (b.uptime ?? 0) - (a.uptime ?? 0))[0] ?? null;
  const bestElec = bestOf(electrical);
  const bestMech = bestOf(mechanical);

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Uptime by trade</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          How much of the recorded hours each electrical and mechanical in-charge kept the line
          running. This is the maintenance half of the shift scoreboard — the production ranking,
          the operator boards and the incentive pool are not on this page.
        </p>
      </div>

      <Card className="mb-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
            <input type="date" name="from" defaultValue={from}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
            <input type="date" name="to" defaultValue={to}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm" />
          </label>
          <button type="submit"
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90">
            Show
          </button>
          <Link href="/mis" className="py-2.5 text-sm text-brand hover:underline">
            The incidents behind these figures
          </Link>
        </form>
      </Card>

      {failure && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">The scores could not be computed.</p>
          {/* Detail for the people who can act on it; everyone else gets the
              sentence above, which already says everything they can use. */}
          {role === "ADMIN" && <p className="mt-1 font-mono text-xs text-red-700">{failure}</p>}
          <p className="mt-1 text-red-700">
            This is not the same as a quiet month — nothing below should be read as uptime.
          </p>
        </div>
      )}

      {data && (
        <>
          {/* The range actually scored, which is not always the range asked for. */}
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Kpi label="Range scored" value={`${data.from} to ${data.to}`}
              sub={data.requestedTo && data.requestedTo !== data.to
                ? `asked to ${data.requestedTo} — cut short`
                : "as asked"} />
            <Kpi label="Best uptime — electrical" value={bestElec ? pct(bestElec.uptime) : "—"}
              sub={bestElec?.person ?? "nobody ranked yet"} />
            <Kpi label="Best uptime — mechanical" value={bestMech ? pct(bestMech.uptime) : "—"}
              sub={bestMech?.person ?? "nobody ranked yet"} />
          </div>

          {(data.totals.unattributedElectrical > 0 || data.totals.unattributedMechanical > 0) && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Shifts that filed MIS but named nobody:{" "}
              {[
                data.totals.unattributedElectrical
                  ? `${fmt(data.totals.unattributedElectrical)} with no electrical in-charge` : null,
                data.totals.unattributedMechanical
                  ? `${fmt(data.totals.unattributedMechanical)} with no mechanical in-charge` : null,
              ].filter(Boolean).join(" · ")}. That stoppage belongs to nobody and quietly lifts
              everyone else&rsquo;s uptime — worth chasing on the MIS entry, not here.
            </div>
          )}

          <Card className="mb-6">
            <H2>Electrical in-charge</H2>
            <p className="mb-3 mt-1 text-xs text-gray-500">
              Ranked on <b>uptime</b>, not slabs — the job is keeping the line running. MIS records
              breakdown as one &ldquo;mechanical or electrical&rdquo; figure, so both trades are
              measured on the same stoppage; a power-out counts against electrical only. Uptime is
              stoppage against the <b>hours MIS actually recorded</b>, so an hour never entered
              earns nothing rather than counting as a running line.
            </p>
            {board(electrical, "Nobody recorded in this role for the range.")}
          </Card>

          <Card className="mb-6">
            <H2>Mechanical in-charge</H2>
            <p className="mb-3 mt-1 text-xs text-gray-500">
              The same measure as electrical, on the same recorded stoppage.
            </p>
            {board(mechanical, "Nobody recorded in this role for the range.")}
          </Card>

          <p className="text-xs text-gray-400">
            Reclassifying a delay on the Downtime report moves minutes between buckets and changes
            the uptime above. That is deliberate and it is logged — the correction and who made it
            are shown on the downtime incident itself.
          </p>
        </>
      )}
    </Shell>
  );
}
