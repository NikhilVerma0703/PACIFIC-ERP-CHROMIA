/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { getSp } from "./spLookup";

/**
 * Build the CC list for any outgoing email:
 *   - Global CC from SalesConfig
 *   - SP's own email
 *   - SP's RM (if assigned)
 *   - Customer-specific CC emails (if clientId is provided)
 */
export async function getCCList(spId: string, clientId?: string | null): Promise<string[]> {
  const db = prisma as any;
  const [sp, rmAssignment, config, client] = await Promise.all([
    db.user.findUnique({ where: { id: spId }, select: { email: true } }),
    // managerId carries no Prisma relation (no hard FK) — `include: { manager }`
    // threw PrismaClientValidationError, so the .catch silently dropped the RM
    // from every CC list. Resolve the manager's email via spLookup instead.
    db.salesManagerAssignment.findFirst({
      where: { spId, isActive: true },
      select: { managerId: true },
    }).catch(() => null),
    db.salesConfig.findUnique({ where: { id: 'global' } }).catch(() => null),
    clientId
      ? db.salesClient.findUnique({ where: { id: clientId }, select: { ccEmails: true } }).catch(() => null)
      : null,
  ]);

  const rmEmail = rmAssignment?.managerId
    ? (await getSp(rmAssignment.managerId))?.email ?? null
    : null;

  const ccs: string[] = [...(config?.ccEmails ?? ['customs@pacific-surfaces.com', 'acreceivables@pacific-surfaces.com'])];
  if (sp?.email) ccs.push(sp.email);
  if (rmEmail) ccs.push(rmEmail);
  // Per-customer CC emails
  if (client?.ccEmails?.length) ccs.push(...client.ccEmails);

  return [...new Set(ccs.filter(Boolean))];
}
