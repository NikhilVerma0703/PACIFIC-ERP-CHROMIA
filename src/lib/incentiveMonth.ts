// One month of the shift incentive, as the page that tracks it needs it: the
// three letters' scores and shares, the pool the plant has reached, and —
// the part that changes hour by hour once the month has ended — every claimed
// slab QC has not yet graded, with where it physically is.
//
// Nothing here re-scores anything. The scores come from scoreRange(), the same
// call /scoreboard makes; the grouping by letter is incentiveMath's; the ladder
// is incentiveLadder's. This file only adds the two questions the payout still
// needs answered after the month closes: how many counted slabs are still to
// come, and are they real.
//
// WHY "ARE THEY REAL" IS A QUESTION. A shift claims slabs by typing a range.
// The score treats every number in the range as a slab, so a range typed one
// digit wide claims fifty slabs that were never pressed — and every one of them
// sits in "awaiting QC" forever, quietly promising points that will never
// arrive. Checking each outstanding number against the press, jot, oven and
// polish tables sorts the waiting from the phantom, and a projection that
// counts only the real ones is the one to plan a payroll on.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { scoreRange, type OutstandingSlab } from "@/lib/shiftScore";
import {
  shiftRange, shiftKeyOf, plusDay, stdMultiplier, gradeCredit, MAX_SLABS_PER_HOUR,
  type ShiftLetter,
} from "@/lib/shiftScoreMath";
import {
  rollUpByLetter, splitPoolByLetter, plantTotals, projectOutstanding,
  type LetterTotals, type LetterShare,
} from "@/lib/incentiveMath";
import { poolFor, nextTier, FLOOR_SLABS, TIERS, pctOfSalary, bandAmounts, ROLES } from "@/lib/incentiveLadder";

const db = prisma as any;

/** How far a claimed-but-uncounted slab has actually got.
 *  routed    — QC saw it and sent it to CTS / Printing: it will never grade.
 *  at-qc     — a QC row exists, still "Not graded yet".
 *  at-polish — on the polish line (polish_entry), no QC row yet.
 *  pressed   — seen at press / jot / oven, nothing downstream yet.
 *  nowhere   — no row in any table: the number was claimed and never made.
 *
 *  `routed` IS EXPECTED TO BE ZERO, AND ITS BEING ZERO IS THE POINT. It is
 *  keyed on OutstandingSlab.verdict, which shiftScore.ts sets to 'cts' only
 *  when the QC grade is exactly 'CTS' and to 'printing' only when the grade
 *  starts 'PRINT' — a ROUTING WRITTEN INTO THE VERDICT COLUMN. scripts/0071 and
 *  0072 took the last of those out: every cut slab now carries the grade the
 *  owner decided ('B'), keeps its slab_mark='CTS' to say it is cut, and earns
 *  its half slab of credit like any other B. Re-measure with
 *      SELECT quality_grade, count(*) FROM polish_qc GROUP BY 1;
 *  (run 2026-09-03: A / A2 / B / C (Reject) / 'Not graded yet' / NULL and
 *  nothing else, all time — the counts move hourly, the absence of a routing
 *  grade does not). So a NON-ZERO `routed` is a regression, not throughput: it
 *  means something has begun writing a routing state back into the grade, which
 *  is exactly the standing check scripts/0072 closes with — and the page says so
 *  rather than printing a column of dashes as if it were a measurement.
 *
 *  DO NOT RE-KEY THIS ONTO slab_mark TO "MAKE THE COLUMN WORK". That would move
 *  the 63 decided-B slabs out of the B column into a routing, scoring them zero
 *  instead of half a slab each, and would undo the owner's ruling — August alone
 *  would fall by 12.5 counted slabs (25 decided-B slabs x ½, measured
 *  2026-09-03). A cut slab KEEPS its verdict and still earns credit. */
export type Stage = "at-qc" | "at-polish" | "pressed" | "nowhere" | "routed";
export const STAGES: readonly Stage[] = ["at-qc", "at-polish", "pressed", "nowhere", "routed"];
/** Stages that can still turn into points. */
export const REAL_STAGES: readonly Stage[] = ["at-qc", "at-polish", "pressed"];

export interface TrackedSlab extends OutstandingSlab {
  anchor: string;
  shift: ShiftLetter;
  stage: Stage;
}

/** How many graded slabs a grade share needs behind it before it is worth
 *  printing. Below this a row says nothing: one C in eight slabs reads as a
 *  disaster and one A in eight reads as a triumph, and neither is true. */
export const MIN_GRADED_TO_SAY = 30;

