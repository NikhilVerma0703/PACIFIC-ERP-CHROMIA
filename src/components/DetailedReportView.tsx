import type { DetailedReport } from "@/lib/detailedReport";
import { ExportReportButton } from "@/components/ExportReportButton";

const td = "border border-gray-300 px-2 py-1 text-xs";
const th = "border border-gray-300 bg-[#dce6f1] px-2 py-1 text-xs font-semibold text-gray-800";
const yellow = " bg-yellow-200 font-medium";

function d(x: Date | null): string { return x ? new Date(x).toLocaleDateString("en-IN") : ""; }
function t(x: Date | null): string { return x ? new Date(x).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""; }
function n(x: number | null | undefined): string { return x == null ? "" : x.toLocaleString("en-IN"); }

export function DetailedReportView({ r }: { r: DetailedReport }) {
  const rows = Math.max(r.cycleGroups.length, 1);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Detailed production report — batch {r.batch}</h2>
        <ExportReportButton targetId="detailed-report" filename={`Production Report ${r.batch}.xls`} />
      </div>

      <div id="detailed-report" className="overflow-x-auto">
        <table className="w-full border-collapse">
          <tbody>
            {/* Title */}
            <tr><td colSpan={16} className="border border-gray-300 bg-[#dce6f1] px-2 py-1.5 text-center text-base font-bold text-red-600">DETAILED PRODUCTION REPORT</td></tr>
            {/* Header block */}
            <tr>
              <td className={th} colSpan={2}>Production starting date</td>
              <td className={th}>Production starting time</td>
              <td className={th}>Production ending date</td>
              <td className={th}>Production ending time</td>
              <td className={th}>Dry Cleaning</td>
              <td className={td}></td>
              <td className={td} colSpan={7}></td>
              <td className={th} colSpan={2}>Code -</td>
            </tr>
            <tr>
              <td className={td} colSpan={2}>{d(r.startAt)}</td>
              <td className={td}>{t(r.startAt)}</td>
              <td className={td}>{d(r.endAt)}</td>
              <td className={td}>{t(r.endAt)}</td>
              <td className={th}>Half Cleaning</td>
              <td className={td}></td>
              <td className={td} colSpan={9}></td>
            </tr>
            {/* Main table head */}
            <tr>
              <td className={th} rowSpan={2}>SL.NO.</td>
              <td className={th} rowSpan={2}>DESIGN</td>
              <td className={th} rowSpan={2}>NO.OF CYCLES</td>
              <td className={th} rowSpan={2}>BATCH NUM</td>
              <td className={th} colSpan={4}>BATCH WEIGHT</td>
              <td className={th} rowSpan={2}>TOTAL</td>
              <td className={th} colSpan={3}>NO. OF SLABS</td>
              <td className={th} colSpan={2}>SLAB NO.</td>
              <td className={th} rowSpan={2}>SLAB BROKEN</td>
              <td className={th} rowSpan={2}>TOTAL</td>
            </tr>
            <tr>
              <td className={th}>M1</td><td className={th}>M2</td><td className={th}>M3</td><td className={th}>M4</td>
              <td className={th}>20MM</td><td className={th}>30MM</td><td className={th}>12MM</td>
              <td className={th}>FROM</td><td className={th}>TO</td>
            </tr>
            {Array.from({ length: rows }).map((_, i) => {
              const g = r.cycleGroups[i];
              const first = i === 0;
              return (
                <tr key={i}>
                  <td className={td}>{first ? 1 : ""}</td>
                  <td className={td + (first ? yellow : "")}>{first ? (r.design ?? "") : ""}</td>
                  <td className={td}>{g ? g.cycles : ""}</td>
                  <td className={td + " font-semibold text-red-600"}>{first ? r.batch : ""}</td>
                  <td className={td}>{g ? n(g.m[0]) : ""}</td>
                  <td className={td}>{g ? n(g.m[1]) : ""}</td>
                  <td className={td}>{g ? n(g.m[2]) : ""}</td>
                  <td className={td}>{g ? n(g.m[3]) : ""}</td>
                  <td className={td + yellow}>{g ? n(g.total) : ""}</td>
                  <td className={td}>{first ? n(r.slabs.mm20) : ""}</td>
                  <td className={td}>{first ? n(r.slabs.mm30) : ""}</td>
                  <td className={td}>{first ? n(r.slabs.mm12) : ""}</td>
                  <td className={td}>{first ? n(r.slabs.from) : ""}</td>
                  <td className={td}>{first ? n(r.slabs.to) : ""}</td>
                  <td className={td}></td>
                  <td className={td}>{first ? n(r.slabs.total) : ""}</td>
                </tr>
              );
            })}
            <tr>
              <td className={td} colSpan={8}></td>
              <td className={td + yellow}>{n(r.batchWeightTotal)}</td>
              <td className={td} colSpan={5}></td>
              <td className={th}>GRAND TOTAL=</td>
              <td className={td + yellow}>{n(r.slabs.total)}</td>
            </tr>
            {/* spacer */}
            <tr><td colSpan={16} className="border-0 py-2"></td></tr>
            {/* Silo status */}
            <tr>
              <td className={th + " text-red-600"} rowSpan={Math.max(r.silos.length, 1) + 1}>Starting status — Silos Status</td>
              <td className={th}>Material</td><td className={th}>Supplier</td><td className={th}>Silo</td><td className={th}>kgs</td>
              <td className={td} rowSpan={Math.max(r.silos.length, 1) + 1}></td>
              <td className={th + " text-red-600"} rowSpan={Math.max(r.silos.length, 1) + 1}>Ending status — Silos Status</td>
              <td className={th}>Material</td><td className={th}>Supplier</td><td className={th}>Silo</td><td className={th}>kgs</td>
              <td className={td} colSpan={5} rowSpan={Math.max(r.silos.length, 1) + 1}></td>
            </tr>
            {(r.silos.length ? r.silos : [null]).map((s, i) => (
              <tr key={i}>
                <td className={td}>{s?.material ?? ""}</td><td className={td}>{s?.supplier ?? ""}</td><td className={td}>{s?.siloNo ?? ""}</td><td className={td}>{s ? n(s.startKg) : ""}</td>
                <td className={td}>{s?.material ?? ""}</td><td className={td}>{s?.supplier ?? ""}</td><td className={td}>{s?.siloNo ?? ""}</td><td className={td}>{s ? n(s.endKg) : ""}</td>
              </tr>
            ))}
            {/* spacer */}
            <tr><td colSpan={16} className="border-0 py-2"></td></tr>
            {/* Materials */}
            <tr>
              <td className={th}>SL.NO.</td>
              <td className={th}>MATERIAL DESCRIPTION</td>
              <td className={th}>SUPPLIER NAME</td>
              <td className={th}>GRADE</td>
              <td className={th} colSpan={2}>INVOICE NUM</td>
              <td className={th} colSpan={5}>BAG NUM</td>
              <td className={th}>TOTAL BAGS</td>
              <td className={th}>WEIGHT / BAG</td>
              <td className={th} colSpan={2}>calculated Consumption</td>
              <td className={th}>KGS</td>
            </tr>
            {r.materials.map((m, i) => (
              <tr key={i}>
                <td className={td}>{i + 1}</td>
                <td className={td + " font-medium"}>{m.desc}</td>
                <td className={td}>{m.supplier}</td>
                <td className={td}>{m.grade}</td>
                <td className={td} colSpan={2}>{m.invoices}</td>
                <td className={td} colSpan={5}>{m.bagNums}</td>
                <td className={td}>{n(m.totalBags)}</td>
                <td className={td}>{n(m.weightPerBag)}</td>
                <td className={td} colSpan={2}>{n(m.consumption)}</td>
                <td className={td}></td>
              </tr>
            ))}
            <tr>
              <td className={th} colSpan={11}>TOTAL</td>
              <td className={td} colSpan={2}></td>
              <td className={td + yellow} colSpan={2}>{n(r.consumptionTotal)}</td>
              <td className={td}></td>
            </tr>
            {/* spacer */}
            <tr><td colSpan={16} className="border-0 py-2"></td></tr>
            {/* Footer */}
            <tr><td className={th} colSpan={2}>AVERAGE WT OF SLAB 12MM</td><td className={td}>{n(r.avgByThickness.mm12)}</td><td className={td} colSpan={10}></td><td className={td} colSpan={2}>{r.avgByThickness.mm12 != null ? n(r.avgByThickness.mm12 * r.slabs.mm12) : ""}</td><td className={td}></td></tr>
            <tr><td className={th} colSpan={2}>AVERAGE WT OF SLAB 20MM</td><td className={td}>{n(r.avgByThickness.mm20)}</td><td className={td} colSpan={10}></td><td className={td} colSpan={2}>{r.avgByThickness.mm20 != null ? n(r.avgByThickness.mm20 * r.slabs.mm20) : ""}</td><td className={td}></td></tr>
            <tr><td className={th} colSpan={2}>AVERAGE WT OF SLAB 30MM</td><td className={td}>{n(r.avgByThickness.mm30)}</td><td className={td} colSpan={10}></td><td className={td} colSpan={2}>{r.avgByThickness.mm30 != null ? n(r.avgByThickness.mm30 * r.slabs.mm30) : ""}</td><td className={td}></td></tr>
            <tr><td className={th} colSpan={2}>TOTAL (slab output)</td><td className={td} colSpan={11}></td><td className={td + yellow} colSpan={2}>{n(r.outputKg)}</td><td className={td}>KGS</td></tr>
            <tr>
              <td className={th + " bg-yellow-200"} colSpan={2}>TOTAL WASTAGE %</td>
              <td className={td} colSpan={11}></td>
              <td className={td + yellow}>{r.wastagePct != null ? `${n(r.wastagePct)}%` : ""}</td>
              <td className={td + yellow}>{n(r.wastageKg)}</td>
              <td className={td}>KGS</td>
            </tr>
          </tbody>
        </table>
      </div>
      {r.wastagePct != null && r.wastagePct < 0 && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠ Slab output ({r.outputKg.toLocaleString("en-IN")} kg) exceeds mix consumed ({r.consumptionTotal.toLocaleString("en-IN")} kg) — check Press slab weights for this batch (some entries may be set weights instead of per-slab).
        </p>
      )}
      <p className="mt-2 text-[11px] text-gray-400">Silo starting status is reconstructed (current remaining + this batch&apos;s consumption). Silane/Cobalt are estimated from daily-tank dosing ratios. Dry/Half cleaning counts are not tracked yet.</p>
    </div>
  );
}
