// Dispatch-team location assignment: set/clear bay and/or frame on selected
// slabs, with a SlabEvent audit entry per change. Gated to inventory roles.
// Body: { slabs: number[], bay?: string|null, frame?: string|null }
//   - field omitted        -> untouched
//   - field null / ""      -> cleared
//   - field non-empty text -> set
/* eslint-disable @typescript-eslint/no-explicit-any */
import { inventoryGate } from "@/lib/inventory/access";
import { assignSlabLocation } from "@/lib/inventory/finishedSlab";

const MAX_SLABS = 500;
const clean = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = String(v).trim().slice(0, 60);
  return t === "" ? null : t;
};

export async function POST(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    const body = await request.json().catch(() => null);
    const slabs: number[] = Array.isArray(body?.slabs)
      ? body.slabs.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    if (slabs.length === 0) return Response.json({ error: "No slabs selected" }, { status: 400 });
    if (slabs.length > MAX_SLABS) return Response.json({ error: `Max ${MAX_SLABS} slabs per move` }, { status: 400 });
    const bay = clean(body?.bay);
    const frame = clean(body?.frame);
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
