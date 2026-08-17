import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { chromiaGate, CHROMIA_MIN_TIER } from "@/lib/chromia/access";
import { operatorQueue } from "@/lib/chromia/store";
import { CHROMIA_TIER_RANK } from "@/lib/chromia/tier";
import { OperatorBoard, type OperatorSlab } from "./OperatorBoard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chromia operator entry | Pacific ERP" };

/**
 * Stage progress captured at the point of work, not re-keyed at end of shift
 * (CHROMIA_PROCESS.md section 2.3).
 *
 * Gated at the production tier — every Chromia rank reaches this. Grading is
 * gated separately inside: the board only offers the QC panel to a user whose
 * tier clears the quality group, and recordQc re-checks it server-side, because
 * a hidden button is not a permission.
 */
export default async function ChromiaOperatorPage() {
  const gate = await chromiaGate(CHROMIA_MIN_TIER.production);
  if (!gate.ok) redirect("/");

  const canGrade = gate.tier != null
    && CHROMIA_TIER_RANK[gate.tier] >= CHROMIA_TIER_RANK[CHROMIA_MIN_TIER.quality];

  const rows = await operatorQueue();
  const slabs: OperatorSlab[] = rows.map((r) => ({
    id: r.id,
    slabNo: r.slabNo,
    batchNo: r.batch.batchNo,
    status: r.status,
    currentStage: r.currentStage,
    cycleNumber: r.currentCycleNumber,
    recalibrationCount: r.recalibrationCount,
    location: r.currentLocation?.name ?? null,
  }));

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Operator entry</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Stamp a slab in when it enters processing, move it stage by stage, and stamp it out when
          the six production stages are done. Each tap writes a timed, attributed event.
        </p>
      </div>
      <OperatorBoard slabs={slabs} canGrade={canGrade} />
    </Shell>
  );
}
