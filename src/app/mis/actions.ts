"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canRespondDowntime, currentUser, localId } from "@/lib/rbac";
import { writeDowntimeResponse, writeDowntimeDispute, DOWNTIME_STATUSES } from "@/lib/downtimeResponse";
import { mirrorDowntimeToTicket } from "@/lib/maintenanceLog";
import { DELAY_FIELDS, DELAY_LABEL, fmtDur } from "@/lib/downtimeShared";
// The rules and the wording are in the prisma-free module so this action, the
// client form and `node --test` all share one set; the READ side (marking the
// corrected hours in the two views) is src/lib/delayReclassLog.ts. The write
// stays here, deliberately: the audit row has to be appended in the same breath
// as the Mis row is rewritten, and the two halves of one correction are easier
// to keep together than to keep in step across modules.
import {
  prepareReclass, bucketsFromMisRow, misDelayUpdate, misDelayUnchanged, DELAY_KEYS, DELAY_COL,
} from "@/lib/delayReclass";

export interface RespondRes { ok: boolean; message: string }

/** Maintenance Manager / Admin records how the team responded to a downtime incident. */
export async function respondToDowntime(misId: string, status: string, note: string): Promise<RespondRes> {
  if (!(await canRespondDowntime())) return { ok: false, message: "Only Maintenance Manager or Admin can respond." };
  if (!misId) return { ok: false, message: "Missing incident reference." };
  if (!DOWNTIME_STATUSES.includes(status as (typeof DOWNTIME_STATUSES)[number])) return { ok: false, message: "Unknown status." };
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const by = ((u as any)?.name as string | undefined) || ((u as any)?.email as string | undefined) || null;
  try {
    await writeDowntimeResponse(misId, status, (note ?? "").trim() || null, by);
  } catch (e) {
    return { ok: false, message: `Save failed: ${String((e as Error)?.message ?? e)}` };
  }
  // Keep the maintenance log in step. Half of the two-way link: a ticket raised
  // from this incident must not still read "Pending" on /maintenance after it
  // has been answered here — whichever screen is staler is the one somebody
  // will act on. Deliberately AFTER the write above and non-fatal: the response
  // itself is saved, and a mirror that fails must not report the save failed.
  await mirrorDowntimeToTicket(misId, status, (note ?? "").trim() || null, by).catch(() => {});
  revalidatePath("/mis");
  revalidatePath("/maintenance");
  return { ok: true, message: "Saved." };
}

/** Maintenance Manager / Admin records a DISAGREEMENT with a logged duration: their own
 *  minutes for one delay type, stored beside production's figure. Nothing here writes to
 *  the MIS row, and nothing downstream reads the disputed figure into a total — it is a
 *  visible disagreement, resolved by production correcting their own entry (the UI shows
 *  the figures matching once they do). minutes === null clears the dispute. */
export async function disputeDowntime(misId: string, typeKey: string | null, minutes: number | null): Promise<RespondRes> {
  if (!(await canRespondDowntime())) return { ok: false, message: "Only Maintenance Manager or Admin can dispute." };
  if (!misId) return { ok: false, message: "Missing incident reference." };
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const by = ((u as any)?.name as string | undefined) || ((u as any)?.email as string | undefined) || null;
  try {
    if (minutes === null) {
      await writeDowntimeDispute(misId, null, by);
    } else {
      // 0 is meaningful — "there was no breakdown that hour" is exactly the disagreement
      // the maintenance manager described. Integers only. 1440 is a generous typo guard,
      // not a claim about the MIS form (which has no such bound): the page already flags
      // anything over 60 in one hour as an entry error, and a dispute may legitimately
      // say the same kind of oversized figure production can enter.
      if (!DELAY_FIELDS.some((d) => d.key === typeKey)) return { ok: false, message: "Unknown delay type." };
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return { ok: false, message: "Minutes must be a whole number between 0 and 1440." };
      // The row must exist: a dispute keyed to a mistyped id would be invisible forever.
      const row = await prisma.mis.findUnique({ where: { id: misId }, select: { id: true } });
      if (!row) return { ok: false, message: "Incident not found." };
      await writeDowntimeDispute(misId, { type: typeKey as string, minutes }, by);
    }
  } catch (e) {
    // Before scripts/0029-downtime-dispute.sql runs, the dispute columns do not exist.
    // Say that plainly instead of dumping the raw SQL error into an 11px span.
    const msg = String((e as Error)?.message ?? e);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((e as any)?.meta?.code === "42703" || /column "disputed_\w+" does not exist/i.test(msg))
      return { ok: false, message: "Disputes are not enabled yet — run scripts/0029-downtime-dispute.sql on the database first." };
    return { ok: false, message: `Save failed: ${msg}` };
  }
  revalidatePath("/mis");
  return { ok: true, message: minutes === null ? "Dispute cleared." : "Dispute recorded." };
}

