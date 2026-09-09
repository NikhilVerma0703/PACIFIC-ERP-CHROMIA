/**
 * The S.No. shown for a slab — computed, not trusted.
 *
 * Pure and alias-free so `node --test` can reach it, the same split
 * productionDate.ts / slabSearch.ts use.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * S.No. is the slab's position in its batch — 1, 2, 3, … up to the batch's slab
 * count. It was read straight off the stored `serialNumber`, the number the
 * operator typed on the tablet (or the old paper register's own column, on an
 * import). That column is not reliable: on old runs the numbers were mistyped —
 * a batch would go 1…36 and then start again at 24 — so the sheet showed
 * duplicates and appeared to stop short of the real slab count (a 92-slab batch
 * ending at S.No. 36). The Batch Numbers were mistyped alongside them, so the
 * S.No. cannot be repaired from the S.No.
 *
 * So S.No. is no longer stored-and-trusted; it is DERIVED from the one ordering
 * in the register that is authoritative: the physical SLAB NUMBER. Slabs are
 * numbered by the plant as they are produced (…148774, 148775, 148776…), so
 * within a batch, ascending slab number IS the production sequence. Rank the
 * batch's slabs by it and the S.No. is 1…N by construction — correct for the old
 * mistyped runs and for every run from here on, with no column to keep in step.
 *
 * `serialNumber` is left in the database untouched; it is simply no longer what
 * anyone is shown. Nothing here reads or writes it.
 */

/** A slab reduced to what the ordering needs. `slabNumber` is the plant's
 *  physical number (usually all digits); `createdAtMs`/`id` only ever break a
 *  tie, so the order is deterministic when two slabs share a number or a slab
 *  number carries no digits. */
export interface SeqSlab {
  slabNumber: string | null | undefined;
  /** createdAt as epoch ms — entry order, the tiebreak when slab numbers tie. */
  createdAtMs?: number | null;
  /** A stable final tiebreak so equal rows never reorder between runs. */
  id?: string | null;
}

/**
 * The numeric value of a slab number's leading digits, for ordering.
 *
 * The register is almost all plain numbers, and those must sort as numbers, not
 * as text — "9" before "10", "148775" before "148776" — so a bare string sort
 * (where "10" precedes "9") is wrong. Leading digits are read as an integer;
 * leading zeros are part of the value, not the ordering ("00042" → 42). A number
 * that does not start with a digit (the odd "A-12", or a blank) has no numeric
 * position, so it sorts AFTER every real number and is ordered among its kind by
 * the createdAt/id tiebreaks — it never jumps to the front of a batch.
 */
export function slabNumberValue(slabNumber: string | null | undefined): number {
  const m = /^\s*(\d+)/.exec((slabNumber ?? "").trim());
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Order two slabs by the authoritative sequence: physical slab number ascending,
 * then entry order, then id. Total and deterministic.
 */
export function compareSlabOrder(a: SeqSlab, b: SeqSlab): number {
  const va = slabNumberValue(a.slabNumber);
  const vb = slabNumberValue(b.slabNumber);
  if (va !== vb) return va - vb;
  // Same numeric value (e.g. two non-numeric, or a genuine duplicate) — fall to
  // entry order, then the slab-number text, then id, so the result is stable.
  const ca = a.createdAtMs ?? 0;
  const cb = b.createdAtMs ?? 0;
  if (ca !== cb) return ca - cb;
  const sa = (a.slabNumber ?? "").trim();
  const sb = (b.slabNumber ?? "").trim();
  if (sa !== sb) return sa < sb ? -1 : 1;
  return (a.id ?? "").localeCompare(b.id ?? "");
}

/**
 * A batch's slabs in authoritative order, each paired with its S.No. (1…N).
 * The input is one batch's slabs; the caller groups by batch first.
 */
export function sequencedByBatch<T extends SeqSlab>(slabs: readonly T[]): { slab: T; seqNo: number }[] {
  return [...slabs].sort(compareSlabOrder).map((slab, i) => ({ slab, seqNo: i + 1 }));
}

/**
 * S.No. for every slab across several batches, keyed by id.
 *
 * Slabs are grouped by `batchKey` (the batch they belong to — normally the
 * batch-recipe id), each group is ranked on its own, and the result maps a
 * slab's id to its 1…N position in its batch. A caller that only has part of a
 * batch loaded would get a partial ranking, so this is used where a WHOLE batch
 * is in hand (an export of one batch, a batch-filtered list); a single slab's
 * S.No. is found the same way, over its batch's slabs.
 */
export function sequenceNumbersById<T extends SeqSlab & { id: string }>(
  slabs: readonly T[],
  batchKey: (slab: T) => string,
): Map<string, number> {
  const groups = new Map<string, T[]>();
  for (const s of slabs) {
    const k = batchKey(s);
    let g = groups.get(k);
    if (!g) { g = []; groups.set(k, g); }
    g.push(s);
  }
  const out = new Map<string, number>();
  for (const g of groups.values()) {
    for (const { slab, seqNo } of sequencedByBatch(g)) out.set(slab.id, seqNo);
  }
  return out;
}
