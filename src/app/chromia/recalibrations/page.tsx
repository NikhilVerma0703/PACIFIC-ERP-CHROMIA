import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/prisma";
import { chromiaGate, CHROMIA_MIN_TIER } from "@/lib/chromia/access";
import { listRecalibrations, referenceData } from "@/lib/chromia/store";
import { RecalibrationPanel, type Candidate, type Outstanding } from "./RecalibrationPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chromia recalibration | Pacific ERP" };

/**
 * Send out, receive back, put back on the line.
 *
 * Supervisor-and-above, matching the module's MANAGEMENT_ROLES guard: a send
 * takes a slab out of the plant's control and consumes one of the five
 * attempts it will ever have, which is not an operator's call.
 */
export default async function ChromiaRecalibrationsPage() {
  const gate = await chromiaGate(CHROMIA_MIN_TIER.management);
  if (!gate.ok) redirect("/");

  const [rows, outstandingRows, refs] = await Promise.all([
    // Graded C and still on site: the only slabs eligible to be sent.
    prisma.chromiaSlab.findMany({
      where: {
        deletedAt: null, currentGrade: "C", isRecalibrationOut: false,
        status: { in: ["GRADED", "RECEIVED_FROM_RECALIBRATION"] },
      },
      orderBy: { slabNo: "asc" },
      take: 100,
      select: {
        id: true, slabNo: true, currentGrade: true, recalibrationCount: true,
        currentThicknessMm: true, batch: { select: { batchNo: true } },
      },
    }),
    listRecalibrations({ limit: 200 }),
    referenceData(),
  ]);

  const candidates: Candidate[] = rows.map((r) => ({
    id: r.id,
    slabNo: r.slabNo,
    batchNo: r.batch.batchNo,
    grade: r.currentGrade,
    recalibrationCount: r.recalibrationCount,
    thicknessMm: r.currentThicknessMm == null ? null : String(r.currentThicknessMm),
  }));

  const outstanding: Outstanding[] = outstandingRows.map((r) => ({
    id: r.id,
    slabNo: r.slabNo,
    attemptNumber: r.attemptNumber,
    facilityName: r.facilityName,
    daysOut: r.ageing.daysOut,
    overdue: r.ageing.overdue,
    received: r.receivedDate != null,
    restarted: r.status === "RESTARTED",
  }));

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Recalibration</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          A rejected slab can have its upper surface removed and start again — at most five times,
          because each pass takes material off. Sending, receiving and restarting are three separate
          records, so a slab back in the yard is never counted as back on the line.
        </p>
      </div>
      <RecalibrationPanel candidates={candidates} outstanding={outstanding} reasons={refs.reasons} />
    </Shell>
  );
}
