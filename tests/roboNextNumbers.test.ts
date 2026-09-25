import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isNumericSlab,
  latestNumericSlab,
  latestSerialNumber,
  nextSerialNumber,
  nextSlabNumber,
} from "../src/lib/robo/nextNumbers.ts";

/* The numbers the entry form offers. Two bugs behind these.

   First: both were computed from the active shift, and a shift row is created
   silently once a day — so every morning the S.No. restarted at 1 against a
   register at 35, and the slab number went blank.

   Then: the fix read "the latest record" two different ways. The slab number
   counted from the newest ROW, the S.No. from the highest NUMBER anywhere —
   max(serial_number) + 1 — and those agree only in a register nothing has been
   imported into. The imported rows carry the old paper register's own S.No.
   column, into the hundreds, so a line whose last saved slab was 19 was offered
   241. Both come from the last saved row now. */

test("the S.No. continues from the last one SAVED, not the highest anywhere", () => {
  // The report: last slab S.No. 19, form offered 241.
  assert.equal(nextSerialNumber(19), 20);
  assert.equal(nextSerialNumber(34), 35);
  assert.equal(nextSerialNumber(65), 66);
});

test("the S.No. starts at 1 only when nothing is numbered yet", () => {
  assert.equal(nextSerialNumber(null), 1);
  assert.equal(nextSerialNumber(undefined), 1);
  assert.equal(nextSerialNumber(0), 1);
  // A NULL serialNumber ordering first is what used to pin the server's own
  // fallback at 1 forever. The walk skips NULLs, but guard anyway.
  assert.equal(nextSerialNumber(Number.NaN), 1);
});

test("the last S.No. saved comes from the newest row that has one", () => {
  // Newest first, as the route reads them.
  assert.equal(latestSerialNumber([19, 18, 17]), 19);
  // 240 is an imported row sitting further down the register. It is not the
  // last row, so it is not what the next slab counts from — this is the whole
  // difference between the old max and the new walk.
  assert.equal(latestSerialNumber([19, 18, 240, 17]), 19);
  assert.equal(nextSerialNumber(latestSerialNumber([19, 18, 240, 17])), 20);
});

test("a row saved without an S.No. does not restart the register at 1", () => {
  // serial_number is nullable, so this is a real row, not a hypothetical.
  assert.equal(latestSerialNumber([null, null, 19]), 19);
  assert.equal(latestSerialNumber([undefined, 19]), 19);
  assert.equal(latestSerialNumber([null, undefined]), null);
  assert.equal(latestSerialNumber([]), null);
  assert.equal(latestSerialNumber([Number.NaN, 0, -3, 19]), 19);
});

test("what counts as a slab number we can count from", () => {
  assert.equal(isNumericSlab("17578"), true);
  assert.equal(isNumericSlab(" 17578 "), true);
  assert.equal(isNumericSlab("140748-A"), false);
  assert.equal(isNumericSlab("A17578"), false);
  assert.equal(isNumericSlab(""), false);
  assert.equal(isNumericSlab(null), false);
});

test("the slab number continues from the latest record", () => {
  assert.equal(nextSlabNumber("17578"), "17579");
  assert.equal(nextSlabNumber("140748"), "140749");
});

test("a non-numeric slab number in the newest row does not stop the suggestion", () => {
  assert.equal(latestNumericSlab(["140748-A", "140747", "140746"]), "140747");
  assert.equal(latestNumericSlab(["17578"]), "17578");
  assert.equal(latestNumericSlab([null, undefined, "  "]), null);
  assert.equal(latestNumericSlab([]), null);
});

test("nothing to count from means no suggestion, not a made-up first number", () => {
  assert.equal(nextSlabNumber(null), "");
  assert.equal(nextSlabNumber("SLAB-1"), "");
});

test("a number already taken is skipped, so the operator is never handed a duplicate", () => {
  assert.equal(nextSlabNumber("17578", new Set(["17579"])), "17580");
  assert.equal(nextSlabNumber("17578", new Set(["17579", "17580", "17581"])), "17582");
  // and it gives up rather than looping forever
  const wall = new Set(Array.from({ length: 40 }, (_, i) => String(17579 + i)));
  assert.equal(nextSlabNumber("17578", wall, 25), "");
});

test("a solid block of taken numbers is walked past, not given up on", () => {
  /* What the route does with the "" above, one probe at a time. This is the
     case that emptied the slab-number field: an imported register can hold a
     continuous run of numbers above the last slab the line actually ran, and a
     single probe against such a run came back with nothing to offer. */
  const wall = new Set(Array.from({ length: 40 }, (_, i) => String(17579 + i)));
  const probe = 25;

  let from = "17578";
  let pick = nextSlabNumber(from, wall, probe);
  assert.equal(pick, "", "first probe lands entirely inside the block");

  // The route counts on from the end of the window it just checked.
  from = String(BigInt(from) + BigInt(probe));
  pick = nextSlabNumber(from, wall, probe);
  assert.equal(pick, "17619", "the second reaches the first free number past it");
});

