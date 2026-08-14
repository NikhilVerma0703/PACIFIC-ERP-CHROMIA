// Reading the applied delay reclassifications for a set of MIS hourly rows, so the
// two views that show corrected hours can mark them. Backed by the raw
// `mis_delay_reclass` table (modelled in schema.prisma as MisDelayReclass so a
// `db push` will not DROP it; access stays raw SQL, like downtime_response).
// Created by scripts/0037-mis-delay-reclass.sql.
//
// READ-ONLY BY DESIGN. The write lives with the server action (src/app/mis/actions.ts)
// because a reclass row must be appended in the same breath as the Mis row is
// rewritten — the two halves of one correction — and splitting the write across two
// modules is how one half ends up shipped without the other. The rules that decide
// WHETHER a correction is legal are in src/lib/delayReclass.ts, which is prisma-free
// and therefore reachable from `node --test` and from the client form.
//
// WHY A FAILED READ IS NOT AN EMPTY READ. If this lookup fails and we return an empty
// map, every corrected hour renders exactly like an untouched one: the Mis row already
// holds the corrected figures, so the numbers look ordinary and nothing says a human
// moved them. That is the single outcome the owner's "mark in some color" asks us to
// prevent, and it is worse here than a blank column would be, because it is silently
// wrong rather than visibly missing. So a genuine failure returns null, the page says
// the marks are unknown, and it withholds the reclassify control for that load rather
// than let a second correction be stacked on a first one nobody could see.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { scoredMinutesRemoved, type ReclassRecord } from "@/lib/delayReclass";

const db = prisma as any;

/** One stored correction, in the structural shape src/lib/delayReclass.ts describes.
 *  `changedAt` is a plain "YYYY-MM-DD HH:MM" string, never a Date: it crosses into a
 *  client component, and describeReclassRecord() slices the date off the front rather
 *  than re-rendering it through the viewer's locale (DB timestamps are naive IST stored
 *  as UTC — a locale formatter moves a late-evening correction to the previous day). */
export interface ReclassLogRow extends ReclassRecord {
  fromType: string;
  toType: string;
  minutes: number;
  reason: string | null;
  changedBy: string | null;
  changedAt: string | null;
}

const fmtAt = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 16).replace("T", " ") : null);

/**
 * Corrections keyed by MIS row id, oldest first — describeReclass() reads them in order
 * and the tooltip is a history, so the newest move has to be the last line.
 *
 * Returns NULL when the lookup itself failed; see the header. A MISSING TABLE is not a
 * failure — before scripts/0037-mis-delay-reclass.sql runs there genuinely are no
 * corrections, so that reads as an empty map and the feature is simply off.
 */
