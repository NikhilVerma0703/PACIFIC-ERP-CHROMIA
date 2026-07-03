"use server";
// Admin control: heal mixer cycles whose grit/filler was never deducted.
// ONLY ERP-native cycles are processed (airtableId is a local id, not "rec…"):
// Airtable-era rows were consumed and accounted for in Airtable before cutover —
// re-allocating them would double-deduct today's stock. Uses the same
// per-record FIFO allocator that runs on every new cycle (allocateMixerCycle),
// NOT the global sweep (runGritFillerAllocator), which is dry-run/analysis-only.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { allocateMixerCycle } from "@/lib/automations-silo";
import { revalidatePath } from "next/cache";

const db = prisma as any;
const BATCH = 40; // per click — stays well inside the serverless time limit

export async function runAllocatorAction(): Promise<{ ok?: boolean; message: string }> {
  if (!(await isAdmin())) return { message: "Only an administrator can run the allocator." };
  try {
    // Serialize runs: a transaction-scoped advisory lock prevents two overlapping
    // clicks (e.g. two tabs) from double-deducting the same demands.
    return await db.$transaction(async (tx: any) => {
    const got: { ok: boolean }[] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(424242) AS ok`;
    if (!got[0]?.ok) return { message: "The allocator is already running — try again in a minute." };
    const rows: { id: string }[] = await db.$queryRaw`
      SELECT id FROM mixer_cycle
      WHERE "airtableId" NOT LIKE 'rec%'
        AND trim(coalesce(filler_silo_buffer, '')) <> ''
        AND cardinality(filler_silo_id) = 0
        AND (coalesce(m1_f_w,0)+coalesce(m2_f_w,0)+coalesce(m3_f_w,0)+coalesce(m4_f_w,0)) > 0
      ORDER BY imported_at ASC
      LIMIT ${BATCH + 1}`;
    if (rows.length === 0) return { ok: true, message: "Nothing to allocate — every ERP cycle is linked." };
    const more = rows.length > BATCH;
    const work = rows.slice(0, BATCH);
    let filler = 0, grit = 0, unbacked = 0, failed = 0;
    for (const r of work) {
      try {
        const res = await allocateMixerCycle(r.id);
        filler += res.fillerFulfilled ?? 0;
        grit += res.gritFulfilled ?? 0;
        unbacked += res.shortfalls?.length ?? 0;
      } catch { failed++; }
    }
    revalidatePath("/live");
    return {
      ok: true,
      message: `Healed ${work.length} cycle(s) — filler ${filler}, grit ${grit} linked` +
        (unbacked ? ` · ${unbacked} drawn unbacked (silo below zero)` : "") +
        (failed ? ` · ${failed} failed` : "") +
        (more ? " · more remaining — click again." : "."),
    };
    }, { timeout: 55000 });
  } catch (e) {
    return { message: `Allocator failed: ${(e as Error).message}` };
  }
}
