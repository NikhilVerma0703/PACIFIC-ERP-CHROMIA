/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * mailSubjects.ts
 * Resolves the subject line for each email type.
 * Custom subjects are stored in sales_config.mail_subjects (JSONB).
 * Supports simple {variable} interpolation.
 */
import { prisma } from "@/lib/prisma";

export { MAIL_SUBJECT_KEYS, DEFAULT_SUBJECTS, MAIL_SUBJECT_LABELS } from "./mailSubjects.defaults";
export type { MailSubjectKey } from "./mailSubjects.defaults";
import { MAIL_SUBJECT_KEYS, DEFAULT_SUBJECTS, type MailSubjectKey } from "./mailSubjects.defaults";

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
