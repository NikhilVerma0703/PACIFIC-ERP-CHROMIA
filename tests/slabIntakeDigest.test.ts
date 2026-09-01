import { test } from "node:test";
import assert from "node:assert/strict";
import {
  digestWindow, digestHeadline, digestSubject, digestBody,
  type Digest,
} from "../src/lib/report/slabIntakeDigestText.ts";

// The window is the whole contract of this report. If a boundary is out by an
// hour the digest quietly reports the wrong shift's work, and nobody can tell
// from the email — so every edge of both halves is pinned here.

const at = (iso: string) => Date.parse(iso);          // a real instant
const iso = (d: Date) => d.toISOString();

test("the day half is 06:00 to 18:00 IST of the day now ending", () => {
  // 18:01 IST = 12:31 UTC, the schedule that closes the day shift.
  const w = digestWindow(at("2026-09-02T12:31:00.000Z"));
  assert.equal(w.kind, "day");
  assert.equal(iso(w.from), "2026-09-02T00:30:00.000Z");   // 06:00 IST
  assert.equal(iso(w.to), "2026-09-02T12:30:00.000Z");     // 18:00 IST
  assert.match(w.label, /day shift of 2 September 2026/);
});

test("the night half is 18:00 to 06:00 IST, and names both dates", () => {
  // 06:01 IST = 00:31 UTC, the schedule that closes the night shift.
  const w = digestWindow(at("2026-09-02T00:31:00.000Z"));
  assert.equal(w.kind, "night");
  assert.equal(iso(w.from), "2026-09-01T12:30:00.000Z");   // 18:00 IST on the 1st
  assert.equal(iso(w.to), "2026-09-02T00:30:00.000Z");     // 06:00 IST on the 2nd
  assert.match(w.label, /night shift of 1 September 2026 into 2 September 2026/);
});

test("THE TWO HALVES TILE THE DAY — no gap, no overlap", () => {
  // The night that ends on the 2nd must finish exactly where the 2nd's day
  // shift begins, or work done at 06:00 belongs to both digests or neither.
  const night = digestWindow(at("2026-09-02T00:31:00.000Z"));
  const day = digestWindow(at("2026-09-02T12:31:00.000Z"));
  assert.equal(iso(night.to), iso(day.from));
  // and the next night picks up exactly where the day shift ended
  const nextNight = digestWindow(at("2026-09-03T00:31:00.000Z"));
  assert.equal(iso(nextNight.from), iso(day.to));
});

test("which half is decided by the clock, so a late or retried run still closes its own shift", () => {
  // An hour late, still the day shift.
  assert.equal(digestWindow(at("2026-09-02T13:31:00.000Z")).kind, "day");
  // Just after noon IST (06:31 UTC) is already the day half.
  assert.equal(digestWindow(at("2026-09-02T06:31:00.000Z")).kind, "day");
  // Just before noon IST is still the night half.
  assert.equal(digestWindow(at("2026-09-02T06:29:00.000Z")).kind, "night");
  // A night run delayed to 08:00 IST still reports the night that ended.
  const late = digestWindow(at("2026-09-02T02:30:00.000Z"));
  assert.equal(late.kind, "night");
  assert.equal(iso(late.to), "2026-09-02T00:30:00.000Z");
});

test("a forced half overrides the clock, for a test send", () => {
  const w = digestWindow(at("2026-09-02T12:31:00.000Z"), "night");
  assert.equal(w.kind, "night");
  assert.equal(iso(w.to), "2026-09-02T00:30:00.000Z");
});

test("month and year boundaries do not fall apart", () => {
  const w = digestWindow(at("2026-09-01T00:31:00.000Z"));   // 06:01 IST, 1 Sept
  assert.equal(iso(w.from), "2026-08-31T12:30:00.000Z");    // 18:00 IST, 31 Aug
  assert.match(w.label, /31 August 2026 into 1 September 2026/);
  const y = digestWindow(at("2027-01-01T00:31:00.000Z"));
  assert.equal(iso(y.from), "2026-12-31T12:30:00.000Z");
  assert.match(y.label, /31 December 2026 into 1 January 2027/);
});

/* ---------------------------------------------------------- what it says */

const win = digestWindow(at("2026-09-02T12:31:00.000Z"));
const slab = (n: number, over: Partial<Digest["slabs"][number]> = {}) => ({
  slabNumber: n, added: false, design: "Carrara Cloud", grade: "A", batch: "D1430",
  status: "AVAILABLE", bay: "Bay 2", photos: 0, changes: [], by: ["Gibin"], at: new Date(), ...over,
});

test("the headline counts added and corrected apart", () => {
  const d: Digest = {
    window: win, addedCount: 2, correctedCount: 1, photoCount: 3, people: ["Gibin"],
    slabs: [slab(1, { added: true }), slab(2, { added: true }), slab(3, { changes: ["grade A → B"] })],
  };
  assert.equal(digestHeadline(d), "2 slabs added, 1 corrected, 3 photos");
  assert.equal(digestSubject(d), "Slab intake — day shift — 2 slabs added, 1 corrected, 3 photos");
});

test("one of a thing is not pluralised", () => {
  const d: Digest = {
    window: win, addedCount: 1, correctedCount: 0, photoCount: 1, people: [],
    slabs: [slab(1, { added: true, photos: 1 })],
  };
  assert.equal(digestHeadline(d), "1 slab added, 1 photo");
});

test("a silent shift says so rather than sending an empty table", () => {
  const d: Digest = { window: win, slabs: [], addedCount: 0, correctedCount: 0, photoCount: 0, people: [] };
  assert.equal(digestHeadline(d), "nothing was entered");
  const { text, html } = digestBody(d, "https://erp.example/slab-intake");
  assert.match(text, /Nothing was entered on the slab-intake form during the day shift of 2 September 2026 \(06:00 to 18:00\)/);
  assert.ok(!html.includes("<table"), "no empty table in the silent case");
});

test("the body names the slab, what happened to it, and every field that moved", () => {
  const d: Digest = {
    window: win, addedCount: 1, correctedCount: 1, photoCount: 2, people: ["Gibin", "Ravi"],
    slabs: [
      slab(144320, { added: true, photos: 2 }),
      slab(144321, { changes: ["grade A → B", "bay Bay 1 → Bay 2"] }),
    ],
  };
  const { text, html } = digestBody(d, "https://erp.example/slab-intake");
  assert.match(text, /144320/);
  assert.match(text, /added/);
  assert.match(text, /grade A → B; bay Bay 1 → Bay 2/);
  assert.match(text, /Entered by Gibin, Ravi/);
  assert.match(text, /https:\/\/erp\.example\/slab-intake/);
  assert.ok(html.includes("<table"));
  assert.match(html, /144321/);
});

test("a design with an angle bracket cannot inject markup into the html", () => {
  const d: Digest = {
    window: win, addedCount: 1, correctedCount: 0, photoCount: 0, people: [],
    slabs: [slab(1, { added: true, design: '<img src=x onerror="alert(1)">' })],
  };
  const { html } = digestBody(d, "https://erp.example/slab-intake");
  assert.ok(!html.includes("<img"), "the design must be escaped, not rendered");
  assert.ok(html.includes("&lt;img"));
});
