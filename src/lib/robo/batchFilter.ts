/**
 * The server half of the Batch Number filter: turn what the operator typed into
 * the set of setup ids it names.
 *
 * Kept apart from the pure batchNo.ts so that module stays reachable by
 * `node --test` without a database, while this — which reads the setups —
 * imports prisma and is reached only through the routes.
 *
 * Returns `null` for a blank query (no batch filter) and an array otherwise,
 * empty when nothing matched (a real filter that finds no rows). The caller ANDs
 * it into its own query in whatever shape fits:
 *
 *   production record → `batchRecipeId: { in }`
 *   delay log         → `productionRecord: { batchRecipeId: { in } }`
 *   the setup itself  → `id: { in }`
 *
 * It reads the whole setup table (two short columns) and matches in memory
 * because the rule — fold case and hyphens, keep a meaningful prefix, treat a
 * bare number as the series-less form — is not something a SQL `contains` can
 * express. The setups number in the hundreds; this is a tiny projection, not a
 * scan anyone will feel.
 */
import { prisma } from "@/lib/prisma";
import { matchingBatchRecipeIds } from "./batchNo";

export async function resolveBatchRecipeIds(
  query: string | null | undefined,
): Promise<string[] | null> {
  const q = (query ?? "").trim();
  if (!q) return null;
  const recipes = await prisma.roboBatchRecipe.findMany({
    select: { id: true, batchNo: true },
  });
  return matchingBatchRecipeIds(q, recipes);
}
