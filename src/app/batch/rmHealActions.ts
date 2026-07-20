"use server";
// Batch-scoped RM self-heal. The per-record FIFO allocator already runs on every
// cycle create/edit; the Live Status button sweeps the global backlog for admins.
// This is the third leg: when the BATCH REPORT sees cycles of its own family whose
// grit/filler was never deducted, it heals exactly those — automatically, without
// waiting for an admin to run the global sweep. Same allocator, same advisory lock
// (so it can never overlap the Live Status sweep or another tab), same ERP-native-only
// rule (Airtable-era cycles were consumed in Airtable — re-allocating would
// double-deduct today's stock).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { batchFamily } from "@/lib/erp";
import { allocateMixerCycle } from "@/lib/automations-silo";

const db = prisma as any;

// The "pending" condition — keep the two queries below in sync with each other and
// with the Live Status sweep (src/app/live/allocatorAction.ts): ERP-native cycle,
// a filler silo/buffer named, filler weight present, but no silo link deducted yet.

/** How many of this family's ERP-native cycles still owe a grit/filler deduction. */
export async function pendingRmAllocation(batch: string): Promise<number> {
  try {
    const { keys } = await batchFamily(batch);
    if (!keys.length) return 0;
    const rows: { n: number }[] = await prisma.$queryRaw`
      SELECT count(*)::int n FROM mixer_cycle
      WHERE batch_key = ANY(${keys}::text[])
        AND "airtableId" NOT LIKE 'rec%'
        AND trim(coalesce(filler_silo_buffer, '')) <> ''
        AND cardinality(filler_silo_id) = 0
        AND (coalesce(m1_f_w,0)+coalesce(m2_f_w,0)+coalesce(m3_f_w,0)+coalesce(m4_f_w,0)) > 0`;
    return rows[0]?.n ?? 0;
  } catch { return 0; }
}

export interface BatchRmHealResult { ok: boolean; healed: number; message: string }

/** Heal THIS family's pending cycles (oldest first). Fired automatically by the
 *  batch report; any signed-in viewer may trigger it — the same allocator already
 *  runs ungated on every cycle create/edit, this only catches the ones it missed. */
export async function healBatchRm(batch: string): Promise<BatchRmHealResult> {
  if (!(await currentUser())) return { ok: false, healed: 0, message: "Sign in to re-link RM." };
  try {
    const { keys } = await batchFamily(batch);
    if (!keys.length) return { ok: false, healed: 0, message: "Not a batch number." };
    return await db.$transaction(async (tx: any) => {
      // Same lock as the Live Status sweep: the two can never double-deduct together.
      const got: { ok: boolean }[] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(424242) AS ok`;
      if (!got[0]?.ok) return { ok: false, healed: 0, message: "The allocator is already running — this batch will heal on the next visit." };
      const rows: { id: string }[] = await tx.$queryRaw`
        SELECT id FROM mixer_cycle
        WHERE batch_key = ANY(${keys}::text[])
          AND "airtableId" NOT LIKE 'rec%'
          AND trim(coalesce(filler_silo_buffer, '')) <> ''
          AND cardinality(filler_silo_id) = 0
          AND (coalesce(m1_f_w,0)+coalesce(m2_f_w,0)+coalesce(m3_f_w,0)+coalesce(m4_f_w,0)) > 0
        ORDER BY imported_at ASC LIMIT 60`;
      if (!rows.length) return { ok: true, healed: 0, message: "Nothing pending — this batch's cycles are all linked." };
      let filler = 0, grit = 0, unbacked = 0, failed = 0;
      for (const r of rows) {
        try {
          const res = await allocateMixerCycle(r.id);
          filler += res.fillerFulfilled ?? 0;
          grit += res.gritFulfilled ?? 0;
          unbacked += res.shortfalls?.length ?? 0;
        } catch { failed++; }
      }
      revalidatePath("/batch");
      return {
        ok: true,
        healed: rows.length - failed,
        message: `✓ Re-linked RM for ${rows.length - failed} cycle(s) — filler ${filler}, grit ${grit}` +
          (unbacked ? ` · ${unbacked} drawn unbacked (silo below zero, auto-links on fill)` : "") +
          (failed ? ` · ${failed} failed — an admin can run the Live Status sweep` : "") + ".",
      };
    }, { timeout: 55000 });
  } catch (e) {
    return { ok: false, healed: 0, message: `RM re-link failed: ${(e as Error).message}` };
  }
}
