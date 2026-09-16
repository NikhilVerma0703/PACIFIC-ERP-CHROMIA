// Shared loading for the export document set routes.
//
// The decision logic — which cell holds what, how slabs become goods lines —
// is in src/lib/commercial/export-workbook/* and is tested there. This file
// only reads the database and shapes the result.
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/commercial/http";
import {
  DEFAULT_ROOTS, ROOT_CELLS, crateRowsFor, slabRowsFromPacking,
  type SlabRow, type CrateRow, type InvoiceSnapshotLike,
} from "@/lib/commercial/export-workbook/mapping";
import { invoicePrintsIndianBlock, invoiceSeller, type DesignCodeLookup } from "@/lib/commercial/invoice-rules";
import type { InvoiceSnapshot } from "@/lib/commercial/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export const INVOICE_INCLUDE = {
  exportDocSet: true,
  packingList: {
    include: {
      crates: { orderBy: { crateNo: "asc" as const } },
      slabs: { orderBy: { sortOrder: "asc" as const } },
    },
  },
  order: { include: { client: { include: { commercialExt: true } } } },
} as const;

/** The invoice with everything the workbook needs, or a 404 / 400. Export
 *  invoices only: a DTA invoice has no shipping documents to generate. */
export async function loadExportInvoice(invId: string): Promise<Row> {
  const inv = await db.commercialInvoice.findUnique({ where: { id: invId }, include: INVOICE_INCLUDE });
  if (!inv) fail(404, "Invoice not found.");
  if (inv.kind !== "EXPORT") {
    fail(400, "Export documents are generated for export invoices only; this one is a DTA (domestic) invoice.");
  }
  // AND ONLY FOR AN INDIAN EXPORTER'S INVOICE. This workbook is an Indian
  // customs filing — a shipping bill, the VGM declaration, Annexure C1 — and
  // mapping.ts does NOT read the invoice's frozen company block for the parts
  // that matter: it binds `settings.company` live and hardcodes Pacific's IEC
  // ("IEC AALCP2750N"), Pacific's GSTIN, the LUT/ARN paragraph and the C1 IEC
  // as literal strings. So a Monolith invoice would produce a complete Indian
  // customs pack under a US company's name, quoting an Indian exporter's
  // registrations it has no right to, and emptying the snapshot would not stop
  // it. Refused at the door instead, where one check covers all three routes.
  if (!invoicePrintsIndianBlock((inv.snapshot ?? {}) as InvoiceSnapshot)) {
    const seller = invoiceSeller((inv.snapshot ?? {}) as InvoiceSnapshot);
    fail(400, `The export document set is an Indian customs filing — shipping bill, VGM and Annexure C1 — and is raised by the Indian exporter. This invoice was sold by ${seller.label}, whose shipment out of India is Pacific's own invoice for the same goods.`);
  }
  return inv as Row;
}

function snapshotOf(inv: Row): InvoiceSnapshotLike {
  const snap = (inv.snapshot ?? {}) as InvoiceSnapshotLike;
  // The snapshot is the truth for what was invoiced; the row's own columns
  // fill the gaps a half-built snapshot leaves.
  return {
    ...snap,
    number: snap.number ?? inv.number,
    date: snap.date ?? (inv.invoiceDate instanceof Date ? inv.invoiceDate.toISOString().slice(0, 10) : String(inv.invoiceDate ?? "")),
    currency: snap.currency ?? inv.currency,
    exchangeRate: snap.exchangeRate ?? (inv.exchangeRate === null || inv.exchangeRate === undefined ? null : Number(inv.exchangeRate)),
    containerNo: snap.containerNo ?? inv.containerNo,
    sealNo: snap.sealNo ?? inv.sealNo,
    vehicleNo: snap.vehicleNo ?? inv.vehicleNo,
    amountInWords: snap.amountInWords ?? inv.amountInWords,
  };
}

/** The root variables to show: what was saved, laid over a fresh derivation so
 *  a key added to the map since the last save is not missing from the form. */
export async function rootsFor(inv: Row, settings: unknown): Promise<{ roots: Record<string, unknown>; saved: boolean }> {
  const defaults = DEFAULT_ROOTS(
    snapshotOf(inv),
    inv.packingList ? plainPackingList(inv.packingList) : null,
    inv.order ?? null,
    (settings ?? {}) as never,
  );
  const savedRaw = inv.exportDocSet?.rootVariables;
  const saved = savedRaw && typeof savedRaw === "object" && !Array.isArray(savedRaw)
    ? (savedRaw as Record<string, unknown>) : null;
  if (!saved) return { roots: defaults, saved: false };
  const merged: Record<string, unknown> = { ...defaults };
  for (const rc of ROOT_CELLS) if (rc.key in saved) merged[rc.key] = saved[rc.key];
  return { roots: merged, saved: true };
}

function plainPackingList(pl: Row) {
  return {
    number: pl.number ?? null,
    containerNo: pl.containerNo ?? null,
    sealNo: pl.sealNo ?? null,
    linerOtlNo: pl.linerOtlNo ?? null,
    vehicleNo: pl.vehicleNo ?? null,
    grossWeightKg: pl.grossWeightKg === null || pl.grossWeightKg === undefined ? null : Number(pl.grossWeightKg),
    netWeightKg: pl.netWeightKg === null || pl.netWeightKg === undefined ? null : Number(pl.netWeightKg),
    packagesSummary: pl.packagesSummary ?? null,
    crates: (pl.crates ?? []).map((c: Row) => ({ crateNo: c.crateNo, kind: c.kind })),
  };
}

/** The packed slabs as measurement-list rows. The mapping lives in the pure
 *  module (slabRowsFromPacking) so the customer-numbering, area and item-code
 *  rules are tested; this is only the Prisma row handed across, with the
 *  design master's lookup (answer 20) for the SKU column. */
export function slabRowsOf(pl: Row | null, codeFor: DesignCodeLookup): SlabRow[] {
  return slabRowsFromPacking(pl as never, codeFor);
}

/** The goods lines the documents print, from the slabs plus the invoice's own
 *  sample lines. */
export function crateRowsOf(inv: Row, slabs: SlabRow[], roots: Record<string, unknown>): CrateRow[] {
  const snap = snapshotOf(inv);
  const netKg = inv.packingList?.netWeightKg === null || inv.packingList?.netWeightKg === undefined
    ? 0 : Number(inv.packingList.netWeightKg);
  return crateRowsFor(slabs, {
    marks: String(roots.marksAndNos ?? ""),
    packages: String(roots.packagesSummary ?? ""),
    unit: "SQMT",
    netWeightTotalKg: netKg,
    invoiceLines: Array.isArray(snap.lines) ? (snap.lines as never) : null,
  });
}