/** ONE ROW OF THE MONTH'S WORK, PER DESIGN AND BATCH — graded and waiting on
 *  the same line.
 *
 *  IT USED TO BE A WAITING LIST AND ONLY A WAITING LIST. `groups` held only the
 *  design+batch combinations with something still outstanding, which is right
 *  for a backlog and wrong the moment the row also shows grades: a batch the
 *  month pressed and QC has since finished would be the one batch missing from
 *  the table, and it would be missing precisely BECAUSE it went well. Measured
 *  on live Neon for August 2026 (2026-09-03): 41 design+batch rows claimed,
 *  of which 8 have nothing waiting — those 8 were invisible here.
 *
 *  THE ROW RECONCILES BY EYE, and that is the whole reason the two halves are
 *  on one line:
 *
 *      gradeA + gradeA2 + gradeB + gradeC = graded
 *      graded + count                     = claimed        (`count` = waiting
 *                                                           + routed, i.e. the
 *                                                           sum of `stages`)
 *
 *  Nothing appears under two headings: a slab is EITHER graded (in exactly one
 *  of the four grade columns) OR still outstanding (in exactly one stage). CTS
 *  and Printing are routings, not verdicts, so they stay in `stages.routed` and
 *  out of all four grade columns — the register already shipped the other bug
 *  twice, a cut count sitting inside a grade block that already contained the
 *  same slabs. */
export interface OutstandingGroup {
  design: string;
  batch: string;
  /** Every slab of this design+batch the month claimed — the row's population,
   *  and the figure the other two must add back up to. */
  claimed: number;
  /** Claimed slabs QC has given a countable verdict. = the four grade columns. */
  graded: number;
  /** A and A2 kept apart: they are both passes and both earn 1, but the plant
   *  sells them as different products, so a batch drifting from A to A2 is a
   *  fact the owner wants to see rather than one averaged away. */
  gradeA: number;
  gradeA2: number;
  gradeB: number;
  gradeC: number;
  /** Of `gradeB`, how many are a DECISION rather than a measurement.
   *
   *  scripts/0071 and 0072 (applied 2026-09-03) regraded all 63 cut-to-size
   *  slabs from 'CTS' to 'B' because their real verdicts were destroyed and
   *  could not be recovered, and stamped quality_grade_before_cts='CTS' on them
   *  so a later reader could tell. gradeCredit() sees a plain 'B' and pays each
   *  one 0.5, so the month's SCORE counts them — and this table must count them
   *  in the same column for the same reason, or it would disagree with the
   *  payout about what August contained. This field is how the screen can SAY
   *  so without adding them anywhere twice: measured on live Neon 2026-09-03,
   *  25 of August's 171 B slabs are decided, all on ARVA WHITE / D1413 (23) and
   *  GLENCO (2). NOT a separate column — a note inside the B cell. */
  decidedB: number;
  /** THIS ROW'S OWN grade share (A=1, A2=1, B=0.5, C=0 over `graded`), null
   *  below MIN_GRADED_TO_SAY.
   *
   *  THE ONLY GRADE SHARE ON THE ROW, SINCE 2026-09-03. There used to be a
   *  second one beside it, `designShare`/`designGraded` — the same scale per
   *  DESIGN across every batch and every slab QC graded in the window — and it
   *  was removed rather than kept and labelled, because it was joining the MIS
   *  design SPELLING to the QC design SPELLING and the two spellings are not
   *  the same vocabulary. Measured on live Neon 2026-09-03, August 2026:
   *    - 7 of the 41 rows printed "none graded yet" over 161 slabs their OWN
   *      Graded column on the same line reported as graded (115, 19, 7, 6, 5,
   *      5, 4), because MIS spells them 'GLENCO - 2', 'Glenco-2', 'Viola',
   *      'Statuario trail-2', 'Toffee lite trial', '08' and 'Super White &
   *      Albester White' and QC has no such design;
   *    - worse, QC's single 'GLENCO' bucket holds 206 graded slabs INCLUDING
   *      the GLENCO-2 ones, so the GLENCO / D1411 row (50 graded of its own)
   *      printed "95.4% on 206" over a denominator containing another row's
   *      115 slabs. A design column that silently borrows another row's slabs
   *      is the "same quantity reading two ways on one screen" this table
   *      exists to prevent.
   *  Every row now carries its own share computed from its own four grade
   *  counts, which needs no name join at all, so nothing was lost by dropping
   *  it. If a design-level figure is ever wanted again, roll THESE rows up by
   *  the MIS design — never re-join to QC's spelling. */
  share: number | null;
  /** STILL OUTSTANDING — waiting plus routed, i.e. the sum of `stages`.
   *
   *  Keeps its old name deliberately: scripts/incentive-tracker.mts renders it
   *  under a "waiting" heading and that meaning has not changed. What changed
   *  is that rows with `count` 0 now exist, because the table no longer stops
   *  at the batches with something left to come. */
  count: number;
  /** How many of the OUTSTANDING ones count double (paired with `count`, not
   *  with `claimed`, so the two columns beside each other still describe the
   *  same set of slabs). */
  slow: number;
  stages: Record<Stage, number>;
}

