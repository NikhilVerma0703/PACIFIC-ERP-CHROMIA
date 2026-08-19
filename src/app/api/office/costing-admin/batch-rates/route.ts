// How a batch's materials were bought — the write surface.
//
// ADMIN plus the TWO BATCH VERIFIERS — the store incharge (STORE role) and the
// named production verifier (WEIGHTS_VERIFIER_EMAILS). It was admin-only, like
// the rate card next door; the owner widened it on 2026-08-19 so the two people
// who sign a batch off can enter its splits, prices and doses themselves, from
// their own page (/office/batch-verify renders the same materials panel). What
// did NOT widen: the plant-wide rate card, the computed sheet and the rest of
// /office/costing stay behind the ADMIN gate — this route is per-batch lines
// only, and the middleware carve-out is scoped to exactly this path.
//
// The verifier check is HERE, not just in middleware: middleware admits the
// coarse roles (STORE, LINE_MANAGER) because it cannot read the env var, but
// "Line Manager" is a rank and the production verifier is one named person —
// a LINE_MANAGER not on the list gets a 403 from this route.
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
  type EffectiveRateCard, type SavedMaterialLine,
} from "@/lib/costing/rateCard";
import { dosingOverrides, isOverridable, isSplittable } from "@/lib/costing/batchRates";
import {
  costsFingerprint, verifyMarks, weightsFingerprint,
  type VerificationRow, type VerifySide,
} from "@/lib/costing/verification";
import { isBatchVerifier } from "@/lib/costing/verification";
import { loadBatchConsumption } from "@/lib/costing/batchData";
import { bandOf, gritItemKey } from "@/lib/costing/batchData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/**
 * Who may price a batch, and the name their writes are attributed to.
 *
 * Admin, or one of the two batch verifiers (see the header). ONE resolution
 * for both questions because they must never disagree: every mutation below
 * logs to action_log with this name, and the batch history drawer reads that
 * log — a write the gate allowed under one identity and the log recorded
 * under another would be an edit nobody made.
 *
 * Null means "not yours to touch"; the caller turns it into the 403.
 */
async function rateEditor(): Promise<{ name: string } | null> {
  const u = await currentUser();
  if (!u) return null;
  const role = (u as { role?: string }).role ?? null;
  const email = (u as { email?: string }).email ?? null;
  const ok = (await isAdmin())
    || isBatchVerifier(role, email, process.env.WEIGHTS_VERIFIER_EMAILS);
  if (!ok) return null;
  // Name over email over "unknown" — the drawer shows people, not addresses,
  // and the old `?? "admin"` fallback would file a verifier's edit under a
  // name that is now provably wrong.
  return { name: (u as { name?: string }).name ?? email ?? "unknown" };
}

const FORBIDDEN =
  "Only an admin or one of the two batch verifiers can price a batch.";

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
  return out;
}

/**
 * Suppliers to suggest in this batch's assignment boxes.
 *
 * PLANT-WIDE, plus the resin suppliers named on this batch's own rate card.
 * The plant buys from the same handful of suppliers batch after batch, so a
 * list scoped to one batch would be empty exactly when it is first needed and
 * would let the same supplier be spelled four ways across four runs - which is
 * the thing that makes a year of splits impossible to group afterwards.
 *
 * It suggests; it does not fill anything in. Nothing here is written to a line
 * that somebody did not choose.
 */
