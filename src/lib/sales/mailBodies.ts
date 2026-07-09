/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * mailBodies.ts
 * Full email body templates stored in sales_config.mail_bodies (JSONB).
 * Supports {variable} interpolation.
 * {details_table} is replaced with auto-generated HTML tables (injected by calling code).
 */
import { prisma } from "@/lib/prisma";

export const MAIL_BODY_KEYS = [
  "pi_body",
  "pi_followup_body",
  "bl_ready_body",
  "eta_reminder_body",
  "advance_overdue_body",
  "cad_reminder_body",
  "shipping_docs_body",
  "dispatch_body",
  "packing_list_body",
] as const;

export type MailBodyKey = typeof MAIL_BODY_KEYS[number];

export const MAIL_BODY_LABELS: Record<MailBodyKey, string> = {
  pi_body:              "PI Send Email",
  pi_followup_body:     "PI Follow-up (3-day reminder)",
  bl_ready_body:        "B/L Ready Email",
  eta_reminder_body:    "ETA Arrival Reminder (Daily)",
  advance_overdue_body: "Advance Payment Overdue",
  cad_reminder_body:    "CAD Payment Reminder (Port Arrival)",
  shipping_docs_body:   "Shipping Documents Email",
  dispatch_body:        "Dispatch / Stuffing Email",
  packing_list_body:    "Packing List Approval Email",
};

/** Variables available per mail type (for UI hint display) */
export const MAIL_BODY_VARS: Record<MailBodyKey, string[]> = {
  pi_body:              ["{clientName}", "{piNumber}", "{currency}", "{totalAmount}", "{paymentTerms}", "{deliveryTerms}", "{validityDays}", "{portOfLoading}", "{spName}", "{details_table}"],
  pi_followup_body:     ["{clientName}", "{piNumber}", "{currency}", "{totalAmount}", "{piDate}", "{spName}"],
  bl_ready_body:        ["{clientName}", "{orderNumber}", "{blNo}", "{sbNo}", "{containerNo}", "{vesselName}", "{portOfLoading}", "{portOfDischarge}", "{etd}", "{eta}", "{spName}", "{details_table}"],
  eta_reminder_body:    ["{clientName}", "{spName}", "{details_table}"],
  advance_overdue_body: ["{clientName}", "{orderNumber}", "{currency}", "{totalAmount}", "{orderDate}", "{paymentTerms}", "{spName}"],
  cad_reminder_body:    ["{clientName}", "{orderNumber}", "{currency}", "{totalAmount}", "{arrivalDate}", "{freeDaysExpiry}", "{spName}"],
  shipping_docs_body:   ["{clientName}", "{invoiceNo}", "{blNo}", "{paymentDueDate}", "{spName}", "{details_table}"],
  dispatch_body:        ["{clientName}", "{invoiceNo}", "{spName}", "{details_table}"],
  packing_list_body:    ["{clientName}", "{invoiceNo}", "{spName}"],
};

const S = `<p style="color:#334155;margin:0 0 16px">`;
const E = `</p>`;
const REGARDS = (spName = "Pacific Group") =>
  `<p style="color:#334155;margin:0">Regards,<br/><strong>${spName}</strong></p>`;

