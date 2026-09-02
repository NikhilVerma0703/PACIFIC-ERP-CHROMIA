/**
 * Batch-number matching, in one place.
 *
 * Pure and alias-free so `node --test` can reach it — the same split
 * productionDate.ts and slabSearch.ts use.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * The register writes the same batch a dozen ways: "D1372", "d1372", "D-1372",
 * "d-1372", and often just "1372". Those are ONE batch and a search for any of
 * them must return all of them. But a prefix that carries meaning must not be
 * thrown away with the noise: "A-1248" and "D-1248" are two different batches
 * and may never be merged.
 *
 * So matching folds away exactly two things — case, and non-alphanumeric
 * formatting (hyphens, spaces, dots) — and nothing else. A leading letter
 * prefix is kept and compared. The one deliberate exception is a bare number:
 * "1372" is taken to be the same batch as "D1372", because the register drops
 * the series letter as often as it writes it. A bare number therefore matches a
 * prefixed one with the same number — but two DIFFERENT prefixes never match
 * each other, so "1248" finding both "A-1248" and "D-1248" never makes those
 * two the same as one another.
 *
 *   canon("D-1372") === canon("d1372") === "D1372"
 *   batchNosMatch("1372", "D1372")   → true   (bare = prefixed, same number)
 *   batchNosMatch("D-1372", "d1372") → true   (case + hyphen only)
 *   batchNosMatch("A-1248", "D-1248")→ false  (different meaningful prefixes)
 */

/** Fold case and formatting away: uppercase, then drop everything that is not a
 *  letter or digit. This is the comparison key, not a value to store. */
export function canonBatchNo(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The leading letters of a canonical batch — its series prefix, or "" for a
 *  bare number. */
function prefixOf(canon: string): string {
  const m = /^[A-Z]+/.exec(canon);
  return m ? m[0] : "";
}

/** Everything after the leading letters — the number (and any trailing part). */
function stemOf(canon: string): string {
  return canon.slice(prefixOf(canon).length);
}

/**
 * Do two batch numbers name the same batch?
 *
 * True when their canonical forms are identical (case/formatting only), OR when
 * their numbers are identical and at least one of them carries no prefix (the
 * bare-number-equals-prefixed rule). Two different prefixes never match.
 */
export function batchNosMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonBatchNo(a);
  const cb = canonBatchNo(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;

  const stemA = stemOf(ca);
  const stemB = stemOf(cb);
  if (!stemA || stemA !== stemB) return false;

  // Same number, but only the same batch if one side is the bare number. Two
  // real prefixes that differ (A vs D) are two batches — never merge them.
  return prefixOf(ca) === "" || prefixOf(cb) === "";
}

/**
 * Given a search string and the batch recipes on file, the ids whose batch
 * number matches it — the bridge from a typed batch number to a Prisma
 * `batchRecipeId: { in: [...] }` filter.
 *
 * Returns [] for a search that matches nothing (a real filter that finds no
 * rows), and [] for a blank search only if the caller passes one — callers
 * should treat a blank search as "no batch filter" before calling.
 */
export function matchingBatchRecipeIds(
  query: string | null | undefined,
  recipes: readonly { id: string; batchNo: string | null }[],
): string[] {
  const q = (query ?? "").trim();
  if (!q) return [];
  return recipes.filter((r) => batchNosMatch(q, r.batchNo)).map((r) => r.id);
}
