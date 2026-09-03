// Optional photo attached to a shop-floor entry record (stored in Postgres).
// Saved best-effort from createRow/saveRow; never blocks the entry itself.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { ALL_PHOTO_FIELDS, PHOTO_SLOTS, photoProblem } from "@/lib/photoSlots";

const db = prisma as any;
const MAX = 8 * 1024 * 1024;

export async function savePhotoFromForm(
  fd: FormData, model: string, recordId: string, by: string | null,
  /** Fields another call has already stored. A reject's far/near pair is stored
   *  by saveRejectPhotoPair below, which REPORTS its failures instead of
   *  swallowing them; without this the best-effort walk would store the same two
   *  files a second time and the record would carry duplicate photos. */
  opts: { skipFields?: readonly string[] } = {},
): Promise<void> {
  // EVERY photo field the form might carry, not just the generic one: the QC
  // form and the tables editor post the far/near pair, and a save that looked
  // only at __photo would drop both without a word. Each slot is stored
  // independently — one unusable file must not lose the other — and all stay
  // best-effort, because a shop-floor entry is never lost to its photo.
  for (const { field, prefix } of ALL_PHOTO_FIELDS) {
    try {
      if (opts.skipFields?.includes(field)) continue;
      const f = fd.get(field);
      if (!(f instanceof File) || f.size === 0) continue;
      if (f.size > MAX || !f.type.startsWith("image/") || f.type === "image/svg+xml") continue; // silently skip invalid (SVG excluded — script risk)
      const buf = Buffer.from(await f.arrayBuffer());
      const id = "eph" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      const name = (prefix + (f.name || "photo.jpg")).slice(0, 200);
      await db.$executeRaw`INSERT INTO entry_photo (id, model, record_id, filename, mime, data, taken_by)
        VALUES (${id}, ${model}, ${recordId}, ${name}, ${f.type}, ${buf}, ${by})`;
    } catch { /* photos are best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// REQUIRED photo, by NAMED field — the slab-intake form's variant. Same store,
// opposite contract: savePhotoFromForm above is best-effort by design (a shop
// -floor entry must never fail on its photo) and its existing callers keep
// that; the intake form's far/near defect photos are MANDATORY, so this pair
// validates and REFUSES with a sentence instead of silently skipping. Split in
// two so the caller can refuse BEFORE creating the row it would attach to.
// ---------------------------------------------------------------------------

/** One refusal sentence, or null when the named field holds a saveable photo.
 *  The same limits savePhotoFromForm enforces silently: 8 MB, image/* minus
 *  SVG (script risk — startsWith, so "image/svg+xml;charset=utf-8" is caught). */
export function requiredPhotoProblem(fd: FormData, field: string, label: string): string | null {
  // ONE RULE, TWO SIDES. The conditions moved to lib/photoSlots (import-free, so
  // the QC screens' submit guards can ask the SAME question this does). They
  // used to check only "present and non-empty" and the server checked three, so
  // a small file with a non-image MIME passed on screen and was refused here.
  return photoProblem(fd.get(field), label);
}

/** Store the named field's photo, prefixing the filename (far- / near-) so the
 *  two slots stay tellable apart when read back. Returns null on success, or
 *  the refusal/failure sentence — never a silent skip. */
export async function saveRequiredPhoto(
  fd: FormData,
  field: string,
  opts: { model: string; recordId: string; by: string | null; prefix: string; label: string },
): Promise<string | null> {
  const bad = requiredPhotoProblem(fd, field, opts.label);
  if (bad) return bad;
  const f = fd.get(field) as File;
  try {
    const buf = Buffer.from(await f.arrayBuffer());
    const id = "eph" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    const name = (opts.prefix + (f.name || "photo.jpg")).slice(0, 200);
    await db.$executeRaw`INSERT INTO entry_photo (id, model, record_id, filename, mime, data, taken_by)
      VALUES (${id}, ${opts.model}, ${opts.recordId}, ${name}, ${f.type}, ${buf}, ${opts.by})`;
    return null;
  } catch (e) {
    console.error("[entryPhoto] required photo save failed:", opts.model, opts.recordId, e);
    return `The ${opts.label} could not be stored — attach it again.`;
  }
}

/** Store a REJECT's far/near pair and say what did not land.
 *
 *  WHY THIS EXISTS RATHER THAN savePhotoFromForm. The reject rule validates the
 *  two files at the door and then hands them to a store that is best-effort BY
 *  DESIGN — the per-slot swallowing catch above, which is right
 *  for every other entry: a shop-floor row must never be lost to its camera. On
 *  a C (Reject) it is wrong. A Neon hiccup, a 22021, or an oversize buffer on
 *  the INSERT produces exactly the thing the rule exists to prevent — a reject
 *  row with no photographs — while the operator is shown a green "Saved" and
 *  walks away believing the evidence is on file.
 *
 *  So on a reject the pair goes through saveRequiredPhoto, which reports. The
 *  ROW IS NOT LOST (it is already written by the time this runs, and re-saving
 *  would duplicate it); the caller folds the returned sentence into its answer
 *  so the operator knows to re-attach. This is the shape slab-intake settled on
 *  — app/slab-intake/actions.ts returns { ok: true, warn: true } for the same
 *  case, for the same reason.
 *
 *  Returns "" when both slots landed. A slot the form did not carry is skipped
 *  silently: the caller's guard has already decided the save may proceed (an
 *  edit can be satisfied by a photo already in entry_photo), and re-reporting
 *  that here would refuse work the rule allows. */
export async function saveRejectPhotoPair(
  fd: FormData,
  opts: { model: string; recordId: string; by: string | null },
): Promise<string> {
  const failures: string[] = [];
  for (const p of PHOTO_SLOTS) {
    const f = fd.get(p.field);
    if (!(f instanceof File) || f.size === 0) continue;   // not carried — see above
    const err = await saveRequiredPhoto(fd, p.field, {
      model: opts.model, recordId: opts.recordId, by: opts.by, prefix: p.prefix, label: p.label,
    });
    if (err) failures.push(err);
  }
  return failures.join(" ");
}

export interface PhotoMeta { id: string; filename: string; at: Date; taken_by: string | null }

/** Photo ids+names for MANY records in one query — the downtime log renders hundreds of
 *  rows, and a per-row lookup would be an N+1. Serializable shape (no Date), so it can
 *  cross into a client component as-is. Best-effort like every other photo read. */
export async function photosForRecords(model: string, recordIds: string[]): Promise<Map<string, { id: string; filename: string }[]>> {
  const out = new Map<string, { id: string; filename: string }[]>();
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (!ids.length) return out;
  try {
    const rows: any[] = await db.$queryRaw`SELECT id, record_id, filename FROM entry_photo WHERE model = ${model} AND record_id = ANY(${ids}) ORDER BY at ASC`;
    for (const r of rows) {
      const k = String(r.record_id);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push({ id: String(r.id), filename: String(r.filename) });
    }
  } catch { /* photos are best-effort */ }
  return out;
}

export async function photosForRecord(model: string, recordId: string): Promise<PhotoMeta[]> {
  try {
    return await db.$queryRaw`SELECT id, filename, at, taken_by FROM entry_photo WHERE model = ${model} AND record_id = ${recordId} ORDER BY at ASC`;
  } catch { return []; }
}
