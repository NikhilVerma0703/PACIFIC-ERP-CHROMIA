// Per-slab quality for one register line (design + thickness + batch) — the
// drill-down behind the Stock-by-Design batch rows for the SALES login.
//
// Sales can only reach the summary API; the full slab search (which already
// shows a Quality Issue column to Admin, Finance and Commercial) is gated away
// from them. The owner's decision (2026-08) is that Sales SHOULD see what is
// wrong with a slab before quoting it — so this route serves exactly that, as
// a CLOSED shape: slab number, grade, issues, status, barcode (the NB display
// label for legacy no-number slabs). No inspector, no notes, no bay/frame, no
// PI/customer — widen it deliberately, never by spreading a row (the same rule
// as lib/batchQcList.ts).
//
// SCOPE IS THE REGISTER'S OWN GROUPING, not the slab-search filters. The first
// review of this route caught both sins of the easy path: feeding the raw
// query string into buildInventoryWhere handed Sales the whole filter surface
// (?bay= / ?customer= / ?pi= became a set-membership oracle for columns this
// shape withholds), and its contains/normalize semantics did not reproduce a
// register row anyway (display batches, "-" placeholders, "(No Name)",
// canonical-vs-variant designs all missed). So this reads EXACTLY three
// whitelisted params and resolves them the way the summary route groups:
// design is the canonical shown name (alias-expanded, exact), thickness and
// batch are the shown values with "-" meaning NULL, batch matched through
// displayBatch so merged spellings ("0123", "123 ") stay one line here too.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { summaryGate, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { approvedOnlyWhere } from "@/lib/inventory/searchWhere";
import { displayBatch } from "@/lib/batchDisplay";

const db = prisma as any;
const NO_DESIGN = "(no design)";
const CAP = 1000;

export async function GET(request: Request) {
  const g = await summaryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  // Commercial has the full slab table and is 403'd by the summary API; this
  // drill-down follows the surface it belongs to.
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) {
    return Response.json({ error: "Not available for this login" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const design = (searchParams.get("design") ?? "").trim();
    const thickness = (searchParams.get("thickness") ?? "").trim();
    const batch = (searchParams.get("batch") ?? "").trim();
    if (!design || !thickness || !batch) {
      return Response.json({ error: "design, thickness and batch are required" }, { status: 400 });
    }

    // Raw design values whose SHOWN name is `design`: its unmerged self plus
    // every variant an alias maps to it. "(No Name)" rows carry NULL. The
    // summary shows "(No Name)" for the coalesced "(no design)" group.
    const aliases: any[] = await db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []);
    const amap = new Map<string, string>(aliases.map((x) => [x.variant, x.canonical]));
    const wantNull = design === NO_DESIGN || design === "(No Name)";
    const rawDesigns = aliases.filter((a) => a.canonical === design).map((a) => a.variant);
    if (!wantNull && (amap.get(design) ?? design) === design) rawDesigns.push(design);
    if (!wantNull && rawDesigns.length === 0) return Response.json({ truncated: false, slabs: [] });
    const designWhere = wantNull ? { design: null } : { design: { in: rawDesigns } };

    // Raw batch numbers whose DISPLAY form is `batch`, within this design and
    // thickness — the same displayBatch merge the register applies.
    const thicknessWhere = { slabThickness: thickness === "-" ? null : thickness };
    let batchWhere: any;
    if (batch === "-") batchWhere = { batchNumber: null };
    else {
      const combos: any[] = await db.finishedSlab.findMany({
        where: { ...designWhere, ...thicknessWhere, batchNumber: { not: null } },
        distinct: ["batchNumber"],
        select: { batchNumber: true },
      });
      const raws = combos.map((c) => c.batchNumber).filter((b: unknown): b is string => typeof b === "string" && displayBatch(b) === batch);
      if (!raws.length) return Response.json({ truncated: false, slabs: [] });
      batchWhere = { batchNumber: { in: raws } };
    }

    // status <> DISPATCHED: the register's Slabs figure counts in-stock only
    // (summary route: count(*) FILTER (WHERE status <> 'DISPATCHED')), and the
    // popup must list the slabs that figure counts — not history that left.
    // strict approval: for this Sales-facing read, "could not check the
    // approval list" fails CLOSED as a 500, never open (see approvedOnlyWhere).
    const where = await approvedOnlyWhere(
      { ...designWhere, ...thicknessWhere, ...batchWhere, status: { not: "DISPATCHED" } },
      { strict: true },
    );
    const rows = await db.finishedSlab.findMany({
      where,
      select: { slabNumber: true, grade: true, qualityIssue: true, status: true, barcode: true },
      orderBy: { slabNumber: "asc" },
      take: CAP + 1,
    });
    const truncated = rows.length > CAP;
    return Response.json({
      truncated,
      slabs: (truncated ? rows.slice(0, CAP) : rows).map((r: any) => ({
        slab: r.slabNumber,
        grade: r.grade?.trim() || null,
        issues: Array.isArray(r.qualityIssue) ? r.qualityIssue.filter(Boolean) : [],
        status: r.status ?? null,
        barcode: r.barcode ?? null,
      })),
    });
  } catch (e) {
    console.error("Batch quality error:", e);
    return Response.json({ error: "Failed to load the slab list" }, { status: 500 });
  }
}