export async function getDelayReclassLog(misIds: string[]): Promise<Map<string, ReclassLogRow[]> | null> {
  const out = new Map<string, ReclassLogRow[]>();
  const ids = [...new Set(misIds.filter(Boolean))];
  if (!ids.length) return out;
  try {
    const rows: any[] = await db.$queryRaw(Prisma.sql`
      SELECT mis_id, from_type, to_type, minutes, reason, changed_by, changed_at
      FROM mis_delay_reclass
      WHERE mis_id IN (${Prisma.join(ids)})
      ORDER BY changed_at ASC`);
    for (const r of rows) {
      const key = String(r.mis_id);
      const list = out.get(key) ?? [];
      list.push({
        fromType: String(r.from_type),
        toType: String(r.to_type),
        minutes: Number(r.minutes),
        reason: r.reason ?? null,
        changedBy: r.changed_by ?? null,
        changedAt: fmtAt(r.changed_at),
      });
      out.set(key, list);
    }
  } catch (e) {
    // Only a missing table reads as feature-off. Matching anything broader (a dropped
    // column, say) would present schema drift as "nothing was ever corrected", which is
    // the exact lie the null return exists to avoid.
    const msg = String((e as Error)?.message ?? e);
    if ((e as any)?.meta?.code === "42P01" || /relation "(?:public\.)?mis_delay_reclass" does not exist/i.test(msg)) return out;
    console.error("getDelayReclassLog failed:", e);
    return null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The scoreboard's view of the same table
// ---------------------------------------------------------------------------
// WHY THE ADMIN NEEDS THIS AND THE TWO LOGS ARE NOT ENOUGH. A reclassification
// rewrites the Mis row, and src/lib/shiftScore.ts computes uptime straight off
// two of those columns (breakdown + power-out) — that uptime is what ranks the
// ELECTRICAL and MECHANICAL incharges and splits their share of the monthly
// incentive pool. So moving minutes OUT of breakdown raises the maintenance
// team's own payout, and the person signing that payout is on /scoreboard, not
// on /mis. Without this the corrected figures arrive on the scoreboard looking
// exactly like figures production typed: the marks the owner asked for live on a
// page the admin has no reason to open while paying.
//
// It reports the moves, it does NOT adjust the score. Undoing them here would be
// a second, invisible set of books and would also assume the correction was
// wrong; the honest thing is to show the admin what was moved, by whom and why,
// and let them look.

export interface ReclassImpactRow extends ReclassLogRow {
  misId: string;
  /** The hour that was corrected, for the "which row?" question the banner raises. */
  misDate: string | null;
  misHour: string | null;
}

export interface ReclassImpact {
  rows: ReclassImpactRow[];
  count: number;
  /** Distinct authors, in first-seen order — "who corrected their own input". */
  authors: string[];
  /** Minutes taken OUT of breakdown, net of any moved back in. Positive means the
   *  scored downtime shrank, i.e. uptime and the maintenance payout went UP. */
  breakdownRemoved: number;
  /** The same for power-out, which counts in the ELECTRICAL ranking only
   *  (scoreRange rolls electrical with withPowerout = true, mechanical without). */
  poweroutRemoved: number;
}

/**
 * Every correction applied to an MIS hour inside one scoring window, newest first.
 *
 * The window is passed as UTC instants rather than dates because the scoreboard's
 * range is a span of SHIFTS, not calendar days — shift A starts at 06:00 IST and
 * shift C ends at 06:00 the next morning. The caller builds it with shiftRange()
 * from shiftScoreMath.ts so this and the score cover the same hours; a window
 * built from midnight would silently include or drop the night shift.
 *
 * The row filter mirrors scoreShift's exactly (`dateAndTime`, falling back to
 * `date` when it is NULL). If those two ever disagree the banner would report
 * corrections to hours the board did not score, or miss ones it did.
 *
 * Returns NULL on a genuine failure and an EMPTY impact when the table is absent,
 * the same contract as getDelayReclassLog above and for the same reason: on a page
 * that decides money, "we could not check" must not render as "nothing happened".
 */
export async function getReclassImpact(start: Date, end: Date): Promise<ReclassImpact | null> {
  const empty: ReclassImpact = { rows: [], count: 0, authors: [], breakdownRemoved: 0, poweroutRemoved: 0 };
  try {
    const rows: any[] = await db.$queryRaw(Prisma.sql`
      SELECT r.mis_id, r.from_type, r.to_type, r.minutes, r.reason, r.changed_by, r.changed_at,
             m.date AS mis_date, m.hour AS mis_hour
        FROM mis_delay_reclass r
        JOIN mis m ON m.id = r.mis_id
       WHERE (m.date_and_time >= ${start} AND m.date_and_time < ${end})
          OR (m.date_and_time IS NULL AND m.date >= ${start} AND m.date < ${end})
       ORDER BY r.changed_at DESC`);
    const out: ReclassImpactRow[] = [];
    const authors: string[] = [];
    for (const r of rows) {
      const minutes = Number(r.minutes);
      const by = (r.changed_by ?? "").trim();
      if (by && !authors.includes(by)) authors.push(by);
      out.push({
        misId: String(r.mis_id),
        misDate: r.mis_date ? new Date(r.mis_date).toISOString().slice(0, 10) : null,
        misHour: r.mis_hour ?? null,
        fromType: String(r.from_type),
        toType: String(r.to_type),
        minutes,
        reason: r.reason ?? null,
        changedBy: r.changed_by ?? null,
        changedAt: fmtAt(r.changed_at),
      });
    }
    // Both figures come from the pure module, off the same records the violet
    // marks are drawn from, so the banner and the two MIS views cannot disagree
    // about what was moved.
    const removed = scoredMinutesRemoved(out);
    return { rows: out, count: out.length, authors, breakdownRemoved: removed.breakdown, poweroutRemoved: removed.powerout };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if ((e as any)?.meta?.code === "42P01" || /relation "(?:public\.)?mis_delay_reclass" does not exist/i.test(msg)) return empty;
    console.error("getReclassImpact failed:", e);
    return null;
  }
}
