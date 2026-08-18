"use server";

import { prisma } from "@/lib/prisma";
import { canUseEntryModel } from "@/lib/stationAccess";
import { normalizeBatch } from "@/lib/normalizeBatch";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = prisma as any;

export interface BatchCarry {
  /** Design recorded on that batch's most recent MIS row. */
  design: string | null;
  /** That row's ending slab number + 1 — where this hour starts. */
  nextStartSlab: number | null;
}

/**
 * The design and next starting slab for a batch, taken from its LAST MIS entry.
 *
 * Hours of one batch run back to back, so the incharge was re-typing the design
 * every hour and working out the next starting slab by hand from the previous
 * row. Both are already known the moment the batch is entered.
 *
 * Matched on `batchKey`, the indexed pre-normalized column every batch join in
 * the ERP uses (see recordSmart.ts, which declares the same carry for the
 * generic MIS form). The raw `batch` text is free-form — "1375", "C1375",
 * "1,375" — so filtering on it would both miss rows and scan the table.
 */
export async function lastMisEntryForBatch(batch: string, before?: string): Promise<BatchCarry | null> {
  if (!(await canUseEntryModel("Mis"))) return null;
  const key = normalizeBatch(batch);
  if (!key) return null;

  try {
    const rows: any[] = await db.mis.findMany({
      where: { batchKey: key },
      select: { design: true, endingSlabNumber: true, dateAndTime: true },
      orderBy: [{ dateAndTime: { sort: "desc", nulls: "last" } }, { importedAt: "desc" }],
      take: 50,
    });
    if (!rows.length) return null;

    // Design belongs to the batch, so any entry of it will do — take the newest
    // that has one. (Hours are regularly logged with a design but no ending slab
    // number, so the two fields cannot come from one row.)
    const design = rows.map((r) => (r.design ?? "").trim()).find(Boolean) ?? null;

    // The slab count must come from an hour that ran BEFORE the one being
    // logged. Back-filling a missed hour would otherwise continue from an hour
    // that ran later and silently record an impossible range.
    const cut = before ? Date.parse(before) : NaN;
    const pool = Number.isFinite(cut)
      ? rows.filter((r) => r.dateAndTime && new Date(r.dateAndTime).getTime() < cut)
      : rows;
    const end = pool
      .map((r) => Number(r.endingSlabNumber))
      .find((n) => Number.isFinite(n) && n > 0);
    return { design, nextStartSlab: end == null ? null : end + 1 };
  } catch {
    return null; // lookup is a convenience — never block the entry form
  }
}
