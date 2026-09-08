import test from "node:test";
import assert from "node:assert/strict";

import { placeSlabs, registerOrder, dayNum } from "../src/lib/robo/slabPlacement.ts";

/* The ONE rule for putting bare HH:MM In/Out on an absolute timeline, shared by
   the hourly chart and the Total Production Time KPI so they can never disagree
   about a batch. Absolute minutes = days since epoch × 1440 + clock. */

const D21 = dayNum("2026-08-21")! * 1440;
const D22 = D21 + 1440;
const at = (base: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return base + h * 60 + m;
};

test("rule 1 — the first dated slab anchors the day; the run follows from there", () => {
  const p = placeSlabs([
    { productionDate: "2026-08-21", inTime: "14:00", outTime: "15:00" },
    { productionDate: "2026-08-21", inTime: "19:00", outTime: "20:00" },
  ]);
  assert.deepEqual(p.map((x) => [x.inAbs, x.outAbs]), [
    [at(D21, "14:00"), at(D21, "15:00")],
    [at(D21, "19:00"), at(D21, "20:00")],
  ]);
});

test("rule 2 — a forward date is TRUSTED when the clock went backwards against the run", () => {
  // Paused overnight, resumed 08:30 next morning: 08:30 same-day would land
  // before 20:00, so it cannot be a continuation — the 22nd is the truth even
  // though 08:30 is not 12h behind 20:00.
  const p = placeSlabs([
    { productionDate: "2026-08-21", inTime: "19:00", outTime: "20:00" },
    { productionDate: "2026-08-22", inTime: "08:30", outTime: "09:30" },
    { productionDate: "2026-08-22", inTime: "11:00", outTime: "12:00" },
  ]);
  assert.equal(p[1].inAbs, at(D22, "08:30"));
  assert.equal(p[2].outAbs, at(D22, "12:00"));
});

test("rule 3 — a forward date is IGNORED when the clock sits at or after the run", () => {
  // Batch 1432's slip: 22:40 dated tomorrow right after a 22:40 Out. The clock
  // never moved back, so the date is a mis-date and the slab stays on the 31st.
  const p = placeSlabs([
    { productionDate: "2026-08-31", inTime: "22:30", outTime: "22:40" },
    { productionDate: "2026-09-01", inTime: "22:40", outTime: "22:45" },
    { productionDate: "2026-09-01", inTime: "22:45", outTime: "22:50" },
  ]);
  const D31 = dayNum("2026-08-31")! * 1440;
  assert.equal(p[1].outAbs, at(D31, "22:45"));
  assert.equal(p[2].outAbs, at(D31, "22:50"));
});

test("rule 3 — a stored date BEHIND the run is never trusted either", () => {
  // A slab cannot be produced before the run it belongs to; it follows the sequence.
  const p = placeSlabs([
    { productionDate: "2026-08-22", inTime: "09:00", outTime: "09:40" },
    { productionDate: "2026-08-21", inTime: "09:40", outTime: "10:15" },
  ]);
  assert.equal(p[1].outAbs, at(D22, "10:15"));
});

test("rule 4 — a clock >12h behind the run wraps a day even with the SAME stored date", () => {
  const p = placeSlabs([
    { productionDate: "2026-08-21", inTime: "23:30", outTime: "23:55" },
    { productionDate: "2026-08-21", inTime: "00:20", outTime: "00:50" },
  ]);
  assert.equal(p[1].inAbs, at(D22, "00:20"));
  assert.equal(p[1].outAbs, at(D22, "00:50"));
});

test("rule 4 — a small backstep is out-of-order logging, not a wrap", () => {
  const p = placeSlabs([
    { productionDate: "2026-08-21", inTime: "10:05", outTime: "10:12" },
    { productionDate: "2026-08-21", inTime: "10:00", outTime: "10:20" },
  ]);
  assert.equal(p[1].inAbs, at(D21, "10:00"));
});

test("rule 5 — within one slab, Out before In means Out is the next day", () => {
  const p = placeSlabs([{ productionDate: "2026-08-21", inTime: "23:30", outTime: "00:10" }]);
  assert.equal(p[0].inAbs, at(D21, "23:30"));
  assert.equal(p[0].outAbs, at(D22, "00:10"));
  // And the run continues from that Out, on the 22nd.
  const q = placeSlabs([
    { productionDate: "2026-08-21", inTime: "23:30", outTime: "00:10" },
    { productionDate: "2026-08-21", inTime: "00:10", outTime: "00:40" },
  ]);
  assert.equal(q[1].outAbs, at(D22, "00:40"));
});

test("slabs with no time, or dated before any date is known, are left out", () => {
  const p = placeSlabs([
    { productionDate: "", inTime: "00:05", outTime: "23:55" },
    { productionDate: "2026-08-21", inTime: null, outTime: null },
    { productionDate: "2026-08-21", inTime: "11:30", outTime: "17:52" },
    { productionDate: null, inTime: "17:52", outTime: "18:10" }, // rides the sequence
  ]);
  assert.equal(p.length, 2);
  assert.equal(p[0].inAbs, at(D21, "11:30"));
  assert.equal(p[1].outAbs, at(D21, "18:10"));
});

test("registerOrder — serial, then createdAt, then the caller's order; stable", () => {
  const ordered = registerOrder([
    { productionDate: "d", inTime: "c", outTime: null, serialNumber: null, createdAt: "2026-08-21T10:00:00Z" },
    { productionDate: "d", inTime: "b", outTime: null, serialNumber: 2 },
    { productionDate: "d", inTime: "a", outTime: null, serialNumber: 1 },
    { productionDate: "d", inTime: "e", outTime: null },
    { productionDate: "d", inTime: "d", outTime: null, serialNumber: null, createdAt: "2026-08-21T11:00:00Z" },
  ]);
  assert.deepEqual(ordered.map((s) => s.inTime), ["a", "b", "e", "c", "d"]);
});
