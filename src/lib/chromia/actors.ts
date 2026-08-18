/**
 * Who did it.
 *
 * The standalone module owned its own `user` table and joined to it, so a
 * screen could write `run.importedBy.name`. Inside the ERP the actor is an ERP
 * user and the chromia_* tables hold a plain `*ById` string with no foreign
 * key — deliberately, so a slab's history survives a user row being archived.
 * The join therefore happens here instead: ids in, display names out, one
 * query per screen.
 */
import { prisma } from "@/lib/prisma";

/** Display names for the ERP user ids stored on chromia_* rows. */
export async function actorNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  });

  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}