test("leading zeros are part of the number, not formatting", () => {
  assert.equal(nextSlabNumber("00042"), "00043");
  assert.equal(nextSlabNumber("09999"), "10000");
  assert.equal(nextSlabNumber("99"), "100");
});

test("numbers past 2^53 stay exact", () => {
  // BigInt, not Number — a register that ever reaches this must not round.
  assert.equal(nextSlabNumber("9007199254740993"), "9007199254740994");
});

/* ══ WHICH SLAB IS "LAST" — and why refresh, navigation and edits cannot move it ══
   (2026-09-25) The owner's report: last slab entered S.No. 13 / 161223, the form
   rightly offering 14 / 161224 — until a refresh, a trip to another page and
   back, or an edit to an older slab (161206), after which it sometimes offered
   a wrong S.No. or a wrong slab number. Those are exactly the moments the form
   asks the server instead of counting on from the slab it just saved, and the
   server read the "last row" as the newest shift date's HIGHEST S.No. One
   shift carries every batch set up that day and a new batch's S.No. starts
   again from 1, so an earlier, longer batch on the same shift won.

   lastEnteredRows now reads the newest slab SAVED on the running shift. These
   tests run it against an in-memory stand-in for the table that honours the
   same where / orderBy / take the real query sends. */

import { lastEnteredRows, ENTRY_ORDER, type EntryDb } from "../src/lib/robo/registerOrderDb.ts";

interface Row { id: string; serialNumber: number | null; slabNumber: string; createdAt: Date; shift: { date: string; status: string } }

/** A stand-in for prisma.roboProductionRecord.findMany: `where` on the shift's
 *  status, an `orderBy` list of the shapes the Robo code uses, `take`, `select`. */
function fakeDb(rows: Row[]): EntryDb {
  type Order = Record<string, unknown>;
  const key = (r: Row, o: Order): [unknown, string, string] => {
    if ("shift" in o) return [r.shift.date, (o.shift as { date: string }).date, "last"];
    if ("createdAt" in o) return [r.createdAt.getTime(), o.createdAt as string, "last"];
    if ("id" in o) return [r.id, o.id as string, "last"];
    const s = o.serialNumber as { sort: string; nulls: string };
    return [r.serialNumber, s.sort, s.nulls];
  };
  const findMany = async (args: { where?: { shift?: { status?: string } }; orderBy?: Order[]; take?: number; select?: Record<string, boolean> }) => {
    let out = rows.filter((r) => !args.where?.shift?.status || r.shift.status === args.where.shift.status);
    out = [...out].sort((a, b) => {
      for (const o of args.orderBy ?? []) {
        const [va, dir, nulls] = key(a, o);
        const [vb] = key(b, o);
        if (va === vb) continue;
        if (va === null) return nulls === "last" ? 1 : -1;
        if (vb === null) return nulls === "last" ? -1 : 1;
        const c = (va as number) < (vb as number) ? -1 : 1;
        return dir === "desc" ? -c : c;
      }
      return 0;
    });
    return out.slice(0, args.take ?? out.length).map((r) =>
      Object.fromEntries(Object.keys(args.select ?? r).map((k) => [k, (r as unknown as Record<string, unknown>)[k]])));
  };
  return { roboProductionRecord: { findMany } } as unknown as EntryDb;
}

/** What the next-number route offers, from the rows lastEnteredRows returns. */
async function offer(db: EntryDb) {
  const recent = await lastEnteredRows(db);
  const latest = latestNumericSlab(recent.map((r) => r.slabNumber));
  const taken = new Set((await (db.roboProductionRecord.findMany as unknown as (a: object) => Promise<Row[]>)({ select: { slabNumber: true } })).map((r) => r.slabNumber));
  return { serialNumber: nextSerialNumber(latestSerialNumber(recent.map((r) => r.serialNumber))), slabNumber: nextSlabNumber(latest, taken, 200) };
}

/** The same, read the way it was read before this change. */
async function offerOldWay(db: EntryDb) {
  const OLD = [{ shift: { date: "desc" } }, { serialNumber: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }];
  const recent = await (db.roboProductionRecord.findMany as unknown as (a: object) => Promise<Row[]>)({ orderBy: OLD, take: 50, select: { serialNumber: true, slabNumber: true } });
  const latest = latestNumericSlab(recent.map((r) => r.slabNumber));
  const taken = new Set((await (db.roboProductionRecord.findMany as unknown as (a: object) => Promise<Row[]>)({ select: { slabNumber: true } })).map((r) => r.slabNumber));
  return { serialNumber: nextSerialNumber(latestSerialNumber(recent.map((r) => r.serialNumber))), slabNumber: nextSlabNumber(latest, taken, 200) };
}

let clock = Date.UTC(2026, 8, 25, 6, 0);
/** `n` slabs saved one after another on a shift, S.No. from `firstSerial`, slab numbers from `firstSlab`. */
function saved(n: number, firstSerial: number, firstSlab: number, shift: { date: string; status: string }, skip: number[] = []): Row[] {
  const out: Row[] = [];
  let slab = firstSlab;
  for (let k = 0; k < n; k++) {
    while (skip.includes(slab)) slab++;
    out.push({ id: `r${slab}`, serialNumber: firstSerial + k, slabNumber: String(slab), createdAt: new Date((clock += 5 * 60_000)), shift });
    slab++;
  }
  return out;
}

