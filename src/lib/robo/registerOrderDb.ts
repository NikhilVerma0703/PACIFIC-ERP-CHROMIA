import type { Prisma } from "@prisma/client";

/**
 * The order the Robo production register is actually written in.
 *
 * `*Db.ts` like setupMastersDb.ts: this one touches Prisma's generated types,
 * so it sits apart from the pure helpers in nextNumbers.ts that `node --test`
 * loads directly.
 *
 * ── WHY NOT createdAt ────────────────────────────────────────────────────
 * Two callers need "the last row of the register": the suggestion the entry
 * form opens on, and the S.No. the POST assigns when the form sends none. Both
 * used to answer it with an aggregate max, which is not a position in a
 * register at all, and the obvious replacement — newest `createdAt` — is wrong
 * here for a specific, checkable reason.
 *
 * The importer (api/robo/imports) groups a register workbook by production
 * date, finds or creates the RoboShift for that date, and writes each row with
 * `serialNumber: row.serialNumber ?? nextSerial` — the sheet's own S.No. The
 * record's `createdAt` is `@default(now())`, so it is the moment of the IMPORT.
 * Import last month's register and every historical row is suddenly newer than
 * the slab the line ran ten minutes ago; read the last row by createdAt and
 * both numbers come off a shift that closed months ago.
 *
 * A register is ordered by the day it records, then by its own row number.
 * `RoboShift.date` is a `yyyy-mm-dd` String, so it sorts as it reads.
 * `serialNumber` is nullable — `nulls: "last"` keeps a row saved without one
 * from taking the top of the list, which is the same NULLS FIRST trap that
 * pinned an earlier version of this answer at 1 forever. createdAt and id are
 * the tiebreaks, for two rows on the same day with the same number.
 */
export const REGISTER_ORDER: Prisma.RoboProductionRecordOrderByWithRelationInput[] = [
  { shift: { date: "desc" } },
  { serialNumber: { sort: "desc", nulls: "last" } },
  { createdAt: "desc" },
  { id: "desc" },
];
