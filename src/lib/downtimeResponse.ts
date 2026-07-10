// Maintenance response on a downtime incident (one per MIS hourly row). Backed by
// the raw `downtime_response` table (no Prisma model needed, like batch_range_edit).
// Visible to anyone who can see /mis; only Maintenance Manager + Admin may write
// (gated in the server action). Resilient if the table isn't created yet.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { localId } from "@/lib/rbac";

const db = prisma as any;

export const DOWNTIME_STATUSES = ["Pending", "Attended", "Resolved", "Not required"] as const;
export type DowntimeStatus = (typeof DOWNTIME_STATUSES)[number];

export interface DowntimeResp { status: string; note: string | null; by: string | null; at: string | null; }

/** Responses keyed by MIS row id, for the given incident ids. */
export async function getDowntimeResponses(misIds: string[]): Promise<Map<string, DowntimeResp>> {
  const out = new Map<string, DowntimeResp>();
  const ids = [...new Set(misIds.filter(Boolean))];
  if (!ids.length) return out;
  try {
    const rows: any[] = await db.$queryRaw(
      Prisma.sql`SELECT mis_id, status, note, responded_by, updated_at FROM downtime_response WHERE mis_id IN (${Prisma.join(ids)})`
    );
    for (const r of rows) {
      out.set(String(r.mis_id), {
        status: String(r.status),
        note: r.note ?? null,
        by: r.responded_by ?? null,
        at: r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 16).replace("T", " ") : null,
      });
    }
  } catch { /* downtime_response table not created yet */ }
  return out;
}

/** Upsert the maintenance response for one incident (one row per MIS id). */
export async function writeDowntimeResponse(misId: string, status: string, note: string | null, by: string | null): Promise<void> {
  if (!misId) return;
  await db.$executeRaw(Prisma.sql`
    INSERT INTO downtime_response (id, mis_id, status, note, responded_by, responded_at, updated_at)
    VALUES (${localId("dtr")}, ${misId}, ${status}, ${note}, ${by}, now(), now())
    ON CONFLICT (mis_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, responded_by = EXCLUDED.responded_by, updated_at = now()`);
}
