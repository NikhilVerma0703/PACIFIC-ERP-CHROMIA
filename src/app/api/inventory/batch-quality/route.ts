// Per-slab quality for one register line (design + thickness + batch) — the
// drill-down behind the Stock-by-Design batch rows for the SALES login.
//
// Sales can only reach the summary API; the full slab search (which already
// shows a Quality Issue column to Admin, Finance and Commercial) is gated away
// from them. The owner's decision (2026-08) is that Sales SHOULD see what is
// wrong with a slab before quoting it — so this route serves exactly that, as
// a CLOSED shape: slab number, grade, MARK, issues, R/W status, repolish
// status, stock status, barcode (the NB display label for legacy no-number
// slabs).
// No inspector, no notes, no bay/frame, no PI/customer — widen it
// deliberately, never by spreading a row (the same rule as lib/batchQcList.ts).
//
// AND IT CARRIES THE MARK. Sales has no other per-slab list, so this popup is
// the one place a cut slab declares itself before somebody quotes it as a full
// slab. The register's Mark column shipped reading `s.mark` while this route's
// `select` did not fetch slab_mark and its mapping emitted no `mark` key, so
// the column rendered a dash on every slab in the plant — and the fallback that
// was supposed to cover that (MarkChip's `legacyGrade`, reading grade='CTS')
// died the same day: scripts/0071 and 0072 regraded all 63 cut slabs to 'B'.
// Measured on live Neon 2026-09-03, the register line Arva White · 2 cm · 1413
// prints Slabs 205 / Cut 11, and this popup listed 205 rows every one of which
// read Grade B, Mark "—". A column that exists and is empty asserts "all whole"
// more loudly than no column at all.
//
// So slab_mark is SELECTED here, and when it cannot be read the payload says so
// (`markAvailable: false`) rather than sending rows with no mark on them. The
// popup then prints "?" instead of a dash: this route never tells Sales a slab
// is whole on the strength of a column it could not read.
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
import { approvedOnlyWhere, slabMarkAvailable, isMissingSlabMarkError } from "@/lib/inventory/searchWhere";
import { displayBatch } from "@/lib/batchDisplay";
import { CATALOGUE_COLOURS } from "@/lib/catalogue/colours";
import { buildDesignResolver } from "@/lib/inventory/designSuggest";

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
    // THE DRILL-THROUGH MUST FOLD THE SAME WAY THE COLUMN DOES. Slabs by design
    // groups "Alabaster Noir" (350) and "Alabaster noir" (1) into one row of
    // 351; if this route collects its raw names by exact alias match it queries
    // for 350 and the last slab vanishes between the column and the detail
    // behind it. Same resolver, so a number cannot change by being clicked on.
    const wantNull = design === NO_DESIGN || design === "(No Name)";
    const resolveDesign = buildDesignResolver(
      aliases as { variant: string; canonical: string }[],
      [...CATALOGUE_COLOURS.map((c) => c.name), ...aliases.map((a: any) => a.canonical)],
    );
    const allDesigns: any[] = wantNull ? [] : await db.finishedSlab
      .findMany({ distinct: ["design"], select: { design: true }, where: { design: { not: null } } })
      .catch(() => []);
    const rawDesigns = allDesigns
      .map((r: any) => String(r.design ?? ""))
      .filter((d: string) => d && resolveDesign(d) === design);
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
    // The mark is asked for whenever the probe says the column is there, and
    // the query is still guarded: the probe answers once per process and a
    // stale client can meet a database the migration has not reached, in which
    // window an unguarded read is a P2022 and a 500 on the Sales drill-down.
    // The re-run drops ONLY slabMark from the select — the quality columns are
    // the reason Sales opens this popup and they must survive a missing mark —
    // and `markAvailable` then travels with the payload so the screen shows the
    // mark as UNKNOWN rather than as a dash that reads "whole".
    const base = {
      slabNumber: true, grade: true, qualityIssue: true, status: true, barcode: true,
      rwStatus: true, repolishStatus: true,
    } as const;
    let markAvailable = await slabMarkAvailable();
    const find = (withMark: boolean) => db.finishedSlab.findMany({
      where,
      select: withMark ? { ...base, slabMark: true } : base,
      orderBy: { slabNumber: "asc" },
      take: CAP + 1,
    });
    const rows = markAvailable
      ? await find(true).catch((e: any) => {
          if (!isMissingSlabMarkError(e)) throw e;
          markAvailable = false;
          return find(false);
        })
      : await find(false);
    const truncated = rows.length > CAP;
    const page = truncated ? rows.slice(0, CAP) : rows;

    // POLISH QC IS THE SOURCE; the inventory column only fills its silence.
    // fg_finished_slab.quality_issue is itself just a mirror of QC ("mirrored
    // from PolishQc each QC pass") and imported/older stock never got one:
    // measured 2026-08, the mirror carried issues on 401 of 3,368 B-grade
    // in-stock slabs while the latest polish_qc row carried them on 1,377.
    // So each field reads the latest QC row first and falls back to the
    // inventory mirror only when QC has no entry for it — a stale mirror can
    // then never override what QC last said. Latest row per slab by
    // COALESCE(created_time, imported_at): Airtable-era rows carry
    // created_time, ERP rows leave it NULL, and imported_at alone loses
    // everything after the June 2026 cutover.
    const nums = page.map((r: any) => r.slabNumber).filter((n: unknown) => typeof n === "number");
    const qcBySlab = new Map<number, any>();
    if (nums.length) {
      const qcRows = await db.polishQc.findMany({
        where: { slabNumber: { in: nums } },
        select: { slabNumber: true, qualityIssue: true, rwStatus: true, repolishStatus: true, createdTime: true, importedAt: true },
      });
      const at = (q: any) => new Date(q.createdTime ?? q.importedAt ?? 0).getTime();
      for (const q of qcRows) {
        const cur = qcBySlab.get(q.slabNumber);
        if (!cur || at(q) > at(cur)) qcBySlab.set(q.slabNumber, q);
      }
    }

    return Response.json({
      truncated,
      // FALSE means "we could not read the mark", not "nothing is marked". The
      // popup must not draw a Mark column it cannot fill — see the header.
      markAvailable,
      slabs: page.map((r: any) => {
        const qc = qcBySlab.get(r.slabNumber);
        const fgIssues = Array.isArray(r.qualityIssue) ? r.qualityIssue.filter(Boolean) : [];
        const qcIssues = Array.isArray(qc?.qualityIssue) ? qc.qualityIssue.filter(Boolean) : [];
        return {
          slab: r.slabNumber,
          grade: r.grade?.trim() || null,
          // WHAT BECAME OF THE SLAB, beside how good the stone is. Sent raw
          // (FULL_SLAB / CTS / SAMPLE) and read through slabMarkOf on the
          // screen, the same as every other surface that shows a mark. Absent
          // from the row only when markAvailable is false, and the popup keys
          // off that flag rather than off `mark == null` — a null here would
          // otherwise be indistinguishable from "whole".
          mark: r.slabMark ?? null,
          issues: qcIssues.length ? qcIssues : fgIssues,
          rw: qc?.rwStatus?.trim() || r.rwStatus?.trim() || null,
          repolish: qc?.repolishStatus?.trim() || r.repolishStatus?.trim() || null,
          status: r.status ?? null,
          barcode: r.barcode ?? null,
        };
      }),
    });
  } catch (e) {
    console.error("Batch quality error:", e);
    return Response.json({ error: "Failed to load the slab list" }, { status: 500 });
  }
}
