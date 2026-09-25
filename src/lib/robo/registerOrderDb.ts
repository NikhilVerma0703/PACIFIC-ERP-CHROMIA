import type { Prisma } from "@prisma/client";
import { latestNumericSlab, latestSerialNumber } from "./nextNumbers.ts";

/**
 * "The last slab entered" — what the entry form's next S.No. and slab number
 * count on from.
 *
 * `*Db.ts` like setupMastersDb.ts: this one reads the database, so it sits
 * apart from the pure helpers in nextNumbers.ts. It only ever imports types
 * from Prisma, so `node --test` can still load it against a stand-in database.
 *
 * Two callers need the answer and must agree on it: the suggestion the entry
 * form opens on (/api/robo/production/next-number — on a fresh page, after a
 * refresh, after navigating back, after an edit or a delete) and the S.No. the
 * POST assigns when the form sends none. Last slab entered S.No. 13 / slab
 * 161223 → both say 14 / 161224, every time, however the page got there.
 *
 * ── THE LAST SLAB ENTERED IS THE NEWEST ONE SAVED ON THE RUNNING SHIFT ─────
 * Every new slab is saved onto the running (ACTIVE) shift, so the newest slab
 * there by save time IS the last one entered. Editing a slab never moves it —
 * a correction changes what a slab says, not when it was saved — and nothing
 * the page holds in memory takes part, so a refresh or a trip to another page
 * and back reads exactly the same rows.
 *
 * ── WHY THE ORDER CHANGED (2026-09-25) ─────────────────────────────────────
 * It was "the newest shift date, then the HIGHEST S.No. on it". But one shift
 * row carries every batch set up that day and a long batch runs on in its
 * shift for days, and the S.No. starts again at 1 for a new batch. So with a
 * 60-slab batch and then a new one at S.No. 13 on the same shift, the "last
 * row" was the old batch's S.No. 60: the form offered 61, and the slab number
 * counted on from THAT row — straight into numbers the new batch had already
 * used, so the free-number walk landed wherever the first gap happened to be.
 * The client counted on correctly after each save, which is why ordinary entry
 * looked right and a refresh, a return to the page or an edit (the moments the
 * form asks the server) did not.
 *
 * ── AND WHY NOT SIMPLY THE NEWEST SAVE ANYWHERE ───────────────────────────
 * The register importer (api/robo/imports) writes historical rows with
 * `createdAt` = the moment of the IMPORT, onto shifts of the register's own
 * dates, which it creates CLOSED. Read "newest save anywhere" and importing
 * last month's register would make its last row the one the line counts on
 * from. Asking the running shift first keeps imports out; when the running
 * shift has saved nothing yet (a new day's setup, no slab yet) the answer falls
 * back to the latest shift date, newest save first — imports land on their
 * past dates, below it.
 */
export const ENTRY_ORDER: Prisma.RoboProductionRecordOrderByWithRelationInput[] = [
  { shift: { date: "desc" } },
  { createdAt: "desc" },
  { id: "desc" },
];

/** Rows read back, newest first, when looking for the last S.No. and slab number. */
export const RECENT_ROWS = 50;

/** The one table this reads — `prisma` itself or a transaction's `tx`. */
export type EntryDb = Pick<Prisma.TransactionClient, "roboProductionRecord">;

export interface EnteredRow {
  serialNumber: number | null;
  slabNumber: string;
}

/**
 * The most recently entered slabs, newest first: the running shift's own, then
 * — only if those never carry an S.No. or a numeric slab number to count from —
 * the latest shift date's. Callers walk the list for the first row with each
 * number (latestSerialNumber / latestNumericSlab), so a row saved without an
 * S.No., or with a slab number like 140748-A, is stepped over, not counted on.
 */
export async function lastEnteredRows(db: EntryDb, take: number = RECENT_ROWS): Promise<EnteredRow[]> {
  const select = { serialNumber: true, slabNumber: true } as const;
  const running = await db.roboProductionRecord.findMany({
    where: { shift: { status: "ACTIVE" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select,
  });
  const serials = running.map((r) => r.serialNumber);
  const slabs = running.map((r) => r.slabNumber);
  if (latestSerialNumber(serials) !== null && latestNumericSlab(slabs) !== null) return running;
  const latestDay = await db.roboProductionRecord.findMany({ orderBy: ENTRY_ORDER, take, select });
  return [...running, ...latestDay];
}
