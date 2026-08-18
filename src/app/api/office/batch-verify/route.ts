// Two sign-offs on a batch, and only the half you sign.
//
// THE FILTERING IS HERE, NOT IN THE COMPONENT. /office/costing hands the whole
// rate card to the browser in one payload because everyone who can open it is
// an admin. This route is opened by two more logins, so the same shortcut would
// put the plant's cost base one devtools tab away from a production manager who
// is only meant to confirm that the mixer weighed 41,873 kg of resin. What a
// caller may not read is never sent.
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
  costsFingerprint, isVerifySide, readableSides, signableSides, verifyState,
  weightsFingerprint, type VerificationRow, type VerifySide,
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

async function statesFor(batchKey: string, fp: Record<VerifySide, string>) {
  const rows = await prisma.costingBatchVerification.findMany({ where: { batchKey } });
  const by = new Map<string, VerificationRow>(
    rows.map((r) => [r.side, {
      side: r.side as VerifySide,
      fingerprint: r.fingerprint,
      verifiedBy: r.verifiedBy,
      verifiedAt: r.verifiedAt.toISOString(),
    }]),
  );
  return {
    WEIGHTS: verifyState(by.get("WEIGHTS"), fp.WEIGHTS),
    COSTS: verifyState(by.get("COSTS"), fp.COSTS),
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
      error: side === "WEIGHTS"
        ? "Only the named production manager signs the weights off."
        : "Only the store incharge signs the prices off.",
    }, 403);
  }

  const f = await fingerprints(batchKey);
  if (!f) return json({ error: "No mixer records for that batch." }, 404);

  await prisma.costingBatchVerification.upsert({
    where: { batchKey_side: { batchKey, side } },
    create: { batchKey, side, fingerprint: f[side], verifiedBy: me.name },
    update: { fingerprint: f[side], verifiedBy: me.name, verifiedAt: new Date() },
  });

  return json({ ok: true, side, verifiedBy: me.name });
}

/** Withdraw a sign-off — only your own half, and only the one you could give. */
export async function DELETE(req: NextRequest) {
  const me = await whoAmI();
  const sp = new URL(req.url).searchParams;
  const batchKey = sp.get("batchKey")?.trim() ?? "";
  const side = sp.get("side")?.trim() ?? "";

  if (!batchKey || !isVerifySide(side)) return json({ error: "Pass ?batchKey= and ?side=" }, 400);
  if (!me.sign.includes(side)) return json({ error: "That is not your half to withdraw." }, 403);

  const gone = await prisma.costingBatchVerification.deleteMany({ where: { batchKey, side } });
  if (!gone.count) return json({ error: "That half was not signed off." }, 404);
  return json({ ok: true, side });
}
