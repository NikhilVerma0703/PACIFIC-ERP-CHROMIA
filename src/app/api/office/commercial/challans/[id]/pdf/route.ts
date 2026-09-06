// GET /api/office/commercial/challans/[id]/pdf — four A4 pages, one per copy
// (Original / Duplicate / Triplicate / Quadruplicate), each carrying its label.
// Rendered from the row plus the live settings: unlike an invoice a challan
// keeps no snapshot, so the company master and the bank come from settings.
import { NextResponse } from "next/server";
import { commercialGate } from "@/lib/commercial/access";
import { deny, handle } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { challanFilename } from "@/lib/commercial/challan-rules";
import { generateChallanPdf } from "@/lib/commercial/pdf/challan";
import { challanIdOf, loadChallan, itemsOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await challanIdOf(params);
    const row = await loadChallan(id);
    const settings = await loadSettings();
    const buf = await generateChallanPdf({
      number: String(row.number),
      challanDate: row.challanDate as Date,
      consigneeName: String(row.consigneeName ?? ""),
      consigneeAddress: (row.consigneeAddress as string | null) ?? null,
      consigneeGstin: (row.consigneeGstin as string | null) ?? null,
      poRef: (row.poRef as string | null) ?? null,
      commodity: (row.commodity as string | null) ?? null,
      purpose: (row.purpose as string | null) ?? null,
      items: itemsOf(row),
      totalAmount: row.totalAmount === null || row.totalAmount === undefined ? null : Number(row.totalAmount),
      amountInWords: (row.amountInWords as string | null) ?? null,
      lorryNo: (row.lorryNo as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      status: (row.status as string | null) ?? null,
    }, settings);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${challanFilename(String(row.number))}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
