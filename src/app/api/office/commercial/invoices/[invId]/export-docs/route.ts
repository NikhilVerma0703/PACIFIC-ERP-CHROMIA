// GET  /api/office/commercial/invoices/[invId]/export-docs
//        → { invoice, roots, groups, sheets, saved, generatedAt }
// PUT   /api/office/commercial/invoices/[invId]/export-docs  { roots }
//        → the saved commercial_export_doc_set row
//
// Export invoices only. A DTA invoice has no shipping documents to generate,
// so it is refused with 400 rather than silently handed an empty workbook.
import { prisma } from "@/lib/prisma";
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, handle, plain, readBody, fail } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import { ROOT_CELLS, groupedRoots, GENERATED_SHEETS } from "@/lib/commercial/export-workbook/mapping";
import { loadExportInvoice, rootsFor } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

async function invIdOf(params: Promise<{ invId: string }>): Promise<string> {
  const { invId } = await params;
  if (!invId) fail(400, "Missing invoice id");
  return invId;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function header(inv: Record<string, any>) {
  return {
    id: inv.id,
    orderId: inv.orderId,
    number: inv.number,
    kind: inv.kind,
    status: inv.status,
    invoiceDate: inv.invoiceDate,
    currency: inv.currency,
    packingListId: inv.packingListId,
    packingListNumber: inv.packingList?.number ?? null,
    slabCount: (inv.packingList?.slabs ?? []).length,
    crateCount: (inv.packingList?.crates ?? []).length,
    orderNumber: inv.order?.number ?? null,
    clientName: inv.order?.client?.name ?? null,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("view", "invoices");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const invId = await invIdOf(params);
    const inv = await loadExportInvoice(invId);
    const settings = await loadSettings();
    const { roots, saved } = await rootsFor(inv, settings);
    return json(plain({
      invoice: header(inv),
      roots,
      groups: groupedRoots(),
      sheets: GENERATED_SHEETS,
      saved,
      generatedAt: inv.exportDocSet?.generatedAt ?? null,
      updatedAt: inv.exportDocSet?.updatedAt ?? null,
    }));
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("write", "invoices");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const invId = await invIdOf(params);
    const inv = await loadExportInvoice(invId);
    const body = await readBody<{ roots?: Record<string, unknown> }>(req);
    const incoming = body.roots;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      fail(400, "Send { roots: { … } } — an object keyed by root variable.");
    }

    // Only keys the map knows are stored: a stray field from an old browser
    // tab must not end up in a document set nobody can explain later.
    const settings = await loadSettings();
    const { roots: current } = await rootsFor(inv, settings);
    const next: Record<string, unknown> = { ...current };
    const unknown: string[] = [];
    for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
      const rc = ROOT_CELLS.find((r) => r.key === k);
      if (!rc) { unknown.push(k); continue; }
      next[k] = rc.kind === "number"
        ? (v === "" || v === null || v === undefined ? 0 : Number(String(v).replace(/,/g, "")) || 0)
        : (v === null || v === undefined ? "" : String(v));
    }

    const stamp = actorStamp(g.user);
    const row = await db.commercialExportDocSet.upsert({
      where: { invoiceId: invId },
      update: { rootVariables: next, generatedById: stamp.id },
      create: { invoiceId: invId, rootVariables: next, generatedById: stamp.id, templateVersion: "ciot-14sheet" },
    });

    if (inv.orderId) {
      await logOrderEvent(inv.orderId, "export_docs", {
        note: `Export document variables saved for invoice ${inv.number}`,
        payload: { invoiceId: invId, keys: Object.keys(incoming).length },
        by: g.user,
      });
    }
    return json(plain({ ...row, unknownKeys: unknown }));
  });
}
