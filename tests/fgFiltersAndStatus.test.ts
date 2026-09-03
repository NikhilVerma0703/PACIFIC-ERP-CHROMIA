import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SLAB_STATUSES,
  SLAB_STATUS_OPTIONS,
  statusesFromTransitions,
  validateSlabDetails,
  type SlabDetailsInput,
} from "../src/lib/inventory/intakeRules.ts";

// ═══════════ THE FINISHED-GOODS FILTER ROW, AND THE WORD CTS LEAVING IT ══════
//
// TWO CHANGES, ONE FILE OF GUARDS.
//
// C1. The stock register (StockByDesign + /api/inventory/summary) grew four
// filters — source, status, bay, mark — and all four are ADMIN-ONLY on the
// owner's instruction: "all the new filters you'll be addin in stock by design
// should be only visible and accessable for admin view". Visible AND accessible,
// so hiding the selects is not enough; the route has to refuse the parameters
// for anyone else, because a query string can be typed.
//
// C2. The status dropdowns stopped OFFERING CTS. Measured on live Neon
// 2026-09-03: fg_finished_slab.status reads AVAILABLE 16,585 · DISPATCHED 6,742
// · CHROMIA 62 · CTS 1 (slab 154757, Arva White, grade B, mark CTS), while
// slab_mark = 'CTS' reads 63 rows, 61 of them on the floor. A status filter
// offering CTS answers "what has been cut" with 1 slab and hides 60. But the one
// row must stay WRITEABLE and FINDABLE, so nothing that validates or stores the
// value lost it — only the lists that offer it from a standing start.
//
// STRUCTURAL FOR THE ROUTE AND THE COMPONENT, behavioural for intakeRules.
// intakeRules imports only grading.ts (with the explicit .ts extension) so
// node --test reaches it directly; the route imports @/lib/prisma and the
// component is a "use client" TSX file, and neither resolves under node's test
// runner — the same reason tests/inventoryMarkFilter.test.ts and
// tests/inventorySummaryColumns.test.ts read their subjects as text. Every
// failure guarded below is a number quietly being the wrong number, or a control
// quietly not being a control, rather than anything throwing.

// Newlines normalised on the way in. These files are checked out with CRLF on
// the plant's Windows boxes, and a guard written against "\n" here passes
// vacuously there — which is the one thing a structural test must never do.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const summary = read("../src/app/api/inventory/summary/route.ts");
const register = read("../src/components/inventory/StockByDesign.tsx");
const dashboard = read("../src/components/inventory/InventoryDashboard.tsx");
const intakeForm = read("../src/app/slab-intake/SlabIntakeForm.tsx");
// The mark-option list the register's select is drawn from, and the SECOND
// finished-goods screen that offered CTS as a status — see the round-2 block at
// the bottom of this file.
const filters = read("../src/app/api/inventory/filters/route.ts");
const qcSlabs = read("../src/app/office/batch-lookup/QcSlabsTable.tsx");

const details = (over: Partial<SlabDetailsInput> = {}): SlabDetailsInput => ({
  design: "Arva White", grade: "B", slabThickness: "2 cm", qualityIssue: [],
  polishType: null, rwStatus: null, repolishStatus: null, batchNumber: "1413",
  lengthIn: 137, widthIn: 79, bayNumber: null, frameNumber: null,
  status: "AVAILABLE", notes: null, ...over,
});

// ══════════════════════════ C2 — OFFERED vs ALLOWED ═════════════════════════

