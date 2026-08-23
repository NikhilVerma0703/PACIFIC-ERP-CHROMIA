/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * mailBodies.ts
 * Full email body templates stored in sales_config.mail_bodies (JSONB).
 * Supports {variable} interpolation.
 * {details_table} is replaced with auto-generated HTML tables (injected by calling code).
 */
import { prisma } from "@/lib/prisma";

export {
  MAIL_BODY_KEYS, MAIL_BODY_LABELS, MAIL_BODY_VARS, DEFAULT_BODIES,
} from "./mailBodies.defaults";
export type { MailBodyKey } from "./mailBodies.defaults";
import { MAIL_BODY_KEYS, DEFAULT_BODIES, type MailBodyKey } from "./mailBodies.defaults";

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
