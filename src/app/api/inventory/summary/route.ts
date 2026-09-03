// Stock summary (register layout): per design -> one row per thickness+batch,
// with bay-wise stock (Bay 5/4/3), grade split, dispatched count and pending
// polish / R&W. Design names are alias-aware. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { summaryGate, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { slabMarkAvailable, isMissingSlabMarkError } from "@/lib/inventory/searchWhere";
import { displayBatch } from "@/lib/batchDisplay";

const db = prisma as any;
const KEYS = ["total","dispatched","bay5","bay4","bay3","nobay","a","a2","b","c","cts","printing","trial","ungraded","cut","pending_polish","pending_rw"];

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
// TODAY THE TWO AGREE. All 62 slabs whose grade reads CTS (60 on the floor, 2
// dispatched — measured on live Neon 2026-09-03) are the same 62 the mark calls
// cut, so `cts` and `cut` print the same number per row until the owner starts
// replacing those grades with the real A/B/C verdicts he is collecting by hand.
// From then on `cts` shrinks to zero and `cut` carries the fact — which is the
// whole point, and why the register must show `cut` rather than `cts` to
// anyone asking what has been cut.

/** Cut = grade says so OR mark says so (the same OR as grading.ts
 *  slabBlocksDispatch and searchWhere anyCutWhere). Without the mark column it
 *  degrades to today's grade-only test, which finds exactly the same 62. */
const cutExpr = (hasMark: boolean) =>
  hasMark ? "(grade IN ('CTS','SAMPLE') OR slab_mark IN ('CTS','SAMPLE'))" : "grade IN ('CTS','SAMPLE')";

export async function GET(request: Request) {
  const g = await summaryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) return Response.json({ error: "Not available for this login" }, { status: 403 });
  try {
    // $queryRawUnsafe, and NOTHING user-supplied goes near it: the only moving
    // part is `cut`, chosen by cutExpr() from two string literals a few lines
    // up. It is a raw string only because the register has to run in BOTH
    // deploy orders — the tagged template cannot vary its own text, and the
    // alternative was two copies of a 25-line query drifting apart.
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
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3`;

    // The register must not go dark over a column that has not shipped. The
    // probe answers first; the catch covers the window where the migration (or
    // a client regeneration) lands between the probe and this query, and
    // re-runs the identical query with the grade-only test -- which is exactly
    // what this page printed yesterday. Anything that is NOT a missing
    // slab_mark is rethrown to the 500 below, because "the register is empty"
    // must never be this route's answer to a database that is actually down.
    const fetchRows = async (): Promise<any[]> => {
      const hasMark = await slabMarkAvailable();
      if (!hasMark) return db.$queryRawUnsafe(registerSql(cutExpr(false)));
      try {
        return await db.$queryRawUnsafe(registerSql(cutExpr(true)));
      } catch (e: any) {
        if (!isMissingSlabMarkError(e)) throw e;
        return db.$queryRawUnsafe(registerSql(cutExpr(false)));
      }
    };

    const [rows, aliases] = await Promise.all([
      fetchRows(),
      db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []),
    ]);
    const hiddenRows: any[] = await db.$queryRaw`SELECT design FROM fg_sales_hidden_design WHERE batch = ''`.catch(() => []);
    const hidden = new Set<string>(hiddenRows.map((h) => h.design));
    const approvedRows: any[] = await db.$queryRaw`SELECT design, batch FROM fg_sales_approved_batch`.catch(() => []);
    const approvedSet = new Set<string>(approvedRows.map((a) => `${a.design}\u0000${a.batch}`));
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isAdm = String((g.user as any)?.role ?? "") === "ADMIN";
    const showPending = isAdm && new URL(request.url).searchParams.get("pending") === "1";
    if (!showPending) out = out.filter((r) => r.approved);
    return Response.json(out);
  } catch (e) {
    console.error("Inventory summary error:", e);
    return Response.json([], { status: 500 });
  }
}
