// Design-merge (DesignAlias) management: variant -> canonical, reversible.
// GET  -> { aliases, designs }  (inventory roles; designs = distinct in stock)
// POST { variant, canonical }  -> create/update a merge   (admin only)
// DELETE ?variant=...          -> un-merge                (admin only)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { inventoryGate, inventoryReadGate, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { isAdmin } from "@/lib/rbac";

const db = prisma as any;
const clean = (v: unknown) => String(v ?? "").trim().slice(0, 120);
const mergeSchema = z.object({
  variant: z.string().trim().min(1, "Both variant and canonical are required").max(120),
  canonical: z.string().trim().min(1, "Both variant and canonical are required").max(120),
});

// The listing is a read, so it is on the read gate like every other read —
// but it stays Admin-only behind it, which is the rule that actually decides
// this handler and the reason a view-grant login sees nothing new here. The
// gate is still moved, deliberately: leaving one GET on the write gate would
// have made "reads use inventoryReadGate" a rule with an exception nobody
// could see the reason for, and the day the Admin check is relaxed the gate
// underneath it would be the wrong one.
export async function GET() {
  const g = await inventoryReadGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  if (!(await isAdmin())) return Response.json({ error: "Admin only" }, { status: 403 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) return Response.json({ error: "Not available for this login" }, { status: 403 });
  try {
    const [aliases, designRows] = await Promise.all([
      db.designAlias.findMany({ orderBy: [{ canonical: "asc" }, { variant: "asc" }] }),
      db.finishedSlab.findMany({ distinct: ["design"], select: { design: true }, where: { design: { not: null } }, orderBy: { design: "asc" } }),
    ]);
    return Response.json({ aliases, designs: designRows.map((r: any) => r.design).filter(Boolean) });
  } catch (e) {
    console.error("Design alias list error:", e);
    return Response.json({ aliases: [], designs: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) return Response.json({ error: "Not available for this login" }, { status: 403 });
  if (!(await isAdmin())) return Response.json({ error: "Admin only" }, { status: 403 });
  try {
    const raw = await request.json().catch(() => null);
    const parsed = mergeSchema.safeParse(raw);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const { variant, canonical } = parsed.data;
    if (variant === canonical) return Response.json({ error: "Variant and canonical are the same" }, { status: 400 });
    // no chains: canonical must not itself be a merged variant; variant must not be a canonical of others
    const [chainUp, chainDown] = await Promise.all([
      db.designAlias.findUnique({ where: { variant: canonical } }),
      db.designAlias.findFirst({ where: { canonical: variant } }),
    ]);
    if (chainUp) return Response.json({ error: `"${canonical}" is already merged into "${chainUp.canonical}" — merge into that instead` }, { status: 400 });
    if (chainDown) return Response.json({ error: `"${variant}" is a canonical with merges — un-merge those first` }, { status: 400 });
    const by = (g.user as any)?.name ?? null;
    const row = await db.designAlias.upsert({
      where: { variant },
      create: { variant, canonical, createdBy: by },
      update: { canonical, createdBy: by },
    });
    return Response.json(row);
  } catch (e) {
    console.error("Design alias save error:", e);
    return Response.json({ error: "Save failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) return Response.json({ error: "Not available for this login" }, { status: 403 });
  if (!(await isAdmin())) return Response.json({ error: "Admin only" }, { status: 403 });
  try {
    const variant = clean(new URL(request.url).searchParams.get("variant"));
    if (!variant) return Response.json({ error: "variant required" }, { status: 400 });
    await db.designAlias.deleteMany({ where: { variant } });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Design alias delete error:", e);
    return Response.json({ error: "Delete failed" }, { status: 500 });
  }
}
