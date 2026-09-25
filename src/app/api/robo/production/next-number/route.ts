import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  latestNumericSlab,
  latestSerialNumber,
  nextSerialNumber,
  nextSlabNumber,
} from "@/lib/robo/nextNumbers";
import { lastEnteredRows } from "@/lib/robo/registerOrderDb";
import { roboGate } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/** Slab numbers checked per round trip when looking for a free one. */
const PROBE = 50;
/** How many of those rounds — so at most 200 numbers past the last slab. */
const PROBE_ROUNDS = 4;

/**
 * GET /api/robo/production/next-number
 *
 * What the entry form should offer for the next slab: `{ serialNumber, slabNumber }`.
 *
 * ── BOTH NUMBERS COME FROM THE LAST SLAB ENTERED ──────────────────────────
 * Each number is taken from the most recently entered slab that carries one:
 * last slab entered S.No. 13 / slab 161223 offers 14 / 161224 — the pair just
 * written, plus one each. "Most recently entered" is lastEnteredRows in
 * lib/robo/registerOrderDb.ts: the newest slab saved on the running shift. It
 * reads only what is in the database, so a refresh, a trip to another page and
 * back, or an edit to an older slab (which never changes when a slab was saved)
 * all come back to the same pair.
 *
 * The S.No. used to be `max(serial_number) + 1` across the whole table — a
 * maximum, not a position, which offered a line sitting at 19 the number 241
 * from an imported paper register. It then became "the highest S.No. on the
 * newest shift date", which is the same mistake one shift at a time: one shift
 * carries every batch set up that day, a new batch's S.No. starts again from 1,
 * and the old batch's higher number won — 61 offered after 13, and a slab
 * number counted on from the old batch's row into numbers already used. See
 * registerOrderDb.ts, which also covers why imports cannot move it.
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
 * The entry form asks on a fresh page (a refresh, coming back to it) and after
 * an edit, a delete or a refused save; after each ordinary save it counts on
 * from the slab it just wrote, which needs no round trip. Both give the same
 * pair, because the slab it just wrote IS the last slab entered. See the
 * numbering effect in RoboEntryForm.
 *
 * Read-only, and gated by middleware's /api/robo rule like every other route here.
 */
export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  const recent = await lastEnteredRows(prisma);

  const serialNumber = nextSerialNumber(latestSerialNumber(recent.map((r) => r.serialNumber)));
  const latest = latestNumericSlab(recent.map((r) => r.slabNumber));
  const slabNumber = latest ? await freeSlabNumber(latest) : "";

  // Never cached anywhere between here and the form: this is the live end of
  // the register, and a stored copy is exactly how a refresh would show an
  // older pair.
  return NextResponse.json({ serialNumber, slabNumber }, { headers: { "Cache-Control": "no-store" } });
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
