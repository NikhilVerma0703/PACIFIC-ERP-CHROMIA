// Two sign-offs on a batch — both people, both halves, one mark per person.
//
// Originally each verifier saw and signed exactly one half ("only the half you
// sign"). The owner widened that on 2026-08-18: the store incharge and the
// named production verifier each mark BOTH the prices and the consumption as
// correct, so both halves are now served to both of them, and each side holds
// one mark PER PERSON (scripts/0048 swapped the unique to include verified_by).
// What a caller may not read is still never sent — a login that is neither
// admin nor one of the two verifiers gets nothing.
//
// Neither half carries a total. The weights side is what the mixer recorded and
// nothing derived from a rate; the prices side is unit rates and nothing
// multiplied by a quantity. Adding those two together is the costed sheet,
// which stays where it is, behind the ADMIN-only gate next door.

import { NextRequest, NextResponse } from "next/server";

import { currentUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { loadBatchConsumption, listCostableBatches } from "@/lib/costing/batchData";
import { effectiveRateCard, listBatchMaterials, RATE_ITEMS } from "@/lib/costing/rateCard";
import {
  costsFingerprint, isVerifySide, readableSides, signableSides, verifyMarks,
  weightsFingerprint, SIDE_LABEL, type VerificationRow, type VerifySide,
} from "@/lib/costing/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** The catalogue labels the prices side needs, without shipping the catalogue's
 *  hints and categories to a screen that does not use them. */
const LABEL = new Map(RATE_ITEMS.map((d) => [d.item, { label: d.label, unit: d.unit }]));

async function whoAmI() {
  const u = await currentUser();
  const role = (u as { role?: string } | null)?.role ?? null;
  const email = (u as { email?: string } | null)?.email ?? null;
  const name = (u as { name?: string } | null)?.name ?? email ?? "unknown";
  const raw = process.env.WEIGHTS_VERIFIER_EMAILS;
  return { role, email, name, can: readableSides(role, email, raw), sign: signableSides(role, email, raw) };
}

/** Both fingerprints for one batch, from the same reads the screen renders. */
async function fingerprints(batchKey: string) {
  const c = await loadBatchConsumption(batchKey);
  if (!c) return null;
  const [card, lines] = await Promise.all([
    effectiveRateCard(c.firstPress ?? new Date()),
    listBatchMaterials(batchKey),
  ]);
  return {
    consumption: c,
    card,
    lines,
    WEIGHTS: weightsFingerprint(c),
    COSTS: costsFingerprint({
      lines: lines.map((l) => ({ item: l.item, seq: l.seq, qty: l.qty, rate: l.rate })),
      cardRates: card.rates,
      resinBySupplier: card.resinBySupplier,
    }),
  };
}

/** Every mark on the batch, per side — a LIST per side now that both people
 *  can hold one. An empty list is "unverified". */
async function statesFor(batchKey: string, fp: Record<VerifySide, string>) {
  const stored = await prisma.costingBatchVerification.findMany({ where: { batchKey } });
  const rows: VerificationRow[] = stored.map((r) => ({
    side: r.side as VerifySide,
    fingerprint: r.fingerprint,
    verifiedBy: r.verifiedBy,
    verifiedAt: r.verifiedAt.toISOString(),
  }));
  return {
    WEIGHTS: verifyMarks(rows, "WEIGHTS", fp.WEIGHTS),
    COSTS: verifyMarks(rows, "COSTS", fp.COSTS),
  };
}

export async function GET(req: NextRequest) {
  const me = await whoAmI();
  if (!me.can.length) return json({ error: "You have nothing to verify on this screen." }, 403);

  const batchKey = new URL(req.url).searchParams.get("batchKey")?.trim() ?? "";
  if (!batchKey) {
    // The picker is common to both halves: which batch, not what it cost.
    return json({ batches: await listCostableBatches(45), can: me.can, sign: me.sign });
  }

  const f = await fingerprints(batchKey);
  if (!f) return json({ error: "No mixer records for that batch." }, 404);
  const state = await statesFor(batchKey, { WEIGHTS: f.WEIGHTS, COSTS: f.COSTS });

  const body: Record<string, unknown> = {
    batchKey,
    batch: f.consumption.batch,
    design: f.consumption.design,
    can: me.can,
    sign: me.sign,
    // The signed-in name, so the screen can tell "you have signed this" from
    // "the other verifier has" — marks are per person now.
    me: me.name,
    verification: state,
  };

  // ---- the weighed half: what the mixer recorded, nothing derived ----
  //
  // The four chemicals are deliberately absent. Their quantities are computed
  // from a dosing percentage, so printing them here would publish the dosing
  // factors by division — and they are not weights anybody can check against a
  // scale, which is the whole job being asked for.
  if (me.can.includes("WEIGHTS")) {
    const c = f.consumption;
    body.weights = {
      resinKg: c.resinKg,
      resinCycles: c.resinCycles,
      resinByTank: c.resinByTank,
      gritCharges: c.gritCharges,
      gritUnresolvedKg: c.gritUnresolvedKg,
      fillerKg: c.fillerKg,
      mixerCharges: c.mixerCharges,
      firstPress: c.firstPress?.toISOString() ?? null,
      lastPress: c.lastPress?.toISOString() ?? null,
    };
  }

  // ---- the priced half: unit rates, never a quantity or an amount ----
  if (me.can.includes("COSTS")) {
    const own = new Map<string, Array<{ seq: number; rate: number; description: string }>>();
    for (const l of f.lines) {
      const bucket = own.get(l.item) ?? [];
      bucket.push({ seq: l.seq, rate: l.rate, description: l.description ?? "" });
      own.set(l.item, bucket);
    }

    const prices = [...new Set([...Object.keys(f.card.rates), ...own.keys()])]
      .filter((item) => LABEL.has(item))
      .sort()
      .map((item) => ({
        item,
        label: LABEL.get(item)!.label,
        unit: LABEL.get(item)!.unit,
        cardRate: Number.isFinite(f.card.rates[item]) ? f.card.rates[item] : null,
        batchLines: own.get(item) ?? [],
      }));

    body.prices = {
      onDate: f.card.onDate,
      resinBySupplier: f.card.resinBySupplier,
      missing: f.card.missing,
      items: prices,
    };
  }

  return json(body);
}

/**
 * Sign one half off.
 *
 * The fingerprint is recomputed HERE rather than accepted from the request. A
 * client that sent its own would let a stale tab — or anybody with curl — mark
 * a batch verified against numbers that are no longer the numbers.
 */
export async function POST(req: NextRequest) {
  const me = await whoAmI();

  let body: { batchKey?: unknown; side?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const batchKey = typeof body.batchKey === "string" ? body.batchKey.trim() : "";
  if (!batchKey) return json({ error: "Which batch? Send batchKey." }, 400);
  if (!isVerifySide(body.side)) return json({ error: "side must be WEIGHTS or COSTS." }, 400);
  const side: VerifySide = body.side;

  if (!me.sign.includes(side)) {
    return json({
      error: "Only the two batch verifiers — the store incharge and the named " +
        "production verifier — sign a batch off.",
    }, 403);
  }

  const f = await fingerprints(batchKey);
  if (!f) return json({ error: "No mixer records for that batch." }, 404);

  // Keyed per PERSON: the other verifier's mark on the same side stands.
  await prisma.costingBatchVerification.upsert({
    where: { batchKey_side_verifiedBy: { batchKey, side, verifiedBy: me.name } },
    create: { batchKey, side, fingerprint: f[side], verifiedBy: me.name },
    update: { fingerprint: f[side], verifiedAt: new Date() },
  });

  // The mark itself lives in costing_batch_verification, but that table only
  // holds the CURRENT marks — a withdrawal or a re-sign erases the trail. The
  // owner asked for the marks to be visible in the batch's edit history, so
  // each act is also appended to action_log, which nothing deletes from.
  await prisma.actionLog.create({
    data: {
      actor: me.name, batchKey, kind: "costing-verify", model: "CostingBatchVerification",
      summary: `${me.name} marked the ${SIDE_LABEL[side].toLowerCase()} correct`,
      payload: { side, fingerprint: f[side] },
    },
  });

  return json({ ok: true, side, verifiedBy: me.name });
}

/** Withdraw a sign-off — only your OWN mark; the other verifier's stands. */
export async function DELETE(req: NextRequest) {
  const me = await whoAmI();
  const sp = new URL(req.url).searchParams;
  const batchKey = sp.get("batchKey")?.trim() ?? "";
  const side = sp.get("side")?.trim() ?? "";

  if (!batchKey || !isVerifySide(side)) return json({ error: "Pass ?batchKey= and ?side=" }, 400);
  if (!me.sign.includes(side)) return json({ error: "That is not yours to withdraw." }, 403);

  // Scoped to verifiedBy: without it this would erase the OTHER person's mark
  // too, which is exactly the overwrite the per-person key exists to prevent.
  const gone = await prisma.costingBatchVerification.deleteMany({
    where: { batchKey, side, verifiedBy: me.name },
  });
  if (!gone.count) return json({ error: "You have no mark on that side to withdraw." }, 404);

  await prisma.actionLog.create({
    data: {
      actor: me.name, batchKey, kind: "costing-verify", model: "CostingBatchVerification",
      summary: `${me.name} withdrew their mark on the ${SIDE_LABEL[side].toLowerCase()}`,
      payload: { side, withdrawn: true },
    },
  });

  return json({ ok: true, side });
}
