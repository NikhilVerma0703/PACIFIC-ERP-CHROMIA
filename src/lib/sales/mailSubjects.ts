/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * mailSubjects.ts
 * Resolves the subject line for each email type.
 * Custom subjects are stored in sales_config.mail_subjects (JSONB).
 * Supports simple {variable} interpolation.
 */
import { prisma } from "@/lib/prisma";

export const MAIL_SUBJECT_KEYS = [
  "pi_subject",
  "dispatch_subject",
  "shipping_docs_subject",
  "packing_list_subject",
  "bl_ready_subject",
  "payment_reminder_subject",
] as const;

export type MailSubjectKey = typeof MAIL_SUBJECT_KEYS[number];

export const DEFAULT_SUBJECTS: Record<MailSubjectKey, string> = {
  pi_subject:               "Proforma Invoice {piNumber} | Pacific Engineered Surfaces Pvt. Ltd.",
  dispatch_subject:         "Dispatch Details — Invoice {invoiceNo} | Pacific Engineered Surfaces",
  shipping_docs_subject:    "Shipping Documents — Invoice {invoiceNo} | Pacific Engineered Surfaces",
  packing_list_subject:     "Packing List for Approval — {invoiceNo} | Pacific Granites India Pvt. Ltd.",
  bl_ready_subject:         "B/L Ready — {invoiceNo} | Pacific Engineered Surfaces",
  payment_reminder_subject: "Payment Reminder — Invoice {invoiceNo} | Pacific Engineered Surfaces",
};

const LABEL: Record<MailSubjectKey, string> = {
  pi_subject:               "PI Send Email",
  dispatch_subject:         "Dispatch / Stuffing Email",
  shipping_docs_subject:    "Shipping Documents Email",
  packing_list_subject:     "Packing List Approval Email (PGI)",
  bl_ready_subject:         "B/L Ready Email",
  payment_reminder_subject: "Payment Reminder Email",
};

export { LABEL as MAIL_SUBJECT_LABELS };

/** Fetch all custom subjects from DB (returns {} if column missing or row absent). */
export async function getMailSubjects(): Promise<Partial<Record<MailSubjectKey, string>>> {
  const db = prisma as any;
  try {
    const rows: any[] = await db.$queryRaw`
      SELECT mail_subjects FROM sales_config WHERE id = 'global'
    `;
    return (rows?.[0]?.mail_subjects as Partial<Record<MailSubjectKey, string>>) ?? {};
  } catch {
    return {};
  }
}

/** Resolve a subject line, substituting {variables}. */
export async function resolveSubject(
  key: MailSubjectKey,
  vars: Record<string, string | undefined | null> = {},
): Promise<string> {
  const custom = await getMailSubjects();
  const tpl = custom[key] ?? DEFAULT_SUBJECTS[key];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Save all custom subjects (merges with existing). */
export async function saveMailSubjects(
  subjects: Partial<Record<MailSubjectKey, string>>,
): Promise<void> {
  const db = prisma as any;
  // Merge with existing
  const existing = await getMailSubjects();
  const merged = { ...existing, ...subjects };
  await db.$executeRaw`
    UPDATE sales_config
    SET mail_subjects = ${JSON.stringify(merged)}::jsonb
    WHERE id = 'global'
  `;
}
