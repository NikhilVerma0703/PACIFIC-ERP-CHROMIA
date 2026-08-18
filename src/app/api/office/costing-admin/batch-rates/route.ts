// How a batch's materials were bought — the write surface.
//
// ADMIN ONLY, like the rate card next door. These lines change what a run cost,
// which is what a container is priced from; not a clerk's field.
//
// A material's lines are saved as a SET, not one at a time: the request carries
// every line for that item and this route replaces them. Anything else and
// deleting the second of three splits becomes its own endpoint, its own race,
// and its own way to leave a batch priced on a half-edited split.
//
// Four things this refuses, each because the alternative produces a plausible
// number rather than an error:
//
//   * a category that is not a material. Conversion is a whole-plant monthly
//     figure and basis holds the denominators every sheet divides by, so a
//     per-batch value would make two batches incomparable under the same
//     column heading.
//   * a rate at or below zero. A zero does not fail loudly — it prices the
//     material at nothing and makes the batch look cheap.
//   * a quantity at or below zero. Negative quantities show up as credits.
//   * an item the catalogue does not know. The computation consumes materials
//     by name; a line nobody reads is worse than none, because the screen shows
//     it as saved.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, currentUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  effectiveRateCard, listBatchMaterials, RATE_ITEM_BY_KEY, RATE_ITEMS,
} from "@/lib/costing/rateCard";
import { dosingOverrides, isOverridable, isSplittable } from "@/lib/costing/batchRates";
import { loadBatchConsumption } from "@/lib/costing/batchData";
import { bandOf, gritItemKey } from "@/lib/costing/batchData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** The catalogue a batch may set — materials, the dosing rules, and ₹ per USD. */
const SETTABLE = RATE_ITEMS.filter((d) => isOverridable(d.category, d.item));

/**
 * What the mixer weighed for each material, so the editor can show the number
 * a split has to add up to.
 *
 * Without this the person splitting resin is typing quantities against a figure
 * they have to find on another panel and remember — which is how 600 + 400 gets
 * entered against a batch that used 1,240 kg.
 */
async function mixerQuantities(batchKey: string): Promise<Record<string, { qty: number; unit: string }>> {
  const c = await loadBatchConsumption(batchKey);
  if (!c) return {};

  const out: Record<string, { qty: number; unit: string }> = {
    resin: { qty: c.resinKg, unit: "kg" },
    "filler-400": { qty: c.fillerKg / 1000, unit: "t" },
  };

  const byBand = new Map<string, number>();
  for (const g of c.gritCharges) byBand.set(g.band, (byBand.get(g.band) ?? 0) + g.kg);
  for (const [band, kg] of byBand) out[gritItemKey(bandOf(band))] = { qty: kg / 1000, unit: "t" };

  // The four chemicals have no weighed quantity — they are dosed on resin
  // weight — so the editor shows the derived figure rather than a blank.
  //
  // A BATCH THAT OVERRODE A DOSING RULE MUST SEE ITS OWN. Reading only the card
  // here meant a batch dosed at 1.4% silane showed the card's 1.2143% quantity
  // in the split boxes while the sheet priced the other one, so the two screens
  // disagreed about how much silane the run used — and the person splitting it
  // would have been allocating against a figure that never appears anywhere.
  const [card, batchDosing] = await Promise.all([
    effectiveRateCard(c.firstPress ?? new Date()),
    listBatchMaterials(batchKey).then(dosingOverrides),
  ]);
  const dose = (k: string): number | undefined => batchDosing[k] ?? card.rates[k];

  for (const [item, key] of [
    ["tio2", "tio2-pct-of-resin"], ["silane", "silane-pct-of-resin"],
    ["cobalt", "cobalt-pct-of-resin"], ["catalyst", "catalyst-pct-of-resin"],
  ] as const) {
    const d = dose(key);
    if (d !== undefined) out[item] = { qty: (c.resinKg * d) / 100, unit: "kg" };
  }
  // The legacy per-charge rule, in the same order of preference report.ts uses,
  // so the two never show different TiO₂.
  const perCharge = dose("tio2-kg-per-charge");
  if (out.tio2 === undefined && perCharge !== undefined) {
    out.tio2 = { qty: perCharge * c.mixerCharges, unit: "kg" };
  }

  return out;
}

/**
 * Every description anybody has typed against a costing line, deduplicated.
 *
 * The description column is what makes a split readable six months later -
 * "Aypols", "PO 4471", "trial drum" - and it was a bare text box, so the same
 * supplier got typed four ways and none of them grouped. This turns it into a
 * list that grows: type a new one and it is a suggestion for everyone next
 * time, with no master table to maintain and nothing to administer.
 *
 * Not scoped to the batch. The point is to reuse what the PLANT has already
 * called things; a per-batch list would suggest only what this batch already
 * says, which is the one place the answer is already on screen.
 */