export interface LetterMoney {
  shift: ShiftLetter;
  share: number;
  pctSalary: number;
  bands: Record<string, number>;
}

export interface IncentiveMonth {
  month: string;
  from: string;
  to: string;
  /** The last day actually scored — scoreRange caps a range at 31 days. */
  scoredTo: string;
  asOf: string;
  /** True once the month's last C shift has ended. */
  monthEnded: boolean;
  letters: LetterTotals[];
  /** The 70/30 split under each quality method. `weighted` is what the
   *  per-person scoreboard pays on; `aggregate` is what the August notice
   *  printed. See incentiveMath.ts. */
  shares: { weighted: LetterShare[]; aggregate: LetterShare[] };
  plant: ReturnType<typeof plantTotals>;
  pool: {
    counted: number;
    poolNow: number;
    floor: number;
    next: { slabs: number; pool: number } | null;
    ladder: typeof TIERS;
  };
  outstanding: {
    total: number;
    /** Every slab the month claimed — graded and outstanding together. This is
     *  the population `groups` describes, and it equals plant.claimed; the
     *  groups table sums to it. */
    claimed: number;
    /** Claimed slabs that reconciled to NEITHER a verdict NOR an outstanding
     *  row — a slab this file's rebuild of the month's claim believes in and
     *  scoreRange() does not. Zero on live August 2026 data (measured
     *  2026-09-03) and it must stay zero: it is one half of the drift alarm for
     *  the two derivations of "what the month claimed", and such slabs are left
     *  OUT of `claimed` so the table's columns keep adding up while it is
     *  shown. */
    unreconciled: number;
    /** THE OTHER HALF OF THE SAME ALARM, and until 2026-09-03 there was no such
     *  half. A slab scoreRange() reports as outstanding that the rebuild does
     *  NOT have drifts the opposite way, and it used to be entirely silent: the
     *  groups loop iterates `claimed`, so such a slab reaches no row and is
     *  missing from `groups`' `count` with nothing said. The screen would then
     *  print "Claimed, not yet counted — N" on one card and "Still waiting — N
     *  minus a few" two inches below it and give the reader no way to tell
     *  which was wrong. Also zero on live August 2026 (measured 2026-09-03:
     *  sum of groups.count = 954 = outstanding.total, all distinct). Unlike
     *  `unreconciled` these slabs ARE in `total`, `byStage` and `slabs` — they
     *  came from the score, which is the authority on the backlog — they are
     *  only absent from the per-batch table. */
    unclaimed: number;
    /** SLABS THE MONTH'S MIS RANGES CLAIMED THAT `claimed` AND `groups`
     *  DELIBERATELY LEAVE OUT: two shifts each typed a range covering them and
     *  no admin has ruled, so the payout gives them to NEITHER shift and this
     *  table — which describes what the month pays — cannot file them under
     *  either shift's design and batch either.
     *
     *  DROPPING THEM IS RIGHT AND SAYING NOTHING ABOUT IT WAS NOT. `claimed` was
     *  headed "every slab the month's MIS ranges claimed" on the screen, and it
     *  is that minus these. The gap is small but it is real and it points the
     *  OPPOSITE way from the CEO monthly report's own gap (that report drops MIS
     *  rows with a blank hourly standard), so the two screens' counts of "the
     *  slabs this month made" differed by the SUM of two cancelling causes and
     *  read as one. Measured on live Neon 2026-09-03, by month:
     *    June 2026   claimed 2,541 + contested 3 = 2,544 distinct slabs claimed
     *    July 2026           5,424 +           6 = 5,430
     *    August 2026         6,261 +           0 = 6,261
     *  (the contested slabs themselves: June 144295-6 and 144340, July 147766-7
     *  and 148112-5 — and none of them will move unless an MIS range is
     *  retyped or a ruling is filed.)
     *
     *  THE SAME SLABS scoreRange COUNTS AS `totals.contested`, reported here
     *  from this file's own rebuild so the sentence on the screen is checkable
     *  against the very population the table draws. The two derivations agreed
     *  exactly on all three months above; `openDisputes` below is the other
     *  one, and the page prints both. A month with 0 (August, today) must print
     *  no clause at all rather than "and 0 more". */
    contested: number;
    byStage: Record<Stage, number>;
    real: number;
    byLetter: Record<ShiftLetter, Record<Stage, number>>;
    groups: OutstandingGroup[];
    slabs: TrackedSlab[];
    /** Contiguous runs of `nowhere` slabs with the hour that claimed them —
     *  the MIS rows to go and correct. */
    phantomRuns: { from: number; to: number; count: number; anchor: string; shift: ShiftLetter; hour: string | null; design: string | null }[];
  };
  projection: {
    /** The month's grade share so far — what the outstanding are assumed to grade at. */
    share: number | null;
    addReal: number;
    projectedReal: number;
    poolReal: number;
    /** The same with the `nowhere` slabs included, i.e. the notice's way. */
    addAll: number;
    projectedAll: number;
    poolAll: number;
  };
  money: {
    pool: number;
    weighted: LetterMoney[];
    aggregate: LetterMoney[];
    roles: typeof ROLES;
  };
  qc: {
    perDay: { day: string; graded: number }[];
    avgPerDay7: number;
    daysToClear: number | null;
  };
  flaggedRows: number;
  openDisputes: number;
  unattributed: number;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** First and last IST day of a YYYY-MM month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The IST month running now, as YYYY-MM. */
export function currentMonthIST(now = new Date()): string {
  return ymd(new Date(now.getTime() + 330 * 60_000)).slice(0, 7);
}

/** Slab numbers present in a table, chunked under Postgres's bind limit. */
async function present(model: string, slabs: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  for (let i = 0; i < slabs.length; i += 5000) {
    const rows: any[] = await db[model].findMany({
      where: { slabNumber: { in: slabs.slice(i, i + 5000) } },
      select: { slabNumber: true },
    });
    for (const r of rows) out.add(Number(r.slabNumber));
  }
  return out;
}

const emptyStages = (): Record<Stage, number> => ({ "at-qc": 0, "at-polish": 0, pressed: 0, nowhere: 0, routed: 0 });

/** What one claimed slab is, for the groups table: the design and batch of the
 *  MIS hour that claimed it, and whether that hour ran a slow product. */
interface ClaimedSlab { mult: number; design: string | null; batch: string | null }

/** EVERY SLAB THE MONTH CLAIMED, by number, with the MIS hour that claimed it.
 *
 *  WHY THIS EXISTS AT ALL, AND WHY IT IS NOT A SECOND OPINION. ShiftScore
 *  reports the slabs it could NOT count (`outstanding`, with design and batch
 *  per slab) and a bare COUNT of the ones it could (`quantity`, `gradeA/B/C`).
 *  The graded slabs' numbers never leave scoreShift, so a table that wants
 *  grades per design+batch cannot get them from ShiftScore and has to rebuild
 *  the claim. This is that rebuild, and it is written to be the SAME set of
 *  slabs, rule for rule, because a table of grades that disagreed with the
 *  payout about which slabs August contained would be worse than no table:
 *
 *    - the same MIS window and the same where-clause as scoreShift (dateAndTime
 *      when it is there, else the IST day LABEL in `date`);
 *    - the same shift membership: shiftKeyOf() lands an instant in exactly the
 *      shiftRange() window scoreShift filters on, because the three windows
 *      tile 06→14→22→06 IST with no gap. A row with no dateAndTime dated by its
 *      `date` label (stored at UTC midnight = 05:30 IST) therefore falls in the
 *      PREVIOUS day's C shift under both rules, not in that day's A;
 *    - only shift instances that have ENDED, as scoreRange does — a running
 *      shift is not scored, so its slabs are not claimed. TWO CLOCKS USED TO
 *      DECIDE THAT, which is why `scored` is a parameter now. scoreRange()
 *      takes its own new Date() inside itself, strictly LATER than the `now`
 *      incentiveMonth was called with and hands down here, so a shift instance
 *      ending in the gap between the two was scored and not claimed — its
 *      slabs came back as outstanding from a shift this rebuild had never
 *      heard of, and landed on no row of the table. The gap is milliseconds
 *      wide and 0 slabs fell in it on live August 2026 (2026-09-03), but it is
 *      open once every eight hours and needs no failure to fire. A shift now
 *      counts as ended if it ended by `now` OR scoreRange actually scored it,
 *      which is a union and therefore can only ADD instances — an instance
 *      scoreRange dropped for having neither slabs nor a crew still passes the
 *      `now` test and is claimed exactly as before;
 *    - the same range guards: non-numeric, non-positive, backwards, or
 *      MAX_SLABS_PER_HOUR wide and above is not a claim;
 *    - the same lower-multiplier-wins rule when two rows cover one slab, so the
 *      design and batch reported here are the ones scoreShift's rowBySlab would
 *      have reported (checked against every one of the 958 slabs outstanding on
 *      August at 2026-09-03, on live Neon: 0 disagreements);
 *    - the same double-claim rule: a slab two SHIFTS both claimed scores for
 *      neither and is dropped here too, unless an admin has awarded it. It is
 *      NOT an unexercised arm: measured 2026-09-03 it drops 3 slabs on June
 *      2026 and 6 on July, and 0 on August. So the returned map is the month's
 *      claim MINUS those, which is what the payout contains and therefore what
 *      the table must contain — and the count comes back alongside it so the
 *      screen can say so instead of heading the table with a total it has
 *      quietly reduced. See `outstanding.contested`.
 *
 *  MEASURED: rebuilt 6,261 slabs for August 2026 against scoreRange's
 *  6,261 (sum of ShiftScore.quantity) — exact, on 736 MIS rows, one query.
 *  Re-measured 2026-09-03: still 6,261, and June 2,541 / July 5,424. August's
 *  figure is settled because MIS for the month is fully entered; the GRADES
 *  behind it move hourly, the claim does not. */
async function claimedByMonth(from: string, scoredTo: string, now: Date, scored: Set<string>): Promise<{ owner: Map<number, ClaimedSlab>; contested: number }> {
  const lo = shiftRange(from, "A").start;
  const hi = shiftRange(scoredTo, "C").end;
  const mis: any[] = await db.mis.findMany({
    where: {
      OR: [
        { dateAndTime: { gte: lo, lt: hi } },
        { AND: [{ dateAndTime: null }, { date: { gte: lo, lt: hi } }] },
      ],
    },
    select: {
      date: true, dateAndTime: true, design: true, batch: true,
      startingSlabNumber: true, endingSlabNumber: true, slabsPerHourStd: true,
    },
  });

  const claimedBy = new Map<number, Set<string>>();   // slab -> shift keys that claimed it
  const owner = new Map<number, ClaimedSlab>();
  for (const r of mis) {
    const ts = r.dateAndTime ?? r.date;
    if (!ts) continue;
    const key = shiftKeyOf(new Date(ts));
    const anchor = key.slice(0, 10), letter = key.slice(10) as ShiftLetter;
    if (anchor < from || anchor > scoredTo) continue;
    // Ended by OUR clock, or scored by scoreRange's — see the two-clocks note
    // in this function's doc. Union, never intersection: an instance scoreRange
    // dropped (it filters out shifts with no slabs AND no crew) is still ended
    // and must still be claimed.
    if (shiftRange(anchor, letter).end > now && !scored.has(key)) continue;
    const a = Number(r.startingSlabNumber), b = Number(r.endingSlabNumber);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b < a) continue;
    if (b - a >= MAX_SLABS_PER_HOUR) continue;
    const mult = stdMultiplier(r.slabsPerHourStd);
    for (let n = a; n <= b; n++) {
      let who = claimedBy.get(n);
      if (!who) claimedBy.set(n, who = new Set());
      who.add(key);
      const cur = owner.get(n);
      if (cur == null || mult < cur.mult) owner.set(n, { mult, design: r.design ?? null, batch: r.batch ?? null });
    }
  }

