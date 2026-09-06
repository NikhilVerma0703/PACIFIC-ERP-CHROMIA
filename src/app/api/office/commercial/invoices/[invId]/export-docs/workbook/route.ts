// GET /api/office/commercial/invoices/[invId]/export-docs/workbook
//     → the filled .xlsx as an attachment.
//
// Not JSON, so this is the one handler in the module that does not end with
// json(plain(...)); errors still do, with a status, so the browser shows the
// reason rather than downloading a file full of an error message.
import { prisma } from "@/lib/prisma";
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, bad, fail, HttpError } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { buildExportWorkbook, workbookFileName } from "@/lib/commercial/export-workbook/build";
import { loadExportInvoice, rootsFor, slabRowsOf, crateRowsOf } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Loading a 550 KB template, rewriting three tables and zipping it back takes
// a couple of seconds cold; the platform default would cut a large shipment off.
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export async function GET(_req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  try {
    const { invId } = await params;
    if (!invId) fail(400, "Missing invoice id");
    const inv = await loadExportInvoice(invId);
    const settings = await loadSettings();
    const { roots } = await rootsFor(inv, settings);

    const slabs = slabRowsOf(inv.packingList ?? null);
    const crateRows = crateRowsOf(inv, slabs, roots);

    const buffer = await buildExportWorkbook({ roots, slabs, crateRows });

    // Stamped after the build, so a failed build does not claim a generation.
    await db.commercialExportDocSet.upsert({
      where: { invoiceId: invId },
      update: { generatedAt: new Date(), generatedById: actorStamp(g.user).id },
      create: {
        invoiceId: invId, rootVariables: roots, templateVersion: "ciot-14sheet",
        generatedAt: new Date(), generatedById: actorStamp(g.user).id,
      },
    });

    const body = new Uint8Array(buffer);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${workbookFileName(inv.number)}"`,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    const msg = (e as Error)?.message ?? String(e);
    console.error("[commercial] export workbook:", msg);
    return bad(msg, 500);
  }
}