async function knownDescriptions(): Promise<string[]> {
  const rows = await prisma.costingBatchMaterial.findMany({
    where: { description: { not: null } },
    select: { description: true },
    distinct: ["description"],
    orderBy: { description: "asc" },
    take: 500,
  });
  return rows
    .map((r) => (r.description ?? "").trim())
    .filter((d) => d.length > 0);
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return json({ error: "Admins only." }, 403);

  const batchKey = new URL(req.url).searchParams.get("batchKey")?.trim() ?? "";
  if (!batchKey) return json({ error: "Which batch? Pass ?batchKey=" }, 400);

  const rows = await listBatchMaterials(batchKey);
  // The card resolved for the batch's OWN run date, not today: comparing a June
  // batch against today's card would report a difference that is just the
  // passage of time.
  const c = await loadBatchConsumption(batchKey);
  const [card, mixer, descriptions] = await Promise.all([
    effectiveRateCard(c?.firstPress ?? new Date()),
    mixerQuantities(batchKey),
    knownDescriptions(),
  ]);

  return json({ batchKey, catalogue: SETTABLE, rows, card, mixer, descriptions });
}

interface PostedLine {
  seq?: unknown; qty?: unknown; rate?: unknown; description?: unknown;
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return json({ error: "Admins only." }, 403);
  const user = (await currentUser())?.name ?? "admin";

  let body: { batchKey?: unknown; item?: unknown; lines?: PostedLine[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const batchKey = typeof body.batchKey === "string" ? body.batchKey.trim() : "";
  if (!batchKey) return json({ error: "Which batch? Send batchKey." }, 400);

  const item = typeof body.item === "string" ? body.item.trim() : "";
  const def = RATE_ITEM_BY_KEY.get(item);
  if (!def) return json({ error: `Unknown material '${item}'` }, 400);
  if (!isOverridable(def.category, def.item)) {
    return json({ error: `'${def.label}' is a plant-wide rate and cannot be set on one batch` }, 400);
  }

  const posted = Array.isArray(body.lines) ? body.lines : [];
  if (posted.length > 30) return json({ error: "Too many lines for one material." }, 400);

  // Validate the whole set before writing any of it — a half-applied save
  // leaves a batch priced on a split nobody chose.
  const lines: Array<{ seq: number; qty: number | null; rate: number; description: string }> = [];
  let restLines = 0;
  posted.forEach((p, i) => {
    lines.push({ seq: typeof p.seq === "number" ? p.seq : i, qty: null, rate: 0, description: "" });
  });

  for (let i = 0; i < posted.length; i++) {
    const p = posted[i];
    const rate = Number(p.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return json({ error: `Line ${i + 1} of ${def.label} needs a price above zero.` }, 400);
    }

    let qty: number | null = null;
    const rawQty = p.qty;
    const blank = rawQty === null || rawQty === undefined || rawQty === "";
    if (!blank) {
      qty = Number(rawQty);
      if (!Number.isFinite(qty) || qty <= 0) {
        return json({ error: `Line ${i + 1} of ${def.label} needs a quantity above zero, or none at all for "the rest".` }, 400);
      }
    } else if (!isSplittable(def.category, def.item)) {
      // A dosing factor or an exchange rate is one value; a blank means nothing.
      qty = null;
    } else {
      restLines += 1;
    }

    // Two "the rest" lines cannot both be the rest — the second would price
    // nothing and the person would not know why.
    if (restLines > 1) {
      return json({ error: `Only one line of ${def.label} can be left blank to mean "the rest".` }, 400);
    }

    // A dosing rule has nothing to split, so more than one line is meaningless.
    if (!isSplittable(def.category, def.item) && posted.length > 1) {
      return json({ error: `${def.label} takes one value, not a split.` }, 400);
    }

    lines[i] = {
      seq: i,
      qty,
      rate,
      description: typeof p.description === "string" ? p.description.trim().slice(0, 200) : "",
    };
  }

  // Replace this material's lines wholesale, in one transaction. Deleting then
  // inserting outside a transaction would leave the batch briefly priced at the
  // card, and a read landing in that window would show a different total.
  await prisma.$transaction(async (tx) => {
    await tx.costingBatchMaterial.deleteMany({ where: { batchKey, item } });
    if (!lines.length) return;
    await tx.costingBatchMaterial.createMany({
      data: lines.map((l) => ({
        batchKey, item, category: def.category, unit: def.unit,
        seq: l.seq, qty: l.qty, rate: l.rate,
        description: l.description || null, createdBy: user,
      })),
    });
  });

  return json({ ok: true, item, lines: lines.length });
}

/** Remove every line for one material, so it falls back to the card again. */
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) return json({ error: "Admins only." }, 403);

  const sp = new URL(req.url).searchParams;
  const batchKey = sp.get("batchKey")?.trim() ?? "";
  const item = sp.get("item")?.trim() ?? "";
  if (!batchKey || !item) return json({ error: "Pass ?batchKey= and ?item=" }, 400);

  const gone = await prisma.costingBatchMaterial.deleteMany({ where: { batchKey, item } });
  if (!gone.count) return json({ error: "That batch has no lines for that material." }, 404);
  return json({ ok: true, fellBackToCard: item, removed: gone.count });
}
