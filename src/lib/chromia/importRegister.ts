"use server";

// Bringing the monthly production register across from Excel.
//
// This runs once per workbook and writes the line's history wholesale, so it is
// deliberately a TWO-STEP action: `previewRegister` reads the sheet and reports
// exactly what would happen, and only `commitRegister` writes. An import that
// silently created nine hundred slabs from a misaligned sheet would be days of
// unpicking, and the preview is the last cheap moment to notice.
//
// Rows whose slab number already exists are SKIPPED, never overwritten: live
// data always wins over an import. That is what makes re-running a workbook
// safe, and it is the rule that lets someone import May, then June, then a
// corrected May, without losing what the line has recorded since.

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";

import { prisma } from "@/lib/prisma";
import { chromiaGate, CHROMIA_MIN_TIER } from "./access";
import {
  findDuplicateSlabNos, parseProRegister, statusForImportedRow, toCode,
  type ParsedSlabRow, type ParseResult,
} from "./register";
import { recalibrationAgeing } from "./process";

export interface ImportPreview {
  ok: boolean;
  error?: string;
  sourceFile: string;
  sheetName: string;
  sheetNames: string[];
  totalRows: number;
  wouldCreate: number;
  alreadyPresent: number;
  skippedBlank: number;
  duplicateSlabNos: string[];
  issues: { sourceRow: number; reason: string }[];
  /** What the sheet says happened, so the numbers can be sanity-checked
   *  against the workbook before anything is written. */
  byDisposition: { label: string; value: number }[];
  stillOut: number;
  sample: Array<{
    slabNo: string; batchNo: string; material: string;
    received: string; disposition: string; remark: string | null;
  }>;
}

function emptyPreview(error: string): ImportPreview {
  return {
    ok: false, error, sourceFile: "", sheetName: "", sheetNames: [],
    totalRows: 0, wouldCreate: 0, alreadyPresent: 0, skippedBlank: 0,
    duplicateSlabNos: [], issues: [], byDisposition: [], stillOut: 0, sample: [],
  };
}

/** Read the upload into rows of cells, addressed by index. `header: 1` is what
 *  makes that possible — the merged header rows cannot be matched by name. */
function readSheet(buf: ArrayBuffer, wanted?: string): {
  rows: unknown[][]; sheetName: string; sheetNames: string[];
} | null {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetNames = wb.SheetNames;
  const sheetName = wanted && sheetNames.includes(wanted) ? wanted : sheetNames[0];
  if (!sheetName) return null;
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1, blankrows: true, defval: "",
  });
  return { rows, sheetName, sheetNames };
}

async function parseUpload(fd: FormData): Promise<
  { parsed: ParseResult; sourceFile: string; sheetName: string; sheetNames: string[] } | string
> {
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return "Choose the register workbook first.";
  if (file.size > 25 * 1024 * 1024) return "That file is larger than 25 MB.";

  let read: ReturnType<typeof readSheet>;
  try {
    read = readSheet(await file.arrayBuffer(), String(fd.get("sheet") ?? "") || undefined);
  } catch (e) {
    return `That file could not be read as a workbook (${e instanceof Error ? e.message : String(e)}).`;
  }
  if (!read) return "That workbook has no sheets.";

  return {
    parsed: parseProRegister(read.rows),
    sourceFile: file.name,
    sheetName: read.sheetName,
    sheetNames: read.sheetNames,
  };
}

