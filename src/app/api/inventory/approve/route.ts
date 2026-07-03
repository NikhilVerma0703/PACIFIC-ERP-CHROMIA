// Approve / un-approve a design for the Sales register. Inventory roles only
// (Sales itself can't touch it). Body: { design: string, approved: boolean }
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { inventoryGate, summaryGate } from "@/lib/inventory/access";
import { isAdmin } from "@/lib/rbac";

const db = prisma as any;
const schema = z.object({ design: z.string().trim().min(1).max(200), batch: z.string().trim().max(120).optional().default(""), approved: z.boolean() });

// Cheap change detector: version string flips whenever any approval changes.
export async function GET() {
  const g = await summaryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    const r: any[] = await db.$queryRaw`
      SELECT (SELECT count(*)::int FROM fg_sales_hidden_design) AS hn,
             (SELECT coalesce(max(at)::text, '') FROM fg_sales_hidden_design) AS ht,
             (SELECT count(*)::int FROM fg_sales_approved_batch) AS an,
             (SELECT coalesce(max(at)::text, '') FROM fg_sales_approved_batch) AS at`;
    const x = r[0] ?? {};
    return Response.json({ v: `${x.hn}|${x.ht}|${x.an}|${x.at}` });
  } catch {
    return Response.json({ v: "" });
  }
}

export async function POST(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  if (!(await isAdmin())) return Response.json({ error: "Only an administrator can approve stock" }, { status: 403 });
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const { design, batch, approved } = parsed.data;
    const by = (g.user as any)?.name ?? null;
    if (batch === "") {
      // design-level master switch (incl. __TRIALS__): hidden-list toggle
      if (approved) await db.$executeRaw`DELETE FROM fg_sales_hidden_design WHERE design = ${design} AND batch = ''`;
      else await db.$executeRaw`INSERT INTO fg_sales_hidden_design (design, batch, hidden_by) VALUES (${design}, '', ${by}) ON CONFLICT (design, batch) DO NOTHING`;
    } else if (approved) {
      // batch approved -> enters the register + Sales view
      await db.$executeRaw`INSERT INTO fg_sales_approved_batch (design, batch, approved_by) VALUES (${design}, ${batch}, ${by}) ON CONFLICT (design, batch) DO NOTHING`;
    } else {
      // batch unticked -> back to PENDING (out of the register + Sales view)
      await db.$executeRaw`DELETE FROM fg_sales_approved_batch WHERE design = ${design} AND batch = ${batch}`;
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Sales approve error:", e);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
