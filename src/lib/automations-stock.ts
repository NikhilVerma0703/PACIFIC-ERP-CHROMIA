// Phase 4 — stock/resin mutators (faithful ports of the record-triggered
// Airtable automations). These DECREMENT stock and set links, so they only run
// post-cutover (when the new system owns state). During the parallel-run phase
// Airtable remains source of truth and these are not invoked.
import { prisma } from "@/lib/prisma";
import { ensureTankDeficitPrep } from "@/lib/backfill";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// "Update Daily Resin Remaining Weight" — for a Mixer Cycle, aggregate resin
// weights by tank name (M{m}_R_DTN), consume from Daily Resin Tank (smallest
// remaining first), link the first matching tank to M{m}_R_ID, decrement tanks.
export async function updateDailyResinForMixer(mixerId: string) {
  const m: any = await db.mixerCycle.findUnique({
    where: { id: mixerId },
    select: { m1RDtn: true, m2RDtn: true, m3RDtn: true, m4RDtn: true, m1RW: true, m2RW: true, m3RW: true, m4RW: true },
  });
  if (!m) return { error: "mixer not found" };
  const names = [m.m1RDtn, m.m2RDtn, m.m3RDtn, m.m4RDtn];
  const weights = [n(m.m1RW), n(m.m2RW), n(m.m3RW), n(m.m4RW)];
  const linkFields = ["m1RIdIds", "m2RIdIds", "m3RIdIds", "m4RIdIds"];

  const sums: Record<string, number> = {};
  names.forEach((nm, i) => { if (nm) sums[nm] = (sums[nm] ?? 0) + weights[i]; });

  const tanks: any[] = await db.dailyResinTank.findMany({ select: { id: true, airtableId: true, dailyTankNo: true, dailyResinId: true, remainingWeight: true } });
  const byName: Record<string, any[]> = {};
  for (const t of tanks) { const nm = t.dailyTankNo; if (!nm) continue; (byName[nm] ||= []).push(t); }

  const matched: Record<string, { id: string; airtableId: string; used: number; remaining: number }[]> = {};
  for (const [nm, total] of Object.entries(sums)) {
    // FIFO by dailyResinId (oldest prep first) — same invariant as Roy + the resin correction engine
    const sorted = (byName[nm] ?? []).filter((t: any) => !String(t.airtableId).startsWith("deficit_")).sort((a: any, b: any) => n(a.dailyResinId) - n(b.dailyResinId));
    let left = total; const used: any[] = [];
    for (const t of sorted) { if (left <= 0) break; const rem = n(t.remainingWeight); if (rem <= 0) continue; const u = Math.min(left, rem); used.push({ id: t.id, airtableId: t.airtableId, used: u, remaining: rem }); left -= u; }
    if (left > 1e-9) {
      // tank not (fully) filled digitally — draw UNBACKED so totals stay truthful;
      // a later prep entry absorbs this and re-links the cycle automatically.
      const ph = await ensureTankDeficitPrep(nm);
      used.push({ id: ph.id, airtableId: ph.airtableId, used: left, remaining: ph.remaining });
      left = 0;
    }
    if (used.length) matched[nm] = used;
  }

  const mixerData: Record<string, string[]> = {};
  // link EVERY tank/prep the draw spanned (not just the first) so traceability is complete
  names.forEach((nm, i) => { if (nm && matched[nm]?.length) mixerData[linkFields[i]] = matched[nm].map((u) => u.airtableId); });
  if (!Object.keys(mixerData).length) return { error: "no tank named on the cycle" };

  await db.mixerCycle.update({ where: { id: mixerId }, data: mixerData });
  for (const used of Object.values(matched)) for (const u of used) await db.dailyResinTank.update({ where: { id: u.id }, data: { remainingWeight: u.remaining - u.used } });
  return { matched: Object.keys(matched).length };
}

// "Update Daily Resin for Roy Mixer" — deduct R_W from Daily Resin Tank rows of
// the named tank (lowest daily_Resin_Id first), set DRT Link.
export async function updateDailyResinForRoy(royId: string) {
  const c: any = await db.royMixerCycle.findUnique({ where: { id: royId }, select: { dailyTankNo: true, rW: true } });
  if (!c?.dailyTankNo || n(c.rW) <= 0) return { skipped: true };
  const tanks: any[] = (await db.dailyResinTank.findMany({ where: { dailyTankNo: c.dailyTankNo }, select: { id: true, airtableId: true, dailyResinId: true, remainingWeight: true } }))
    .sort((a: any, b: any) => n(a.dailyResinId) - n(b.dailyResinId));
  let left = n(c.rW); const usedIds: string[] = [];
  for (const t of tanks) { const rem = n(t.remainingWeight); if (rem <= 0) continue; const ded = Math.min(left, rem); await db.dailyResinTank.update({ where: { id: t.id }, data: { remainingWeight: rem - ded } }); usedIds.push(t.airtableId); left -= ded; if (left <= 0) break; }
  if (usedIds.length) await db.royMixerCycle.update({ where: { id: royId }, data: { drtLinkIds: usedIds } });
  return { used: usedIds.length, shortfall: Math.max(0, left) };
}

// "Storage tank update on Daily tank submission" — subtract Daily Resin Tank
// Quantity from the linked RESIN STORAGE Quantity Remaining.
export async function storageTankUpdate(dailyTankId: string) {
  const t: any = await db.dailyResinTank.findUnique({ where: { id: dailyTankId }, select: { quantity: true, outsideTankNoIds: true } });
  const link = (t?.outsideTankNoIds ?? []) as string[];
  if (!link.length) return { skipped: true };
  const storage: any = await db.resinStorage.findUnique({ where: { airtableId: link[0] }, select: { id: true, quantityRemaining: true } });
  if (!storage) return { error: "storage not found" };
  await db.resinStorage.update({ where: { id: storage.id }, data: { quantityRemaining: n(storage.quantityRemaining) - n(t.quantity) } });
  return { ok: true };
}

// "RM Availability Update Roy Mixer" — set Availability="No" on RM rows linked
// from a Change Parameters Roy Mixer Cycle record (F_RM, G1_RM..G5_RM).
export async function rmAvailabilityRoy(changeId: string) {
  const r: any = await db.changeParametersRoyMixerCycle.findUnique({ where: { id: changeId }, select: { fRmIds: true, g1RmIds: true, g2RmIds: true, g3RmIds: true, g4RmIds: true, g5RmIds: true } });
  if (!r) return { skipped: true };
  const ids = new Set<string>();
  for (const f of ["fRmIds", "g1RmIds", "g2RmIds", "g3RmIds", "g4RmIds", "g5RmIds"]) for (const x of (r[f] ?? [])) ids.add(x);
  let updated = 0;
  for (const airtableId of ids) { const res = await db.rm.updateMany({ where: { airtableId, NOT: { availability: "No" } }, data: { availability: "No" } }); updated += res.count; }
  return { updated };
}

// NOTE — captured but intentionally NOT auto-wired (need extra mapping / are
// destructive); port when scheduling the post-cutover run:
//   • "Silo Remaining Quantity Initiation": set SILO Remaining Weight+Weight
//     from the linked Used Bag's Bag Weight.
//   • "RM Availability Update Silo": copy linked RM rows into Used Bags
//     (Availability=No) and DELETE the originals from RM (destructive).