  const contested = [...claimedBy].filter(([, who]) => who.size > 1).map(([n]) => n);
  // How many of them ended up dropped — not how many were contested. An awarded
  // slab is not contested any more: it scores for the winner and stays on a row,
  // so counting it here would have the screen apologise for a slab it is
  // showing. Live today this is the whole of `contested` (0 rows in
  // slab_claim_award, measured 2026-09-03), and the moment the owner rules on
  // one it stops being.
  let dropped = 0;
  if (contested.length) {
    // An ADMIN'S RULING beats the default, exactly as in scoreRange: an awarded
    // slab scores for the winner and therefore belongs in this table; an
    // unruled one scores for nobody and must not appear. (The design and batch
    // of an awarded slab are still taken by the lower-multiplier rule across
    // BOTH claimants' rows rather than the winner's alone — a difference only a
    // contested slab whose two claimants typed different designs could show,
    // and there are none live today.)
    const awarded = new Set<number>();
    for (let i = 0; i < contested.length; i += 5000) {
      const rows: any[] = await db.slabClaimAward.findMany({
        where: { slabNumber: { in: contested.slice(i, i + 5000) } },
        select: { slabNumber: true },
      });
      for (const r of rows) awarded.add(Number(r.slabNumber));
    }
    for (const n of contested) if (!awarded.has(n)) { owner.delete(n); dropped += 1; }
  }
  return { owner, contested: dropped };
}

