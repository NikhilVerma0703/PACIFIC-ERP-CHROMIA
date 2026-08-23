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
import { canRectify } from "@/lib/rbac";
import { currentBranchName } from "@/lib/branch";
import { currentUser } from "@/lib/rbac";
import { batchFamily } from "@/lib/erp";
import { allocateMixerCycle } from "@/lib/automations-silo";

const db = prisma as any;

// The "pending" condition — keep the two queries below in sync with each other and
// with the Live Status sweep (src/app/live/allocatorAction.ts): ERP-native cycle,
// a filler silo/buffer named, filler weight present, but no silo link deducted yet.

/** How many of this family's ERP-native cycles still owe a grit/filler deduction.
 *
 *  Gated like its sibling below — a session, then canRectify() — but answering 0
 *  instead of refusing, so the batch report renders identically for everyone who
 *  can open it (every role that reaches /batch is rank INCHARGE or above and
 *  passes both). It used to carry no gate at all: a "use server" export is
 *  callable by action id from any page, not only from /batch, so the middleware
 *  block that keeps Commercial off the route was the only thing between a
 *  signed-in Sales, Fabrication or Chromia login and this count. */
export async function pendingRmAllocation(batch: string): Promise<number> {
  if (!(await currentUser())) return 0;
  if (!(await canRectify())) return 0;
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

/** Heal THIS family's pending cycles (oldest first). Fired automatically by the batch
 *  report, so it is a WRITE with no click behind it: it moves silo stock, re-links
 *  mixer cycles and can create deficit bags. It therefore carries the SAME two gates as
 *  every sibling rectify action — incharge and above, Shop Floor branch only. A viewer
 *  who cannot rectify simply sees the pending count; nothing is mutated for them. */
export async function healBatchRm(batch: string): Promise<BatchRmHealResult> {
  if (!(await currentUser())) return { ok: false, healed: 0, message: "Sign in to re-link RM." };
  if (!(await canRectify())) return { ok: false, healed: 0, message: "Only incharge and above can re-link RM." };
  if ((await currentBranchName()) !== "SHOP_FLOOR") return { ok: false, healed: 0, message: "RM is re-linked from the Shop Floor branch." };
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
