// Stock summary (register layout): per design -> one row per thickness+batch,
// with bay-wise stock (Bay 5/4/3), grade split, dispatched count and pending
// polish / R&W. Design names are alias-aware. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { summaryGate, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { slabMarkAvailable, isMissingSlabMarkError } from "@/lib/inventory/searchWhere";
import { displayBatch } from "@/lib/batchDisplay";
import { CUT_GRADES, CUT_MARKS } from "@/lib/inventory/grading";
import { SLAB_STATUSES } from "@/lib/inventory/intakeRules";
import { parseSlabMark } from "@/lib/fab/slabMark";
import { NONE } from "@/lib/inventory/filterValues";

const db = prisma as any;
const KEYS = ["total","dispatched","bay5","bay4","bay3","nobay","a","a2","b","c","cts","printing","trial","ungraded","cut","pending_polish","pending_rw"];

// ═════════════ THE FOUR ADMIN-ONLY REGISTER FILTERS (owner, 2026-09-03) ══════
//
// "This i ment all the new filters you'll be addin in stock by design should be
// only visible and accessable for admin view" — source, status, bay and mark.
// VISIBLE **AND** ACCESSIBLE, so hiding the four selects from a non-admin is
// only half of it: anyone can type a query string, and a hidden control is not
// an access control. The gate is here, on the server, and it reads the role off
// the session (summaryGate's user) and never off anything the caller sent.
//
// AN UNAUTHORISED PARAMETER IS REFUSED, NOT IGNORED — 403, naming the
// parameters. The opposite choice is defensible for `pending`, a few lines
// down, and this route makes BOTH choices on purpose, because the two kinds of
// parameter fail in opposite directions:
//
//   * `pending=1` WIDENS the answer (it folds in unapproved stock). Ignoring it
//     for a non-admin hands back LESS than was asked for, which is the safe
//     direction: the caller sees approved stock only, which is exactly what
//     they are entitled to and exactly what the screen claims to show.
//   * source / status / bay / mark NARROW the answer. Ignoring one hands back
//     MORE than was asked for — the whole yard under a heading that says "Bay 4
//     only", or every slab in the plant under one that says "cut". That is the
//     same class of confident wrong answer as `mark=FULL_SLAB` listing 61 cut
//     slabs as whole stock, and this file refuses it for the same reason.
//
// A refusal costs a non-admin an error on a filter they were never shown. The
// alternative costs somebody a register they believe is filtered and is not.
const ADMIN_ONLY_FILTERS = ["source", "status", "bay", "mark"] as const;

/** The SlabSource enum, as buildInventoryWhere spells it. Hand copy for the
 *  same reason SLAB_STATUSES is one: this list only has to name the values, and
 *  a wrong one is refused below rather than reaching Postgres, where comparing
 *  an enum column against a bogus string is an error and not an empty result. */
const SOURCES = ["QC_AUTOLINK", "BULK_UPLOAD", "MANUAL_ENTRY"] as const;

type Refusal = { error: string; status: number };
type Filter = { sql: string; params: unknown[] };
const isRefusal = (x: Filter | Refusal): x is Refusal => "error" in x;

// ══════════════════ WHAT A STATUS FILTER MEANS IN THIS REGISTER ══════════════
//
// Every column this table PRINTS counts stock on the floor — `status <>
// 'DISPATCHED'` — and that is not incidental, it is what lets the grade columns
// add up to the Slabs total (tests/inventorySummaryColumns.test.ts pins it).
// So a status filter here narrows WHICH ON-FLOOR STOCK IS COUNTED, and it is
// applied to the whole query rather than to any one column: the grade partition
// survives because it partitions whatever set it is given. Measured on live
// Neon 2026-09-03 under `?status=CHROMIA`: 21 register rows, Slabs 62, and
// A+A2+B+C+CTS+Print+Trial+No-Gr. = 62. The row still adds up.
//
// DISPATCHED IS THE ONE STATUS THIS REGISTER CANNOT ANSWER, and it is refused
// rather than served. It is not a permissions question and not a data question
// — it is that `status = 'DISPATCHED'` is the exact complement of the
// `status <> 'DISPATCHED'` every visible column carries, so the answer is a
// full-height table of dashes with a real Slabs total of 0 on every row. The
// only column that would hold a number is `dispatched`, and the register does
// not render it (see the Cells component and the tfoot's NUMS.filter). A table
// of zeros is indistinguishable from "the data did not load", and this codebase
// has already had one incident from a screen that read as empty when it was
// not. So the screen is told why, in a sentence, instead.
const DISPATCHED_REFUSAL =
  "The stock register cannot be filtered to Dispatched: every column it prints counts stock still on the floor " +
  "(status <> 'DISPATCHED'), so the whole table would read zero. Use the Slabs tab with the Dispatched status " +
  "filter to see dispatched slabs.";