/** The owner's shift: a 60-slab batch earlier on it (161151 to 161210, 161206
 *  among them), then a new batch — S.No. 1 to 13, slabs 161211 to 161223. */
function ownersShift(jumped: number[] = []) {
  const running = { date: "2026-09-25", status: "ACTIVE" };
  const batchA = saved(60, 1, 161151, running);
  const batchB = saved(13, 1, 161211, running, jumped);
  return { running, rows: [...batchA, ...batchB], last: batchB[batchB.length - 1] };
}

test("the next pair is the last slab ENTERED plus one: 13 / 161223 → 14 / 161224 (owner's case)", async () => {
  const { rows, last } = ownersShift();
  assert.deepEqual([last.serialNumber, last.slabNumber], [13, "161223"]);
  const db = fakeDb(rows);
  assert.deepEqual(await offer(db), { serialNumber: 14, slabNumber: "161224" });
  // …and a refresh, or coming back to the page, asks again and gets the same.
  assert.deepEqual(await offer(db), await offer(db));
});

test("the old reading picked the earlier batch's S.No. 60 — and, past a jumped number, a slab number from the gap", async () => {
  const old = await offerOldWay(fakeDb(ownersShift().rows));
  assert.equal(old.serialNumber, 61, "the wrong S.No. after a refresh");
  // The same shift where slab 161215 was jumped (never entered): the new batch's
  // 13th slab is 161224, and the old reading, counting on from the old batch's
  // 161210, offered the gap instead.
  const jumped = ownersShift([161215]);
  assert.equal(jumped.last.slabNumber, "161224");
  assert.equal((await offerOldWay(fakeDb(jumped.rows))).slabNumber, "161215", "the 'random' slab number");
  assert.deepEqual(await offer(fakeDb(jumped.rows)), { serialNumber: 14, slabNumber: "161225" });
});

test("editing an older slab (161206) does not move the next pair", async () => {
  const { rows } = ownersShift();
  const before = await offer(fakeDb(rows));
  // The edit changes what 161206 says — even its S.No. — never when it was saved.
  const edited = rows.map((r) => (r.slabNumber === "161206" ? { ...r, serialNumber: 99 } : r));
  assert.deepEqual(await offer(fakeDb(edited)), before);
  assert.equal((await offerOldWay(fakeDb(edited))).serialNumber, 100, "the old reading jumped to the edited row");
});

test("an imported register cannot move it, whatever dates it carries", async () => {
  const { rows } = ownersShift();
  const before = await offer(fakeDb(rows));
  // Imported AFTER the last slab was entered — so newer by save time — onto
  // CLOSED shifts of the register's own dates: one in the past, one dated after
  // the running shift began.
  const august = saved(40, 1, 153100, { date: "2026-08-10", status: "CLOSED" });
  const later = saved(20, 300, 170000, { date: "2026-09-30", status: "CLOSED" });
  assert.deepEqual(await offer(fakeDb([...rows, ...august, ...later])), before);
});

test("a new day's setup with nothing saved yet continues from the last slab of the day before", async () => {
  const { rows, last } = ownersShift();
  const closed = rows.map((r) => ({ ...r, shift: { date: "2026-09-25", status: "CLOSED" } }));
  // The new running shift exists (its setup was saved) but holds no slab yet.
  const db = fakeDb(closed);
  assert.deepEqual(await offer(db), { serialNumber: 14, slabNumber: String(Number(last.slabNumber) + 1) });
  // Once its first slab is saved, that slab is the last one entered.
  const first = saved(1, 1, 161300, { date: "2026-09-26", status: "ACTIVE" });
  assert.deepEqual(await offer(fakeDb([...closed, ...first])), { serialNumber: 2, slabNumber: "161301" });
});

test("a slab saved without an S.No. is stepped over for the S.No., not for the slab number", async () => {
  const { rows, running } = ownersShift();
  const noSerial: Row = { id: "x", serialNumber: null, slabNumber: "161224", createdAt: new Date((clock += 60_000)), shift: running };
  assert.deepEqual(await offer(fakeDb([...rows, noSerial])), { serialNumber: 14, slabNumber: "161225" });
});

test("the fallback order and both callers are the shared ones", () => {
  // The latest shift date first — imports sit on their past dates below it —
  // then the newest save; never the S.No. value.
  assert.deepEqual(ENTRY_ORDER, [{ shift: { date: "desc" } }, { createdAt: "desc" }, { id: "desc" }]);
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  assert.match(src("app/api/robo/production/next-number/route.ts"), /await lastEnteredRows\(prisma\)/);
  assert.match(src("app/api/robo/production/route.ts"), /await lastEnteredRows\(tx\)/, "the POST's own S.No. agrees with the suggestion");
  assert.ok(!/serialNumber: \{ sort: "desc"/.test(src("lib/robo/registerOrderDb.ts")), "no ordering by the S.No. value");
});