function summarise(rows: readonly ParsedSlabRow[]) {
  const counts = new Map<string, number>();
  let stillOut = 0;
  for (const r of rows) {
    const key = r.disposition ?? "still on the line";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (r.disposition === "RECALIBRATION" && !r.recalReceivedDate) stillOut++;
  }
  return {
    byDisposition: [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    stillOut,
  };
}

/** Dry run. Reads the sheet and reports what would happen. Writes nothing. */
export async function previewRegister(fd: FormData): Promise<ImportPreview> {
  const gate = await chromiaGate(CHROMIA_MIN_TIER.management);
  if (!gate.ok) return emptyPreview("You are not allowed to import the Chromia register.");

  const read = await parseUpload(fd);
  if (typeof read === "string") return emptyPreview(read);
  const { parsed, sourceFile, sheetName, sheetNames } = read;

  const slabNos = parsed.rows.map((r) => r.slabNo);
  const existing = slabNos.length
    ? await prisma.chromiaSlab.findMany({
        where: { slabNo: { in: slabNos } }, select: { slabNo: true },
      })
    : [];
  const have = new Set(existing.map((e) => e.slabNo));

  const { byDisposition, stillOut } = summarise(parsed.rows);

  return {
    ok: true,
    sourceFile, sheetName, sheetNames,
    totalRows: parsed.rows.length,
    wouldCreate: parsed.rows.filter((r) => !have.has(r.slabNo)).length,
    alreadyPresent: parsed.rows.filter((r) => have.has(r.slabNo)).length,
    skippedBlank: parsed.skipped,
    duplicateSlabNos: findDuplicateSlabNos(parsed.rows),
    issues: parsed.issues.slice(0, 50),
    byDisposition,
    stillOut,
    sample: parsed.rows.slice(0, 10).map((r) => ({
      slabNo: r.slabNo,
      batchNo: r.batchNo,
      material: r.materialName,
      received: r.receivedDate.toLocaleDateString("en-IN", { dateStyle: "medium" }),
      disposition: r.disposition ?? "—",
      remark: r.remark,
    })),
  };
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  importBatchId?: string;
  imported: number;
  skipped: number;
  failed: number;
  errors: { sourceRow: number; reason: string }[];
}

/**
 * Write the register.
 *
 * Every imported slab keeps a pointer back to where it came from — file, sheet,
 * row number and the original remark text — so an imported record can always be
 * reconciled against the spreadsheet, and so a figure that came from the old
 * workbook never looks like one the line recorded itself.
 */
export async function commitRegister(fd: FormData): Promise<ImportResult> {
  const gate = await chromiaGate(CHROMIA_MIN_TIER.management);
  if (!gate.ok) {
    return { ok: false, error: "You are not allowed to import the Chromia register.", imported: 0, skipped: 0, failed: 0, errors: [] };
  }
  const userId = (gate.user as { id?: string } | null)?.id ?? null;

  const read = await parseUpload(fd);
  if (typeof read === "string") {
    return { ok: false, error: read, imported: 0, skipped: 0, failed: 0, errors: [] };
  }
  const { parsed, sourceFile, sheetName } = read;
  if (!parsed.rows.length) {
    return { ok: false, error: "Nothing in that sheet could be read as a slab row.", imported: 0, skipped: 0, failed: 0, errors: [] };
  }

  const periodLabel = String(fd.get("period") ?? "").trim() || sheetName;
  const startedAt = new Date();

  const batch = await prisma.chromiaImportBatch.create({
    data: {
      sourceFile, sheetName, periodLabel, status: "PROCESSING",
      totalRows: parsed.rows.length, startedAt, importedById: userId,
    },
  });

  const errors: { sourceRow: number; reason: string }[] = [...parsed.issues];
  let imported = 0;
  let skipped = parsed.skipped;
  let failed = 0;

  // Master data the sheet references, resolved once and cached. The register is
  // free text, so a material or design that has never been seen is created
  // rather than rejected — refusing the row would lose real history over a
  // spelling nobody has entered yet.
  const materials = new Map<string, string>();
  const designs = new Map<string, string>();
  const batches = new Map<string, string>();
  const reasons = new Map<string, string>();
  for (const r of await prisma.chromiaRecalibrationReason.findMany({ select: { id: true, code: true } })) {
    reasons.set(r.code, r.id);
  }

  async function materialId(name: string): Promise<string> {
    const code = toCode(name);
    const hit = materials.get(code);
    if (hit) return hit;
    const rec = await prisma.chromiaBaseMaterial.upsert({
      where: { code }, update: {}, create: { code, name: name.trim() },
      select: { id: true },
    });
    materials.set(code, rec.id);
    return rec.id;
  }

  async function designId(name: string | null): Promise<string | null> {
    if (!name) return null;
    const code = toCode(name);
    if (!code) return null;
    const hit = designs.get(code);
    if (hit) return hit;
    const rec = await prisma.chromiaDesign.upsert({
      where: { code },
      update: {},
      // fileName is the artwork as the register wrote it — kept verbatim
      // alongside the tidied name, because the print file is what an operator
      // matches against on the machine.
      create: { code, name: name.trim(), fileName: name.trim() },
      select: { id: true },
    });
    designs.set(code, rec.id);
    return rec.id;
  }

  async function batchId(batchNo: string, materialRef: string, received: Date): Promise<string> {
    const hit = batches.get(batchNo);
    if (hit) return hit;
    const rec = await prisma.chromiaBatch.upsert({
      where: { batchNo },
      update: {},
      create: {
        batchNo, receivedDate: received, baseMaterialId: materialRef,
        createdById: userId,
      },
      select: { id: true },
    });
    batches.set(batchNo, rec.id);
    return rec.id;
  }

  async function reasonId(code: string | null): Promise<string | null> {
    if (!code) return null;
    const hit = reasons.get(code);
    if (hit) return hit;
    const rec = await prisma.chromiaRecalibrationReason.upsert({
      where: { code }, update: {},
      create: { code, name: code.replace(/-/g, " ").toLowerCase() },
      select: { id: true },
    });
    reasons.set(code, rec.id);
    return rec.id;
  }

  for (const r of parsed.rows) {
    try {
      // Live data wins. A slab the line has recorded since is never overwritten
      // by a row from the workbook it came from.
      const exists = await prisma.chromiaSlab.findUnique({
        where: { slabNo: r.slabNo }, select: { id: true },
      });
      if (exists) { skipped++; continue; }

      const materialRef = await materialId(r.materialName);
      const batchRef = await batchId(r.batchNo, materialRef, r.receivedDate);
      const designRef = await designId(r.designFile);
      const status = statusForImportedRow(r);

      await prisma.$transaction(async (tx) => {
        const slab = await tx.chromiaSlab.create({
          data: {
            slabNo: r.slabNo,
            batchId: batchRef,
            baseMaterialId: materialRef,
            plannedDesignId: designRef,
            status: status as never,
            currentDisposition: (r.disposition ?? null) as never,
            isRecalibrationOut: status === "OUT_FOR_RECALIBRATION",
            recalibrationCount: r.disposition === "RECALIBRATION" ? 1 : 0,
            receivedDate: r.receivedDate,
            legacySourceFile: sourceFile,
            legacySheetName: sheetName,
            legacySourceRow: r.sourceRow,
            legacyRemark: r.remark,
            importBatchId: batch.id,
            createdById: userId,
          },
        });

        // Cycle 1, carrying what the sheet knows about the pass.
        const cycle = await tx.chromiaProcessCycle.create({
          data: {
            slabId: slab.id, cycleNumber: 1,
            status: r.disposition ? "COMPLETED" : "ACTIVE",
            designId: designRef,
            fullyPrintedDate: r.fullyPrintedDate,
            printResult: r.fullyPrintedDate
              ? "FULLY_PRINTED"
              : r.bypassedDate ? "BYPASSED" : null,
            disposition: (r.disposition ?? null) as never,
            completedAt: r.disposition ? r.receivedDate : null,
            createdById: userId,
          },
        });

        if (r.disposition === "RECALIBRATION") {
          await tx.chromiaRecalibrationCycle.create({
            data: {
              slabId: slab.id, attemptNumber: 1,
              status: r.recalReceivedDate ? "RECEIVED" : "SENT",
              failedCycleId: cycle.id,
              reasonId: await reasonId(r.recalibrationReasonCode),
              reasonNotes: r.remark,
              sentDate: r.recalSentDate,
              receivedDate: r.recalReceivedDate,
              turnaroundDays: recalibrationAgeing({
                sentDate: r.recalSentDate, receivedDate: r.recalReceivedDate,
              }).daysOut,
              createdById: userId,
            },
          });
        }

        await tx.chromiaSlabEvent.create({
          data: {
            slabId: slab.id, cycleId: cycle.id, eventType: "SLAB_CREATED",
            toStatus: status as never, userId,
            occurredAt: r.receivedDate,
            note: `Imported from ${sourceFile} (${sheetName} row ${r.sourceRow})`,
            payload: { importBatchId: batch.id, remark: r.remark },
          },
        });
      });

      imported++;
    } catch (e) {
      failed++;
      errors.push({
        sourceRow: r.sourceRow,
        reason: `${r.slabNo}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  await prisma.chromiaImportBatch.update({
    where: { id: batch.id },
    data: {
      status: failed && !imported ? "FAILED" : "COMPLETED",
      importedRows: imported, skippedRows: skipped, failedRows: failed,
      completedAt: new Date(),
      errorLog: errors.length ? errors.slice(0, 200) : undefined,
    },
  });

  for (const p of ["/chromia", "/chromia/slabs", "/chromia/recalibration-tracking", "/chromia/import"]) {
    revalidatePath(p);
  }

  return { ok: true, importBatchId: batch.id, imported, skipped, failed, errors: errors.slice(0, 50) };
}