/** Thrown inside the reclass transaction to roll it back with a message the
 *  manager can act on. Not exported — a "use server" module may only export async
 *  functions, and nothing outside needs it: every path turns it back into an
 *  ordinary { ok: false } result before returning. */
class ReclassRefused extends Error {}

/**
 * Maintenance Manager / Admin CORRECTS a mis-classified delay: moves minutes out
 * of the bucket production filed them under and into the right one, on the MIS
 * hourly row itself.
 *
 * THIS IS THE STRONGER SIBLING OF disputeDowntime ABOVE, AND IT IS DELIBERATE.
 * The dispute records maintenance's own figure BESIDE production's and writes
 * nothing to the MIS row — "a visible disagreement, not a second set of books",
 * and that decision stands for "we disagree about how long it was". It is the
 * wrong shape for "those minutes are in the wrong bucket": the four buckets ARE
 * the downtime totals, the type chips, every chart and the uptime score, so a
 * counter-claim nothing reads leaves all of them wrong. The owner asked for the
 * correction, so this action performs it. Two actions, two meanings — dispute the
 * duration, reclassify the type.
 *
 * IT MOVES MONEY, so read the guarantees before changing anything here:
 *  - the arithmetic and every rule live in the pure src/lib/delayReclass.ts, and
 *    the hour's TOTAL never changes, which is what keeps the 60-min/hr cap in
 *    src/app/tables/actions.ts satisfied without this action re-checking it;
 *  - the Mis rewrite and the audit row are ONE transaction. A corrected figure
 *    with no audit row beside it is the invisible edit the whole feature exists
 *    to prevent — and shiftScore.ts ranks the electrical and mechanical incharges
 *    on uptime computed from the breakdown and power-out minutes, so moving
 *    minutes out of `breakdown` raises the mover's own incentive;
 *  - the author is taken from the SESSION, never from an argument, for the same
 *    reason;
 *  - the write is guarded on the figures the plan was computed from, so a
 *    concurrent MIS edit loses instead of silently compounding.
 */
export async function reclassifyDelay(
  misId: string,
  from: string,
  to: string,
  minutes: number,
  reason: string,
): Promise<RespondRes> {
  // Same audience as the dispute: nobody else may touch the classification.
  if (!(await canRespondDowntime())) return { ok: false, message: "Only Maintenance Manager or Admin can reclassify a delay." };
  if (!misId) return { ok: false, message: "Missing incident reference." };

  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uid = ((u as any)?.id as string | undefined) || null;
  // Never NULL if we can help it: "by maintenance" in a tooltip is a weaker
  // answer than a name when a payout is argued about months later, and the user
  // id at least identifies the account when the session carries no display name.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const by = ((u as any)?.name as string | undefined) || ((u as any)?.email as string | undefined) || uid;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = prisma as any;
    const plan = await db.$transaction(async (tx: any) => {
      // Read the hour INSIDE the transaction. Reading it outside would widen the
      // window between what the rules were checked against and what gets written.
      const row = await tx.mis.findUnique({
        where: { id: misId },
        select: Object.fromEntries(DELAY_KEYS.map((k) => [DELAY_COL[k], true])),
      });
      if (!row) throw new ReclassRefused("Incident not found.");

      // Reason + arithmetic in one call, so this action cannot enforce one rule
      // and forget the other. Its refusals are written for the manager; pass them
      // through unchanged rather than restating them here in different words.
      const p = prepareReclass({ current: bucketsFromMisRow(row), from, to, minutes, reason });
      if (!p.ok) throw new ReclassRefused(p.message);

      // The optimistic lock: update only while the four figures are still the ones
      // the plan was computed from. count === 0 means production edited the hour
      // (or the manager double-submitted) in between — refuse rather than apply a
      // move to numbers nobody looked at.
      //
      // All four columns are written, so a bucket that held NULL ("nothing
      // entered") comes out as 0. Checked before relying on it: every consumer of
      // these columns — downtime.ts, shiftScore.ts, misShift.ts — already reads
      // NULL as 0, so no total, chart or score moves. It is only visible in the
      // /tables editor, where the cell reads 0 instead of blank, and that is the
      // honest rendering of an hour a human has since gone over.
      const res = await tx.mis.updateMany({
        where: { id: misId, AND: misDelayUnchanged(p.before) },
        data: misDelayUpdate(p.next),
      });
      if (res.count !== 1)
        throw new ReclassRefused("This hour changed while the form was open — reload the log and check the figures before reclassifying.");

      // The audit row: same transaction, and after the rewrite. If this throws
      // (most likely 42P01 — scripts/0037-mis-delay-reclass.sql not run yet) the
      // Mis row rolls back with it and the hour is left exactly as production
      // logged it. A correction applied with nothing recording who applied it is
      // the invisible edit this whole feature exists to prevent, so "no audit
      // row" must mean "no correction", never "correction, unattributed".
      //
      // Append-only, no ON CONFLICT: two identical moves are two real
      // corrections, and an undo is an inverse row rather than a DELETE.
      await tx.$executeRaw`
        INSERT INTO mis_delay_reclass (id, mis_id, from_type, to_type, minutes, reason, changed_by, changed_by_user_id, changed_at)
        VALUES (${localId("mdr")}, ${misId}, ${p.from}, ${p.to}, ${p.minutes}, ${p.reason}, ${by}, ${uid}, now())`;
      return p;
    });

    // Revalidate everything the moved minutes are now read into. /mis and the
    // maintenance log are the two screens showing the hour; /scoreboard is here
    // because the uptime ranking behind the incentive pool is computed from the
    // breakdown and power-out figures this action just changed, and a cached
    // scoreboard would go on paying out the old classification.
    revalidatePath("/mis");
    revalidatePath("/maintenance");
    revalidatePath("/scoreboard");
    return {
      ok: true,
      message: `Moved ${fmtDur(plan.minutes)} from ${DELAY_LABEL[plan.from] ?? plan.from} to ${DELAY_LABEL[plan.to] ?? plan.to}.`,
    };
  } catch (e) {
    if (e instanceof ReclassRefused) return { ok: false, message: e.message };
    // Before scripts/0037-mis-delay-reclass.sql runs the audit table does not
    // exist. Say that plainly, the way disputeDowntime does for its own columns,
    // instead of dumping a raw SQL error into an 11px span. Nothing was written:
    // the whole transaction rolled back, including the Mis rewrite.
    const msg = String((e as Error)?.message ?? e);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((e as any)?.meta?.code === "42P01" || /relation "(?:public\.)?mis_delay_reclass" does not exist/i.test(msg))
      return { ok: false, message: "Reclassification is not enabled yet — run scripts/0037-mis-delay-reclass.sql on the database first." };
    return { ok: false, message: `Save failed: ${msg}` };
  }
}

