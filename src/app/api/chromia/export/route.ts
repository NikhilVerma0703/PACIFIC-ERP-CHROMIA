// CSV exports for the Chromia line.
//
// CSV rather than XLSX deliberately: every one of these opens in Excel, none of
// them needs formatting, and streaming a string costs nothing next to building
// a workbook in memory on a serverless function.
//
// Gated at the management tier, the same as the Downloads page that links here.
// Middleware stops the request at /api/chromia, this stops a direct fetch, and
// each is useless on its own the day the other is edited.

import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { chromiaGate, CHROMIA_MIN_TIER } from "@/lib/chromia/access";
import { recalibrationAgeing, STAGE_LABEL, STATUS_LABEL } from "@/lib/chromia/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One CSV field.
 *
 * The leading-character guard is not decoration: a value starting =, +, - or @
 * is executed as a formula when the file is opened, so a slab remark reading
 * "=cmd|..." becomes code running on whoever opens the export. Prefixing a
 * quote makes Excel treat it as text. Slab numbers and remarks are typed by
 * hand into a shared workbook, which is exactly the untrusted input this
 * protects against.
 */
function cell(v: unknown): string {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function csv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(cell).join(",")];
  for (const r of rows) lines.push(r.map(cell).join(","));
  // A BOM, so Excel opens it as UTF-8 rather than mangling any non-ASCII in a
  // design name or a remark.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function attachment(name: string, body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const gate = await chromiaGate(CHROMIA_MIN_TIER.management);
  if (!gate.ok) {
    return Response.json({ error: "Forbidden" }, { status: gate.status || 403 });
  }

  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") ?? "slabs";

  if (kind === "slabs") {
    const rows = await prisma.chromiaSlab.findMany({
      where: {
        deletedAt: null,
        ...(sp.get("status") ? { status: sp.get("status") as never } : {}),
        ...(sp.get("stage") ? { currentStage: sp.get("stage") as never } : {}),
      },
      orderBy: [{ receivedDate: "desc" }, { slabNo: "asc" }],
      take: 20_000,
      select: {
        slabNo: true, status: true, currentStage: true, currentCycleNumber: true,
        currentGrade: true, currentDisposition: true, recalibrationCount: true,
        receivedDate: true, currentThicknessMm: true, legacySourceFile: true,
        batch: { select: { batchNo: true } },
        baseMaterial: { select: { name: true } },
        plannedDesign: { select: { name: true } },
        currentLocation: { select: { name: true } },
      },
    });
    return attachment(
      `chromia-slabs-${stamp()}.csv`,
      csv(
        ["Slab", "Batch", "Material", "Design", "Stage", "State", "Cycle",
         "Recalibrations", "Grade", "Outcome", "Location", "Thickness (mm)",
         "Received", "Imported from"],
        rows.map((r) => [
          r.slabNo, r.batch.batchNo, r.baseMaterial.name, r.plannedDesign?.name,
          r.currentStage ? STAGE_LABEL[r.currentStage] : "",
          STATUS_LABEL[r.status] ?? r.status,
          r.currentCycleNumber, r.recalibrationCount, r.currentGrade,
          r.currentDisposition, r.currentLocation?.name, r.currentThicknessMm,
          r.receivedDate, r.legacySourceFile,
        ]),
      ),
    );
  }

  if (kind === "recalibrations") {
    const outstanding = sp.get("outstanding") === "1";
    const rows = await prisma.chromiaRecalibrationCycle.findMany({
      where: outstanding ? { receivedDate: null } : {},
      orderBy: [{ sentDate: "asc" }],
      take: 20_000,
      include: {
        reason: { select: { name: true } },
        slab: { select: { slabNo: true, batch: { select: { batchNo: true } } } },
      },
    });
    const now = new Date();
    return attachment(
      `chromia-recalibrations-${stamp()}.csv`,
      csv(
        ["Slab", "Batch", "Attempt", "State", "Reason", "Notes", "Facility",
         "Sent", "Expected back", "Received", "Days out", "Days late",
         "Turnaround", "Removed (mm)", "Gate pass"],
        rows.map((r) => {
          const age = recalibrationAgeing(r, now);
          return [
            r.slab.slabNo, r.slab.batch.batchNo, r.attemptNumber, r.status,
            r.reason?.name, r.reasonNotes, r.facilityName,
            r.sentDate, r.expectedReturnDate, r.receivedDate,
            age.daysOut, age.daysLate || "", r.turnaroundDays,
            r.materialRemovedMm, r.gatePassNo,
          ];
        }),
      ),
    );
  }

  if (kind === "output") {
    const from = sp.get("from") ? new Date(`${sp.get("from")}T00:00:00`) : new Date(0);
    // Inclusive of the end date: someone typing today means "including today".
    const to = sp.get("to") ? new Date(`${sp.get("to")}T23:59:59.999`) : new Date();
    const rows = await prisma.chromiaProcessCycle.findMany({
      where: { outTime: { gte: from, lte: to } },
      orderBy: { outTime: "asc" },
      take: 20_000,
      include: {
        design: { select: { name: true } },
        slab: { select: { slabNo: true, batch: { select: { batchNo: true } } } },
        qcRecord: { select: { verdict: true } },
      },
    });
    return attachment(
      `chromia-output-${stamp()}.csv`,
      csv(
        ["Slab", "Batch", "Cycle", "Design", "In", "Out", "Minutes",
         "Fully printed", "Print result", "QC", "Grade", "Outcome"],
        rows.map((r) => [
          r.slab.slabNo, r.slab.batch.batchNo, r.cycleNumber, r.design?.name,
          r.inTime?.toISOString(), r.outTime?.toISOString(), r.processingMinutes,
          r.fullyPrintedDate, r.printResult, r.qcRecord?.verdict,
          r.finalGrade, r.disposition,
        ]),
      ),
    );
  }

  if (kind === "events") {
    const rows = await prisma.chromiaSlabEvent.findMany({
      orderBy: { occurredAt: "desc" },
      take: 20_000,
      include: { slab: { select: { slabNo: true } } },
    });
    return attachment(
      `chromia-events-${stamp()}.csv`,
      csv(
        ["When", "Slab", "Event", "Stage", "From", "To", "User", "Note"],
        rows.map((r) => [
          r.occurredAt.toISOString(), r.slab.slabNo, r.eventType,
          r.stage ? STAGE_LABEL[r.stage] : "",
          r.fromStatus, r.toStatus, r.userId, r.note,
        ]),
      ),
    );
  }

  return Response.json({ error: "Unknown export" }, { status: 404 });
}
