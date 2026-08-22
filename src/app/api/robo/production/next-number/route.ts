import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  latestNumericSlab,
  latestSerialNumber,
  nextSerialNumber,
  nextSlabNumber,
} from "@/lib/robo/nextNumbers";
import { REGISTER_ORDER } from "@/lib/robo/registerOrderDb";

export const dynamic = "force-dynamic";

/** Rows walked back through to find the last S.No. and the last slab number. */
const RECENT_ROWS = 50;
/** Slab numbers checked per round trip when looking for a free one. */
const PROBE = 50;
/** How many of those rounds — so at most 200 numbers past the last slab. */
const PROBE_ROUNDS = 4;

/**
 * GET /api/robo/production/next-number
 *
 * What the entry form should offer for the next slab: `{ serialNumber, slabNumber }`.
 *
 * ── BOTH NUMBERS COME FROM THE LAST ROW OF THE REGISTER ──────────────────
 * One query, in the register's own order, and each number is taken from the
 * last row that carries one. Last slab S.No. 19 / slab 43567 offers 20 / 43568:
 * the pair on the sheet, plus one each.
 *
 * The S.No. used to be `max(serial_number) + 1` across the whole table. That is
 * a maximum, not a position in a register, and the two stop agreeing the moment
 * anything is imported — the historical rows carry the old paper register's own
 * S.No. column, running into the hundreds, so a line sitting at 19 was offered
 * 241.
 *
 * ── AND THE ORDER IS THE REGISTER'S, NOT THE INSERT ORDER ────────────────
 * Not `createdAt`, which is the tempting answer and the wrong one. The importer
 * writes historical rows with `@default(now())` — see api/robo/imports, which
 * groups the workbook by production date, finds or creates the shift for that
 * date, and writes `row.serialNumber` from the sheet. So the moment anyone
 * imports last month's register, every one of those rows is NEWER by createdAt
 * than the slab the line ran ten minutes ago, and both numbers would be read
 * off a shift that closed months back — the same 241 as before, plus a slab
 * number to match.
 *
 * A register is ordered by the day it records and then by its own row number.
 * `shift.date` is a `yyyy-mm-dd` string so it sorts as it reads; createdAt and
 * id stay on the end as tiebreaks, for two rows of the same day and number.
 *
 * Neither number is an allocation. Both are suggestions the operator types
 * over, and the S.No. deliberately does not skip numbers that already exist:
 * the column has no unique constraint and an import fills it from the sheet.
 *
 * The slab number does skip, because that one IS checked for duplicates on save
 * and offering a taken number would hand the operator a 409 they did not cause.
 * `freeSlabNumber` walks forward in blocks until it finds a gap — an imported
 * register can hold a solid run of numbers above the last slab the line ran, and
 * a single 25-wide probe against such a run came back empty, which is why the
 * field went blank rather than counting on.
 *
 * The entry form only asks on a fresh page: after each save it counts on from
 * the slab it just wrote, which needs no round trip and cannot be argued with.
 * See the numbering effect in RoboEntryForm.
 *
 * Read-only, and gated by middleware's /api/robo rule like every other route here.
 */
export async function GET() {
  const recent = await prisma.roboProductionRecord.findMany({
    orderBy: REGISTER_ORDER,
    take: RECENT_ROWS,
    select: { serialNumber: true, slabNumber: true },
  });

  const serialNumber = nextSerialNumber(latestSerialNumber(recent.map((r) => r.serialNumber)));
  const latest = latestNumericSlab(recent.map((r) => r.slabNumber));
  const slabNumber = latest ? await freeSlabNumber(latest) : "";

  return NextResponse.json({ serialNumber, slabNumber });
}

/**
 * The first slab number above `latest` that nothing else in the register holds.
 *
 * Bounded twice over — PROBE numbers per query, PROBE_ROUNDS queries — so a
 * pathological register costs four small `IN` lookups and then gives up with
 * "", which the form reads as "leave the field to the operator". The ordinary
 * case is one query that matches no rows.
 */
async function freeSlabNumber(latest: string): Promise<string> {
  let from = latest;
  for (let round = 0; round < PROBE_ROUNDS; round++) {
    const width = from.length;
    const start = BigInt(from) + 1n;
    const window = Array.from({ length: PROBE }, (_, i) =>
      String(start + BigInt(i)).padStart(width, "0"),
    );
    const clashes = await prisma.roboProductionRecord.findMany({
      where: { slabNumber: { in: window } },
      select: { slabNumber: true },
    });
    const pick = nextSlabNumber(from, new Set(clashes.map((c) => c.slabNumber)), PROBE);
    if (pick) return pick;
    // Every number in that block is taken; count on from the end of it. The
    // width follows the number rather than the other way round, so 09999 walks
    // into 10000 without losing a digit.
    from = window[window.length - 1];
  }
  return "";
}