/** Build the WHERE for the four admin-only filters, or the refusal that says
 *  why it will not.
 *
 *  EVERY USER VALUE LEAVES AS A `$n` PLACEHOLDER. The register query runs
 *  through $queryRawUnsafe (the `cut` expression has to vary — see the header
 *  below), so a value pasted into the SQL text would be an injection on a route
 *  every office login can reach. Nothing user-supplied is concatenated; the
 *  only strings that reach the SQL are the column names and operators written
 *  here, and the values travel as bound parameters.
 *
 *  NOTHING IN THE ANSWER SAYS WHICH FILTERS WERE APPLIED, and nothing needs to:
 *  this route refuses a filter it cannot honour rather than dropping one, so
 *  what the screen asked for is what the screen got. That is the whole payoff of
 *  refusing over ignoring — the client can compose the "showing: bay 4, cut
 *  only" line above the register from its own state and be right. */
function buildRegisterFilter(sp: URLSearchParams, hasMark: boolean): Filter | Refusal {
  const q = (k: string) => (sp.get(k) ?? "").trim();
  const clauses: string[] = [];
  const params: unknown[] = [];
  const ph = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const source = q("source");
  if (source) {
    if (!(SOURCES as readonly string[]).includes(source))
      return { status: 400, error: `"${source}" is not a slab source — the sources are ${SOURCES.join(", ")}.` };
    // ::text, not a cast of the parameter: `source` is a Postgres ENUM column,
    // and comparing it to a bound text parameter without this is a type error
    // that would 500 the register rather than filtering it.
    clauses.push(`source::text = ${ph(source)}`);
  }

  const status = q("status");
  if (status) {
    if (status === "DISPATCHED") return { status: 400, error: DISPATCHED_REFUSAL };
    // Refused rather than passed through, because an unrecognised status is a
    // typo and `status::text = 'AVAILABE'` is an EMPTY REGISTER — which reads
    // on the screen as "there is no stock", the one sentence this module may
    // never say by accident.
    if (!(SLAB_STATUSES as readonly string[]).includes(status))
      return { status: 400, error: `"${status}" is not a slab status.` };
    clauses.push(`status::text = ${ph(status)}`);
  }

  const bay = q("bay");
  if (bay) {
    // NONE is the shared "this column IS NULL" value (lib/inventory/filterValues),
    // the same one the slab list's bay select offers as "— no bay —". It is worth
    // having here: 6,526 of the 16,648 slabs on the floor have no bay at all
    // (measured on live Neon 2026-09-03; the plant is running, so these counts
    // move by a slab or two through the day), and without this there is no way
    // to ask the register which stock has never been put away.
    if (bay === NONE) clauses.push("bay_number IS NULL");
    // Exact match, and deliberately NOT validated against a list of bays: the
    // column is free text, the option list the screen offers is read back off
    // live rows (/api/inventory/filters), and a bay that holds nothing honestly
    // returns nothing. That is a narrowing that came back empty, not a filter
    // that was silently dropped, so there is nothing here to refuse.
    else clauses.push(`bay_number = ${ph(bay)}`);
  }

  const markRaw = q("mark");
  if (markRaw) {
    const mark = parseSlabMark(markRaw);
    if (!mark) return { status: 400, error: `"${markRaw}" is not a slab mark — the marks are ${CUT_MARKS.join(", ")} and FULL_SLAB.` };
    // NO MARK, NO ANSWER — the same rule, and the same refusal, as
    // searchWhere.ts noMarkNoAnswer, which this filter deliberately mirrors
    // rather than inventing a second one. scripts/0071 and 0072 regraded all 63
    // cut slabs from 'CTS' to 'B', so the grade arm of the OR below matches
    // NOTHING: re-measured on live Neon 2026-09-03, zero rows in
    // fg_finished_slab carry grade 'CTS' or 'SAMPLE', while 61 cut slabs sit on
    // the floor and every one of them is found by the mark alone.
    //
    // So a grade-only fallback here would not be a smaller answer, it would be a
    // wrong one: `?mark=CTS` would report a register with no cut stone in it,
    // and `?mark=FULL_SLAB` — its exact complement — would list all 61 already-
    // cut slabs as whole sellable stock. 503, not a quiet degrade.
    if (!hasMark)
      return {
        status: 503,
        error:
          "The slab mark could not be read, and the grade column no longer carries the cut signal " +
          "(scripts/0071 and 0072 regraded all 63 cut slabs to 'B'). Refusing to filter the register by mark " +
          "rather than reporting a floor with no cut slabs on it.",
      };
    // Built INSIDE the branch that uses them, not above it: `ph` appends to
    // `params`, and a placeholder that no clause references makes Postgres
    // refuse the whole statement ("bind message supplies N parameters, but
    // prepared statement requires M") — a 500 on the register over an unused
    // list.
    if (mark === "FULL_SLAB") {
      const cutGrades = CUT_GRADES.map(ph).join(", ");
      const cutMarks = CUT_MARKS.map(ph).join(", ");
      // The EXACT complement of the cut clause, not merely `slab_mark =
      // 'FULL_SLAB'`. The `grade IS NULL` arm is load-bearing: 1,315 slabs on
      // the floor have no grade (measured 2026-09-03) and in SQL
      // NULL NOT IN ('CTS','SAMPLE') is NULL, so a bare NOT IN would drop every
      // one of them out of "still whole" without a word.
      //
      // RUN AGAINST LIVE NEON WITH THIS EXACT CLAUSE, 2026-09-03: mark=FULL_SLAB
      // 16,587 slabs and mark=CTS 61, summing to 16,648 — the whole floor, with
      // no slab in both and none in neither. The `cut` column reads 61 under the
      // CTS filter and 0 under FULL_SLAB, which is the same statement made twice.
      clauses.push(`((grade IS NULL OR grade NOT IN (${cutGrades})) AND slab_mark NOT IN (${cutMarks}))`);
    } else {
      // Grade OR mark, exactly as cutSignalWhere builds it. The grade arm stays
      // even though it matches nothing today: it costs one OR arm, and it is
      // what catches a routing state the day one reappears in the grade column.
      clauses.push(`(grade = ${ph(mark)} OR slab_mark = ${ph(mark)})`);
    }
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

// ═══════════════ THE CUT COLUMN, AND WHY IT IS NOT A GRADE COLUMN ═══════════
//
// The register's one arithmetic check — the grade columns add up to Slabs — is
// the reason this is a NEW column rather than a widening of `cts`.
//
// A grade column is a PARTITION: every slab on the floor lands in exactly one
// of A / A2 / B / C / CTS / Printing / Trial / Ungraded, which is what lets a
// person add the row across and get the total. That is not a style choice; the
// Trial column silently broke it once already (see the comment on that column
// below and tests/inventorySummaryColumns.test.ts).
//
// The MARK is not a grade and does not partition the same set. From 2026-09-03
// fabrication records a cut in fg_finished_slab.slab_mark and STOPS overwriting
// the grade, so the natural next slab is grade A **and** mark CTS. Widening the
// `cts` column to count it would have counted that slab twice — once under A,
// once under CTS — and the row would stop adding up, for every design with a
// cut slab in it. Moving it out of A into CTS would be worse: it would answer
// "how many grade A slabs do I have" with a number that is short by however
// many of them fabrication happened to take, which is exactly the destruction
// of the polishing verdict this whole change exists to stop.
//
// So the grade columns stay purely about GRADE — untouched, still summing to
// Slabs — and `cut` sits beside them as its own count, deliberately overlapping
// them. It answers a different question: not "how good is this stone" but "how
// much of this stock is no longer a whole slab".
//
// THE TWO NO LONGER AGREE, AND THE PARAGRAPH THAT USED TO SIT HERE IS FALSE.
// It said "TODAY THE TWO AGREE — all 62 slabs whose grade reads CTS (60 on the
// floor, 2 dispatched) are the same 62 the mark calls cut, so `cts` and `cut`
// print the same number per row until the owner starts replacing those grades
// with the real A/B/C verdicts he is collecting by hand". Those verdicts turned
// out to be unrecoverable, so scripts/0071 and 0072 moved all 63 slabs to grade
// 'B' by his decision instead. Re-measured on live Neon 2026-09-03: ZERO rows in
// fg_finished_slab carry grade 'CTS' or 'SAMPLE', so the `cts` column reads 0 on
// every row of the register, while 63 rows carry slab_mark = 'CTS' (61 of them
// on the floor) and `cut` finds all 61. The stale sentence is replaced rather
// than deleted because it is the reason the two columns exist, and a reader who
// finds only "cts is always 0" will delete the column that is doing the work.

/** Cut = grade says so OR mark says so (the same OR as grading.ts
 *  slabBlocksDispatch and searchWhere anyCutWhere).
 *
 *  THE `hasMark = false` BRANCH NOW UNDER-REPORTS TO ZERO, and the old comment
 *  here — "degrades to today's grade-only test, which finds exactly the same
 *  62" — is no longer true: after scripts/0071 and 0072 no row anywhere carries
 *  a cut GRADE (measured on live Neon 2026-09-03), so grade-only finds 0 of the
 *  61 cut slabs on the floor.
 *
 *  It is kept anyway, and that is a narrow, deliberate exception to the
 *  fail-closed rule the mark FILTER above follows. The difference is what each
 *  one is: the filter is a caller asking "show me the cut slabs" and a wrong
 *  answer to that is a list somebody acts on, so it refuses. This is ONE COLUMN
 *  of a register whose other sixteen columns — the whole grade split, the
 *  totals, R/W — do not depend on the mark at all, and throwing here takes the
 *  entire stock register down over it. The register printing a too-low Cut
 *  column is bad; the register not printing is worse, and this route's own
 *  fetchRows comment has said so since it shipped.
 *
 *  IT IS STILL A NUMBER THAT CAN BE WRONG WITHOUT SAYING SO, which is the one
 *  thing this codebase does not tolerate elsewhere (the KPI card answers `null`
 *  and prints "?"; the Sales drill-down prints "?" per row). Fixing it properly
 *  means the count travelling as null through normalizeRow, sumRows and the
 *  grand total in StockByDesign — a change to the register's aggregation that
 *  belongs on its own, not folded into the filter work. Recorded here so the
 *  next reader finds it. */
const cutExpr = (hasMark: boolean) =>
  hasMark ? "(grade IN ('CTS','SAMPLE') OR slab_mark IN ('CTS','SAMPLE'))" : "grade IN ('CTS','SAMPLE')";

export async function GET(request: Request) {
  const g = await summaryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) return Response.json({ error: "Not available for this login" }, { status: 403 });
  // WHO IS ASKING — off the session, never off the request. The client passes
  // `canApprove` down to the register to decide whether to DRAW the four
  // selects; this is what decides whether to HONOUR them, and the two are
  // deliberately not the same fact. See ADMIN_ONLY_FILTERS at the top.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isAdm = String((g.user as any)?.role ?? "") === "ADMIN";
  const sp = new URL(request.url).searchParams;
  if (!isAdm) {
    const sent = ADMIN_ONLY_FILTERS.filter((k) => (sp.get(k) ?? "").trim() !== "");
    if (sent.length)
      return Response.json(
        { error: `The ${sent.join(", ")} filter${sent.length > 1 ? "s are" : " is"} available to Admin only.` },
        { status: 403 },
      );
  }
  try {
    // $queryRawUnsafe, and STILL nothing user-supplied is concatenated into it.
    // Two things now vary: `cut`, chosen by cutExpr() from two string literals a
    // few lines up, and `where`, whose text is built entirely from the column
    // names and operators written in buildRegisterFilter — every value the
    // caller sent travels as a bound `$n` parameter alongside it. It is a raw
    // string only because the register has to run in BOTH deploy orders — the
    // tagged template cannot vary its own text, and the alternative was two
    // copies of a 25-line query drifting apart.
    const filter = buildRegisterFilter(sp, await slabMarkAvailable());
    if (isRefusal(filter)) return Response.json({ error: filter.error }, { status: filter.status });
    const registerSql = (cut: string) => `
        SELECT coalesce(design, '(no design)') AS design,
               coalesce(slab_thickness, '-')   AS thickness,
               coalesce(batch_number, '-')     AS batch,
               count(*) FILTER (WHERE status <> 'DISPATCHED')::int AS total,
               count(*) FILTER (WHERE status = 'DISPATCHED')::int  AS dispatched,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND bay_number = 'Bay 5')::int AS bay5,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND bay_number = 'Bay 4')::int AS bay4,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND bay_number = 'Bay 3')::int AS bay3,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND (bay_number IS NULL OR bay_number NOT IN ('Bay 5','Bay 4','Bay 3')))::int AS nobay,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND grade = 'A')::int        AS a,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND grade = 'A2')::int       AS a2,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND grade = 'B')::int        AS b,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND grade = 'C')::int        AS c,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND grade = 'CTS')::int      AS cts,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND grade = 'Printing')::int AS printing,
               -- 'status <> DISPATCHED' like every other grade column. Without it the
               -- Trial count included slabs that had already left the yard, so a design
               -- whose trials were all dispatched showed Trial = 6 against Slabs = 0 and
               -- the grade columns did not add up to the Slabs total — the one arithmetic
               -- check the register exists to let you do by eye.
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND grade = 'Trial')::int   AS trial,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND grade IS NULL)::int      AS ungraded,
               -- Cut slabs, from EITHER signal. Deliberately overlaps the grade
               -- columns instead of joining their sum -- see the header. Same
               -- 'status <> DISPATCHED' as the rest so it is read against the
               -- same Slabs total they are.
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND ${cut})::int             AS cut,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND repolish_status = 'Repolish Required')::int AS pending_polish,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND rw_status = 'RW Required and ongoing')::int AS pending_rw
        FROM fg_finished_slab
        ${filter.sql}
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3`;

    // ONE `WHERE`, ON THE WHOLE QUERY, AND NOT ON ANY ONE COLUMN — this is what
    // keeps the register adding up under a filter. Every count above is a
    // FILTER over the same rows, so narrowing the rows narrows all seventeen
    // together and the grade split still partitions exactly the set the Slabs
    // total counts. Pushing a filter into individual FILTER clauses instead
    // would give a table whose columns answered different questions, which is
    // the shape of the bug this register has already had once (a Cut card of 61
    // sitting inside a grade block whose B card held the same 61 slabs).
    // Verified against live Neon 2026-09-03 with ?status=CHROMIA: 21 rows,
    // Slabs 62, grade columns 62.
    //
    // The register must not go dark over a column that has not shipped. The
    // probe answers first; the catch covers the window where the migration (or
    // a client regeneration) lands between the probe and this query, and
    // re-runs the identical query with the grade-only test — which now
    // UNDER-REPORTS the Cut column to zero rather than reproducing yesterday's
    // answer (see cutExpr, where that trade-off is argued). The `?mark=` FILTER
    // does not take that trade: buildRegisterFilter has already refused with a
    // 503 above if the mark could not be read, so no row reaching here was
    // selected by an unreadable column. Anything that is NOT a missing
    // slab_mark is rethrown to the 500 below, because "the register is empty"
    // must never be this route's answer to a database that is actually down.
    const fetchRows = async (): Promise<any[]> => {
      const hasMark = await slabMarkAvailable();
      if (!hasMark) return db.$queryRawUnsafe(registerSql(cutExpr(false)), ...filter.params);
      try {
        return await db.$queryRawUnsafe(registerSql(cutExpr(true)), ...filter.params);
      } catch (e: any) {
        if (!isMissingSlabMarkError(e)) throw e;
        return db.$queryRawUnsafe(registerSql(cutExpr(false)), ...filter.params);
      }
    };

    // ═══ A FAILED APPROVAL LOOKUP IS NOT A YARD WITH NOTHING APPROVED IN IT ═══
    //
    // All three of these reads used to end `.catch(() => [])`, and what they
    // degraded into is the exact empty-shelf reading this route's client was
    // just fixed to stop showing. Trace it: an empty `approvedSet` makes
    // `approved` false on every row and `pending` true on every row, and the
    // `!showPending` filter a few lines down then returns [] — WITH HTTP 200.
    // StockByDesign's new banner fires on `!r.ok` only, so a 200 carrying []
    // renders as "No stock matches." on the screen Sales quotes from. Replacing
    // `r.ok ? r.json() : []` there bought nothing while this could hand back a
    // clean, confident, empty plant.
    //
    // Two live tables sit behind it — measured on live Neon 2026-09-03: 1,606
    // rows in fg_sales_approved_batch, 2 in fg_sales_hidden_design — and the
    // ADMIN path is no better off than the Sales one: with `pending` true
    // everywhere, the approval strip would offer all 2,134 register lines as new
    // stock awaiting approval, against the 83 that really are.
    //
    // The alias read joins them, and not merely for tidy names: the approval key
    // is built from the CANONICAL design (lib/inventory/approvalKey), so losing
    // the 287 aliases looks up the wrong key for every merged-away variant and
    // marks that stock pending too. On this route the aliases are half the key.
    //
    // So the group fails together and says so. 503 rather than the outer 500:
    // this is a read that did not land, not a register that is broken, and the
    // sentence is what the banner prints.
    let approvalReadFailed = false;
    const noteFail = () => { approvalReadFailed = true; return [] as any[]; };
    const [rows, aliases, hiddenRows, approvedRows] = await Promise.all([
      fetchRows(),
      db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(noteFail),
      db.$queryRaw`SELECT design FROM fg_sales_hidden_design WHERE batch = ''`.catch(noteFail) as Promise<any[]>,
      db.$queryRaw`SELECT design, batch FROM fg_sales_approved_batch`.catch(noteFail) as Promise<any[]>,
    ]);
    if (approvalReadFailed)
      return Response.json(
        {
          error:
            "the Sales approval list could not be read, so the register cannot say which stock is approved — " +
            "showing nothing would read as an empty yard and showing everything would expose stock Sales has " +
            "not approved, so the register is not being served",
        },
        { status: 503 },
      );
    const hidden = new Set<string>((hiddenRows as any[]).map((h) => h.design));
    const approvedSet = new Set<string>((approvedRows as any[]).map((a) => `${a.design}\u0000${a.batch}`));
    const alias = new Map<string, string>(aliases.map((x: any) => [x.variant, x.canonical]));
    const merged = new Map<string, any>();
    for (const r of rows) {
      const design = alias.get(r.design) ?? r.design;
      const batch = r.batch === "-" ? r.batch : displayBatch(r.batch);
      const key = [design, r.thickness, batch].join(" ");
      const m = merged.get(key);
      if (!m) merged.set(key, { ...r, design, batch });
      else for (const k of KEYS) m[k] += r[k];
    }
    let out = [...merged.values()];
    out = out.map((r) => {
      const designApproved = !hidden.has(r.design);
      const batchApproved = approvedSet.has(`${r.design}\u0000${r.batch}`);
      return {
        ...r,
        designApproved,
        approved: designApproved && batchApproved,      // visible to Sales
        pending: designApproved && !batchApproved,      // new stock awaiting admin approval
      };
    });
    // Unapproved stock is ADMIN-only, and only when the pending toggle is on.
    // `isAdm` and `sp` are the ones resolved at the top of the handler — the
    // same role for the same request, so the pending toggle and the four
    // admin-only filters cannot disagree about who is asking.
    const showPending = isAdm && sp.get("pending") === "1";
    if (!showPending) out = out.filter((r) => r.approved);
    return Response.json(out);
  } catch (e) {
    console.error("Inventory summary error:", e);
    return Response.json([], { status: 500 });
  }
}
