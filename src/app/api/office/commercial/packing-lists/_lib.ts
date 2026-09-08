// Shared by every /api/office/commercial/packing-lists/** and
// /dispatch-check/** handler, and by the create route under orders/[id]/.
// Not a route — Next ignores a colocated file that is not route.ts.
//
// One loader, one include, one place that decides which inventory rows may
// join a list: a packing list is the document the container is stuffed from,
// so "which slab is on it" has to mean the same thing whether the row was
// added at creation, added later by number, or pulled off at submit.
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/commercial/http";
import type { CommercialGate } from "@/lib/commercial/access";
import { readSlabs, type SlabRow } from "@/lib/commercial/inventory-bridge";
import { parseMeasurementUnit } from "@/lib/commercial/measure";
import {
  nextPackagesSummary, slabEligibility, buildPackedSlab, canEdit, canEditHeader,
  vesselFromSnapshot, PACKING_STATUS_LABEL, type PackingStatus, type OrderItemLike, type PartyLike,
} from "@/lib/commercial/packing-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** Everything the editor, the PDFs and the dispatch screen read off a list. */
export const PL_INCLUDE = {
  crates: { orderBy: { crateNo: "asc" } },
  slabs: { orderBy: { sortOrder: "asc" } },
  order: {
    include: {
      client: { include: { commercialExt: true } },
      enquiry: { select: { id: true, number: true } },
      items: { orderBy: { lineNo: "asc" } },
      holds: { include: { slabs: { orderBy: { slabNumber: "asc" } } }, orderBy: { placedAt: "desc" } },
    },
  },
  invoices: { select: { id: true, number: true, kind: true, invoiceDate: true, status: true }, orderBy: { invoiceDate: "desc" } },
} as const;

export interface PackingListRow extends Record<string, unknown> {
  id: string;
  orderId: string;
  number: string;
  status: PackingStatus;
  packagesSummary: string | null;
  /** cm | in — what the sheets print in (answer 17). */
  measurementUnit: string;
  crates: Array<Record<string, unknown> & { id: string; crateNo: number; kind: string }>;
  slabs: Array<Record<string, unknown> & { id: string; slabNumber: number; sortOrder: number; fit: string }>;
  order: Record<string, unknown> & { id: string; number: string; kind: "DOMESTIC" | "EXPORT"; status: string; items: Array<Record<string, unknown>>; client: Record<string, unknown>; holds: Array<Record<string, unknown>> };
}

/** Route params in Next 15 are a promise, and this segment's is not `id`. */
export async function paramPl(params: Promise<{ plId: string }>): Promise<string> {
  const { plId } = await params;
  if (!plId) fail(400, "Missing packing list id");
  return plId;
}

export async function paramTwo(params: Promise<Record<string, string>>, a: string, b: string): Promise<[string, string]> {
  const p = await params;
  if (!p[a]) fail(400, `Missing ${a}`);
  if (!p[b]) fail(400, `Missing ${b}`);
  return [p[a], p[b]];
}

/** The list with its crates, slabs and order, or a 404. */
export async function loadList(plId: string): Promise<PackingListRow> {
  const row = await db.commercialPackingList.findUnique({ where: { id: plId }, include: PL_INCLUDE });
  if (!row) fail(404, "Packing list not found");
  return row as PackingListRow;
}

/** Who the bridge and the stamps record. */
export function byOf(g: CommercialGate): string | null {
  return g.user?.name ?? g.user?.email ?? null;
}

export function isAdminOf(g: CommercialGate): boolean {
  return g.actor === "ADMIN";
}

const label = (s: string): string => PACKING_STATUS_LABEL[s as PackingStatus]?.toLowerCase() ?? s;

/** Crates and slabs may only be changed while the list is with Commercial. */
export function requireEditable(list: { status: string; number: string }): void {
  if (!canEdit(list.status)) fail(409, `${list.number} is ${label(list.status)} — reopen it before changing what is packed`);
}

/** Container, seal, vehicle and weights are known at stuffing time, after the
 *  check, so the header stays open until the slabs have gone. */
export function requireHeaderEditable(list: { status: string; number: string }): void {
  if (!canEditHeader(list.status)) fail(409, `${list.number} has been dispatched — its header can no longer be changed`);
}

/**
 * The references this order's slabs may legitimately be held under: the order
 * number, every hold it has placed, and its enquiry number. A slab reserved
 * under somebody else's PI is refused, which is the concern the inventory
 * route refuses COMMERCIAL `release` for (see inventory-bridge's head note).
 */
