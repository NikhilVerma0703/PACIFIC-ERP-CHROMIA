// Grit assigned silo by silo — the write surface, and the read that feeds it.
//
// WHO. Admin, or either batch verifier. The same resolution as the batch-rates
// route next door and for the same reason: every mutation here is logged under
// this name, and a write the gate allowed under one identity and the log
// recorded under another would be an edit nobody made.
//
// WHAT THIS ROUTE CANNOT DO, and the reasons are load-bearing:
//
//   * It cannot return a rupee figure. There is no rate column on either table
//     to return, so the guarantee is structural rather than a filter somebody
//     has to maintain. The price is typed afterwards on the costing panel.
//   * It cannot write to a silo, a mixer cycle, the FIFO allocator or anything
//     else. It reads the bag records to report a disagreement and writes only
//     to the two costing-owned tables.
//   * It cannot refuse a save because of a disagreement. A flag is advice; the
//     entered value is what the batch is costed at. The only refusals here are
//     malformed input and an unknown batch.

import { NextRequest, NextResponse } from "next/server";

import { currentUser, isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { GRIT_BAND_LABELS, loadBatchConsumption } from "@/lib/costing/batchData";
import { isBatchVerifier } from "@/lib/costing/verification";
import {
  gritAssignBlockers, matchSize, matchSupplier, mergeSizeCatalogue,
} from "@/lib/costing/gritAssign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

const FORBIDDEN = "Only an admin or one of the two batch verifiers can assign grit.";

/** Null means "not yours to touch"; the caller turns it into the 403. */
async function assigner(): Promise<{ name: string } | null> {
  const u = await currentUser();
  if (!u) return null;
  const role = (u as { role?: string }).role ?? null;
  const email = (u as { email?: string }).email ?? null;
  const ok = (await isAdmin())
    || isBatchVerifier(role, email, process.env.WEIGHTS_VERIFIER_EMAILS);
  if (!ok) return null;
  return { name: (u as { name?: string }).name ?? email ?? "unknown" };
}

/** Every size anybody has ever assigned, plant-wide — the learned list. The
 *  suggestedSuppliers() precedent: derived, so the list and the data cannot
 *  disagree, and no dictionary table to administer. */
async function everAssignedSizes(): Promise<string[]> {
  const rows = await prisma.costingBatchGritSilo.findMany({
    where: { size: { not: "" } },
    select: { size: true },
    distinct: ["size"],
    take: 500,
  });
  return rows.map((r) => r.size);
}

/** The three the plant runs today. A SEED, not a whitelist: the dropdown offers
 *  these plus everything anybody has typed, and a new one typed once is offered
 *  on every batch afterwards. Nothing rejects a type that is not here. */
const SEED_GRIT_TYPES = ["Premium Supreme G2", "Glass", "Cristobalite"];

/** Every grit type anybody has ever assigned, plant-wide, seeded with the three
 *  above. Derived exactly like everAssignedSizes so the list and the data
 *  cannot disagree - see scripts/0050 for why there is no dictionary table. */
async function everAssignedTypes(): Promise<string[]> {
  const rows = await prisma.costingBatchGritSilo.findMany({
    where: { gritType: { not: "" } },
    select: { gritType: true },
    distinct: ["gritType"],
    take: 500,
  });
  // Case-insensitive de-dup so "Glass" typed once does not sit beside "glass".
  const seen = new Map<string, string>();
  for (const t of [...SEED_GRIT_TYPES, ...rows.map((r) => r.gritType)]) {
    const k = t.trim().toLowerCase();
    if (k && !seen.has(k)) seen.set(k, t.trim());
  }
  return [...seen.values()];
}

export async function GET(req: NextRequest) {
  const me = await assigner();
  if (!me) return json({ error: FORBIDDEN }, 403);

  const batchKey = new URL(req.url).searchParams.get("batchKey")?.trim() ?? "";
  if (!batchKey) return json({ error: "Which batch? Pass ?batchKey=" }, 400);

  const c = await loadBatchConsumption(batchKey);
  if (!c) return json({ error: "No mixer records for that batch." }, 404);

  // Every silo the MIXER says fed this batch, whether or not it has been
  // assigned — the row list comes from consumption, never from a catalogue. A
  // silo that only exists in the catalogue is a silo nobody can price.
  // FULL weight per silo, not the band-resolved part. gritCharges is keyed by
  // band and omits any charge whose bags yield none, so building the row list
  // from it hid whole silos: on batch 1415 silo 203 drew 11,534.5 kg and had no
  // card at all, and silo 204 showed 12,998.6 of the 26,258.6 kg it ran.
  const kgBySilo = new Map<string, number>();
  for (const g of c.gritSiloKg) kgBySilo.set(g.silo, (kgBySilo.get(g.silo) ?? 0) + g.kg);

  const assigned = new Map((c.gritSilos ?? []).map((s) => [s.silo, s]));
  const silos = [...kgBySilo.entries()]
    .sort((a, b) => b[1] - a[1])           // heaviest first: that is the order it is worked in
    .map(([silo, kg]) => {
      const a = assigned.get(silo);
      const size = a?.size ?? "";
      const gritType = a?.gritType ?? "";
      const suppliers = a?.suppliers ?? [];
      return {
        silo, kg, size, gritType, suppliers,
        recordedSizes: a?.recordedSizes ?? [],
        recordedSuppliers: a?.recordedSuppliers ?? [],
        // Reported, never enforced. The entered value is what is costed.
        sizeFlag: matchSize(size, a?.recordedSizes ?? []),
        supplierFlags: suppliers.map((p) => ({ seq: p.seq, ...matchSupplier(p.supplier, a?.recordedSuppliers ?? []) })),
      };
    });

  const recordedHere = silos.flatMap((s) => s.recordedSizes);
  return json({
    batchKey,
    batch: c.batch,
    design: c.design,
    silos,
    unresolvedKg: c.gritUnresolvedKg,
    sizeOptions: mergeSizeCatalogue(await everAssignedSizes(), Object.keys(GRIT_BAND_LABELS), recordedHere),
    // Learned the same way sizes are: SELECT DISTINCT over what has been typed,
    // seeded with the three the plant runs today. No dictionary table, so the
    // list and the data cannot drift apart.
    typeOptions: await everAssignedTypes(),
    blockers: gritAssignBlockers(silos),
  });
}

interface PostedSupplier { supplier?: unknown; kg?: unknown; ratePerT?: unknown }
interface PostedSilo { silo?: unknown; size?: unknown; gritType?: unknown; suppliers?: PostedSupplier[] }

/**
 * Save the assignment for one or more silos.
 *
 * SCOPED TO THE SILOS IN THE PAYLOAD, never the whole batch. Two people with the
 * screen open on different silos must not wipe each other's work, and a
 * batch-wide delete makes that the default outcome rather than an edge case.
 */
export async function PUT(req: NextRequest) {
  const me = await assigner();
  if (!me) return json({ error: FORBIDDEN }, 403);

  let body: { batchKey?: unknown; silos?: PostedSilo[] };
  try { body = await req.json(); } catch { return json({ error: "Body must be JSON." }, 400); }

  const batchKey = typeof body.batchKey === "string" ? body.batchKey.trim() : "";
  if (!batchKey) return json({ error: "Which batch? Send batchKey." }, 400);
  const posted = Array.isArray(body.silos) ? body.silos : [];
  if (!posted.length) return json({ error: "No silos to save." }, 400);
  if (posted.length > 60) return json({ error: "Too many silos in one save." }, 400);

  // Validate the WHOLE payload before writing any of it — a half-applied save
  // leaves a batch assigned in a way nobody chose. Same rule as the batch-rates
  // route, and the same reason.
  type CleanLine = { seq: number; supplier: string; kg: number; ratePerT: number | null };
  const clean: Array<{ silo: string; size: string; gritType: string; suppliers: CleanLine[] }> = [];
  for (const p of posted) {
    const silo = typeof p.silo === "string" ? p.silo.trim() : "";
    if (!silo) return json({ error: "Every row needs a silo number." }, 400);
    const size = typeof p.size === "string" ? p.size.trim().slice(0, 60) : "";
    const gritType = typeof p.gritType === "string" ? p.gritType.trim().slice(0, 60) : "";
    const rows = Array.isArray(p.suppliers) ? p.suppliers : [];
    if (rows.length > 20) return json({ error: `Too many suppliers on silo ${silo}.` }, 400);

    const suppliers: CleanLine[] = [];
    for (const r of rows) {
      const supplier = typeof r.supplier === "string" ? r.supplier.trim().slice(0, 200) : "";
      // A row with NOTHING in it is a row nobody filled in, and dropping it
      // silently is right — the editor always renders one blank line.
      //
      // The rate has to be in this test. It was added after the test was
      // written, so a row carrying ONLY a price looked empty: the line was
      // discarded, the save answered ok, and the price the verifier had just
      // typed was gone with nothing on screen saying so.
      const blankRate = r.ratePerT === "" || r.ratePerT == null;
      if (!supplier && (r.kg === "" || r.kg == null) && blankRate) continue;
      if (!supplier) {
        return json({ error: blankRate
          ? `A weight on silo ${silo} has no supplier against it.`
          : `A price on silo ${silo} has no supplier against it.` }, 400);
      }
      const kg = Number(r.kg);
      // Refused rather than coerced, for the reason the batch-rates route gives
      // about a zero rate: a zero does not fail loudly, it just assigns nothing
      // to a supplier who is then printed on the sheet as having supplied it.
      if (!Number.isFinite(kg) || kg <= 0) {
        return json({ error: `${supplier} on silo ${silo} needs a weight above zero.` }, 400);
      }
      // seq is positional over the KEPT rows, so a deleted blank line does not
      // leave a hole the unique index would later trip over.
      // THE RATE IS OPTIONAL AND null IS A REAL ANSWER. Blank means nobody has
      // priced this line yet, which is the normal state between assigning a
      // silo and pricing it. A zero is refused for the same reason a zero
      // weight is: it does not fail loudly, it just costs the grit at nothing
      // and prints a sheet that looks complete.
      let ratePerT: number | null = null;
      if (!(r.ratePerT === "" || r.ratePerT == null)) {
        const v = Number(r.ratePerT);
        if (!Number.isFinite(v) || v <= 0) {
          return json({ error: `${supplier} on silo ${silo} needs a price above zero, or none at all.` }, 400);
        }
        ratePerT = v;
      }
      suppliers.push({ seq: suppliers.length, supplier, kg, ratePerT });
    }
    clean.push({ silo, size, gritType, suppliers });
  }

  // One transaction per save. Deleting and re-inserting outside one would leave
  // the batch briefly unassigned, and a read landing in that window would flip
  // it back to the per-band costing path and print a different total.
  await prisma.$transaction(async (tx) => {
    for (const s of clean) {
      await tx.costingBatchGritSilo.upsert({
        where: { batchKey_siloNo: { batchKey, siloNo: s.silo } },
        create: { batchKey, siloNo: s.silo, size: s.size, gritType: s.gritType, assignedBy: me.name },
        update: { size: s.size, gritType: s.gritType, assignedBy: me.name, updatedAt: new Date() },
      });
      await tx.costingBatchGritSupplier.deleteMany({ where: { batchKey, siloNo: s.silo } });
      if (s.suppliers.length) {
        await tx.costingBatchGritSupplier.createMany({
          data: s.suppliers.map((p) => ({
            batchKey, siloNo: s.silo, seq: p.seq, supplier: p.supplier, kg: p.kg,
            ratePerT: p.ratePerT,
            // Stamped only when there IS a rate, so "who priced this" stays
            // answerable and does not quietly become "who last touched the row".
            rateBy: p.ratePerT == null ? null : me.name,
            rateAt: p.ratePerT == null ? null : new Date(),
            assignedBy: me.name,
          })),
        });
      }
    }
  });

  return json({ ok: true, silos: clean.length, assignedBy: me.name });
}

/** Withdraw one silo's assignment, or the whole batch's. Withdrawing every silo
 *  puts the batch back on the per-band card path — which is a real answer when
 *  an assignment was made on the wrong batch, so it must be reachable. */
export async function DELETE(req: NextRequest) {
  const me = await assigner();
  if (!me) return json({ error: FORBIDDEN }, 403);

  const sp = new URL(req.url).searchParams;
  const batchKey = sp.get("batchKey")?.trim() ?? "";
  const silo = sp.get("silo")?.trim() ?? "";
  if (!batchKey) return json({ error: "Pass ?batchKey=" }, 400);

  const where = silo ? { batchKey, siloNo: silo } : { batchKey };
  const [a, b] = await prisma.$transaction([
    prisma.costingBatchGritSilo.deleteMany({ where }),
    prisma.costingBatchGritSupplier.deleteMany({ where }),
  ]);
  if (!a.count && !b.count) return json({ error: "Nothing was assigned there." }, 404);
  return json({ ok: true, removed: a.count + b.count });
}
