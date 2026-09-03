// Shared filter builder for the inventory search + KPI routes, so the KPI
// cards always describe exactly what the table shows.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { approvalKey, approvalKeyString, NO_DESIGN } from "@/lib/inventory/approvalKey";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { NONE, customerKey } from "@/lib/inventory/filterValues";
import { CUT_GRADES, CUT_MARKS } from "@/lib/inventory/grading";
import { parseSlabMark } from "@/lib/fab/slabMark";

const db = prisma as any;

// ═══════════════════════ THE MARK, AND WHY "CUT" IS AN OR ═══════════════════
//
// THE INCIDENT. Until 2026-09-03 fabrication OVERWROTE a cut slab's grade with
// 'CTS' (lib/fab/markQcSlabCts.ts), which destroyed the polishing line's A/B/C
// verdict. The owner: "grade should be A/B/C like normal, and the MARK is CTS
// or sampling." So the routing state moves to its own column — polish_qc
// .slab_mark (scripts/0057) and fg_finished_slab.slab_mark (scripts/0070) —
// and the grade goes back to meaning quality.
//
// THE HOLE THAT OPENS IF NOTHING ELSE CHANGES, which is why this block exists.
// Every inventory surface identifies a cut slab by its GRADE and nothing
// anywhere filtered by the MARK. So the moment new slabs stop carrying
// grade='CTS' the dropdown option disappears (it is built from live values),
// the KPI card reads zero, the register's CTS column empties — and there is no
// way left on the screen to find a slab that has been cut. That is worse than
// the bug being fixed.
//
// MEASURED ON LIVE NEON, 2026-09-03, BEFORE 0070/0071/0072 RAN — EVERY BULLET
// BELOW IS NOW SUPERSEDED. Read it as history and see the re-measurement after
// it; acting on these four numbers today is acting on a yard that no longer
// exists:
//   * 62 slabs read grade='CTS' — 60 on the floor, 2 already DISPATCHED. All 62
//     also carry slab_mark='CTS' on their polish_qc row.
//   * No slab anywhere reads SAMPLE, in either column. Every other polish_qc
//     row is FULL_SLAB.
//   * fg_finished_slab.slab_mark DOES NOT EXIST YET — scripts/0070 is written
//     and unapplied (checked against information_schema on the live database).
//   * 1,615 slabs have NO grade at all (1,309 on the floor). That number is the
//     reason wholeSlabWhere() spells out `grade IS NULL OR grade NOT IN (...)`
//     rather than trusting a bare notIn: in SQL, NULL NOT IN ('CTS','SAMPLE')
//     is NULL, so an ungraded slab is neither cut nor whole and 1,309 slabs
//     would drop out of the "Full slab" filter without a word.
//
// THE RULE, and it is the whole safety property here: A CUT SLAB IS ONE WHOSE
// GRADE SAYS CUT **OR** WHOSE MARK SAYS CUT. Never the mark alone — that would
// lose the 62 legacy rows the day the filter shipped, because the owner is
// collecting their real A/B/C verdicts by hand and their grade stays 'CTS'
// until he does. Never the grade alone — that is the hole above. Both signals
// are live through the whole changeover, so both are asked.
//
// ══════════ AND THEN THE GRADE BELT WAS CUT AWAY, LATER THE SAME DAY ════════
//
// Everything above describes a changeover in which BOTH signals were live.
// That is no longer the world, and the paragraph that used to sit here — "on a
// database without the column each clause collapses to exactly the grade-only
// filter that runs today, the same 62 slabs, no 500, no empty screen" — IS NOW
// FALSE. It is kept deleted deliberately: a stale justification is how the next
// person re-introduces the bug.
//
// What happened: scripts/0070 landed, so fg_finished_slab.slab_mark EXISTS; and
// then scripts/0071 and 0072 moved all 63 of those slabs from grade 'CTS' to
// grade 'B', on the owner's decision, because their real A/B/C verdicts are
// unrecoverable.
//
// RE-MEASURED ON LIVE NEON, 2026-09-03, AFTER 0070/0071/0072:
//   * ZERO rows in fg_finished_slab and ZERO in polish_qc carry grade 'CTS' or
//     'SAMPLE'. The grade arm of every OR below now matches NOTHING AT ALL.
//   * 63 rows carry slab_mark = 'CTS' (60 AVAILABLE, 1 status CTS, 2 already
//     DISPATCHED) — 61 of them on the floor, and every one of those 61 reads
//     grade 'B'. No row anywhere reads SAMPLE, in either column.
//   * On-floor total 16,628 = A 8,304 + B 3,424 + C 2,346 + A2 859 + Trial 384
//     + ungraded 1,311. The MARK is the only signal left that says "cut".
//
// SO THE `hasMark = false` BRANCH NO LONGER DEGRADES TO YESTERDAY'S ANSWER — IT
// DEGRADES TO ZERO. A grade-only clause does not under-report the cut slabs any
// more, it reports that there are none, over a floor holding 61 that have been
// cut; and `?mark=FULL_SLAB`, its complement, lists all 61 as whole sellable
// stock. That is not a degraded answer, it is a confident wrong one.
//
// THE RULE FOR THIS FILE FROM HERE ON: ANYTHING THAT CANNOT CONFIRM THE MARK
// MUST FAIL CLOSED. Every clause below still TAKES `hasMark` — the grade arm
// stays, so the day a routing state reappears in the grade column it is caught
// again — but a `false` no longer produces a clause. It throws, the route
// answers an error, and somebody makes a phone call. The alternative is a
// screen that says "no cut slabs here" and a lorry.

