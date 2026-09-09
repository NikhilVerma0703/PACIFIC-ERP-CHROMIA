// Shared by the /api/office/commercial/challans/** handlers: the include the
// list and the detail use, the loader, and the body → row parser (which is
// where "Verbal" and the two default texts come from). Not a route — Next
// ignores a colocated file that is not route.ts.
import { prisma } from "@/lib/prisma";
import { fail, str, dateOnly } from "@/lib/commercial/http";
import {
  normaliseChallanItems, challanTotals, challanWords,
  CHALLAN_DEFAULT_PO_REF, CHALLAN_DEFAULT_COMMODITY,
} from "@/lib/commercial/challan-rules";
import type { CommercialSettings } from "@/lib/commercial/settings-defaults";
import type { ChallanItem } from "@/lib/commercial/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** The challan screens show which order (if any) and which client it moves to. */
export const CHALLAN_INCLUDE = {
  order: { select: { id: true, number: true, kind: true } },
  consigneeClient: { select: { id: true, name: true } },
} as const;

export async function challanIdOf(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!id) fail(400, "Missing challan id");
  return id;
}

export async function loadChallan(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialDeliveryChallan.findUnique({ where: { id }, include: CHALLAN_INCLUDE });
  if (!row) fail(404, "Challan not found");
  return row;
}

/** A stored items column → ChallanItem[], whatever shape it was written in. */
export function itemsOf(row: Record<string, unknown>): ChallanItem[] {
  return normaliseChallanItems(row.items);
}

const has = (b: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(b, k);

/**
 * The consignee block a body names, or the client master's when only a client
 * was picked. A challan can go to a free-text consignee (a sample to a
 * showroom that is not a customer yet), so the name is what matters.
 */
export async function consigneeFromBody(body: Record<string, unknown>): Promise<{ consigneeClientId: string | null; consigneeName: string; consigneeAddress: string | null; consigneeGstin: string | null }> {
  const clientId = str(body.consigneeClientId);
  let name = str(body.consigneeName);
  let address = str(body.consigneeAddress);
  let gstin = str(body.consigneeGstin);
  if (clientId) {
    const client = await db.salesClient.findUnique({ where: { id: clientId }, include: { commercialExt: true } });
    if (!client) fail(400, "Consignee client not found");
    name = name ?? (client.name as string);
    address = address ?? ([client.address, client.city, client.country].filter(Boolean).join(", ") || null);
    gstin = gstin ?? ((client.commercialExt?.gstin as string | null) ?? null);
  }
  if (!name) fail(400, "Name the consignee");
  return { consigneeClientId: clientId, consigneeName: name, consigneeAddress: address, consigneeGstin: gstin };
}

/** Items, their settled amounts, the total and the total in words. */
export function itemsPatch(raw: unknown): { items: ChallanItem[]; totalAmount: number; amountInWords: string } {
  const totals = challanTotals(normaliseChallanItems(raw));
  return { items: totals.items, totalAmount: totals.totalAmount, amountInWords: challanWords(totals.totalAmount) };
}

/** The columns a PATCH body names, parsed. Only keys the body carries appear. */
export function challanPatchFromBody(body: Record<string, unknown>, settings: CommercialSettings): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (has(body, "challanDate")) {
    const raw = str(body.challanDate);
    const d = dateOnly(raw);
    if (raw && !d) fail(400, "Challan date must be YYYY-MM-DD");
    if (d) data.challanDate = d;
  }
  if (has(body, "orderId")) data.orderId = str(body.orderId);
  if (has(body, "poRef")) data.poRef = str(body.poRef) ?? CHALLAN_DEFAULT_PO_REF;
  if (has(body, "commodity")) data.commodity = str(body.commodity) ?? CHALLAN_DEFAULT_COMMODITY;
  if (has(body, "purpose")) data.purpose = str(body.purpose) ?? settings.texts.challanNote;
  if (has(body, "lorryNo")) data.lorryNo = str(body.lorryNo);
  if (has(body, "notes")) data.notes = str(body.notes);
  if (has(body, "items")) Object.assign(data, itemsPatch(body.items));
  return data;
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
