/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";

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
    db.salesManagerAssignment.findFirst({
      where: { spId, isActive: true },
      include: { manager: { select: { email: true } } },
    }).catch(() => null),
    db.salesConfig.findUnique({ where: { id: 'global' } }).catch(() => null),
    clientId
      ? db.salesClient.findUnique({ where: { id: clientId }, select: { ccEmails: true } }).catch(() => null)
      : null,
  ]);

  const ccs: string[] = [...(config?.ccEmails ?? ['customs@pacific-surfaces.com', 'acreceivables@pacific-surfaces.com'])];
  if (sp?.email) ccs.push(sp.email);
  if (rmAssignment?.manager?.email) ccs.push(rmAssignment.manager.email);
  // Per-customer CC emails
  if (client?.ccEmails?.length) ccs.push(...client.ccEmails);

  return [...new Set(ccs.filter(Boolean))];
}
