// Design-merge (DesignAlias) management: variant -> canonical, reversible.
// GET  -> { aliases, designs }  (inventory roles; designs = distinct in stock)
// POST { variant, canonical }  -> create/update a merge   (admin only)
// DELETE ?variant=...          -> un-merge                (admin only)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { inventoryGate, inventoryReadGate, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { isAdmin } from "@/lib/rbac";
import { CATALOGUE_COLOURS } from "@/lib/catalogue/colours";
import { foldName, suggestDesigns, isResolved } from "@/lib/inventory/designSuggest";

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
    const [aliases, designRows, counts] = await Promise.all([
      db.designAlias.findMany({ orderBy: [{ canonical: "asc" }, { variant: "asc" }] }),
      db.finishedSlab.findMany({ distinct: ["design"], select: { design: true }, where: { design: { not: null } }, orderBy: { design: "asc" } }),
      // WITH SLAB COUNTS, because the backlog is worked by how much stock is
      // stuck behind each name, not alphabetically. 665 slabs spelt "Simply
      // white" is a morning's win; one slab spelt "Cal" is not.
      db.$queryRawUnsafe(
        `SELECT design, COUNT(*)::int AS n,
                COUNT(DISTINCT batch_number)::int AS batches
           FROM fg_finished_slab
          WHERE design IS NOT NULL AND design <> ''
          GROUP BY 1`,
      ).catch(() => []),
    ]);

    // ── THE BACKLOG, which is what the screen is actually for ───────────────
    //
    // Every design name in stock that is neither on the colour chart nor
    // already merged away. 104 of the 488 names in the yard, and the reason
    // "Antique Greya" and "An" were being offered in the filter dropdown beside
    // real colours: a name nobody has merged counts as a design of its own.
    const merged = new Set<string>(aliases.map((a: any) => a.variant));
    const known = new Set<string>([
      ...CATALOGUE_COLOURS.map((c: any) => c.name),
      ...aliases.map((a: any) => a.canonical),
    ]);
    const countBy = new Map<string, { n: number; batches: number }>(
      (counts as any[]).map((r: any) => [String(r.design), { n: Number(r.n || 0), batches: Number(r.batches || 0) }]),
    );

    // CASE TWINS ARE ONE DECISION, NOT TWO. "Simply white" (665) and "Simply
    // White" (68) are the same name typed twice; asking about each separately
    // doubles the work and invites two different answers.
    const groups = new Map<string, { spellings: string[]; slabs: number; batches: number }>();
    for (const row of designRows as any[]) {
      const raw = String(row.design ?? "");
      if (!raw || isResolved(raw, known, merged)) continue;
      const key = foldName(raw);
      if (!key) continue;
      const c = countBy.get(raw) ?? { n: 0, batches: 0 };
      const g = groups.get(key) ?? { spellings: [], slabs: 0, batches: 0 };
      g.spellings.push(raw);
      g.slabs += c.n;
      g.batches = Math.max(g.batches, c.batches);
      groups.set(key, g);
    }

    const backlog = [...groups.entries()]
      .map(([key, g]) => ({
        key,
        // the spelling the yard uses most is the one to standardise on, unless
        // a suggestion beats it
        spellings: g.spellings.sort((a, b) => (countBy.get(b)?.n ?? 0) - (countBy.get(a)?.n ?? 0)),
        slabs: g.slabs,
        batches: g.batches,
        suggestions: suggestDesigns(g.spellings[0], known, 3),
      }))
      .sort((a, b) => b.slabs - a.slabs);

    return Response.json({
      aliases,
      designs: designRows.map((r: any) => r.design).filter(Boolean),
      known: [...known].sort((a, b) => a.localeCompare(b)),
      backlog,
      backlogTotals: {
        names: backlog.length,
        slabs: backlog.reduce((n, b) => n + b.slabs, 0),
        withSuggestion: backlog.filter((b) => b.suggestions.length > 0).length,
      },
    });
  } catch (e) {
    console.error("Design alias list error:", e);
    return Response.json({ aliases: [], designs: [], known: [], backlog: [], backlogTotals: { names: 0, slabs: 0, withSuggestion: 0 } }, { status: 500 });
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