export function ownReferences(order: { number: string; holds?: Array<{ reference?: string | null }> | null; enquiry?: { number?: string | null } | null }): string[] {
  const refs = new Set<string>();
  if (order.number) refs.add(order.number);
  for (const h of order.holds ?? []) if (h?.reference) refs.add(h.reference);
  if (order.enquiry?.number) refs.add(order.enquiry.number);
  return Array.from(refs);
}

export interface SlabIntake {
  /** commercial_packed_slab data rows, ready for create. */
  rows: Array<Record<string, unknown>>;
  /** Numbers that could not go on, with the reason printed for the user. */
  skipped: Array<{ slab: number; reason: string }>;
}

/**
 * Turn a list of slab numbers into packed-slab rows: read the inventory,
 * refuse what may not be packed (slabEligibility), refuse what is already on
 * the list, and build the rest with the customer's SKU from the matching order
 * line and centimetres from the stored inches.
 */
export async function intakeSlabs(opts: {
  slabNumbers: number[];
  order: { number: string; items: OrderItemLike[]; holds?: Array<{ reference?: string | null }> | null; enquiry?: { number?: string | null } | null };
  already: ReadonlyArray<{ slabNumber: number }>;
  startSortOrder: number;
  isAdmin: boolean;
}): Promise<SlabIntake> {
  const wanted = Array.from(new Set(opts.slabNumbers)).sort((a, b) => a - b);
  const onList = new Set(opts.already.map((s) => Number(s.slabNumber)));
  const refs = ownReferences(opts.order);
  const live: SlabRow[] = wanted.length ? await readSlabs(wanted, opts.isAdmin) : [];
  const byNo = new Map(live.map((r) => [r.slabNumber, r]));
  const rows: Array<Record<string, unknown>> = [];
  const skipped: Array<{ slab: number; reason: string }> = [];
  let sort = opts.startSortOrder;
  for (const n of wanted) {
    if (onList.has(n)) { skipped.push({ slab: n, reason: "already on this list" }); continue; }
    const row = byNo.get(n);
    if (!row) { skipped.push({ slab: n, reason: "not found in finished goods" }); continue; }
    const check = slabEligibility(row, refs);
    if (!check.ok) { skipped.push({ slab: n, reason: check.reason }); continue; }
    rows.push({ ...buildPackedSlab(row, opts.order.items, sort++) });
  }
  return { rows, skipped };
}

/**
 * "07 Wooden Crate(S) + 08 Sample Box", kept true as crates come and go —
 * unless somebody typed a wording of their own, which is never overwritten
 * (nextPackagesSummary). Called after every crate change so the invoice's
 * Packages column is right without anyone maintaining it. `before` is the
 * crate set as it was when the list was loaded.
 */
export async function syncPackages(list: { id: string; packagesSummary: string | null; crates?: ReadonlyArray<{ kind: string }> }): Promise<void> {
  const after: Array<{ kind: string }> = await db.commercialCrate.findMany({ where: { packingListId: list.id }, select: { kind: true } });
  const next = nextPackagesSummary(list.packagesSummary, list.crates ?? [], after);
  if (next.change) await db.commercialPackingList.update({ where: { id: list.id }, data: { packagesSummary: next.value } });
}

// ───────────────────────────── the two PDFs ─────────────────────────────────
// Both sheets print the same list, order, client and (when there is one)
// invoice, so they are shaped ONCE here. Deliberately NOT typed by importing
// the pdf modules: those `require("pdfmake")` at load, and every packing route
// imports this file.

/** A slab as the sheets read it — Decimal columns already numbers. */
export interface PdfSlab {
  crateId: string | null;
  slabNumber: number;
  customerSlabNo: string | null;
  customerBatchNo: string | null;
  design: string | null;
  customerSku: string | null;
  thickness: string | null;
  batchKey: string | null;
  batchNumber: string | null;
  grade: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  sqm: number | null;
  sqft: number | null;
  fit: string;
  sortOrder: number;
}

export interface PdfCrate {
  id: string;
  crateNo: number;
  kind: string;
  grossKg: number | null;
  netKg: number | null;
  remarks: string | null;
}

