// Approve / un-approve a design for the Sales register. Inventory roles only
// (Sales itself can't touch it). Body: { design: string, approved: boolean }
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";

const db = prisma as any;
const schema = z.object({ design: z.string().trim().min(1).max(200), approved: z.boolean() });

export async function POST(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const { design, approved } = parsed.data;
    const by = (g.user as any)?.name ?? null;
    if (approved) await db.$executeRaw`DELETE FROM fg_sales_hidden_design WHERE design = ${design}`;
    else await db.$executeRaw`INSERT INTO fg_sales_hidden_design (design, hidden_by) VALUES (${design}, ${by}) ON CONFLICT (design) DO NOTHING`;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Sales approve error:", e);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
