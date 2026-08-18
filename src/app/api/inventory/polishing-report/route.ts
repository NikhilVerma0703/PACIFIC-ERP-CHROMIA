// Excel export of the full polishing report for a date range — every polish
// entry in the window with the QC outcome of that same slab beside it.
//
// Audience = inventoryGate: Commercial (who asked for it), Finance, Accounts and
// Admin. Sales is summary-only and is refused by that gate, same as the Slabs
// search it sits above.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";
import { slabLabel } from "@/lib/slabLabel";
import { displayBatch } from "@/lib/batchDisplay";
import { canonicalGrade } from "@/lib/inventory/grading";
import { normalizeBatch } from "@/lib/normalizeBatch";
import * as XLSX from "xlsx";

const db = prisma as any;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** IST day boundary — the floor's day, not UTC's. */
const istStart = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00+05:30`));
const istEnd = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00+05:30`) + 86400_000);
const ist = (d: Date | null | undefined) =>
  d ? new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 16).replace("T", " ") : "";

export async function GET(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const sp = new URL(request.url).searchParams;
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();
  // A batch runs across days, so asking for one by name means the WHOLE batch —
  // the date range is not applied on top, or the tail of a batch that spilled
  // past midnight would be silently missing from its own report.
  const batchKey = normalizeBatch(sp.get("b") ?? "");

  if (!batchKey) {
    if (!YMD.test(from) || !YMD.test(to)) {
      return Response.json({ error: "Pick a start and end date, or enter a batch." }, { status: 400 });
    }
    if (from > to) return Response.json({ error: "The start date is after the end date." }, { status: 400 });
  }

  try {
    // `created` is the Airtable-era timestamp and stopped being filled in June
    // 2026 — ERP-created rows only carry importedAt. Without the fallback this
    // report is empty for every recent range.
    const inWindow = batchKey
      ? { batchKey }
      : {
          OR: [
            { created: { gte: istStart(from), lt: istEnd(to) } },
            { AND: [{ created: null }, { importedAt: { gte: istStart(from), lt: istEnd(to) } }] },
          ],
        };

    // Ordered by importedAt, which EVERY row has. Ordering by `created` desc
    // nulls-last would push the ERP-era rows (created = null) to the end, so the
    // take cap would drop exactly the most recent polishing — the opposite of
    // what a truncated report should lose. Display order is fixed below.
    const entries: any[] = await db.polishEntry.findMany({
      where: inWindow,
      select: {
        slabNumber: true, batchNumber: true, design: true, slabThickness: true,
        polishSide: true, calliberator: true, polishingStatus: true,
        thickness1Mm: true, thickness2Mm: true, thickness3Mm: true, thickness4Mm: true,
        sku: true, remarks: true, polishQcIds: true, created: true, importedAt: true,
      },
      orderBy: { importedAt: "desc" },
      take: 50000,
    });
    const stamp = (r: any) => new Date(r.created ?? r.importedAt ?? 0).getTime();
    entries.sort((a, b) => stamp(b) - stamp(a));

    // QC outcome for the same slabs. Joined by the stored link ids where they
    // exist (Airtable-era rows), else by slab number — ERP-created entries have
    // no link, and dropping those would silently blank the grade column.
    //
    // Chunked: Postgres caps a statement at 32767 bind parameters, and a few
    // months of polishing is tens of thousands of slab numbers, so a single
    // `in` list turned an ordinary date range into a hard 500.
    const linkIds = [...new Set(entries.flatMap((e) => e.polishQcIds ?? []).filter(Boolean))] as string[];
    const slabNos = [...new Set(entries.map((e) => e.slabNumber).filter((n) => n != null))] as number[];
    const QC_SELECT = {
      airtableId: true, slabNumber: true, qualityGrade: true, inspector: true,
      rwStatus: true, repolishStatus: true, qualityIssue: true, polishType: true,
      bay: true, dispatchStatus: true, createdTime: true, importedAt: true,
    };
    const CHUNK = 5000;
    const qc: any[] = [];
    for (let i = 0; i < slabNos.length; i += CHUNK) {
      qc.push(...await db.polishQc.findMany({
        where: { slabNumber: { in: slabNos.slice(i, i + CHUNK) } }, select: QC_SELECT,
      }));
    }
    for (let i = 0; i < linkIds.length; i += CHUNK) {
      qc.push(...await db.polishQc.findMany({
        where: { airtableId: { in: linkIds.slice(i, i + CHUNK) } }, select: QC_SELECT,
      }));
    }
    // Newest QC first by the EFFECTIVE timestamp, so a re-polished slab reports
    // its latest outcome rather than whichever era's row happened to sort first.
    const qcStamp = (q: any) => new Date(q.createdTime ?? q.importedAt ?? 0).getTime();
    qc.sort((a, b) => qcStamp(b) - qcStamp(a));
    const qcById = new Map<string, any>();
    const qcBySlab = new Map<number, any>();
    for (const q of qc) {
      if (q.airtableId && !qcById.has(q.airtableId)) qcById.set(q.airtableId, q);
      if (q.slabNumber != null && !qcBySlab.has(q.slabNumber)) qcBySlab.set(q.slabNumber, q);
    }
    const qcFor = (e: any) => {
      for (const id of e.polishQcIds ?? []) { const q = qcById.get(id); if (q) return q; }
      return e.slabNumber != null ? qcBySlab.get(e.slabNumber) : undefined;
    };

    const header = [
      // "Grade" is the canonical A/A2/B/C the rest of Finished Goods filters on;
      // "QC grade" further right keeps QC's raw wording ("C (Reject)", "Not
      // graded yet"), so the two never have to be reconciled by the reader.
      "Date & time", "Slab #", "Batch", "Design", "Grade", "Quality issues", "Thickness",
      "Polish side", "Calliberator", "Polishing status",
      "Thk 1 (mm)", "Thk 2 (mm)", "Thk 3 (mm)", "Thk 4 (mm)", "SKU", "Remarks",
      "QC grade", "Inspector", "RW status", "Repolish", "Polish type",
      "Bay", "Dispatch status", "QC date",
    ];
    const data: (string | number)[][] = [header];
    for (const e of entries) {
      const q = qcFor(e);
      data.push([
        ist(e.created ?? e.importedAt),
        slabLabel(e.slabNumber),
        // displayBatch renders an em-dash for "no batch"; a spreadsheet wants an
        // empty cell so the column still filters and sorts cleanly.
        e.batchNumber ? displayBatch(e.batchNumber) : "",
        e.design ?? "",
        canonicalGrade(q?.qualityGrade) ?? "",
        (q?.qualityIssue ?? []).join(", "),
        e.slabThickness ?? "",
        e.polishSide ?? "",
        e.calliberator ?? "",
        e.polishingStatus ?? "",
        e.thickness1Mm ?? "", e.thickness2Mm ?? "", e.thickness3Mm ?? "", e.thickness4Mm ?? "",
        e.sku ?? "",
        e.remarks ?? "",
        q?.qualityGrade ?? "",
        q?.inspector ?? "",
        q?.rwStatus ?? "",
        q?.repolishStatus ?? "",
        q?.polishType ?? "",
        q?.bay ?? "",
        q?.dispatchStatus ?? "",
        ist(q?.createdTime ?? q?.importedAt),
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    // Widths follow the header order above, one per column.
    ws["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 22 }, { wch: 8 }, { wch: 34 }, { wch: 11 },
      { wch: 12 }, { wch: 16 }, { wch: 15 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 28 },
      { wch: 9 }, { wch: 16 }, { wch: 12 }, { wch: 11 }, { wch: 14 }, { wch: 9 }, { wch: 15 }, { wch: 16 }];
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length - 1, c: header.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Polishing report");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    // Filename carries what was asked for, so several downloads never collide.
    // The batch box is free text — strip anything a header cannot carry.
    const tag = batchKey ? `batch-${batchKey.replace(/[^\w.-]/g, "") || "x"}` : `${from}_to_${to}`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="polishing-report-${tag}.xlsx"`,
      },
    });
  } catch (e) {
    console.error("Polishing report export error:", e);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}