export const DEFAULT_BODIES: Record<MailBodyKey, string> = {
  pi_body: `${S}Dear {clientName},${E}
${S}Please find below our Proforma Invoice <strong>{piNumber}</strong> for your kind consideration.${E}
{details_table}
${S}A PDF copy of the Proforma Invoice is attached for your records. Please confirm your acceptance by replying to this email.${E}
${REGARDS("{spName}")}`,

  pi_followup_body: `${S}Dear {clientName},${E}
${S}This is a gentle follow-up regarding our Proforma Invoice <strong>{piNumber}</strong> dated {piDate} for <strong>{currency} {totalAmount}</strong>, which is awaiting your confirmation.${E}
${S}Kindly revert at your earliest convenience. Please feel free to reach out if you have any questions or require any modifications.${E}
${REGARDS("{spName}")}`,

  bl_ready_body: `${S}Dear {clientName},${E}
${S}We are pleased to inform you that the Bill of Lading for your order <strong>{orderNumber}</strong> is now ready. Please find the shipping details below:${E}
{details_table}
${S}Shipping documents have been attached for your reference. Please arrange for customs clearance accordingly.${E}
${REGARDS("{spName}")}`,

  eta_reminder_body: `${S}Dear {clientName},${E}
${S}This is a reminder that the following shipments are arriving at their destination port within the next 7 days. Please make the necessary arrangements for customs clearance and port pickup.${E}
{details_table}
${S}Please ensure all payment obligations are fulfilled before the vessel arrives to avoid demurrage charges.${E}
${REGARDS("{spName}")}`,

  advance_overdue_body: `${S}Dear {clientName},${E}
${S}This is to bring to your attention that the advance payment for order <strong>{orderNumber}</strong> is now overdue.${E}
{details_table}
<p style="margin:0 0 16px;color:#c0392b;font-weight:bold">⚠ Please arrange the advance payment at the earliest to avoid any delay in production and shipment.</p>
${REGARDS("{spName}")}`,

  cad_reminder_body: `${S}Dear {clientName},${E}
${S}Your shipment for order <strong>{orderNumber}</strong> has arrived at the port. As per the agreed payment terms, the CAD (Cash Against Documents) payment is now due.${E}
{details_table}
<p style="margin:0 0 16px;color:#c0392b;font-weight:bold">⚠ Please complete the CAD payment immediately to avoid storage/demurrage charges and ensure timely release of your goods.</p>
${REGARDS("{spName}")}`,

  shipping_docs_body: `${S}Dear {clientName},${E}
${S}Please find attached the shipping documents for Invoice <strong>{invoiceNo}</strong>. Kindly arrange for customs clearance at your earliest.${E}
{details_table}
${REGARDS("{spName}")}`,

  dispatch_body: `${S}Dear {clientName},${E}
${S}We are pleased to inform you that your goods against Invoice <strong>{invoiceNo}</strong> have been dispatched. Please find the dispatch details below.${E}
{details_table}
${REGARDS("{spName}")}`,

  packing_list_body: `${S}Dear {clientName},${E}
${S}Please find attached the Packing List for Invoice <strong>{invoiceNo}</strong> for your approval.${E}
${S}Kindly review and revert with your confirmation at the earliest so we may proceed with the shipment.${E}
${REGARDS("{spName}")}`,
};

/** Fetch all custom bodies from DB. */
export async function getMailBodies(): Promise<Partial<Record<MailBodyKey, string>>> {
  const db = prisma as any;
  try {
    const rows: any[] = await db.$queryRaw`
      SELECT mail_bodies FROM sales_config WHERE id = 'global'
    `;
    return (rows?.[0]?.mail_bodies as Partial<Record<MailBodyKey, string>>) ?? {};
  } catch {
    return {};
  }
}

/** Resolve a body template, substituting {variables}. Returns null if no custom body stored. */
export async function resolveBody(
  key: MailBodyKey,
  vars: Record<string, string | undefined | null> = {},
  detailsTable = "",
): Promise<string | null> {
  const custom = await getMailBodies();
  const tpl = custom[key] ?? null;
  if (!tpl) return null;
  return tpl
    .replace(/\{details_table\}/g, detailsTable)
    .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Resolve a body using the default template (always returns a value). */
export function resolveDefaultBody(
  key: MailBodyKey,
  vars: Record<string, string | undefined | null> = {},
  detailsTable = "",
): string {
  const tpl = DEFAULT_BODIES[key];
  return tpl
    .replace(/\{details_table\}/g, detailsTable)
    .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Save custom bodies (merges with existing). */
export async function saveMailBodies(
  bodies: Partial<Record<MailBodyKey, string>>,
): Promise<void> {
  const db = prisma as any;
  const existing = await getMailBodies();
  const merged = { ...existing, ...bodies };
  await db.$executeRaw`
    UPDATE sales_config
    SET mail_bodies = ${JSON.stringify(merged)}::jsonb
    WHERE id = 'global'
  `;
}
