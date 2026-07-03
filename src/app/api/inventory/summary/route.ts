// Stock summary: designs (colours) grouped by thickness and batch, with grade
// split + pending polish / pending R&W counts. Stock on hand only (dispatched
// excluded). Design names are alias-aware (merged variants report under their
// canonical name). Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";

const db = prisma as any;

export async function GET() {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    const [rows, aliases] = await Promise.all([
      db.$queryRaw`
        SELECT coalesce(design, '(no design)')        AS design,
               coalesce(slab_thickness, '—')          AS thickness,
               coalesce(batch_number, '—')            AS batch,
               count(*)::int                          AS total,
               count(*) FILTER (WHERE grade = 'A')::int        AS a,
               count(*) FILTER (WHERE grade = 'A2')::int       AS a2,
               count(*) FILTER (WHERE grade = 'B')::int        AS b,
               count(*) FILTER (WHERE grade = 'C')::int        AS c,
               count(*) FILTER (WHERE grade = 'CTS')::int      AS cts,
               count(*) FILTER (WHERE grade = 'Printing')::int AS printing,
               count(*) FILTER (WHERE grade = 'Trial')::int    AS trial,
               count(*) FILTER (WHERE grade IS NULL)::int      AS ungraded,
               count(*) FILTER (WHERE repolish_status = 'Repolish Required')::int AS pending_polish,
               count(*) FILTER (WHERE rw_status = 'RW Required and ongoing')::int AS pending_rw
        FROM fg_finished_slab
        WHERE status <> 'DISPATCHED'
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3`,
      db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []),
    ]);
    // fold merged design variants into their canonical name
    const alias = new Map<string, string>(aliases.map((a: any) => [a.variant, a.canonical]));
    const merged = new Map<string, any>();
    for (const r of rows) {
      const design = alias.get(r.design) ?? r.design;
      const key = [design, r.thickness, r.batch].join("\u0000"); // separator can't appear in names
      const m = merged.get(key);
      if (!m) merged.set(key, { ...r, design });
      else for (const k of ["total","a","a2","b","c","cts","printing","trial","ungraded","pending_polish","pending_rw"]) m[k] += r[k];
    }
    return Response.json([...merged.values()]);
  } catch (e) {
    console.error("Inventory summary error:", e);
    return Response.json([], { status: 500 });
  }
}