const PHOTO_MAX = 8 * 1024 * 1024;

/** Attach a photo to the maintenance response. Stored in entry_photo against the MIS row
 *  (model "Mis"), so the existing /api/photo viewer serves it under its existing gate,
 *  canSeeModel("Mis") — which refuses COMMERCIAL, SALES and STORE. Not byte-identical to
 *  this page's audience (an OPERATOR passes the model gate while middleware bars them
 *  from /mis itself), but strictly no wider than the shop-floor data they already see.
 *  Explicit validation, unlike the best-effort savePhotoFromForm: the manager attaching
 *  evidence must be TOLD when the file was refused, not silently skipped. */
export async function addDowntimePhoto(fd: FormData): Promise<RespondRes> {
  if (!(await canRespondDowntime())) return { ok: false, message: "Only Maintenance Manager or Admin can attach photos." };
  const misId = String(fd.get("misId") ?? "").trim();
  if (!misId) return { ok: false, message: "Missing incident reference." };
  const f = fd.get("photo");
  if (!(f instanceof File) || f.size === 0) return { ok: false, message: "Choose a photo first." };
  if (f.size > PHOTO_MAX) return { ok: false, message: "Photo too large (max 8 MB)." };
  // startsWith, not equality: "image/svg+xml;charset=utf-8" is still SVG (script risk).
  if (!f.type.startsWith("image/") || f.type.startsWith("image/svg")) return { ok: false, message: "Only image files can be attached (SVG excluded)." };
  const row = await prisma.mis.findUnique({ where: { id: misId }, select: { id: true } });
  if (!row) return { ok: false, message: "Incident not found." };
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const by = ((u as any)?.name as string | undefined) || ((u as any)?.email as string | undefined) || null;
  try {
    const buf = Buffer.from(await f.arrayBuffer());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).$executeRaw`INSERT INTO entry_photo (id, model, record_id, filename, mime, data, taken_by)
      VALUES (${localId("eph")}, ${"Mis"}, ${misId}, ${f.name.slice(0, 200) || "photo.jpg"}, ${f.type}, ${buf}, ${by})`;
  } catch (e) {
    return { ok: false, message: `Photo save failed: ${String((e as Error)?.message ?? e)}` };
  }
  revalidatePath("/mis");
  return { ok: true, message: "Photo attached." };
}