test("the picker list and the validator list are two different lists now", () => {
  // One constant used to do both jobs. Splitting them is what makes it possible
  // to stop offering a status without making it unwritable.
  assert.ok((SLAB_STATUSES as readonly string[]).includes("CTS"), "the validator must still accept CTS");
  assert.ok(!(SLAB_STATUS_OPTIONS as readonly string[]).includes("CTS"), "the picker must not offer CTS");
  // CHROMIA's rule is unchanged and has simply moved into the same list.
  assert.ok((SLAB_STATUSES as readonly string[]).includes("CHROMIA"));
  assert.ok(!(SLAB_STATUS_OPTIONS as readonly string[]).includes("CHROMIA"));
  // Offered is a SUBSET of allowed. A picker that could offer a value the API
  // refuses is a form that fails on save for a value it suggested.
  for (const s of SLAB_STATUS_OPTIONS) assert.ok((SLAB_STATUSES as readonly string[]).includes(s), `${s} is offered but not allowed`);
  assert.deepEqual([...SLAB_STATUS_OPTIONS], ["AVAILABLE", "RESERVED", "PACKED", "DISPATCHED", "RETURNED"]);
});

test("slab 154757 stays saveable — a status that is not offered is still accepted", () => {
  // The live row: status CTS, grade B, mark CTS. Correcting its bay must not be
  // refused over a status nobody touched.
  assert.equal(validateSlabDetails(details({ status: "CTS" })), null);
  assert.equal(validateSlabDetails(details({ status: "CHROMIA" })), null);
  // And the validator has not gone soft in the process.
  assert.match(validateSlabDetails(details({ status: "SOLD" })) ?? "", /not a slab status/);
});

test("the lifecycle drift guard still passes over the UNSPLIT list", () => {
  // grading.ts TRANSITIONS still moves slabs into and out of CTS (the `cts` and
  // `uncts` actions), so the set it knows must keep matching SLAB_STATUSES —
  // never SLAB_STATUS_OPTIONS. Comparing the wrong one is how "not offered"
  // quietly becomes "not allowed".
  assert.deepEqual([...SLAB_STATUSES].sort(), statusesFromTransitions());
  assert.ok(statusesFromTransitions().includes("CTS"), "the lifecycle still moves slabs into CTS");
});

test("the intake form re-adds a non-offered status when it IS the current one", () => {
  // Without this the select renders blank for slab 154757 and the box reads as
  // unset over a row that is set.
  const block = intakeForm.slice(intakeForm.indexOf("{SLAB_STATUSES"), intakeForm.indexOf("</select>", intakeForm.indexOf("{SLAB_STATUSES")));
  assert.ok(block.includes("SLAB_STATUS_OPTIONS"), "the form must build its options from the picker list");
  assert.match(block, /current\?\.status === s/, "the form must keep the current status as an option");
});