/** Prisma could not read fg_finished_slab.slab_mark — and it is THAT, not a
 *  database in trouble.
 *
 *  Two different failures mean the same thing to us and both must be caught:
 *    * P2022, the column is not in the database (scripts/0070 unapplied);
 *    * a PrismaClientValidationError, the generated client does not know the
 *      field. Real today: schema.prisma declares slabMark but this working copy
 *      has not re-run `prisma generate`, so node_modules/.prisma knows slabMark
 *      on PolishQc only. The build runs generate, so deployed code will not see
 *      this — but a query built on a wrong assumption here would 500 the whole
 *      inventory page, and the message names the field either way.
 *
 *  Anything else — a dropped connection, a timeout — is NOT this and is
 *  rethrown by the callers, so one bad second cannot latch a process into
 *  grade-only reads for its whole life while looking perfectly healthy. */
export function isMissingSlabMarkError(e: any): boolean {
  return e?.code === "P2022" || /slab_mark|slabMark/.test(String(e?.message || ""));
}

/** One probe per process, memoised as a promise so concurrent requests share it.
 *
 *  WHY A PROBE AND NOT users.ts's "run it and re-filter in JS": you cannot
 *  re-derive in JS a column the database does not have, and buildInventoryWhere
 *  BUILDS a where clause rather than running one, so there is no query here to
 *  catch a failure from. The closest fitting pattern is the other half of the
 *  same idea — finishedSlab.ts's slabMarkColumnMissing, which asks once and
 *  then runs the narrower query. This asks once and then builds the narrower
 *  clause.
 *
 *  A NEGATIVE VERDICT IS NO LONGER LATCHED FOR THE LIFE OF THE PROCESS, and
 *  that change is the whole point of this hunk. The old comment here said a
 *  latched `false` was harmless because "the process keeps filtering on the
 *  grade, which is precisely what it does today". After scripts/0071 and 0072
 *  the grade filter matches nothing (see the block at the top of this file), so
 *  one misclassified error at boot used to leave that instance reporting a yard
 *  with no cut slabs in it until somebody restarted it. Now the clause builders
 *  refuse to answer on a `false` — and this expires it as well, the same way
 *  finishedSlab.ts's RECHECK_MS does, so a process that probed during the
 *  window before scripts/0070 landed picks the column up within a minute
 *  instead of needing a restart. It is also LOGGED: "missing" is a real
 *  operational event now, not a quiet fallback.
 *
 *  A POSITIVE verdict IS still latched for the process: the column cannot go
 *  away underneath us, and re-probing every minute for a fact that cannot
 *  change would be a query per minute per instance for nothing.
 *
 *  A transient failure is NOT cached either way: the cache is cleared and the
 *  error rethrown, so the route reports the outage instead of quietly serving
 *  half the cut slabs as if that were the whole answer. */
let slabMarkProbe: Promise<boolean> | null = null;
/** When a `false` verdict stops being trusted and is re-probed. 0 while the
 *  cached verdict is `true` (which never expires) or unset. */
