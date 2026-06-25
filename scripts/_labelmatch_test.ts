// throwaway test harness for lib/fab/labelMatch — run with tsx, then delete.
import { readFileSync } from "fs";
import { snapLabel, normalizeLabel } from "../src/lib/fab/labelMatch";

const valid: string[] = JSON.parse(readFileSync("/tmp/labels.json", "utf8"));

// [rawOCR, expectedLabel|null]
const cases: [string, string | null][] = [
  ["1-2A", "1-2A"],          // clean
  ["1-2a", "1-2A"],          // case
  ["1 - 2A", "1-2A"],        // spaces
  ["I-2A", "1-2A"],          // I→1 drawing
  ["l-2B", "1-2B"],          // l→1
  ["1–2A", "1-2A"],          // en-dash
  ["1—3E", "1-3E"],          // em-dash
  ["1-3O", null],            // 3O? no 1-30 exists -> none/ambiguous-ish
  ["7-2B", "7-2B"],          // high drawing
  ["1O-2", "10-2"],          // O→0 in drawing (does 10-2 exist?)
  ["Z5-2", "25-2"],          // Z→2 drawing
  ["S-1", "5-1"],            // S→5 drawing
  ["8-4", "8-4"],            // exists?
  ["G-4", "6-4"],            // G→6 (6-4 exists)
  ["", null],
  ["-", null],
  ["garbage", null],
  ["40-3D", "40-3D"],        // last-ish drawing
];

let pass = 0, fail = 0;
for (const [raw, exp] of cases) {
  const r = snapLabel(raw, valid);
  const ok = r.label === exp;
  // tolerate: if expected exists in valid only; otherwise just print
  const existsExp = exp == null || valid.map(normalizeLabel).includes(normalizeLabel(exp));
  const verdict = ok ? "PASS" : (existsExp ? "FAIL" : "n/a ");
  if (ok) pass++; else if (existsExp) fail++;
  console.log(
    `${verdict}  raw=${JSON.stringify(raw).padEnd(10)} -> ${String(r.label).padEnd(8)} ` +
    `(${r.confidence}, d=${r.distance.toFixed(2)})  expected=${exp}` +
    (r.candidates.length ? `  cands=[${r.candidates.join(",")}]` : ""),
  );
}
console.log(`\n${pass} pass / ${fail} fail (n/a = expected label not in set)`);

// quick ambiguity demo with a tiny synthetic set
const tiny = ["1-2A", "1-2B"];
console.log("\nambiguity demo on", tiny);
console.log("  '1-2X' ->", JSON.stringify(snapLabel("1-2X", tiny)));
console.log("  '1-2B' + dim tie-break ->",
  JSON.stringify(snapLabel("1-2E", tiny, {
    dim: "105x25.5",
    dimByLabel: new Map([["1-2A", { w: 38, d: 25.5 }], ["1-2B", { w: 105, d: 25.5 }]]),
  })));