test("the dashboard status filter no longer offers CTS, and keeps every other lifecycle state", () => {
  const line = dashboard.split("\n").find((l) => l.startsWith("const STATUSES = ")) ?? "";
  assert.ok(line, "the STATUSES constant moved or was renamed");
  assert.ok(!/["']CTS["']/.test(line), "CTS is still offered in the slab table's status filter");
  // Zero-row states stay: they are real lifecycle destinations the ACTIONS list
  // can move slabs into, and a status you can apply but not filter for is the
  // same bug the other way round.
  for (const s of ["AVAILABLE", "RESERVED", "PACKED", "DISPATCHED", "RETURNED", "CHROMIA"])
    assert.ok(line.includes(`"${s}"`), `${s} disappeared from the status filter`);
});

test("a status the filter no longer offers is still rendered when something selects it", () => {
  // The "CTS status (legacy)" KPI card sets status: "CTS". A select whose value
  // is absent from its options renders blank — the box would read "Any status"
  // over a table that IS filtered, which is the lie this guard exists to stop.
  // Same guard the grade, thickness and mark selects have always carried.
  assert.match(
    dashboard,
    /f\.status && !STATUSES\.includes\(f\.status\) \? \[\.\.\.STATUSES, f\.status\] : STATUSES/,
    "the status select lost its not-in-the-list guard",
  );
});

test("the legacy CTS-status card hides at zero and still names itself legacy", () => {
  // It is the only door left to a status='CTS' row (the word is not in the
  // dropdown any more) so it must not be deleted; and it must not sit at a
  // permanent 0 under the word CTS once the last row is released, which is a
  // place for the eye to check for cut stone and find none.
  assert.match(dashboard, /kpi\.ctsStatus > 0 && card\(/, "the CTS-status card no longer hides itself at zero");
  assert.match(dashboard, /card\("CTS status \(legacy\)"/, "the CTS-status card is not named as legacy");
});

// ═══════════════════ C1 — ADMIN-ONLY, ON THE SERVER, NOT THE SCREEN ═════════

test("the four register filters are refused by the route for a non-admin", () => {
  assert.match(summary, /ADMIN_ONLY_FILTERS = \["source", "status", "bay", "mark"\]/, "the admin-only list moved or changed");
  // The role comes off the gate's session user. If this ever reads a query
  // parameter or a request header instead, the gate is decoration.
  const gate = summary.slice(summary.indexOf("export async function GET"), summary.indexOf("try {"));
  assert.match(gate, /const isAdm = String\(\(g\.user as any\)\?\.role \?\? ""\) === "ADMIN"/, "the admin check no longer reads the session");
  // Refused, NOT ignored: an ignored narrowing filter answers with MORE stock
  // than was asked for, under a heading that claims otherwise. The block runs
  // from the admin test to its own 403 and nothing else may sit between them.
  const refuse = gate.slice(gate.indexOf("if (!isAdm)"));
  assert.ok(refuse.length > 0, "the non-admin branch is gone");
  assert.match(refuse, /ADMIN_ONLY_FILTERS\.filter/, "the 403 must be driven by the admin-only list");
  assert.match(refuse, /status: 403/, "an unauthorised filter must be refused, not ignored");
});

test("the register's mark filter fails closed, exactly as searchWhere does", () => {
  const fn = summary.slice(summary.indexOf("function buildRegisterFilter"), summary.indexOf("\n}", summary.indexOf("function buildRegisterFilter")));
  const mark = fn.slice(fn.indexOf('q("mark")'));
  // No mark, no answer. scripts/0071 and 0072 regraded all 63 cut slabs to 'B',
  // so a grade-only fallback finds 0 of the 61 cut slabs on the floor — and its
  // complement, mark=FULL_SLAB, would hand back all 61 as whole sellable stock.
  assert.match(mark, /if \(!hasMark\)/, "the mark filter no longer checks whether the column is readable");
  assert.match(mark, /status: 503/, "the mark filter must refuse rather than fall back to the grade");
  assert.ok(!/hasMark \?/.test(mark), "the mark filter must not have a grade-only branch");
  // Both signals are still asked when the column IS readable — the grade arm is
  // what catches a routing state the day one reappears in the grade column.
  assert.match(mark, /grade = \$\{ph\(mark\)\} OR slab_mark = \$\{ph\(mark\)\}/);
  // FULL_SLAB is the exact complement, and the NULL arm is load-bearing: 1,315
  // slabs on the floor have no grade and `NULL NOT IN (...)` is NULL in SQL.
  assert.match(mark, /grade IS NULL OR grade NOT IN/);
  assert.match(mark, /slab_mark NOT IN/);
});

test("the register cannot be filtered to Dispatched, and says why", () => {
  // Every column the register prints counts `status <> 'DISPATCHED'`, so this
  // one value empties the whole visible table — and a table of zeros is
  // indistinguishable from a table that did not load.
  assert.match(summary, /if \(status === "DISPATCHED"\) return \{ status: 400, error: DISPATCHED_REFUSAL \}/);
  assert.match(summary, /const DISPATCHED_REFUSAL =/);
  // And it is not offered on the screen either.
  assert.match(dashboard, /const REGISTER_STATUSES = STATUSES\.filter\(\(s\) => s !== "" && s !== "DISPATCHED"\)/);
});

test("no caller value is concatenated into the register's raw SQL", () => {
  // The query runs through $queryRawUnsafe because the `cut` expression has to
  // vary, and this route is reachable by every office login. Every value the
  // caller sent must leave buildRegisterFilter as a bound $n placeholder.
  const fn = summary.slice(summary.indexOf("function buildRegisterFilter"), summary.indexOf("\n}", summary.indexOf("function buildRegisterFilter")));
  assert.ok(fn.includes("params.push(v); return `$${params.length}`;"), "the placeholder helper moved or stopped binding");
  // Only the SQL fragments matter — the refusal SENTENCES quote the caller's
  // value on purpose ("\"AVAILABE\" is not a slab status"), and those never
  // reach the database.
  const clauses = [...fn.matchAll(/clauses\.push\(([\s\S]*?)\);\n/g)].map((m) => m[1]);
  assert.ok(clauses.length >= 5, `only ${clauses.length} clauses parsed — the guard below would be vacuous`);
  for (const c of clauses) {
    for (const raw of ["source", "status", "bay", "mark", "markRaw"])
      assert.ok(!c.includes("${" + raw + "}"), `a clause interpolates the caller's ${raw} straight into SQL: ${c}`);
    // Anything that IS interpolated must come from ph() — directly, or through
    // the two lists built from it a few lines up.
    for (const m of c.matchAll(/\$\{([^}]*)\}/g))
      assert.match(m[1], /^ph\(|^cutGrades$|^cutMarks$/, `a clause interpolates something that is not a bound parameter: ${m[1]}`);
  }
  // …and the params reach the query.
  assert.match(summary, /\$queryRawUnsafe\(registerSql\(cutExpr\(true\)\), \.\.\.filter\.params\)/);
  assert.match(summary, /\$queryRawUnsafe\(registerSql\(cutExpr\(false\)\), \.\.\.filter\.params\)/);
});

test("the filter is ONE where on the whole query, so the row still adds up", () => {
  // The register's one arithmetic check is that the grade columns sum to Slabs.
  // That survives a filter only because the filter narrows the ROWS every
  // count(*) FILTER sees, rather than being pushed into some of those clauses
  // and not others. Verified on live Neon 2026-09-03 with ?status=CHROMIA: 21
  // rows, Slabs 62, A+A2+B+C+CTS+Print+Trial+No-Gr. 62.
  const sql = summary.slice(summary.indexOf("const registerSql = (cut: string)"), summary.indexOf("ORDER BY 1, 2, 3"));
  assert.equal((sql.match(/\$\{filter\.sql\}/g) ?? []).length, 1, "the filter must appear exactly once in the query");
  assert.ok(
    sql.indexOf("FROM fg_finished_slab") < sql.indexOf("${filter.sql}"),
    "the filter must be the query's WHERE, not part of a column's FILTER clause",
  );
  assert.ok(sql.indexOf("${filter.sql}") < sql.indexOf("GROUP BY"), "the filter must precede the GROUP BY");
  // tests/inventorySummaryColumns.test.ts pins the other half: every column
  // still carries `status <> 'DISPATCHED'`. Restated here so a reader of this
  // file knows the invariant did not move.
  assert.ok(sql.includes("status <> 'DISPATCHED' AND grade = 'A'"));
});

// ══════════════════════ C1 — THE SCREEN SIDE OF THE GATE ════════════════════

test("the four selects are drawn only for an admin, from lists that exist", () => {
  const bar = register.slice(register.indexOf("{canApprove && ("), register.indexOf("Stock register - click a colour"));
  for (const key of ["source", "status", "bay", "mark"])
    assert.ok(bar.includes(`srv.${key}`), `the ${key} select is outside the admin guard`);
  // Options come from what exists, not from literals typed into this file.
  assert.match(bar, /filterOptions\?\.sources/);
  assert.match(bar, /filterOptions\?\.statuses/);
  assert.match(bar, /filterOptions\?\.bays/);
  assert.match(bar, /filterOptions\?\.marks\?\.length \? \(/, "the mark select must hide when the server offers no marks");
  // The dashboard feeds them from its own constants and from the live
  // /api/inventory/filters answer, so both screens offer one list per column.
  assert.match(dashboard, /filterOptions=\{\{ bays: opts\.bays, marks: opts\.marks, sources: SOURCES, statuses: REGISTER_STATUSES \}\}/);
});

test("the four never leave the browser unless they are drawn", () => {
  const q = register.slice(register.indexOf("const serverQuery = useMemo"), register.indexOf("const anyServerFilter"));
  assert.match(q, /if \(canApprove\) for \(const \[k, v\] of Object\.entries\(srv\)\)/, "the query builder must gate the four on canApprove");
});

test("a register that did not load is not rendered as an empty yard", () => {
  // The old body was `r.ok ? r.json() : []`, so a 403, a 500 or a refused filter
  // all printed "No stock matches." on a screen Sales quotes from.
  assert.ok(!register.includes("(r.ok ? r.json() : [])"), "the summary fetch is silently swallowing failures again");
  assert.match(register, /setLoadError\(/);
  assert.match(register, /Stock register not loaded/);
  // Under a filter the stale rows answer a DIFFERENT question, so they go —
  // and `shown` goes with them, so the heading cannot outlive the figures.
  assert.match(register, /if \(anyServerFilter\) \{ setRows\(\[\]\); setShown\(applied\); \}/);
});

test("a 200 with an empty body is not a way for the register to say 'no stock'", () => {
  // The route's approval lookups used to be `.catch(() => [])`. An empty
  // approvedSet marks every row unapproved, the !showPending filter then returns
  // [], and it leaves as HTTP 200 — which the client's new banner (it fires on
  // !r.ok) renders as "No stock matches." Two live tables sit behind it: 1,606
  // rows in fg_sales_approved_batch and 2 in fg_sales_hidden_design, measured on
  // live Neon 2026-09-03.
  const block = summary.slice(summary.indexOf("const [rows, aliases"), summary.indexOf("const alias = new Map"));
  assert.ok(!/\.catch\(\(\) => \[\]\)/.test(block), "an approval lookup is swallowing its failure again");
  assert.match(block, /status: 503/, "a failed approval read must refuse, not answer with an empty yard");
  // The DESIGN ALIASES are in the same group on purpose: the approval key is
  // built from the canonical design (lib/inventory/approvalKey), so losing the
  // 287 aliases mis-keys every merged-away variant and marks that stock pending.
  assert.match(block, /designAlias\.findMany\(\{ select: \{ variant: true, canonical: true \} \}\)\.catch\(noteFail\)/);
});

test("a filtered register says on screen that it is filtered", () => {
  // Every number below it — the Slabs total, the grade split, the grand total —
  // is computed over the filtered stock, and the colour count under the table
  // reads the same either way, so it cannot carry this alone.
  assert.match(register, /Filtered register — every count below is for/);
});

test("the four travel with a click through to the slab table and to the KPI strip", () => {
  // Otherwise the row says 12 and the slab table it opens lists 40, with
  // nothing on either screen saying why.
  // `...shown`, not `...srv`: the four that COUNTED the row, so a click made
  // between a filter change and its answer opens the slab table under the same
  // four the number beside it was counted under.
  assert.equal((register.match(/onOpenSlabs\(\{[^}]*\.\.\.shown \}\)/g) ?? []).length, 2, "an onOpenSlabs call is dropping the server filters");
  assert.ok(!/onOpenSlabs\(\{[^}]*\.\.\.srv \}\)/.test(register), "a click-through is reading the controls instead of the answer");
  assert.match(register, /onFilters\?\.\(\{ design: q\.trim\(\), thickness: thick, batch: batchQ\.trim\(\), \.\.\.srv \}\)/);
  assert.match(dashboard, /applyKpiFilters\(\{ \.\.\.EMPTY, design: sf\.design, thickness: sf\.thickness, batch: sf\.batch, source: sf\.source, status: sf\.status, bay: sf\.bay, mark: sf\.mark \}\)/);
});

// ══════════ THE ROUND-2 FIXES: WHAT EACH NARROWED SCREEN NOW SAYS ═══════════
//
// Every guard below is a number that was quietly the wrong number, measured by
// replaying the summary route's own merge/alias/approval logic against live Neon
// on 2026-09-03. None of them threw; all of them read as an answer.

test("the approval strip says when it is only part of the queue, and survives at zero", () => {
  // pendingRows is filtered off the same `rows` as the register, but the strip
  // is drawn ABOVE the filter row while the register's heading sits below it
  // and says "every count BELOW" — explicitly disclaiming the strip. Measured:
  // 83 unapproved lines unfiltered, 28 under bay='Bay 4', 4 under
  // status=CHROMIA, 1 under mark=CTS. This queue decides what Sales can see.
  const strip = register.slice(register.indexOf("{canApprove && showPending &&"), register.indexOf("<div className=\"flex flex-wrap items-center gap-3"));
  assert.ok(strip.length > 0, "the approval strip moved or was renamed");
  assert.match(strip, /New stock awaiting approval \(\{pendingRows\.length\}\{shownAny/, "the strip heading does not name the filter narrowing it");
  assert.match(strip, /This is NOT the whole approval queue/, "nothing on the strip says it is a slice");
  // It must render at ZERO under a filter too: the old `pendingRows.length > 0`
  // guard made a narrowed-to-nothing queue vanish, which is the same wrong
  // reading with no text left to argue with.
  assert.match(register, /showPending && \(pendingRows\.length > 0 \|\| shownAny\)/, "a filtered-to-empty approval queue disappears again");
  // One rendering of "what is being narrowed", shared with the register's own
  // heading — two spellings is how the two came to describe different things.
  assert.match(strip, /\{shownWords\}/);
});

test("the thickness select keeps a value the four server filters knocked out of its list", () => {
  // thickOptions is derived from `rows`, which the server filters shrink, while
  // `thick` is still applied in the groups memo. Live: pick '1.2 cm' (152 slabs
  // on the floor), then bay 'Bay 1' — Bay 1 holds one 2 cm slab and one 3 cm
  // slab, so the list became ['2 cm','3 cm'], the select rendered "Any
  // thickness" and the table below it still printed "No stock matches."
  assert.match(
    register,
    /thick && !thickOptions\.includes\(thick\) \? \[\.\.\.thickOptions, thick\] : thickOptions/,
    "the register's thickness select lost the not-in-the-list guard the dashboard's selects carry",
  );
});

test("the register's heading describes the fetch its numbers came from", () => {
  // setLoading(true) is deliberately not called on a refetch (the same load()
  // runs on the 30s poll and on every focus; blanking ~2,300 rows twice a minute
  // is worse). So the heading was reading `srv` over the PREVIOUS answer's rows:
  // bay='Bay 4' printed "for Bay 4 only" over a Grand Total of 15,716, and
  // clearing it dropped the heading while Bay 4's 4,407 was still on screen.
  assert.match(register, /const \[shown, setShown\] = useState<RegisterFilters>/, "the register no longer tracks what its rows were counted under");
  assert.match(register, /setRows\(d\); setShown\(applied\);/, "`shown` must be written in the same .then as the rows");
  const banner = register.slice(register.indexOf("{(shownAny || refetching) && !loadError"), register.indexOf("{/* A REGISTER THAT DID NOT LOAD"));
  assert.ok(banner.length > 0, "the filtered-register banner moved");
  assert.ok(!/srv\.(source|status|bay|mark)/.test(banner), "the heading is reading the controls again instead of the answer");
  assert.match(banner, /Re-counting for/, "nothing says a newer count is still in flight");
});

test("the KPI strip says what it is counting, not only the register below it", () => {
  // onFilters -> applyKpiFilters -> /api/inventory/kpi, so the register's four
  // server filters narrow the cards too. With mark=CTS the strip read Total
  // Slabs 63 / Available 60 / Grade B 61 / Cut 61 (pending included) or
  // 61 / 58 / 59 / 59 (approved only) against a register Grand Total of 59 —
  // with nothing on the strip saying it was a cut-slabs-only view. The plant
  // total is 22,361 approved rows, 23,394 in all.
  assert.match(dashboard, /function describeFilters\(f: typeof EMPTY\)/, "there is no rendering of the KPI filters in words");
  assert.match(dashboard, /These cards count \{kpiOn\.join\(" · "\)\} only — not the whole plant/, "the KPI strip has no filter sentence");
  // The sentence and the fetch must not be able to drift: the fetch input is a
  // ref (it must not re-render), the sentence is state, and one setter writes
  // both. A direct assignment to the ref anywhere is the drift.
  const body = dashboard.slice(dashboard.indexOf("const applyKpiFilters"));
  assert.equal(
    (body.match(/kpiFilters\.current = /g) ?? []).length,
    1,
    "something assigns kpiFilters.current directly — the cards would filter without the sentence saying so",
  );
});

test("the register's mark select cannot be drawn in the one state it cannot work in", () => {
  // offerableMarks did `if (!hasMarkColumn) offer.add("FULL_SLAB")`, so the
  // degraded checkout the mark select hides in was the one that returned
  // marks: ['FULL_SLAB'] — length 1, so the select WAS drawn, offering the only
  // value that gets the summary route's 503, on a register that retries every
  // 30s and on every focus. There is nothing left for it to degrade to:
  // searchWhere.wholeSlabWhere throws without the mark, because since
  // scripts/0071 and 0072 a grade-only "still whole" test calls all 61 already-
  // cut slabs whole.
  const fn = filters.slice(filters.indexOf("function offerableMarks"), filters.indexOf("const clean ="));
  assert.ok(fn.length > 0, "offerableMarks moved or was renamed");
  assert.match(fn, /if \(!hasMarkColumn\) return \[\]/, "the mark list still invents an option on a database that cannot answer it");
  // Comment lines dropped first: the fallback that was removed is QUOTED in the
  // comment above it, on purpose — the rule in this codebase is to say what a
  // stale claim used to be rather than delete it, and a naive substring test
  // over the whole function would fail on that quotation for ever.
  const code = fn.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/offer\.add\("FULL_SLAB"\)/.test(code), "the FULL_SLAB fallback is back");
  // …and the client's hide test covers an empty list, not only a missing key.
  assert.match(register, /filterOptions\?\.marks\?\.length \? \(/);
});

test("the batch-lookup QC table no longer answers 'what has been cut' with a status", () => {
  // Measured on live Neon 2026-09-03: batch 1413 (Arva White) holds 232
  // finished-goods slabs, 11 of them slab_mark='CTS', and exactly ONE of those
  // 11 — slab 154757 — also carries status='CTS'. The dropdown offered "Cut to
  // size" and answered with 1 of the 11. This table has no Mark column, so
  // nothing else on it distinguishes the other 10.
  assert.match(qcSlabs, /const NOT_OFFERED_STATUS = new Set\(\["CTS"\]\)/, "the batch-lookup status filter offers CTS again");
  assert.match(qcSlabs, /statuses: \[\.\.\.s\]\.filter\(\(v\) => !NOT_OFFERED_STATUS\.has\(v\)\)/, "the filter is not applied to the offered statuses");
  // The BADGE still has to render for slab 154757, so the word stays in the map
  // — named for the column it comes from, and never as a claim about cutting.
  assert.ok(!/CTS: "Cut to size"/.test(qcSlabs), "the badge still labels a hand-applied status as 'Cut to size'");
  assert.match(qcSlabs, /CTS: "CTS \(legacy status\)"/);
  assert.match(qcSlabs, /const STATUS_NOTE: Record<string, string> = \{/, "the badge carries no note saying it is not the cut record");
});
