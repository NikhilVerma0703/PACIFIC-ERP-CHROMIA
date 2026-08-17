import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Badge, Card, Empty } from "@/components/ui";
import { chromiaGate } from "@/lib/chromia/access";
import { listSlabs } from "@/lib/chromia/store";
import { STAGE_LABEL, STAGE_ORDER, STATUS_LABEL } from "@/lib/chromia/process";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chromia slabs | Pacific ERP" };

const PAGE = 50;

const TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  RECEIVED: "brand", IN_PROCESS: "brand", UNDER_INSPECTION: "amber",
  GRADED: "amber", OUT_FOR_RECALIBRATION: "red", RECEIVED_FROM_RECALIBRATION: "amber",
  IN_STOCK: "green", SAMPLE_CUT: "green", DISPATCHED: "green",
  WASTE: "red", ON_HOLD: "amber",
};

/**
 * The slab register — and the search that replaces walking the floor asking
 * people where a slab is (CHROMIA_PROCESS.md section 3.1).
 *
 * One box searches slab number OR batch number, because that is how the
 * question actually arrives: someone holding a slab reads its own number,
 * someone chasing an order has the batch.
 */
export default async function ChromiaSlabsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; stage?: string; page?: string }>;
}) {
  const gate = await chromiaGate();
  if (!gate.ok) redirect("/");

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { slabs, total } = await listSlabs({
    q: sp.q, status: sp.status, stage: sp.stage,
    limit: PAGE, offset: (page - 1) * PAGE,
  });

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, status: sp.status, stage: sp.stage, ...patch })) {
      if (v != null && v !== "") p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `/chromia/slabs?${s}` : "/chromia/slabs";
  };

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Slabs</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Every slab the line has ever seen. Search a slab or batch number for its full history.
          </p>
        </div>
        {/* Intake is reached from here rather than from the menu — the module's
            own decision: a blank form in the nav invites someone to type a slab
            the operator has already entered. */}
        <Link
          href="/chromia/slabs/new"
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90"
        >
          Receive slabs
        </Link>
      </div>

      <Card className="mb-5">
        {/* A GET form, so a search is a URL: it can be bookmarked, shared with
            whoever is asking, and survives a refresh. */}
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="q" className="mb-1 block text-xs font-medium text-gray-600">
              Slab or batch number
            </label>
            <input
              id="q" name="q" defaultValue={sp.q ?? ""} autoComplete="off"
              placeholder="e.g. CHR-1042 or MAY-07"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label htmlFor="status" className="mb-1 block text-xs font-medium text-gray-600">State</label>
            <select
              id="status" name="status" defaultValue={sp.status ?? ""}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Any</option>
              {Object.entries(STATUS_LABEL).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="stage" className="mb-1 block text-xs font-medium text-gray-600">Stage</label>
            <select
              id="stage" name="stage" defaultValue={sp.stage ?? ""}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Any</option>
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>{STAGE_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90"
          >
            Search
          </button>
          {(sp.q || sp.status || sp.stage) && (
            <Link href="/chromia/slabs" className="py-2.5 text-sm text-gray-400 hover:text-gray-700">
              Clear
            </Link>
          )}
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {total} slab{total === 1 ? "" : "s"}
          {page > 1 || pages > 1 ? ` · page ${page} of ${pages}` : ""}
        </h2>

        {slabs.length === 0 ? (
          <Empty>
            {sp.q || sp.status || sp.stage
              ? "No slab matches that. Check the number, or clear the filters."
              : "No slabs recorded yet."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">Slab</th>
                  <th className="py-2 pr-4 font-medium">Batch</th>
                  <th className="py-2 pr-4 font-medium">Stage</th>
                  <th className="py-2 pr-4 font-medium">State</th>
                  <th className="py-2 pr-4 font-medium">Cycle</th>
                  <th className="py-2 pr-4 font-medium">Grade</th>
                  <th className="py-2 pr-4 font-medium">Design</th>
                  <th className="py-2 font-medium">Where</th>
                </tr>
              </thead>
              <tbody>
                {slabs.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-brand/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/chromia/slabs/${encodeURIComponent(s.slabNo)}`}
                        className="font-medium text-gray-900 hover:text-brand hover:underline"
                      >
                        {s.slabNo}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{s.batchNo}</td>
                    <td className="py-2 pr-4 text-gray-600">
                      {s.currentStage ? STAGE_LABEL[s.currentStage] : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge tone={TONE[s.status] ?? "brand"}>{STATUS_LABEL[s.status]}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">
                      {s.cycleNumber}
                      {/* The count Excel destroyed: a slab in front of you, and
                          no way to tell if it is on its first pass or its fourth. */}
                      {s.recalibrationCount > 0 && (
                        <span className="ml-1 text-xs text-red-600">
                          ({s.recalibrationCount} recal)
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{s.grade ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-600">{s.design ?? "—"}</td>
                    <td className="py-2 text-gray-500">{s.location ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-sm">
            {page > 1
              ? <Link href={qs({ page: page - 1 })} className="text-brand hover:underline">← Previous</Link>
              : <span className="text-gray-300">← Previous</span>}
            <span className="text-gray-400">Page {page} of {pages}</span>
            {page < pages
              ? <Link href={qs({ page: page + 1 })} className="text-brand hover:underline">Next →</Link>
              : <span className="text-gray-300">Next →</span>}
          </div>
        )}
      </Card>
    </Shell>
  );
}
