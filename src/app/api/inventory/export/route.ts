// Excel export of the Slabs search — same filters as the table, ADMIN only.
//
// On the read gate because the handler only reads; the ADMIN check under it is
// what decides the audience, and it is unchanged, so a finished-goods view
// grant gets the table on screen and not the spreadsheet — the same answer
// Finance and Accounts have always had here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryReadGate } from "@/lib/inventory/access";
import { buildInventoryWhere, approvedOnlyWhere, isMissingSlabMarkError } from "@/lib/inventory/searchWhere";
import { isAdmin } from "@/lib/rbac";
import { slabLabel } from "@/lib/slabLabel";
import { displayBatch } from "@/lib/batchDisplay";
import { slabMarkOf, SLAB_MARK_LABEL } from "@/lib/fab/slabMark";
import * as XLSX from "xlsx";

const db = prisma as any;

export async function GET(request: Request) {
  const g = await inventoryReadGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  if (!(await isAdmin())) return Response.json({ error: "Admin only" }, { status: 403 });
  try {
    const sp = new URL(request.url).searchParams;
    let where = await buildInventoryWhere(sp);
    if (sp.get("pending") !== "1") where = await approvedOnlyWhere(where); // export matches the visible view
    // No `select`, so every scalar comes back — which from 2026-09-03 includes
    // slabMark, because schema.prisma declares it. THAT IS A DEPLOY-ORDER TRAP:
    // a generated client that knows the field against a database that has not
    // had scripts/0070 asks for a column that is not there and Prisma answers
    // P2022, turning the whole export into "Export failed". `omit` re-runs the
    // identical query without that one column, so the spreadsheet still comes
    // out — with the Mark filled in from the legacy grade, exactly as this file
    // would have printed it yesterday.
    const findRows = { where, orderBy: { slabNumber: "desc" as const }, take: 50000 };
    const rows: any[] = await db.finishedSlab.findMany(findRows).catch((e: any) => {
      if (!isMissingSlabMarkError(e)) throw e;
      return db.finishedSlab.findMany({ ...findRows, omit: { slabMark: true } });
    });
    const aliasRows: any[] = await db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []);
    const amap = new Map<string, string>(aliasRows.map((x) => [x.variant, x.canonical]));
    // MARK BESIDE GRADE, never instead of it. A spreadsheet of stock that shows
    // only the grade cannot answer "which of these have been cut" the moment
    // fabrication stops overwriting the grade with 'CTS' — and a stock list you
    // cannot ask that of is how an already-cut slab gets promised to a customer
    // as a full slab. Two columns, two facts: how good the stone is, and what
    // became of the slab.
    const header = ["Slab #","Design","Batch","Thickness","Grade","Mark","Quality Issues","Polish","Bay","Frame","Sqft","Sqm","Age (days)","Status","PI","Customer"];
    const data: (string | number)[][] = [header];
    for (const r of rows) {
      const sqft = Math.round((((r.lengthIn ?? 0) * (r.widthIn ?? 0)) / 144) * 100) / 100;
      const age = r.firstSeenAt ? Math.max(0, Math.floor((Date.now() - new Date(r.firstSeenAt).getTime()) / 86400000)) : "";
      data.push([
        r.slabNumber >= 9000000 && r.barcode ? r.barcode : slabLabel(r.slabNumber),
        r.design ? (amap.get(r.design) ?? r.design) : "",
        displayBatch(r.batchNumber) === "—" ? "" : displayBatch(r.batchNumber),
        r.slabThickness ?? "",
        r.grade ?? "",
        // slabMarkOf falls back to the legacy `grade = 'CTS'` write when the
        // row has no mark — a database without scripts/0070, or a row the
        // backfill has not reached — so the 62 legacy CTS slabs (measured on
        // live Neon 2026-09-03) read "CTS" in this column from the very first
        // export rather than a sheet full of "Full slab" that has already been
        // cut. Words, not codes: this file is opened in Excel by people, and
        // FULL_SLAB is not a thing anybody says out loud.
        SLAB_MARK_LABEL[slabMarkOf(r.slabMark, r.grade)],
        Array.isArray(r.qualityIssue) ? r.qualityIssue.join("; ") : "",
        r.polishType ?? "", r.bayNumber ?? "", r.frameNumber ?? "",
        sqft, Math.round(sqft * 0.092903 * 100) / 100, age, r.status,
        r.reservedForPi ?? "", r.customer ?? "",
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    // One width per header, in header order — the extra { wch: 10 } is Mark,
    // sitting right after Grade. A short list here does not throw, it just
    // leaves the tail columns at Excel's default, which is how a mismatch goes
    // unnoticed until someone opens the sheet.
    ws["!cols"] = [{ wch: 10 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Finished Goods");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="finished-goods-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (e) {
    console.error("Inventory export error:", e);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}
