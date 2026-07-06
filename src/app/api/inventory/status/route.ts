// Slab lifecycle actions: reserve (PI hold, 7-day default expiry) / release /
// pack / dispatch / return. Gated to inventory roles; only ADMIN may override
// the reservation expiry. Invalid transitions are skipped, never forced.
// Body: { slabs: number[], action, pi?, customer?, expiryDays? }
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { inventoryGate, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { changeSlabStatus, DEFAULT_RESERVATION_DAYS, type StatusAction } from "@/lib/inventory/finishedSlab";
import { getUnapprovedSlabNumbers } from "@/lib/inventory/searchWhere";
import { isAdmin as isAdminCheck } from "@/lib/rbac";

const MAX_SLABS = 500;
const optText = z.preprocess(
  (v) => { const t = String(v ?? "").trim().slice(0, 120); return t === "" ? null : t; },
  z.string().nullable()
);
const bodySchema = z.object({
  action: z.enum(["reserve", "release", "pack", "dispatch", "return"]),
  slabs: z.array(z.coerce.number().finite().positive())
    .min(1, "No slabs selected")
    .max(MAX_SLABS, `Max ${MAX_SLABS} slabs per action`)
    .transform((a) => [...new Set(a)]),
  pi: optText.optional().default(null),
  customer: optText.optional().default(null),
  expiryDays: z.unknown().optional(),
});

export async function POST(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) return Response.json({ error: "Not available for this login" }, { status: 403 });
  try {
    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const body: any = parsed.data;
    const action = body.action;
    let slabs: number[] = body.slabs;
    if (!(await isAdminCheck())) {
      const unapproved = new Set(await getUnapprovedSlabNumbers(true));
      slabs = slabs.filter((n: number) => !unapproved.has(n));
      if (!slabs.length) return Response.json({ error: "Selected slabs are not available" }, { status: 400 });
    }
    const pi = body.pi;
    const customer = body.customer;
    if (action === "reserve" && !pi && !customer)
      return Response.json({ error: "Reserve needs a PI and/or customer" }, { status: 400 });

    // Only Admin may override the default hold; everyone else gets 7 days.
    // (Only meaningful for reserve — ignored for other actions.)
    let expiryDays = DEFAULT_RESERVATION_DAYS;
    if (action === "reserve" && body.expiryDays !== undefined && body.expiryDays !== null && String(body.expiryDays).trim() !== "") {
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
