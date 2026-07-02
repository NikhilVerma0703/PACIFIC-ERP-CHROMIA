// Slab lifecycle actions: reserve (PI hold, 7-day default expiry) / release /
// pack / dispatch / return. Gated to inventory roles; only ADMIN may override
// the reservation expiry. Invalid transitions are skipped, never forced.
// Body: { slabs: number[], action, pi?, customer?, expiryDays? }
/* eslint-disable @typescript-eslint/no-explicit-any */
import { inventoryGate } from "@/lib/inventory/access";
import { changeSlabStatus, DEFAULT_RESERVATION_DAYS, type StatusAction } from "@/lib/inventory/finishedSlab";

const ACTIONS = new Set(["reserve", "release", "pack", "dispatch", "return"]);
const MAX_SLABS = 500;
const clean = (v: unknown) => { const t = String(v ?? "").trim().slice(0, 120); return t === "" ? null : t; };

export async function POST(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    const body = await request.json().catch(() => null);
    const action = String(body?.action ?? "");
    if (!ACTIONS.has(action)) return Response.json({ error: "Unknown action" }, { status: 400 });
    const slabs: number[] = Array.isArray(body?.slabs)
      ? [...new Set<number>(body.slabs.map(Number).filter((n: number) => Number.isFinite(n) && n > 0))]
      : [];
    if (slabs.length === 0) return Response.json({ error: "No slabs selected" }, { status: 400 });
    if (slabs.length > MAX_SLABS) return Response.json({ error: `Max ${MAX_SLABS} slabs per action` }, { status: 400 });

    const pi = clean(body?.pi);
    const customer = clean(body?.customer);
    if (action === "reserve" && !pi && !customer)
      return Response.json({ error: "Reserve needs a PI and/or customer" }, { status: 400 });

    // Only Admin may override the default hold; everyone else gets 7 days.
    // (Only meaningful for reserve — ignored for other actions.)
    let expiryDays = DEFAULT_RESERVATION_DAYS;
    if (action === "reserve" && body?.expiryDays !== undefined && body?.expiryDays !== null && String(body.expiryDays).trim() !== "") {
      const isAdminUser = String((g.user as any)?.role ?? "") === "ADMIN";
      const rawDays = Number(body.expiryDays);
      if (!Number.isFinite(rawDays) || rawDays < 1) return Response.json({ error: "Hold must be a whole number of days (1–365)" }, { status: 400 });
      const days = Math.min(365, Math.max(1, Math.round(rawDays)));
      if (days !== DEFAULT_RESERVATION_DAYS && !isAdminUser)
        return Response.json({ error: "Only Admin can change the 7-day hold" }, { status: 403 });
      expiryDays = days;
    }

    const by = (g.user as any)?.name ?? (g.user as any)?.username ?? null;
    const res = await changeSlabStatus(slabs, action as StatusAction, { pi, customer, expiryDays, by });
    return Response.json(res);
  } catch (e) {
    console.error("Inventory status error:", e);
    return Response.json({ error: "Action failed" }, { status: 500 });
  }
}
