/**
 * Batch D-1432 (TIFFANY CHR) as the Reports screen showed it on 2026-09-25 —
 * RECONSTRUCTED, not exported: the per-hour completions are read off that
 * screen's "Production Rate per Hour" chart, the run's first In (11:20) and last
 * Out (22:31) and the slab range 157678–157803 come from the production register
 * (FOR ERP ENTRY JULY & AUG). Within an hour the Outs are spread evenly and each
 * In is 20 minutes before its Out, the register's usual time in the line.
 *
 * The chart put two slabs on 1 Sep, at 21:00–22:00 and 22:00–23:00. They are the
 * slabs that completed at 21:57 and 22:00 on 31 Aug — 157798 and 157799 in
 * production order. `slip` says how their records are wrong:
 *
 *   "date" — stored 2026-09-01 with their real clock times: a production date
 *            one day off.
 *   "out"  — stored 2026-08-31, but each Out typed a few minutes BEFORE its In,
 *            so the midnight rule pushes the Out to 1 Sep.
 *
 * Either way the screen read Total Production Time 34 hours 40 minutes and
 * Avg Slabs/hour 3.6. Not a test file (the runner only picks up *.test.ts).
 */

/** Completions per hour on 31 Aug, 11:00–12:00 … 22:00–23:00, as charted —
 *  124 slabs; the other two were charted on 1 Sep. */
export const D1432_CHARTED_31_AUG = [5, 10, 13, 7, 11, 12, 12, 14, 12, 11, 13, 4];
/** The same hours once the two are back on 31 Aug: 21:00 → 14, 22:00 → 5. */
export const D1432_REAL_31_AUG = [5, 10, 13, 7, 11, 12, 12, 14, 12, 11, 14, 5];
/** The two slabs the chart drew on 1 Sep. */
export const D1432_SLIPPED = ["157798", "157799"];

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export interface D1432Row {
  slabNumber: string;
  productionDate: string;
  inTime: string;
  outTime: string;
}

export function d1432(slip: "date" | "out" = "date"): D1432Row[] {
  // Out times, minutes after midnight, hour by hour.
  const outs: number[] = [];
  D1432_REAL_31_AUG.forEach((count, i) => {
    const hour = 11 + i;
    if (hour === 11) {
      // The run starts 11:20, so its first hour's slabs complete from 11:40.
      for (let k = 0; k < count; k++) outs.push(11 * 60 + 40 + 4 * k);
    } else if (hour === 22) {
      // The last hour ends on the register's last Out, 22:31.
      for (const m of [0, 8, 16, 24, 31]) outs.push(22 * 60 + m);
    } else {
      for (let k = 0; k < count; k++) outs.push(hour * 60 + Math.floor(((k + 0.5) * 60) / count));
    }
  });
  return outs.map((out, i) => {
    const slabNumber = String(157678 + i);
    const slipped = D1432_SLIPPED.includes(slabNumber);
    if (slipped && slip === "out") {
      return { slabNumber, productionDate: "2026-08-31", inTime: hm(out + 5), outTime: hm(out) };
    }
    return {
      slabNumber,
      productionDate: slipped ? "2026-09-01" : "2026-08-31",
      inTime: hm(out - 20),
      outTime: hm(out),
    };
  });
}
