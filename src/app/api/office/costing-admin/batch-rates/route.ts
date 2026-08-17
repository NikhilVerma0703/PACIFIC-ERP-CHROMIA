// Per-batch material rates — the write surface.
//
// ADMIN ONLY, like the rate card next door. A batch rate changes what a run
// cost, which is what a container is priced from; it is not a clerk's field.
//
// Three things this route refuses, each because the alternative produces a
// plausible number rather than an error:
//
//   * a category that is not a material. Conversion is a whole-plant monthly
//     figure and basis holds the denominators every sheet divides by, so a
//     per-batch value would make two batches incomparable under the same
//     column heading. Refused here AND in batchRates.applyBatchRates, because
//     this route is not the only way rows could arrive.
//   * a rate at or below zero. A zero does not fail loudly — it prices the
//     material at nothing and makes the batch look cheap.
//   * an item the catalogue does not know. The computation consumes rates by
//     name; a rate nobody reads is worse than none, because the screen shows
//     it as set.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, currentUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  effectiveRateCard, listBatchRates, RATE_ITEM_BY_KEY, RATE_ITEMS,
} from "@/lib/costing/rateCard";
import { compareToCard, isOverridable } from "@/lib/costing/batchRates";
import { loadBatchConsumption } from "@/lib/costing/batchData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** The catalogue a batch may set — materials and the dosing rules. */
const SETTABLE = RATE_ITEMS.filter((d) => isOverridable(d.category));

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return json({ error: "Admins only." }, 403);

  const batchKey = new URL(req.url).searchParams.get("batchKey")?.trim() ?? "";
  if (!batchKey) return json({ error: "Which batch? Pass ?batchKey=" }, 400);

  const rows = await listBatchRates(batchKey);
  // The card the batch WOULD price at, resolved for its own run date rather
  // than today: comparing a June batch's rates against today's card would
  // report a difference that is just the passage of time.
  const consumption = await loadBatchConsumption(batchKey);
  const onDate = consumption?.firstPress ?? new Date();
  const card = await effectiveRateCard(onDate);

  return json({
    batchKey,
    catalogue: SETTABLE,
    rows,
    card,
    comparison: compareToCard(card, rows),
  });
}

interface PostedRow {
  item?: unknown; variant?: unknown; rate?: unknown; note?: unknown;
}

function validate(r: PostedRow):
  | { item: string; variant: string; rate: number; note: string | null; category: string; unit: string }
  | string {
  const item = typeof r.item === "string" ? r.item.trim() : "";
  const def = RATE_ITEM_BY_KEY.get(item);
  if (!def) return `Unknown rate item '${item}'`;
  if (!isOverridable(def.category)) {
    return `'${def.label}' is a plant-wide rate and cannot be set on one batch`;
  }
  const variant = typeof r.variant === "string" ? r.variant.trim() : "";
  if (def.variants && !variant) return `'${def.label}' needs a supplier name`;
  if (!def.variants && variant) return `'${def.label}' does not take a supplier`;
  const rate = Number(r.rate);
  if (!Number.isFinite(rate) || rate <= 0) return `'${def.label}' needs a rate above zero`;
  const note = typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, 300) : null;
  return { item, variant, rate, note, category: def.category, unit: def.unit };
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return json({ error: "Admins only." }, 403);
  const user = (await currentUser())?.name ?? "admin";

  let body: { batchKey?: unknown; rows?: PostedRow[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const batchKey = typeof body.batchKey === "string" ? body.batchKey.trim() : "";
  if (!batchKey) return json({ error: "Which batch? Send batchKey." }, 400);

  const posted = Array.isArray(body.rows) ? body.rows : [];
  if (!posted.length) return json({ error: "No rates to save." }, 400);
  if (posted.length > 60) return json({ error: "Too many rates in one save." }, 400);

  // Validate the whole set before writing any of it — a half-applied save
  // leaves a batch costed on a mixture nobody chose.
  const rows = [];
  for (const p of posted) {
    const v = validate(p);
    if (typeof v === "string") return json({ error: v }, 400);
    rows.push(v);
  }

  for (const r of rows) {
    await prisma.costingBatchRate.upsert({
      where: {
        batchKey_item_variant: { batchKey, item: r.item, variant: r.variant },
      },
      create: {
        batchKey, category: r.category, item: r.item, variant: r.variant,
        unit: r.unit, rate: r.rate, note: r.note, createdBy: user,
      },
      // Corrected in place, not appended. A batch rate is one current fact
      // about one run; the plant-wide card is where revision history lives.
      update: { rate: r.rate, note: r.note, createdBy: user },
    });
  }

  return json({ ok: true, written: rows.length });
}

/** Remove one batch rate, so the item falls back to the card again. Takes the
 *  exact (item, variant) rather than an id, because that is what the screen
 *  knows and it cannot match more than one row. */
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) return json({ error: "Admins only." }, 403);

  const sp = new URL(req.url).searchParams;
  const batchKey = sp.get("batchKey")?.trim() ?? "";
  const item = sp.get("item")?.trim() ?? "";
  const variant = sp.get("variant")?.trim() ?? "";
  if (!batchKey || !item) return json({ error: "Pass ?batchKey= and ?item=" }, 400);

  const gone = await prisma.costingBatchRate.deleteMany({ where: { batchKey, item, variant } });
  if (!gone.count) return json({ error: "That batch has no such rate." }, 404);
  return json({ ok: true, fellBackToCard: item });
}
