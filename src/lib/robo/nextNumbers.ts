/**
 * What the entry form should offer as the next S.No. and slab number.
 *
 * Pure and alias-free so `node --test` can reach it, the same split
 * setupMasters.ts and slabSearch.ts use. The database half — which rows to read
 * — lives in the route at src/app/api/robo/production/next-number.
 *
 * WHY THIS EXISTS. The form used to work both numbers out in the browser from
 * `shift.productionRecords`, i.e. from the ACTIVE SHIFT ONLY, and a shift row is
 * created silently once per day. So at the start of every day the register was
 * at 35 and the form offered 1, and the slab number went blank because there
 * was no previous record in that shift to add one to. Neither number is a
 * per-day count — the S.No. is the register's running row number and the slab
 * number is the plant's — so both are now computed from the latest record in
 * the whole table, on the server, where the answer cannot depend on which
 * tablet is asking or how long it has had the page open.
 */

/** Highest S.No. seen anywhere, or null when nothing is numbered yet. */
export function nextSerialNumber(maxSerial: number | null | undefined): number {
  const max = typeof maxSerial === "number" && Number.isFinite(maxSerial) ? maxSerial : 0;
  return (max > 0 ? max : 0) + 1;
}

/** Is this slab number one we can count from? */
export function isNumericSlab(slabNumber: string | null | undefined): boolean {
  return typeof slabNumber === "string" && /^\d+$/.test(slabNumber.trim());
}

/**
 * The most recent slab number we can count from, out of the recent records in
 * newest-first order. Non-numeric numbers are skipped rather than rejected:
 * the register has carried the odd `140748-A` and one of those in the newest
 * row must not stop the suggestion for every slab after it.
 */
export function latestNumericSlab(recent: readonly (string | null | undefined)[]): string | null {
  for (const s of recent) {
    if (isNumericSlab(s)) return (s as string).trim();
  }
  return null;
}

/**
 * The next slab number, skipping any that are already taken.
 *
 * `taken` is the set of numbers the caller found at or above the candidate —
 * the duplicate check on save is global, so suggesting a number that already
 * exists would hand the operator a 409 they did not cause. Returns "" when
 * there is nothing to count from, which is the form's "leave it to the
 * operator" signal; it never invents a first number.
 *
 * The candidate keeps the width of what it counts from, so 09999 -> 10000 and
 * 00042 -> 00043: leading zeros in this register are part of the number, not
 * formatting.
 */
export function nextSlabNumber(
  latest: string | null,
  taken: ReadonlySet<string> = new Set(),
  limit = 25,
): string {
  if (!isNumericSlab(latest)) return "";
  const base = (latest as string).trim();
  const width = base.length;
  let n = BigInt(base) + 1n;
  for (let i = 0; i < limit; i++) {
    const candidate = String(n).padStart(width, "0");
    if (!taken.has(candidate)) return candidate;
    n += 1n;
  }
  return "";
}
