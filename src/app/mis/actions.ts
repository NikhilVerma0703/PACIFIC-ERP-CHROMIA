"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canRespondDowntime, currentUser, localId } from "@/lib/rbac";
import { writeDowntimeResponse, writeDowntimeDispute, DOWNTIME_STATUSES } from "@/lib/downtimeResponse";
import { DELAY_FIELDS } from "@/lib/downtimeShared";

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
  revalidatePath("/mis");
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