let slabMarkRecheckAt = 0;
/** Same minute finishedSlab.ts gives its own missing-column memo, on purpose:
 *  the two halves of this rule must not disagree about how stale is stale. */
const MARK_RECHECK_MS = 60_000;

export function slabMarkAvailable(): Promise<boolean> {
  if (slabMarkRecheckAt && Date.now() >= slabMarkRecheckAt) {
    slabMarkProbe = null; // a "missing" verdict has gone stale — ask again
    slabMarkRecheckAt = 0;
  }
  if (!slabMarkProbe) {
    slabMarkProbe = (async () => {
      try {
        await db.finishedSlab.findFirst({ select: { slabMark: true } }); // SELECT slab_mark ... LIMIT 1
        slabMarkRecheckAt = 0; // proven present; nothing to re-probe
        return true;
      } catch (e: any) {
        if (!isMissingSlabMarkError(e)) throw e;
        slabMarkRecheckAt = Date.now() + MARK_RECHECK_MS;
        // LOUD, because every cut-slab count and filter is about to refuse to
        // answer until this clears, and "the inventory screen is erroring" with
        // nothing in the log is a much longer evening than this line.
        console.error(
          "[searchWhere] fg_finished_slab.slab_mark is unreadable — every cut/whole filter will refuse to answer until this clears. Re-probing in %dms. %s",
          MARK_RECHECK_MS,
          String(e?.message ?? e),
        );
        return false;
      }
    })().catch((e) => {
      slabMarkProbe = null; // transient — let the next request ask again
      slabMarkRecheckAt = 0;
      throw e;
    });
  }
  return slabMarkProbe;
}

/** Append clauses to `where.AND` without trampling what is already there.
 *  The design filter writes `where.AND` and approvedOnlyWhere appends to it, so
 *  a plain assignment here would silently drop one of them — dropping the
 *  approval clause would show Sales stock an admin master-hid. */
export function andWhere(where: any, ...clauses: any[]): any {
  const use = clauses.filter(Boolean);
  if (!use.length) return where;
  const prev = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  return { ...where, AND: [...prev, ...use] };
}

/** Is this filter value one of the two cut states (CTS / SAMPLE)? Compared
 *  case-insensitively because it arrives off a query string; the value used in
 *  the clause is the canonical upper-case one, since both columns store exactly
 *  that (all 63 live marks read 'CTS', and 0070's CHECK constraint allows the
 *  mark nothing else; no row in either column reads 'SAMPLE' yet). */
function cutValueOf(v: string): string | null {
  const up = v.trim().toUpperCase();
  return (CUT_GRADES as readonly string[]).includes(up) ? up : null;
}

/** NO MARK, NO ANSWER — the fail-closed end of every clause below.
 *
 *  Until scripts/0071 and 0072 ran, a clause built without the mark collapsed
 *  to the grade rule and returned exactly what these screens printed yesterday:
 *  fewer cut slabs than the truth, but never zero, and never a whole-stock list
 *  with a cut slab in it. Those two scripts regraded all 63 cut slabs from
 *  'CTS' to 'B', so the grade arm now matches NOTHING — measured on live Neon
 *  2026-09-03: zero rows with grade 'CTS' or 'SAMPLE' in either table, 61 cut
 *  slabs on the floor, every one of them grade 'B', mark 'CTS'.
 *
 *  So the grade-only clause stopped being a smaller answer and became a WRONG
 *  one: `anyCutWhere` counts 0 of 61, and `wholeSlabWhere` — its complement —
 *  hands back all 61 already-cut slabs as whole sellable stock. A Sales user
 *  filtering "Full slab" would be looking at a list that is 61 slabs too long,
 *  with nothing on the screen saying so.
 *
 *  Refusing costs somebody a phone call about an inventory screen that is
 *  erroring. Answering costs an already-cut slab on a customer's lorry, and the
 *  customer finds out. So this throws, the route answers an error, and the
 *  screen says it could not tell. */
function noMarkNoAnswer(fn: string): never {
  throw new Error(
    `${fn}: fg_finished_slab.slab_mark could not be read, and the grade column no ` +
      `longer carries the cut signal (scripts/0071 and 0072 regraded all 63 cut slabs ` +
      `to 'B'). Refusing to answer rather than reporting a floor with no cut slabs on it.`,
  );
}

