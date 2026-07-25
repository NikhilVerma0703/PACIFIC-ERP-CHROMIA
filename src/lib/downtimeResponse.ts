// Maintenance response on a downtime incident (one per MIS hourly row). Backed by
// the raw `downtime_response` table (no Prisma model needed, like batch_range_edit).
// Visible to anyone who can see /mis; only Maintenance Manager + Admin may write
// (gated in the server action). Resilient if the table isn't created yet.
//
// The response can carry a DISPUTE: maintenance's own duration for one delay type,
// recorded BESIDE production's figure, never over it. The MIS row stays production's;
// nothing here writes to it, and no KPI or chart reads the disputed figure - it is a
// visible disagreement, not a second set of books. If production agrees, they correct
// their own entry through the MIS form, and the UI shows the figures matching.
//
// Full DDL, verified against the live table 2026-07-25 (it predates this file's history):
//   CREATE TABLE IF NOT EXISTS downtime_response (
//     id           text PRIMARY KEY,
//     mis_id       text NOT NULL UNIQUE,
//     status       text NOT NULL,
//     note         text,
//     responded_by text,
//     responded_at timestamp NOT NULL DEFAULT now(),  -- timestamp WITHOUT tz, stored UTC
//     updated_at   timestamp NOT NULL DEFAULT now()
//   );
//   -- dispute columns: scripts/0029-downtime-dispute.sql (timestamp, not timestamptz,
//   -- matching the siblings; all four nullable — NULL means "no dispute")
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { localId } from "@/lib/rbac";

const db = prisma as any;

export const DOWNTIME_STATUSES = ["Pending", "Attended", "Resolved", "Not required"] as const;
export type DowntimeStatus = (typeof DOWNTIME_STATUSES)[number];

export interface DowntimeResp {
  status: string; note: string | null; by: string | null; at: string | null;
  /** Dispute: maintenance's own duration for one delay type. null = no dispute. */
  dispType: string | null; dispMinutes: number | null; dispBy: string | null; dispAt: string | null;
}

/** Responses keyed by MIS row id, for the given incident ids.
 *  Returns NULL when the lookup itself failed (transient DB error): a silent empty map
 *  here renders every saved response as "not responded" — and because the respond form
 *  then offers a fresh save, one flaky read can get a Resolved+note upserted over with a
 *  blank Pending. Callers must treat null as "unknown", not "none". A missing table
 *  (fresh deploy, migration not run) still reads as genuinely empty — feature off. */
export async function getDowntimeResponses(misIds: string[]): Promise<Map<string, DowntimeResp> | null> {
  const out = new Map<string, DowntimeResp>();
  const ids = [...new Set(misIds.filter(Boolean))];
  if (!ids.length) return out;
  const fmtAt = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 16).replace("T", " ") : null);
  const fill = (rows: any[], withDispute: boolean) => {
    for (const r of rows) {
      out.set(String(r.mis_id), {
        status: String(r.status),
        note: r.note ?? null,
        by: r.responded_by ?? null,
        at: fmtAt(r.updated_at),
        dispType: withDispute ? (r.disputed_type ?? null) : null,
        dispMinutes: withDispute && r.disputed_minutes != null ? Number(r.disputed_minutes) : null,
        dispBy: withDispute ? (r.disputed_by ?? null) : null,
        dispAt: withDispute ? fmtAt(r.disputed_at) : null,
      });
    }
  };
  try {
    try {
      fill(await db.$queryRaw(
        Prisma.sql`SELECT mis_id, status, note, responded_by, updated_at, disputed_type, disputed_minutes, disputed_by, disputed_at FROM downtime_response WHERE mis_id IN (${Prisma.join(ids)})`
      ), true);
    } catch (inner) {
      // 42703 = a column in the SELECT does not exist — before scripts/0029 runs, that
      // is the dispute columns. Fall back to the original column set so existing
      // responses keep rendering; disputes read as absent, which is also TRUE — none
      // can have been written. Anything that is not a missing column re-throws to the
      // outer handler so a real failure still reads as "unknown", not "none".
      const msg = String((inner as Error)?.message ?? inner);
      if (!((inner as any)?.meta?.code === "42703" || /column "disputed_\w+" does not exist/i.test(msg))) throw inner;
      fill(await db.$queryRaw(
        Prisma.sql`SELECT mis_id, status, note, responded_by, updated_at FROM downtime_response WHERE mis_id IN (${Prisma.join(ids)})`
      ), false);
    }
  } catch (e) {
    // Only a MISSING TABLE reads as feature-off; a broader match (e.g. a dropped column)
    // would masquerade schema drift as "nobody responded" and reopen the blind-overwrite
    // hazard this null exists to close.
    const msg = String((e as Error)?.message ?? e);
    if ((e as any)?.meta?.code === "42P01" || /relation "(?:public\.)?downtime_response" does not exist/i.test(msg)) return out;
    console.error("getDowntimeResponses failed:", e);
    return null;
  }
  return out;
}

/** Upsert the maintenance response for one incident (one row per MIS id).
 *  Touches status/note only — an existing dispute on the row is preserved. */
export async function writeDowntimeResponse(misId: string, status: string, note: string | null, by: string | null): Promise<void> {
  if (!misId) return;
  await db.$executeRaw(Prisma.sql`
    INSERT INTO downtime_response (id, mis_id, status, note, responded_by, responded_at, updated_at)
    VALUES (${localId("dtr")}, ${misId}, ${status}, ${note}, ${by}, now(), now())
    ON CONFLICT (mis_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, responded_by = EXCLUDED.responded_by, updated_at = now()`);
}

/** Record (or clear, with null) the dispute on one incident. Touches the dispute
 *  columns only — status and note are preserved; a dispute saved before any response
 *  gets status 'Pending' so the row renders like every other unattended incident. */
export async function writeDowntimeDispute(
  misId: string,
  dispute: { type: string; minutes: number } | null,
  by: string | null
): Promise<void> {
  if (!misId) return;
  if (dispute) {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO downtime_response (id, mis_id, status, note, responded_by, responded_at, updated_at, disputed_type, disputed_minutes, disputed_by, disputed_at)
      VALUES (${localId("dtr")}, ${misId}, 'Pending', NULL, NULL, now(), now(), ${dispute.type}, ${dispute.minutes}, ${by}, now())
      ON CONFLICT (mis_id) DO UPDATE SET disputed_type = EXCLUDED.disputed_type, disputed_minutes = EXCLUDED.disputed_minutes, disputed_by = EXCLUDED.disputed_by, disputed_at = now(), updated_at = now()`);
  } else {
    await db.$executeRaw(Prisma.sql`
      UPDATE downtime_response SET disputed_type = NULL, disputed_minutes = NULL, disputed_by = NULL, disputed_at = NULL, updated_at = now()
      WHERE mis_id = ${misId}`);
  }
}