export async function incentiveMonth(month: string, now = new Date()): Promise<IncentiveMonth> {
  const { from, to } = monthBounds(month);
  const data = await scoreRange(from, to);
  const letters = rollUpByLetter(data.shifts);
  const plant = plantTotals(letters);
  const shares = {
    weighted: splitPoolByLetter(letters, "weighted"),
    aggregate: splitPoolByLetter(letters, "aggregate"),
  };

  // ---- Where every uncounted slab actually is -----------------------------
  const raw: (OutstandingSlab & { anchor: string; shift: ShiftLetter })[] = data.shifts.flatMap((s) =>
    s.outstanding.map((o) => ({ ...o, anchor: s.anchor, shift: s.shift })),
  );
  const numbers = [...new Set(raw.map((o) => o.slab))];
  const [atPolish, atPress, atJot, atOven] = await Promise.all([
    present("polishEntry", numbers), present("press", numbers), present("jot", numbers), present("oven", numbers),
  ]);
  const slabs: TrackedSlab[] = raw.map((o) => {
    const stage: Stage =
      o.verdict === "cts" || o.verdict === "printing" ? "routed"
      : o.verdict === "not-graded" ? "at-qc"
      : atPolish.has(o.slab) ? "at-polish"
      : atPress.has(o.slab) || atJot.has(o.slab) || atOven.has(o.slab) ? "pressed"
      : "nowhere";
    return { ...o, stage };
  }).sort((x, y) => x.slab - y.slab);

  const byStage = emptyStages();
  const byLetter: Record<ShiftLetter, Record<Stage, number>> = { A: emptyStages(), B: emptyStages(), C: emptyStages() };
  for (const s of slabs) { byStage[s.stage] += 1; byLetter[s.shift][s.stage] += 1; }
  const real = REAL_STAGES.reduce((a, st) => a + byStage[st], 0);

  // ---- What the month's claimed slabs GRADED, per design and batch ---------
  // The waiting half of a groups row comes from `slabs` above. The graded half
  // needs the slab NUMBERS scoreShift counted, which it does not report — so
  // the claim is rebuilt (claimedByMonth, above) and everything in it that is
  // not waiting is looked up in QC here, under scoreShift's own rules:
  // newest verdict per slab wins, and gradeCredit() decides what a verdict is.
  const { owner: claimed, contested } = await claimedByMonth(from, data.to, now, new Set(data.shifts.map((s) => `${s.anchor}${s.shift}`)));
  const waitingBySlab = new Map<number, TrackedSlab>();
  for (const s of slabs) waitingBySlab.set(s.slab, s);
  const toGrade = [...claimed.keys()].filter((n) => !waitingBySlab.has(n));
  const gradedQc: any[] = [];
  for (let i = 0; i < toGrade.length; i += 5000) {
    gradedQc.push(...await db.polishQc.findMany({
      where: { slabNumber: { in: toGrade.slice(i, i + 5000) } },
      // qualityGradeBeforeCts rides along for `decidedB` — see OutstandingGroup.
      select: { slabNumber: true, qualityGrade: true, qualityGradeBeforeCts: true, createdTime: true, importedAt: true },
    }));
  }
  // Newest verdict per slab — scoreShift's rule, character for character, so a
  // re-graded slab reports the same outcome on this table as in the payout.
  const stampOf = (q: any) => new Date(q.createdTime ?? q.importedAt ?? 0).getTime();
  gradedQc.sort((x, y) => stampOf(y) - stampOf(x));
  const verdictOf = new Map<number, any>();
  for (const q of gradedQc) if (q.slabNumber != null && !verdictOf.has(Number(q.slabNumber))) verdictOf.set(Number(q.slabNumber), q);

  // THERE WAS A SECOND, DESIGN-LEVEL GRADE SHARE HERE, AND IT IS GONE.
  // A raw GROUP BY over polish_qc gave every row a `designShare` /
  // `designGraded` pair "across all batches of this design", joined to the row
  // by upper(trim(design)) — QC's spelling against MIS's. Removed 2026-09-03,
  // for two measured reasons and one that would have bitten later:
  //
  //   - IT PRINTED "none graded yet" OVER GRADED SLABS. 7 of August 2026's 41
  //     rows, 161 slabs, each row's own Graded column on the same line reading
  //     115 / 19 / 7 / 6 / 5 / 5 / 4 — because MIS says 'GLENCO - 2',
  //     'Glenco-2', 'Viola', 'Statuario trail-2', 'Toffee lite trial', '08',
  //     'Super White & Albester White' and QC has no design of those names.
  //   - WORSE, WHERE IT DID JOIN IT BORROWED. QC's one 'GLENCO' bucket (206
  //     graded) contains the GLENCO-2 slabs, so GLENCO / D1411 — 50 graded of
  //     its own — printed "95.4% on 206" over a denominator holding another
  //     row's 115 slabs. Two rows of one screen reporting one quantity two
  //     ways is exactly what this table exists to stop.
  //   - IT COUNTED ROWS, NOT SLABS. The comment above it claimed it was "built
  //     from the same latest-verdict rule the score uses"; it was a plain
  //     count(*) with no newest-per-slab dedupe, so a slab QC re-inspected
  //     inside the window counted once under each verdict. Zero impact on the
  //     August window (6,230 rows over 6,230 distinct slabs, measured
  //     2026-09-03) but polish_qc holds 268 slabs carrying 537 rows between
  //     them, so the shape is real and the claim was false.
  //
  // Nothing replaced it: `share` on each row is the same arithmetic over that
  // row's OWN four grade counts and needs no name join at all. A design-level
  // figure, if ever wanted again, is a roll-up of THESE rows by MIS design.
  //
  // WHAT THAT QUERY'S COMMENT ALSO CARRIED, KEPT HERE BECAUSE IT IS STILL TRUE
  // OF THE GRADE COLUMNS BELOW. scripts/0071 and 0072 (applied 2026-09-03)
  // regraded all 63 cut-to-size slabs from 'CTS' to 'B', so they are plain 'B'
  // rows now and this table counts them at half a slab of credit — 25 of them
  // fall in August (23 Arva White, 2 GLENCO - 2). That is deliberate:
  // gradeCredit() pays them 0.5 too, so the table and the money agree about
  // what August contained. Excluding them the other way — by
  // quality_grade_before_cts, the noVerdict rule the CEO's PASS RATE uses —
  // answers a different question ("what share of INSPECTED slabs passed") and
  // would disagree with the credit this same page pays on. `decidedB` names
  // them on screen so the choice is visible rather than silent. The routing
  // states need no filter here: gradeCredit() returns null for 'CTS',
  // 'PRINT%' and anything else that is not A/B/C, which is what keeps a
  // routing out of a grade column — that rule, not a WHERE clause, is now the
  // only one, and it is the one the payout uses.

  // ---- One row per design+batch the month claimed --------------------------
  const groupMap = new Map<string, OutstandingGroup>();
  // LENGTH-PREFIXED KEY. The old one was `${design}${batch}`, which can collide:
  // design "AB" batch "C" and design "A" batch "BC" are the same string, so two
  // different batches merge into one row whose columns still add up and are
  // still wrong — the quietest kind of error this table can make. Prefixing the
  // design's length makes the split unambiguous whatever either half contains,
  // and does it in ASCII, unlike a separator character.
  const rowFor = (design: string, batch: string): OutstandingGroup => {
    const k = `${design.length}:${design}${batch}`;
    let g = groupMap.get(k);
    if (!g) {
      g = {
        design, batch, claimed: 0, graded: 0,
        gradeA: 0, gradeA2: 0, gradeB: 0, gradeC: 0, decidedB: 0, share: null,
        count: 0, slow: 0, stages: emptyStages(),
      };
      groupMap.set(k, g);
    }
    return g;
  };
  let unreconciled = 0;
  for (const [slab, own] of claimed) {
    const waiting = waitingBySlab.get(slab);
    // The design and batch of a WAITING slab come from the TrackedSlab, not
    // from `own`, so the two halves of the row can never be filed under two
    // different spellings of the same batch. They agree today — checked against
    // every one of the 958 slabs outstanding on August at 2026-09-03, 0
    // disagreements — and this makes that structural rather than lucky.
    const design = String((waiting ? waiting.design : own.design) ?? "(no design)").trim() || "(no design)";
    const batch = String((waiting ? waiting.batch : own.batch) ?? "—").trim() || "—";
    const g = rowFor(design, batch);
    if (waiting) {
      g.claimed += 1; g.count += 1; g.stages[waiting.stage] += 1;
      if (waiting.mult > 1) g.slow += 1;
      continue;
    }
    const q = verdictOf.get(slab);
    const credit = gradeCredit(q?.qualityGrade);
    if (credit == null) {
      // Neither graded nor listed as outstanding by the score — the two
      // derivations of "what the month claimed" have drifted. Left OUT of
      // `claimed` so the row's columns still add up, and counted so the page
      // can say so. 0 on live August 2026 data.
      unreconciled += 1;
      continue;
    }
    g.claimed += 1; g.graded += 1;
    const u = String(q.qualityGrade).trim().toUpperCase();
    // A2 before A: "A2".startsWith("A") is true, and the whole point of the
    // column is that the two are told apart.
    if (u === "A2") g.gradeA2 += 1;
    else if (u.startsWith("A")) g.gradeA += 1;
    else if (u.startsWith("B")) {
      g.gradeB += 1;
      if (String(q.qualityGradeBeforeCts ?? "").trim().toUpperCase() === "CTS") g.decidedB += 1;
    } else g.gradeC += 1;
  }
  // THE DRIFT ALARM'S OTHER HALF. The loop above walks `claimed`, so a slab the
  // SCORE reports as outstanding and the rebuild does not have reaches no row
  // at all: it is in `total` and in `byStage` but missing from every row's
  // `count`, and without this the page would print two different figures for
  // the same backlog two inches apart with nothing to explain the gap. Counted,
  // not corrected — the score is the authority on the backlog, and a rebuild
  // that has lost a slab needs a person, not a patch. 0 on live August 2026,
  // measured three times on 2026-09-03 as QC kept grading (954, 953, 952
  // outstanding) with the rows summing to the same figure each time.
  let unclaimed = 0;
  for (const s of slabs) if (!claimed.has(s.slab)) unclaimed += 1;
  for (const g of groupMap.values()) {
    // The row's own share, on gradeCredit's scale: A and A2 are passes worth 1,
    // B is half a slab of credit, C earns nothing. Same arithmetic as
    // ShiftScore.rawQuality, over this row's slabs instead of a shift's.
    g.share = g.graded >= MIN_GRADED_TO_SAY ? (g.gradeA + g.gradeA2 + g.gradeB * 0.5) / g.graded : null;
  }
  // Outstanding first — this table is still, in part, the list of what the
  // month is waiting on, and that is what an admin opens it for. Fully graded
  // batches fall below, largest first, where they read as the month's record.
  const groups = [...groupMap.values()]
    .filter((g) => g.claimed > 0)
    .sort((a, b) => b.count - a.count || b.claimed - a.claimed
      || a.design.localeCompare(b.design) || a.batch.localeCompare(b.batch));
  const monthClaimed = groups.reduce((a, g) => a + g.claimed, 0);

  // Phantom runs: contiguous `nowhere` numbers claimed by one hour.
  const phantomRuns: IncentiveMonth["outstanding"]["phantomRuns"] = [];
  for (const s of slabs) {
    if (s.stage !== "nowhere") continue;
    const last = phantomRuns[phantomRuns.length - 1];
    if (last && last.to === s.slab - 1 && last.anchor === s.anchor && last.shift === s.shift && last.hour === s.hour) { last.to = s.slab; last.count += 1; }
    else phantomRuns.push({ from: s.slab, to: s.slab, count: 1, anchor: s.anchor, shift: s.shift, hour: s.hour, design: s.design });
  }
  phantomRuns.sort((a, b) => b.count - a.count);

  // ---- The pool, now and if the waiting slabs grade like the month has ------
  const counted = plant.points;
  const share = plant.rawShare;
  const realSlabs = slabs.filter((s) => REAL_STAGES.includes(s.stage));
  const addReal = projectOutstanding(realSlabs, share);
  const addAll = projectOutstanding(slabs.filter((s) => s.stage !== "routed"), share);
  const projectedReal = counted + addReal;
  const projectedAll = counted + addAll;

  const moneyFor = (rows: LetterShare[], pool: number): LetterMoney[] => rows.map((r) => {
    const pct = pctOfSalary(r.share, pool);
    return { shift: r.shift, share: r.share, pctSalary: pct, bands: bandAmounts(pct) };
  });
  // Money is shown on the pool the REAL projection reaches — the notice's
  // planning figure — never on a pool the counted total has not unlocked yet
  // without saying so; the page labels it.
  const planningPool = poolFor(projectedReal);

  // ---- QC throughput, for a days-to-clear -----------------------------------
  const perDayRows: any[] = await db.$queryRaw`
    SELECT ((coalesce(created_time, imported_at) + interval '330 minutes')::date)::text AS day, count(*)::int AS graded
    FROM polish_qc
    WHERE coalesce(created_time, imported_at) >= ${new Date(now.getTime() - 14 * 86400_000)}
      AND quality_grade IS NOT NULL AND quality_grade NOT ILIKE 'Not graded%'
    GROUP BY 1 ORDER BY 1`;
  const perDay = perDayRows.map((r) => ({ day: String(r.day), graded: Number(r.graded) }));
  const today = ymd(new Date(now.getTime() + 330 * 60_000));
  // The seven full days before today, zeros included — a day QC did not run is
  // a day the backlog did not move.
  const last7 = Array.from({ length: 7 }, (_, i) => plusDay(today, -(i + 1)));
  const sum7 = last7.reduce((a, d) => a + (perDay.find((p) => p.day === d)?.graded ?? 0), 0);
  const avgPerDay7 = sum7 / 7;
  const daysToClear = avgPerDay7 > 0 ? Math.ceil(real / avgPerDay7) : null;

  return {
    month, from, to, scoredTo: data.to, asOf: now.toISOString(),
    monthEnded: shiftRange(to, "C").end <= now,
    letters, shares, plant,
    pool: { counted, poolNow: poolFor(counted), floor: FLOOR_SLABS, next: nextTier(counted), ladder: TIERS },
    outstanding: { total: slabs.length, claimed: monthClaimed, unreconciled, unclaimed, contested, byStage, real, byLetter, groups, slabs, phantomRuns },
    projection: {
      share, addReal, projectedReal, poolReal: poolFor(projectedReal),
      addAll, projectedAll, poolAll: poolFor(projectedAll),
    },
    money: { pool: planningPool, weighted: moneyFor(shares.weighted, planningPool), aggregate: moneyFor(shares.aggregate, planningPool), roles: ROLES },
    qc: { perDay, avgPerDay7, daysToClear },
    flaggedRows: data.flagged.length,
    openDisputes: data.totals.contested,
    unattributed: data.totals.unattributed,
  };
}