/** Slabs cut in ONE named way — what `?grade=CTS` and `?mark=CTS` both mean.
 *  Grade OR mark; see the rule above. Matching is exact on both sides, exactly
 *  as the grade filter has always been: the dropdown offers values read back
 *  out of the columns, so an exact compare is what makes an offered option
 *  return its rows.
 *
 *  The grade arm STAYS even though nothing matches it today: it costs one OR
 *  arm, and it is what catches a routing state the day one reappears in the
 *  grade column. Without the mark, though, it is the whole clause and it finds
 *  nobody — so that branch refuses. */
export function cutSignalWhere(value: string, hasMark: boolean): any {
  const byGrade = { grade: value };
  return hasMark ? { OR: [byGrade, { slabMark: value }] } : noMarkNoAnswer("cutSignalWhere");
}

/** Slabs cut in ANY way — the KPI card's and the register's "how much of this
 *  stock has been cut". CTS and SAMPLE together, from either signal. Without
 *  the mark this would count 0 of the 61 cut slabs on the floor, so it refuses
 *  instead — the KPI card shows "?" rather than a confident zero. */
export function anyCutWhere(hasMark: boolean): any {
  const byGrade = { grade: { in: [...CUT_GRADES] } };
  return hasMark ? { OR: [byGrade, { slabMark: { in: [...CUT_MARKS] } }] } : noMarkNoAnswer("anyCutWhere");
}

/** Slabs still whole — the exact complement of anyCutWhere, which is the same
 *  set dispatch will still let out as a full slab (grading.ts slabBlocksDispatch
 *  ORs the two signals the same way).
 *
 *  THIS IS THE CLAUSE THAT LOADS A LORRY. `?mark=FULL_SLAB` is a list of stock
 *  somebody may sell whole; a cut slab appearing on it is the failure the whole
 *  mark column exists to prevent. Without the mark the notCutGrade arm alone
 *  calls all 61 already-cut slabs whole (they read grade 'B' since scripts/0072),
 *  so that branch refuses rather than answering.
 *
 *  The `grade: null` arm is load-bearing: 1,311 slabs on the floor have no grade
 *  and would vanish from this filter under a bare notIn — in SQL, NULL NOT IN
 *  ('CTS','SAMPLE') is NULL, so an ungraded slab would be neither cut nor whole. */
export function wholeSlabWhere(hasMark: boolean): any {
  const notCutGrade = { OR: [{ grade: null }, { grade: { notIn: [...CUT_GRADES] } }] };
  return hasMark ? { AND: [notCutGrade, { slabMark: { notIn: [...CUT_MARKS] } }] } : noMarkNoAnswer("wholeSlabWhere");
}