async function suggestedSuppliers(card: { resinBySupplier: Record<string, number> }): Promise<string[]> {
  const rows = await prisma.costingBatchMaterial.findMany({
    where: { description: { not: null } },
    select: { description: true },
    distinct: ["description"],
    take: 500,
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...Object.keys(card.resinBySupplier), ...rows.map((r) => r.description ?? "")]) {
    const t = v.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Whether the two sign-offs on this batch still stand.
 *
 * Shown on the admin panel because the person changing a rate is exactly the
 * person who needs to know that somebody has already checked it - and that
 * their change is about to invalidate that check. Read-only here: admin sees
 * both and signs neither.
 */
async function verification(batchKey: string, card: EffectiveRateCard, lines: SavedMaterialLine[]) {
  const c = await loadBatchConsumption(batchKey);
  const fp: Record<VerifySide, string> = {
    WEIGHTS: c ? weightsFingerprint(c) : "",
    COSTS: costsFingerprint({
      lines: lines.map((l) => ({ item: l.item, seq: l.seq, qty: l.qty, rate: l.rate })),
      cardRates: card.rates,
      resinBySupplier: card.resinBySupplier,
    }),
  };
  const stored = await prisma.costingBatchVerification.findMany({ where: { batchKey } });
  const rows: VerificationRow[] = stored.map((r) => ({
    side: r.side as VerifySide, fingerprint: r.fingerprint,
    verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt.toISOString(),
  }));
  // A LIST per side: both verifiers may hold a mark on the same side now
  // (owner, 2026-08-18), and each lapses on its own.
  return {
    WEIGHTS: verifyMarks(rows, "WEIGHTS", fp.WEIGHTS),
    COSTS: verifyMarks(rows, "COSTS", fp.COSTS),
  };
}

export async function GET(req: NextRequest) {
  if (!(await rateEditor())) return json({ error: FORBIDDEN }, 403);

  const batchKey = new URL(req.url).searchParams.get("batchKey")?.trim() ?? "";
  if (!batchKey) return json({ error: "Which batch? Pass ?batchKey=" }, 400);

  const rows = await listBatchMaterials(batchKey);
  // The card resolved for the batch's OWN run date, not today: comparing a June
  // batch against today's card would report a difference that is just the
  // passage of time.
  const c = await loadBatchConsumption(batchKey);
  const [card, mixer] = await Promise.all([
    effectiveRateCard(c?.firstPress ?? new Date()),
    mixerQuantities(batchKey),
  ]);
  const [descriptions, signoff] = await Promise.all([
    suggestedSuppliers(card),
    verification(batchKey, card, rows),
  ]);

  return json({ batchKey, catalogue: SETTABLE, rows, card, mixer, descriptions, signoff });
}

interface PostedLine {
  seq?: unknown; qty?: unknown; rate?: unknown; description?: unknown; note?: unknown;
}

export async function POST(req: NextRequest) {
  const editor = await rateEditor();
  if (!editor) return json({ error: FORBIDDEN }, 403);
  const user = editor.name;

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
  const lines: Array<{ seq: number; qty: number | null; rate: number; description: string; note: string }> = [];
  let restLines = 0;
  posted.forEach((p, i) => {
    lines.push({ seq: typeof p.seq === "number" ? p.seq : i, qty: null, rate: 0, description: "", note: "" });
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
      // Free text, and longer: the description names the supplier, the note is
      // where "short delivery, balance invoiced next month" goes.
      note: typeof p.note === "string" ? p.note.trim().slice(0, 500) : "",
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
        description: l.description || null, note: l.note || null, createdBy: user,
      })),
    });
    // The edit trail. costing_batch_material only remembers its CURRENT lines
    // — the wholesale replace above wipes who set what before — so each save is
    // also appended to action_log, which nothing deletes from. This is what the
    // costing dashboard's "edit history" drawer reads.
    await tx.actionLog.create({
      data: {
        actor: user, batchKey, kind: "costing-batch-rate", model: "CostingBatchMaterial",
        summary: `${user} set ${def.label}: ${lines.length} line${lines.length === 1 ? "" : "s"}`,
        payload: { item, lines },
      },
    });
  });

  return json({ ok: true, item, lines: lines.length });
}

/** Remove every line for one material, so it falls back to the card again. */
export async function DELETE(req: NextRequest) {
  const editor = await rateEditor();
  if (!editor) return json({ error: FORBIDDEN }, 403);
  const user = editor.name;

  const sp = new URL(req.url).searchParams;
  const batchKey = sp.get("batchKey")?.trim() ?? "";
  const item = sp.get("item")?.trim() ?? "";
  if (!batchKey || !item) return json({ error: "Pass ?batchKey= and ?item=" }, 400);

  const gone = await prisma.costingBatchMaterial.deleteMany({ where: { batchKey, item } });
  if (!gone.count) return json({ error: "That batch has no lines for that material." }, 404);

  // Same trail as the save: a clear changes what the batch costs just as much
  // as a set does, and the drawer must show who did it and when.
  const label = RATE_ITEM_BY_KEY.get(item)?.label ?? item;
  await prisma.actionLog.create({
    data: {
      actor: user, batchKey, kind: "costing-batch-rate", model: "CostingBatchMaterial",
      summary: `${user} cleared ${label} — it prices at the card again`,
      payload: { item, cleared: gone.count },
    },
  });

  return json({ ok: true, fellBackToCard: item, removed: gone.count });
}
