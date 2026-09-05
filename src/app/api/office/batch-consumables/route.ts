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
import {
  batchUsage, editProblem, floorEditProblem, updatePatch, isUpdate, pricePatch, saverName,
  BATCH_STATIONS, LINE_SOURCE, SHEET_ITEM_WHERE, type UsageEdit,
} from "@/lib/consumables/batchUsage";
import { MODEL_DEPT } from "@/lib/consumables/dept";

const db = prisma as any;
export const dynamic = "force-dynamic";

const STATION_SET = new Set(BATCH_STATIONS.map((s) => s.model));

async function gate() {
  const u = await currentUser();
  if (!u) return { ok: false as const, status: 401, error: "Not signed in.", name: "" };
  const role = (u as { role?: string }).role ?? null;
  const email = (u as { email?: string }).email ?? null;
  // Never "": this name is stamped as pricedBy on every price set through the
  // sheet, and `name ?? email` passed an empty-string name straight through.
  const name = saverName((u as { name?: string }).name, email);
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
  if (deletes.length > 200) return Response.json({ error: "Too many lines removed in one save (max 200)." }, { status: 400 });
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
    // A LINE THE FLOOR LOGGED MAY NOT BE DELETED HERE, and that is a stock rule
    // rather than a permissions one. quickLog decremented the item when the
    // station reported it; deleting the row leaves that decrement standing
    // against nothing, so the stock is short by a quantity no screen can now
    // name. The sheet may correct such a line — quantity, price, person — it
    // may not make it vanish, nor (next guard) move it to another item or
    // unit. Removing it for real is a store adjustment, on the store's own
    // screen, where the stock moves with it.
    if (deletes.length) {
      const floorRows: any[] = await db.consumptionEntry.findMany({
        where: { id: { in: deletes }, batchKey, source: LINE_SOURCE.floor },
        select: { itemName: true },
      });
      if (floorRows.length) {
        const names = [...new Set(floorRows.map((r) => String(r.itemName)))].join(", ");
        return Response.json({
          error: `${names} was logged at the machine, so it cannot be removed here — correct the quantity instead, or ask the store to adjust the stock.`,
        }, { status: 400 });
      }
    }

    // NOR MAY A FLOOR LINE BE MOVED TO ANOTHER ITEM OR UNIT, for the same stock
    // reason, and this is checked here — before the transaction, like the
    // delete guard — not left to the browser's read-only boxes. The edited rows
    // are read once with the stock row each is linked to; the rows that are the
    // floor's are held to that stock row's name and to their own unit
    // (floorEditProblem). What each existing row IS also decides, below, which
    // columns its edit may rewrite at all.
    const existing = new Map<string, { itemName: string; unit: string; fromFloor: boolean; stockName: string | null }>();
    const editIds = edits.filter(isUpdate).map((e) => e.id);
    if (editIds.length) {
      const rows: any[] = await db.consumptionEntry.findMany({
        where: { id: { in: editIds }, batchKey },
        select: { id: true, itemName: true, unit: true, source: true, inventoryStock: { select: { itemName: true } } },
      });
      for (const r of rows) {
        existing.set(String(r.id), {
          itemName: String(r.itemName ?? ""), unit: String(r.unit ?? ""),
          fromFloor: r.source === LINE_SOURCE.floor,
          stockName: r.inventoryStock?.itemName == null ? null : String(r.inventoryStock.itemName),
        });
      }
      for (const e of edits) {
        if (!isUpdate(e)) continue;
        const row = existing.get(e.id);
        if (!row?.fromFloor) continue;
        const bad = floorEditProblem(row, e);
        if (bad) return Response.json({ error: bad }, { status: 400 });
      }
    }

    // Departments are upserted by name, exactly as the floor panel does it —
    // the eight seeded names already exist, so this is a read in practice.
    const depts = new Map<string, string>();
    for (const station of new Set(edits.map((e) => e.station).filter((s): s is string => typeof s === "string"))) {
      const name = MODEL_DEPT[station] ?? "Production";
      if (!depts.has(name)) {
        const d = await db.consumableDepartment.upsert({ where: { name }, update: {}, create: { name } });
        depts.set(name, d.id);
      }
    }
    const departmentFor = (station: string) => depts.get(MODEL_DEPT[station] ?? "Production")!;
    // The same list the sheet's dropdown shows (SHEET_ITEM_WHERE): a line typed
    // against resin or grit saves unlinked rather than linking to a stock row
    // the floor panel deliberately never offers.
    const stocks: any[] = await db.inventoryStock.findMany({ where: SHEET_ITEM_WHERE, select: { id: true, itemName: true } });
    const byName = new Map<string, { id: string; itemName: string }>(
      stocks.map((s) => [String(s.itemName).toLowerCase(), { id: String(s.id), itemName: String(s.itemName) }]),
    );
    const stockFor = (itemName: string) => byName.get(itemName.trim().toLowerCase());
    // When the batch actually ran — the date a line entered here is filed
    // under. Read from the press, which every batch passes; null on a batch
    // with no press rows, and then the save's own time is the honest answer.
    const firstPress: any = await db.press.findFirst({
      where: { batchKey, date: { not: null } }, orderBy: { date: "asc" }, select: { date: true },
    }).catch(() => null);
    const batchDate: Date | null = firstPress?.date ? new Date(firstPress.date) : null;

    let saved = 0;
    let deleted = 0;
    await db.$transaction(async (tx: any) => {
      // Deletes first: a sheet that replaces a line does it as delete + create,
      // and doing it the other way round could trip a uniqueness rule later.
      if (deletes.length) {
        const r = await tx.consumptionEntry.deleteMany({ where: { id: { in: deletes }, batchKey } });
        deleted = r.count;
      }
      const at = new Date();
      for (const e of edits) {
        if (isUpdate(e)) {
          // ONLY THE COLUMNS THE EDIT CARRIES ARE WRITTEN — updatePatch keys
          // every column on the field being present, so a stale sheet that
          // changed one box cannot put a colleague's other boxes back. On a
          // floor row it never emits item or unit, whatever was sent.
          const data = updatePatch(e, {
            fromFloor: existing.get(e.id)?.fromFloor ?? false,
            stockFor, departmentFor, by: me.name, at,
          });
          if (Object.keys(data).length === 0) continue;
          // Scoped to the batch: an id from another batch cannot be edited
          // through this batch's sheet.
          const r = await tx.consumptionEntry.updateMany({ where: { id: e.id, batchKey }, data });
          saved += r.count;
        } else {
          const itemName = String(e.itemName).trim();
          const stock = stockFor(itemName);
          // ABSENT PRICE = LEAVE IT ALONE. The sheet sends `unitPrice` only
          // for a line whose price box was touched, so one verifier saving a
          // new line can no longer blank the price another typed — nor
          // re-stamp their name on it. pricePatch returns null for "not
          // carried"; see batchUsageRules.
          const priced = pricePatch(e, me.name, at);
          await tx.consumptionEntry.create({
            data: {
              departmentId: departmentFor(e.station),
              // THE ITEM'S NAME IS THE STOCK ROW'S NAME whenever the line is
              // linked to one — "gloves" typed against the "Gloves" row must
              // not become a second item on the dashboards.
              itemName: stock?.itemName ?? itemName,
              quantity: Number(e.quantity),
              unit: String(e.unit ?? "").trim() || "PCS",
              inventoryStockId: stock?.id ?? null,
              batchKey, station: e.station,
              operatorName: e.operatorName ?? null,
              enteredBy: me.name,
              // WHICH PATH WROTE THIS. Read back as the sheet's "from the
              // floor" badge — see scripts/0075 for why it is a column and not
              // an inference from operatorName, which both paths set.
              source: LINE_SOURCE.signoff,
              // The consumption belongs to the batch's own time, not to the day
              // somebody reconciled it, or every KPI that filters by date files
              // a week-old drum under sign-off day.
              date: batchDate ?? at,
              remarks: `Entered at batch sign-off by ${me.name}`,
              ...(priced ?? {}),
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
