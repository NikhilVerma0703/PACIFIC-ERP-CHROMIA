/**
 * User lookups for the International Sales models.
 *
 * The sales tables reference users through plain string columns (sp_id,
 * manager_id, created_by_id, checked_by_id, user_id) with NO Prisma relation
 * and no DB foreign key — the core User model is deliberately untouched (see
 * prisma/schema.prisma comments). The fork this module was ported from had a
 * real `sp`/`manager`/`createdBy` relation, so ported code that does
 * `include: { sp: ... }` throws PrismaClientValidationError ("Unknown field
 * `sp`") at runtime. Every reader must resolve users through these helpers
 * instead.
 *
 * Graceful degradation: an id with no matching users row (e.g. imported
 * legacy records that store the salesperson's NAME in sp_id) resolves to
 * { id, name: id, email: null } so UIs still render the stored text.
 */
import { prisma } from "@/lib/prisma";

export type SpInfo = { id: string; name: string | null; email: string | null };

/** Batch-resolve user ids → { id, name, email }. Never throws. */
export async function getSpMap(
  ids: Array<string | null | undefined>
): Promise<Map<string, SpInfo>> {
  const unique = [
    ...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0)),
  ];
  if (unique.length === 0) return new Map();

  let users: SpInfo[] = [];
  try {
    users = await prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, email: true },
    });
  } catch {
    users = [];
  }
  const byId = new Map(users.map((u) => [u.id, u]));
  return new Map(
    unique.map((id) => [id, byId.get(id) ?? { id, name: id, email: null }])
  );
}

/** Resolve one user id; null in → null out. Never throws. */
export async function getSp(id: string | null | undefined): Promise<SpInfo | null> {
  if (!id) return null;
  return (await getSpMap([id])).get(id) ?? null;
}
