// The batch's consumables sheet — read and written by the two people who sign
// a batch off, and by nobody else.
//
// THE GATE IS signableSides, NOT A ROLE LIST. Satya is a LINE_MANAGER and so
// are people who must not touch this; what separates them is being named in
// WEIGHTS_VERIFIER_EMAILS. The store incharge qualifies by role (canVerifyCosts
// = STORE) and admin by rank. Reusing the verify screen's own function is the
// point: this sheet is part of that sign-off, so exactly the people who may
// mark the batch may fill in what it consumed — one rule, one place, and it
// cannot drift from the buttons beside it.
//
// Re-checked here and not trusted from middleware, for the reason the verify
// page states: a UI condition is not an authorisation, and this route is its
// own endpoint.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { signableSides } from "@/lib/costing/verification";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { batchUsage, editProblem, BATCH_STATIONS, type UsageEdit } from "@/lib/consumables/batchUsage";
import { MODEL_DEPT } from "@/lib/consumables/dept";

const db = prisma as any;
export const dynamic = "force-dynamic";

const STATION_SET = new Set(BATCH_STATIONS.map((s) => s.model));

async function gate() {
  const u = await currentUser();
  if (!u) return { ok: false as const, status: 401, error: "Not signed in.", name: "" };
  const role = (u as { role?: string }).role ?? null;
  const email = (u as { email?: string }).email ?? null;
  const name = (u as { name?: string }).name ?? email ?? "unknown";
  if (signableSides(role, email, process.env.WEIGHTS_VERIFIER_EMAILS).length === 0) {
    return { ok: false as const, status: 403, error: "Only the batch verifiers and the store can fill this in.", name };
  }
  return { ok: true as const, status: 200, error: "", name };
}

export async function GET(req: NextRequest) {
  const me = await gate();
  if (!me.ok) return Response.json({ error: me.error }, { status: me.status });
  const batchKey = new URL(req.url).searchParams.get("batchKey")?.trim() ?? "";
  if (!batchKey) return Response.json({ error: "Pick a batch first." }, { status: 400 });
  try {
    return Response.json({ ...(await batchUsage(batchKey)), me: me.name });
  } catch (e) {
    console.error("batch-consumables GET:", e);
    return Response.json({ error: "Could not read the batch's consumables." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const me = await gate();
  if (!me.ok) return Response.json({ error: me.error }, { status: me.status });

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request body." }, { status: 400 }); }
  const batchKey = normalizeBatch(typeof body?.batchKey === "string" ? body.batchKey : "");
  if (!batchKey) return Response.json({ error: "Pick a batch first." }, { status: 400 });

  const edits: UsageEdit[] = Array.isArray(body?.edits) ? body.edits : [];
  const deletes: string[] = Array.isArray(body?.deletes) ? body.deletes.map(String).filter(Boolean) : [];
  if (edits.length === 0 && deletes.length === 0) return Response.json({ error: "Nothing to save." }, { status: 400 });
  if (edits.length > 200) return Response.json({ error: "Too many lines in one save (max 200)." }, { status: 400 });

  // EVERY LINE IS CHECKED BEFORE ANY LINE IS WRITTEN. A sheet half-saved
  // because its ninth row had a typo is worse than one not saved at all: the
  // person cannot see which half landed, and the batch carries a mixture.
  for (const e of edits) {
    const bad = editProblem(e, STATION_SET);
    if (bad) return Response.json({ error: bad }, { status: 400 });
  }

  try {
    // Departments are upserted by name, exactly as the floor panel does it —
    // the eight seeded names already exist, so this is a read in practice.
    const depts = new Map<string, string>();
    for (const station of new Set(edits.map((e) => e.station))) {
      const name = MODEL_DEPT[station] ?? "Production";
      if (!depts.has(name)) {
        const d = await db.consumableDepartment.upsert({ where: { name }, update: {}, create: { name } });
        depts.set(name, d.id);
      }
    }
    const stocks: any[] = await db.inventoryStock.findMany({ select: { id: true, itemName: true } });
    const byName = new Map<string, string>(stocks.map((s) => [String(s.itemName).toLowerCase(), String(s.id)]));

    let saved = 0;
    let deleted = 0;
    await db.$transaction(async (tx: any) => {
      // Deletes first: a sheet that replaces a line does it as delete + create,
      // and doing it the other way round could trip a uniqueness rule later.
      if (deletes.length) {
        const r = await tx.consumptionEntry.deleteMany({ where: { id: { in: deletes }, batchKey } });
        deleted = r.count;
      }
      for (const e of edits) {
        const itemName = String(e.itemName).trim();
        const unit = String(e.unit ?? "").trim() || "PCS";
        const quantity = Number(e.quantity);
        const unitPrice = e.unitPrice == null || String(e.unitPrice) === "" ? null : Number(e.unitPrice);
        const stockId = byName.get(itemName.toLowerCase()) ?? null;
        // The price carries its author and time whenever it is present. A line
        // saved with no price clears both rather than keeping a stale name
        // beside an empty figure.
        const priced = unitPrice == null
          ? { unitPrice: null, pricedBy: null, pricedAt: null }
          : { unitPrice, pricedBy: me.name, pricedAt: new Date() };

        if (e.id) {
          // Scoped to the batch: an id from another batch cannot be edited
          // through this batch's sheet.
          const r = await tx.consumptionEntry.updateMany({
            where: { id: e.id, batchKey },
            data: {
              itemName, quantity, unit, inventoryStockId: stockId,
              station: e.station, operatorName: e.operatorName ?? null, ...priced,
            },
          });
          saved += r.count;
        } else {
          await tx.consumptionEntry.create({
            data: {
              departmentId: depts.get(MODEL_DEPT[e.station] ?? "Production")!,
              itemName, quantity, unit, inventoryStockId: stockId,
              batchKey, station: e.station,
              operatorName: e.operatorName ?? null,
              enteredBy: me.name,
              remarks: `Entered at batch sign-off by ${me.name}`,
              ...priced,
            },
          });
          saved += 1;
        }
      }
    });

    // NO STOCK DECREMENT HERE, and that is deliberate. The floor panel
    // decrements because it reports a consumption as it happens; this sheet is
    // a reconciliation written days later, often over lines the floor already
    // logged, and decrementing again would take the same drum out of stock
    // twice. The store adjusts stock on its own screen.
    return Response.json({ ok: true, saved, deleted, ...(await batchUsage(batchKey)) });
  } catch (e) {
    console.error("batch-consumables POST:", e);
    return Response.json({ error: "Could not save the sheet — try again." }, { status: 500 });
  }
}