export async function buildInventoryWhere(searchParams: URLSearchParams): Promise<any> {
  const q = (k: string) => (searchParams.get(k) ?? "").trim();
  const where: any = {};
  // Clauses that cannot be one top-level key because they span two columns
  // (grade OR mark). Merged through andWhere at the bottom so they cannot
  // clobber the design filter's `where.AND`.
  const extraAnd: any[] = [];
  if (q("design")) {
    // Search by the CANONICAL (displayed) name: a term matches a slab when the
    // name it is SHOWN under contains the term. A raw variant that was merged
    // away (e.g. "Arva White Trial" -> "Trial") no longer matches its old text.
    const term = q("design");
    const aliases: any[] = await db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []);
    const hit = (v: string) => v.toLowerCase().includes(term.toLowerCase());
    const matchingVariants = aliases.filter((a) => hit(a.canonical)).map((a) => a.variant);
    const nonMatchingVariants = aliases.filter((a) => !hit(a.canonical)).map((a) => a.variant);
    where.AND = [
      {
        OR: [
          { design: { contains: term, mode: "insensitive" } },
          ...(matchingVariants.length ? [{ design: { in: matchingVariants, mode: "insensitive" } }] : []),
        ],
      },
      ...(nonMatchingVariants.length ? [{ design: { notIn: nonMatchingVariants, mode: "insensitive" } }] : []),
    ];
  }
  if (q("batch")) where.batchKey = normalizeBatch(q("batch"));
  // NONE asks for rows where the column is NULL — 922 slabs have no grade and 3,525 no
  // bay, and there was previously no way to filter for either. Empty string still means
  // "any", so this cannot be reached by leaving a filter blank. No row currently holds
  // the literal "__none__", though nothing on the write side rejects it: the slab edit
  // route takes free text for grade, bay and thickness.
  if (q("thickness")) where.slabThickness = q("thickness") === NONE ? null : q("thickness");
  // GRADE — and, for the two CUT values only, the mark as well.
  //
  // `?grade=CTS` has to keep meaning what the person clicking it means: "show
  // me the slabs that have been cut." That fact now lives in the MARK and only
  // in the mark — scripts/0071 and 0072 regraded all 63 legacy rows to 'B', so
  // asking the grade alone returns NOTHING, not half. A filter that silently
  // under-returns is the failure this whole change is guarding against, and one
  // that returns nothing at all is the same failure at full size, so the cut
  // values fan out to `grade = X OR mark = X` and refuse when the mark is
  // unreadable (cutSignalWhere).
  //
  // Every other grade (A, A2, B, C, Trial, Printing) is untouched and stays an
  // exact match on the grade column: those are quality verdicts, the mark
  // knows nothing about them, and a slab graded A that fabrication later cut
  // is still — correctly — a grade A slab in this filter.
  if (q("grade")) {
    const raw = q("grade");
    const cut = raw === NONE ? null : cutValueOf(raw);
    if (cut) extraAnd.push(cutSignalWhere(cut, await slabMarkAvailable()));
    else where.grade = raw === NONE ? null : raw;
  }
  // MARK — what became of the physical slab, beside how good the stone is:
  // FULL_SLAB / CTS / SAMPLE (src/lib/fab/slabMark.ts). New filter, and the one
  // that keeps a cut slab findable once the grade stops saying so.
  //
  // Parsed through parseSlabMark, so "cts" and "full slab" read as the person
  // meant them and anything outside the three states is NOT guessed at — it
  // applies no filter, the same way an unknown `source` value does above,
  // rather than 500ing or silently returning nothing.
  //
  // CTS/SAMPLE OR the grade, for the reason spelt out at the top of this file.
  // FULL_SLAB is the exact complement — not merely `mark = FULL_SLAB`, because
  // an un-backfilled row can read FULL_SLAB while its grade says CTS, and
  // listing that slab as whole is how an already-cut slab gets onto a lorry.
  //
  // Both branches now THROW when the mark cannot be read, so this filter can
  // 500 where it used to answer. That is deliberate: the grade arm alone would
  // call all 61 cut slabs whole (see noMarkNoAnswer). An unparseable value is
  // still not a filter at all rather than an error — that is a typo, not a
  // failure to read the column.
  if (q("mark")) {
    const mark = parseSlabMark(q("mark"));
    if (mark) {
      const hasMark = await slabMarkAvailable();
      extraAnd.push(mark === "FULL_SLAB" ? wholeSlabWhere(hasMark) : cutSignalWhere(mark, hasMark));
    }
  }
  if (q("bay")) where.bayNumber = q("bay") === NONE ? null : { contains: q("bay"), mode: "insensitive" };
  if (q("status")) where.status = q("status");
  // PI is exact: it is picked from values already in the column. Customer is NOT exact —
  // see below. Neither field is new information: the slab list API applies no `select`,
  // so both are already on every row it returns.
  if (q("pi")) where.reservedForPi = q("pi") === NONE ? null : q("pi");
  if (q("customer")) {
    const term = q("customer");
    if (term === NONE) where.customer = null;
    else {
      // Match every spelling that folds to the same customer, not the raw string — see
      // customerKey. Same shape as the design clause above, which resolves variants
      // through DesignAlias for exactly this reason.
      const rows: any[] = await db.finishedSlab
        .findMany({ distinct: ["customer"], select: { customer: true }, where: { customer: { not: null } } })
        .catch(() => []);
      const key = customerKey(term);
      const spellings = rows
        .map((r) => r.customer)
        .filter((c: unknown): c is string => typeof c === "string" && customerKey(c) === key);
      // `in` whenever anything folds to this key -- NOT only when several do. The option
      // label is cleaned for display, so it is not necessarily an exact column value; a
      // customer stored once as "Heda Granites," would match nothing on an exact compare.
      where.customer = spellings.length ? { in: spellings } : term;
    }
  }
  // Where the row CAME FROM — the QC autolink, the bulk upload, or the intake
  // form's hand entry. `source` is a Prisma ENUM column, so an unknown value
  // does not match nothing the way a free-text filter would — Prisma refuses
  // it and the route answers 500. The dropdown only offers these three, but
  // the HTTP surface takes anything; a value off the list means no filter.
  if (["QC_AUTOLINK", "BULK_UPLOAD", "MANUAL_ENTRY"].includes(q("source"))) where.source = q("source");
  if (q("rw") === "1") where.rwStatus = "RW Required and ongoing";
  if (q("slab")) {
    const n = Number(q("slab"));
    if (Number.isFinite(n)) where.slabNumber = n;
    else where.barcode = { contains: q("slab"), mode: "insensitive" }; // non-numeric -> barcode search
  }
  return extraAnd.length ? andWhere(where, ...extraAnd) : where;
}

