// Optional photo attached to a shop-floor entry record (stored in Postgres).
// Saved best-effort from createRow/saveRow; never blocks the entry itself.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";

const db = prisma as any;
const MAX = 8 * 1024 * 1024;

export async function savePhotoFromForm(fd: FormData, model: string, recordId: string, by: string | null): Promise<void> {
  try {
    const f = fd.get("__photo");
    if (!(f instanceof File) || f.size === 0) return;
    if (f.size > MAX || !f.type.startsWith("image/") || f.type === "image/svg+xml") return; // silently skip invalid (SVG excluded — script risk)
    const buf = Buffer.from(await f.arrayBuffer());
    const id = "eph" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    await db.$executeRaw`INSERT INTO entry_photo (id, model, record_id, filename, mime, data, taken_by)
      VALUES (${id}, ${model}, ${recordId}, ${f.name.slice(0, 200) || "photo.jpg"}, ${f.type}, ${buf}, ${by})`;
  } catch { /* photos are best-effort */ }
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
