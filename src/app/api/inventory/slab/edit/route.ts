// Admin edit of an inventory slab's fields (design/batch/thickness/grade/
// polish/bay/frame/notes) with a SlabEvent per changed field. ADMIN only.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";
import { isAdmin } from "@/lib/rbac";
import { normalizeBatch } from "@/lib/normalizeBatch";

const db = prisma as any;
const t = (max: number) => z.preprocess((v) => { const s = String(v ?? "").trim().slice(0, max); return s === "" ? null : s; }, z.string().nullable());
const schema = z.object({
  slabNumber: z.coerce.number().finite().positive(),
  design: t(120).optional(), batchNumber: t(60).optional(), slabThickness: t(30).optional(),
  grade: t(30).optional(), polishType: t(30).optional(), bayNumber: t(30).optional(),
  frameNumber: t(60).optional(), notes: t(900).optional(),
});
const FIELDS = ["design","batchNumber","slabThickness","grade","polishType","bayNumber","frameNumber","notes"] as const;

export async function POST(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  if (!(await isAdmin())) return Response.json({ error: "Admin only" }, { status: 403 });
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const body: any = parsed.data;
    const cur = await db.finishedSlab.findUnique({ where: { slabNumber: body.slabNumber } });
    if (!cur) return Response.json({ error: "Slab not found" }, { status: 404 });
    const data: Record<string, unknown> = {};
    const events: { field: string; oldValue: string | null; newValue: string | null }[] = [];
    for (const f of FIELDS) {
      if (body[f] === undefined) continue;
      const nv = body[f]; const ov = cur[f] ?? null;
      if (nv !== ov) { data[f] = nv; events.push({ field: f, oldValue: ov, newValue: nv }); }
    }
    if ("batchNumber" in data) data.batchKey = data.batchNumber ? normalizeBatch(String(data.batchNumber)) : null;
    if (!Object.keys(data).length) return Response.json({ ok: true, changed: 0 });
    const by = (g.user as any)?.name ?? null;
    await db.$transaction([
      db.finishedSlab.update({ where: { slabNumber: body.slabNumber }, data }),
      db.slabEvent.createMany({
        data: events.map((e) => ({ slabNumber: body.slabNumber, kind: "edit", field: e.field, oldValue: e.oldValue, newValue: e.newValue, changedBy: by, source: "Admin edit" })),
      }),
    ]);
    return Response.json({ ok: true, changed: events.length });
  } catch (e) {
    console.error("Slab edit error:", e);
    return Response.json({ error: "Save failed" }, { status: 500 });
  }
}
