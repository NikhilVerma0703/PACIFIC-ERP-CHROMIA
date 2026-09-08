// Shared by the /api/office/commercial/invoices/** and
// /api/office/commercial/orders/[id]/invoices handlers: the include the
// register and the detail both use, the loader, the row columns that are
// kept in step with the snapshot, and the two lookups the answers of
// 2026-09-07 added — the design-code master and the dropdown choices. Not a
// route — Next ignores a colocated file that is not route.ts.
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/commercial/http";
import { rowTotalsFromSnapshot, designCodeLookup, BANK_KEYS, LIVE_PI_STATUSES, livePiOf, type DesignCodeLookup, type PiBankSource } from "@/lib/commercial/invoice-rules";
import { gstinChoices, type CommercialSettings, type GstinChoice } from "@/lib/commercial/settings-defaults";
import type { InvoiceSnapshot } from "@/lib/commercial/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** Every invoice screen shows the order it belongs to and who it is for. */
export const INVOICE_INCLUDE = {
  order: { select: { id: true, number: true, kind: true, status: true, approvedAt: true, approvedByName: true, client: { select: { id: true, name: true, country: true } } } },
  packingList: { select: { id: true, number: true, status: true } },
  exportDocSet: { select: { id: true, generatedAt: true } },
} as const;

/** Next 15 hands route params as a promise; this segment's is `invId`. */
export async function invoiceIdOf(params: Promise<{ invId: string }>): Promise<string> {
  const { invId } = await params;
  if (!invId) fail(400, "Missing invoice id");
  return invId;
}

/** The invoice with its order and packing list, or a 404. */
export async function loadInvoice(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialInvoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
  if (!row) fail(404, "Invoice not found");
  return row;
}

/** The stored snapshot, or a 409 when the row was written without one. */
export function snapshotOf(row: Record<string, unknown>): InvoiceSnapshot {
  const s = row.snapshot as InvoiceSnapshot | null;
  if (!s || typeof s !== "object" || !Array.isArray(s.lines)) fail(409, "This invoice has no snapshot to print");
  return s;
}

/** The row columns that mirror the snapshot, so a list never disagrees with a PDF. */
export function rowPatchFor(snapshot: InvoiceSnapshot): Record<string, unknown> {
  return { snapshot, ...rowTotalsFromSnapshot(snapshot) };
}

/**
 * The PI the invoice references: the order's live issued (or accepted) one.
 * Its snapshot comes back too — round two's answer 20 has the invoice inherit
 * the PI's bank, so the customer pays into the account his proforma named.
 *
 * WHICH one, when a row from before answer 24 left two standing, is decided by
 * `livePiOf` and by nothing else. This used to be a findFirst ordered by
 * issuedAt then revision, while the order screen ran the pure livePiOf over
 * the same PIs and took the HIGHEST REVISION — so an older revision issued
 * later made the server and the screen name different PIs as "the live one",
 * and the invoice inherited a bank the tab never showed. The query now only
 * narrows and orders the candidates (highest revision first, latest issue as
 * the tie-break inside one revision); the rule picks.
 */
export async function livePiFor(orderId: string): Promise<{ number: string; date: string | null; status: string; snapshot: { bankKey?: unknown } | null } | null> {
  const rows = await db.commercialProforma.findMany({
    where: { orderId, status: { in: LIVE_PI_STATUSES } },
    // `nulls: "last"` because an ACCEPTED row saved without an issue date must
    // not out-rank a PI of the same revision that carries one.
    orderBy: [{ revision: "desc" }, { issuedAt: { sort: "desc", nulls: "last" } }],
    select: { number: true, issuedAt: true, status: true, revision: true, snapshot: true },
  });
  const pi = livePiOf(rows as Array<PiBankSource & { number: string; issuedAt: Date | string | null }>);
  if (!pi) return null;
  return {
    number: pi.number,
    date: pi.issuedAt ? new Date(pi.issuedAt).toISOString().slice(0, 10) : null,
    status: pi.status ?? "",
    snapshot: (pi.snapshot ?? null) as { bankKey?: unknown } | null,
  };
}

/** "01 TO 07" — the marks & nos an export invoice prints for N crates. */
export function marksForCrates(count: number): string | null {
  if (!count || count < 1) return null;
  return count === 1 ? "01" : `01 TO ${String(count).padStart(2, "0")}`;
}

/** kg → the weight string the export sheets print. */
export function weightText(kg: unknown): string | null {
  const n = kg === null || kg === undefined ? NaN : Number(kg);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} KGS` : null;
}

/** Prisma's unique-violation code, so a duplicate invoice number is a 409. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * design → item code, from commercial_design_code (answer 20). The whole
 * master is read: it is one small table, and a line-by-line lookup would be a
 * query per printed line on every draft.
 */
export async function designCodesLookup(): Promise<DesignCodeLookup> {
  const rows = await db.commercialDesignCode.findMany({ select: { design: true, code: true } });
  return designCodeLookup(rows as Array<{ design: string; code: string | null }>);
}

/** What the two invoice dropdowns offer (answers 21, 23), plus the tax switch
 *  the screen needs to know whether a missing state code is worth a warning. */
export interface InvoiceChoices {
  gstins: GstinChoice[];
  banks: Array<{ key: "export" | "domestic"; name: string; label: string }>;
  alwaysIgst: boolean;
}

export function choicesFor(settings: CommercialSettings): InvoiceChoices {
  return {
    gstins: gstinChoices(settings.company),
    banks: BANK_KEYS.map((key) => ({
      key,
      name: settings.banks[key].name,
      label: `${settings.banks[key].name} — ${key === "domestic" ? "domestic" : "export"} account`,
    })),
    alwaysIgst: settings.tax.alwaysIgst,
  };
}
