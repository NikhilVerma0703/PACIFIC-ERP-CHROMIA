// Excel export of the Slabs search — same filters as the table, ADMIN only.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";
import { buildInventoryWhere, approvedOnlyWhere } from "@/lib/inventory/searchWhere";
import { isAdmin } from "@/lib/rbac";
import { slabLabel } from "@/lib/slabLabel";
import { displayBatch } from "@/lib/batchDisplay";
import * as XLSX from "xlsx";

const db = prisma as any;

export async function GET(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  if (!(await isAdmin())) return Response.json({ error: "Admin only" }, { status: 403 });
  try {
    const sp = new URL(request.url).searchParams;
    let where = await buildInventoryWhere(sp);
    if (sp.get("pending") !== "1") where = await approvedOnlyWhere(where); // export matches the visible view
    const rows: any[] = await db.finishedSlab.findMany({ where, orderBy: { slabNumber: "desc" }, take: 50000 });
    const aliasRows: any[] = await db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []);
    const amap = new Map<string, string>(aliasRows.map((x) => [x.variant, x.canonical]));
    const header = ["Slab #","Design","Batch","Thickness","Grade","Quality Issues","Polish","Bay","Frame","Sqft","Sqm","Age (days)","Status","PI","Customer"];
    const data: (string | number)[][] = [header];
    for (const r of rows) {
      const sqft = Math.round((((r.lengthIn ?? 0) * (r.widthIn ?? 0)) / 144) * 100) / 100;
      const age = r.firstSeenAt ? Math.max(0, Math.floor((Date.now() - new Date(r.firstSeenAt).getTime()) / 86400000)) : "";
      data.push([
        r.slabNumber >= 9000000 && r.barcode ? r.barcode : slabLabel(r.slabNumber),
        r.design ? (amap.get(r.design) ?? r.design) : "",
        displayBatch(r.batchNumber) === "—" ? "" : displayBatch(r.batchNumber),
        r.slabThickness ?? "", r.grade ?? "",
        Array.isArray(r.qualityIssue) ? r.qualityIssue.join("; ") : "",
        r.polishType ?? "", r.bayNumber ?? "", r.frameNumber ?? "",
        sqft, Math.round(sqft * 0.092903 * 100) / 100, age, r.status,
        r.reservedForPi ?? "", r.customer ?? "",
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 10 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 28 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
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