const dec = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** Everything either sheet needs, read once and converted out of Decimal. */
export async function shapeForPdf(plId: string) {
  const list = await loadList(plId);
  const order = list.order;
  const client = (order.client as Record<string, unknown> | null) ?? null;
  const ext = (client?.commercialExt as Record<string, unknown> | null) ?? null;
  const invoices = (list.invoices as Array<Record<string, unknown>> | undefined) ?? [];
  const invoice = invoices.find((i) => i.status === "ISSUED") ?? invoices[0] ?? null;

  // The vessel is on the invoice's frozen snapshot and nowhere else in the
  // module, so the packing list's "Vessel / Flight No." box can only be filled
  // once there is an invoice — read here rather than in PL_INCLUDE, which every
  // packing route loads and which has no business carrying an invoice's whole
  // snapshot. (B/L and S/B have no column anywhere; their boxes print empty.)
  const invRow = invoice
    ? await db.commercialInvoice.findUnique({ where: { id: invoice.id }, select: { snapshot: true } })
    : null;
  const vessel = vesselFromSnapshot(invRow?.snapshot);

  return {
    vessel,
    number: list.number,
    plList: {
      number: list.number,
      createdAt: (list.createdAt as string | Date | null) ?? null,
      containerNo: (list.containerNo as string | null) ?? null,
      sealNo: (list.sealNo as string | null) ?? null,
      linerOtlNo: (list.linerOtlNo as string | null) ?? null,
      vehicleNo: (list.vehicleNo as string | null) ?? null,
      grossWeightKg: dec(list.grossWeightKg),
      netWeightKg: dec(list.netWeightKg),
      packagesSummary: list.packagesSummary,
      measurementUnit: parseMeasurementUnit(list.measurementUnit) ?? "cm",
      notes: (list.notes as string | null) ?? null,
      crates: list.crates.map((c): PdfCrate => ({
        id: c.id, crateNo: Number(c.crateNo), kind: String(c.kind),
        grossKg: dec(c.grossKg), netKg: dec(c.netKg), remarks: (c.remarks as string | null) ?? null,
      })),
      slabs: list.slabs.map((s): PdfSlab => ({
        crateId: (s.crateId as string | null) ?? null,
        slabNumber: Number(s.slabNumber),
        customerSlabNo: (s.customerSlabNo as string | null) ?? null,
        customerBatchNo: (s.customerBatchNo as string | null) ?? null,
        design: (s.design as string | null) ?? null,
        customerSku: (s.customerSku as string | null) ?? null,
        thickness: (s.thickness as string | null) ?? null,
        batchKey: (s.batchKey as string | null) ?? null,
        batchNumber: (s.batchNumber as string | null) ?? null,
        grade: (s.grade as string | null) ?? null,
        lengthCm: dec(s.lengthCm), widthCm: dec(s.widthCm), sqm: dec(s.sqm), sqft: dec(s.sqft),
        fit: String(s.fit),
        sortOrder: Number(s.sortOrder) || 0,
      })),
    },
    plOrder: {
      number: String(order.number),
      kind: String(order.kind),
      customerPoNumber: (order.customerPoNumber as string | null) ?? null,
      customerPoDate: (order.customerPoDate as string | Date | null) ?? null,
      consignee: (order.consignee as PartyLike | null) ?? null,
      notifyParty: (order.notifyParty as PartyLike | null) ?? null,
      buyerIfNotConsignee: (order.buyerIfNotConsignee as PartyLike | null) ?? null,
      countryOfOrigin: (order.countryOfOrigin as string | null) ?? null,
      countryOfDestination: (order.countryOfDestination as string | null) ?? null,
      deliveryTerms: (order.deliveryTerms as string | null) ?? null,
      paymentTerms: (order.paymentTerms as string | null) ?? null,
      preCarriageBy: (order.preCarriageBy as string | null) ?? null,
      placeOfReceipt: (order.placeOfReceipt as string | null) ?? null,
      portOfLoading: (order.portOfLoading as string | null) ?? null,
      portOfDischarge: (order.portOfDischarge as string | null) ?? null,
      finalDestination: (order.finalDestination as string | null) ?? null,
      items: (order.items as Array<{ isSample?: boolean | null; qtySlabs?: number | null; qty?: number | null; description?: string | null }>) ?? [],
    },
    client: client ? {
      name: String(client.name),
      address: (client.address as string | null) ?? null,
      city: (client.city as string | null) ?? null,
      country: (client.country as string | null) ?? null,
    } : null,
    ext: (ext as { shippingAddress?: PartyLike | null; billingAddress?: PartyLike | null; notifyParty?: PartyLike | null } | null) ?? null,
    invoice: invoice ? { number: String(invoice.number), invoiceDate: (invoice.invoiceDate as string | Date | null) ?? null } : null,
  };
}
