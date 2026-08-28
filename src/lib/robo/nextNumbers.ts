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
 *
 * ── AND WHY IT CHANGED AGAIN ─────────────────────────────────────────────
 * "The latest record" was then read two different ways, and one of them was
 * wrong. The slab number counted from the newest ROW; the S.No. counted from
 * the HIGHEST NUMBER anywhere in the table — `max(serial_number) + 1`. Those
 * two agree only in a register that has never been imported into. This one has
 * been: the historical rows carry the old paper register's own S.No. column,
 * running into the hundreds, so a line whose last saved slab was S.No. 19 was
 * offered 241 — a number with nothing behind it that the operator could check.
 *
 * A maximum is not a position in a register. Both numbers now come from the
 * same place — the row that was saved last — so what the form offers is the
 * pair on the last slab plus one each, which is exactly what is written on the
 * sheet in front of the operator.
 */

/**
 * The S.No. actually recorded on the newest row, out of recent rows in
 * newest-first order. Null when nothing is numbered yet.
 *
 * It walks rather than reading `recent[0]` because the column is nullable, and
 * one row saved without an S.No. must not restart the register at 1. The walk
 * is per-field on purpose: a row can carry a slab number and no S.No., or the
 * other way round, and each number should still come from the newest row that
 * actually has one.
 */
export function latestSerialNumber(recent: readonly (number | null | undefined)[]): number | null {
  for (const n of recent) {
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

/**
 * One past the last S.No. saved. An empty register starts at 1.
 *
 * Deliberately not max + 1, and deliberately not skipping numbers that already
 * exist: `serial_number` carries no unique constraint, an import fills it from
 * whatever the old sheet said, and the operator can type over the suggestion in
 * any case. This is the next line in the book, not an allocated identifier.
 */
export function nextSerialNumber(latestSerial: number | null | undefined): number {
  const last = typeof latestSerial === "number" && Number.isFinite(latestSerial) ? latestSerial : 0;
  return (last > 0 ? Math.trunc(last) : 0) + 1;
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
 * exists would hand the operator a 409 they did not cause.
 *
 * "" means no suggestion. Two things produce it: nothing to count from, which
 * is the form's "leave it to the operator" signal and never invents a first
 * number; and `limit` consecutive candidates all being taken, which is the
 * caller's signal to look further ahead if it wants to — the route does, one
 * `limit`-sized probe at a time, because a register that has been imported into
 * can hold a solid block of numbers above the last slab the line actually ran.
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
