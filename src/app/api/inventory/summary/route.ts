// Stock summary (register layout): per design -> one row per thickness+batch,
// with bay-wise stock (Bay 5/4/3), grade split, dispatched count and pending
// polish / R&W. Design names are alias-aware. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { summaryGate, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { displayBatch } from "@/lib/batchDisplay";

const db = prisma as any;
const KEYS = ["total","dispatched","bay5","bay4","bay3","nobay","a","a2","b","c","cts","printing","trial","ungraded","pending_polish","pending_rw"];

export async function GET() {
  const g = await summaryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) return Response.json({ error: "Not available for this login" }, { status: 403 });
  try {
    const [rows, aliases] = await Promise.all([
      db.$queryRaw`
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
               count(*) FILTER (WHERE grade = 'Trial')::int                               AS trial,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND grade IS NULL)::int      AS ungraded,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND repolish_status = 'Repolish Required')::int AS pending_polish,
               count(*) FILTER (WHERE status <> 'DISPATCHED' AND rw_status = 'RW Required and ongoing')::int AS pending_rw
        FROM fg_finished_slab
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3`,
      db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []),
    ]);
    const hiddenRows: any[] = await db.$queryRaw`SELECT design FROM fg_sales_hidden_design WHERE batch = ''`.catch(() => []);
    const hidden = new Set<string>(hiddenRows.map((h) => h.design));
    const approvedRows: any[] = await db.$queryRaw`SELECT design, batch FROM fg_sales_approved_batch`.catch(() => []);
    const approvedSet = new Set<string>(approvedRows.map((a) => `${a.design} ${a.batch}`));
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
      const batchApproved = approvedSet.has(`${r.design} ${r.batch}`);
      return {
        ...r,
        designApproved,
        approved: designApproved && batchApproved,      // visible to Sales
        pending: designApproved && !batchApproved,      // new stock awaiting admin approval
      };
    });
    // Sales logins only ever see approved stock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (String((g.user as any)?.role ?? "") === "SALES") out = out.filter((r) => r.approved);
    return Response.json(out);
  } catch (e) {
    console.error("Inventory summary error:", e);
    return Response.json([], { status: 500 });
  }
}