/**
 * Slab numbers of UNAPPROVED (pending or master-hidden) stock. Approval is
 * decided per (canonical design, display batch); this resolves it back to the
 * raw rows. Small result in practice (only new/unticked stock).
 */
export async function getUnapprovedSlabNumbers(strict = false): Promise<number[]> {
  try {
    const [combos, aliases, approved, hiddenRows] = await Promise.all([
      db.$queryRaw`SELECT DISTINCT design, batch_number AS batch FROM fg_finished_slab`,
      db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []),
      db.$queryRaw`SELECT design, batch FROM fg_sales_approved_batch`,
      db.$queryRaw`SELECT design FROM fg_sales_hidden_design WHERE batch = ''`,
    ]);
    const amap = new Map<string, string>((aliases as any[]).map((x) => [x.variant, x.canonical]));
    // The key is built in ONE place (lib/inventory/approvalKey), because the
    // slab intake form writes approvals against it: two derivations meant the
    // form could store a row this lookup never checks.
    const ok = new Set<string>((approved as any[]).map((a) => approvalKeyString({ design: a.design, batch: a.batch })));
    const hidden = new Set<string>((hiddenRows as any[]).map((h) => h.design));
    const pendingPairs: { design: string | null; batch: string | null }[] = [];
    for (const c of combos as any[]) {
      const canon = amap.get(c.design ?? NO_DESIGN) ?? (c.design ?? NO_DESIGN);
      const key = approvalKey(canon, c.batch);
      if (hidden.has(key.design) || !ok.has(approvalKeyString(key))) pendingPairs.push({ design: c.design ?? null, batch: c.batch ?? null });
    }
    if (!pendingPairs.length) return [];
    const rows: any[] = await db.finishedSlab.findMany({
      where: { OR: pendingPairs.map((p) => ({ design: p.design, batchNumber: p.batch })) },
      select: { slabNumber: true },
    });
    return rows.map((r) => r.slabNumber);
  } catch (e) {
    if (strict) throw e; // WRITE routes must fail CLOSED
    return [];           // read views degrade to showing approved-known state
  }
}

/** Wrap a where clause so unapproved stock is excluded (approved-only view).
 *
 *  `strict` decides what a failed approval read means. Default (false): the
 *  view degrades to approved-known state — right for inventoryGate audiences,
 *  who may see pending stock anyway. A SALES-facing caller must pass true: for
 *  that audience "could not read the approval list" has to fail CLOSED (throw,
 *  route answers 500), because degrading OPEN would show unapproved and
 *  admin-hidden stock to exactly the audience approval exists to shield. */
export async function approvedOnlyWhere(where: any, opts?: { strict?: boolean; pending?: number[] }): Promise<any> {
  // `pending` lets a caller that already fetched the list reuse it. The slab
  // list does: it counts what the gate is about to withhold so the screen can
  // SAY so, and fetching the list twice for one request would be two heavy
  // reads for one answer.
  const pending = opts?.pending ?? await getUnapprovedSlabNumbers(opts?.strict ?? false);
  if (!pending.length) return where;
  // preserve top-level keys (status etc.) — some callers read them back
  const prevAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  return { ...where, AND: [...prevAnd, { slabNumber: { notIn: pending } }] };
}
