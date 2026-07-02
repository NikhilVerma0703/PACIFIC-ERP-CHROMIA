// Dispatch-team location assignment: set/clear bay and/or frame on selected
// slabs, with a SlabEvent audit entry per change. Gated to inventory roles.
// Body: { slabs: number[], bay?: string|null, frame?: string|null }
//   - field omitted        -> untouched
//   - field null / ""      -> cleared
//   - field non-empty text -> set
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { inventoryGate } from "@/lib/inventory/access";
import { assignSlabLocation } from "@/lib/inventory/finishedSlab";

const MAX_SLABS = 500;
// omitted -> undefined (untouched) · null/"" -> null (clear) · text -> set
const locText = z.preprocess(
  (v) => { if (v === undefined) return undefined; if (v === null) return null; const t = String(v).trim().slice(0, 60); return t === "" ? null : t; },
  z.string().nullable().optional()
);
const bodySchema = z.object({
  slabs: z.array(z.coerce.number().finite().positive())
    .min(1, "No slabs selected")
    .max(MAX_SLABS, `Max ${MAX_SLABS} slabs per move`),
  bay: locText,
  frame: locText,
});

export async function POST(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const { slabs, bay, frame } = parsed.data;
    if (bay === undefined && frame === undefined)
      return Response.json({ error: "Nothing to change — provide bay and/or frame" }, { status: 400 });

    const by = (g.user as any)?.name ?? (g.user as any)?.username ?? null;
    const res = await assignSlabLocation([...new Set(slabs)], { bay, frame, by });
    return Response.json(res);
  } catch (e) {
    console.error("Inventory location error:", e);
    return Response.json({ error: "Move failed" }, { status: 500 });
  }
}
