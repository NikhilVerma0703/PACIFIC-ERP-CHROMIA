/**
 * The three date/clock primitives the Robo reports share: minutes-since-
 * midnight, whole-days-since-epoch, and back again. UTC throughout, so no
 * timezone ever shifts a day.
 *
 * Pure and alias-free so `node --test` can reach it.
 *
 * ── THIS FILE USED TO HOLD A PLACEMENT RULE, AND NO LONGER DOES ────────────
 * It once decided which DAY each slab sat on by walking the batch in
 * serialNumber order and treating a backwards clock as a midnight crossing —
 * one rule shared by the hourly chart and the Total Production Time KPI so the
 * two could not disagree.
 *
 * That rule was replaced on 2026-09-16. serialNumber turned out to be
 * unreliable on real runs (mistyped, restarted, duplicated), so the walk ran
 * out of order, every out-of-order step read as a midnight crossing, and whole
 * batches drifted forward — 1440 (8-10 Sep) charted as 23-25 Sep, 1445
 * (15-16 Sep) as 18-20 Sep. Each slab is now placed on its OWN stored
 * production date by hourlyProduction.placeSlabs, which productionSpan.ts also
 * goes through: still one rule, a different one. (That placeSlabs is not this
 * file's old walk: it keeps the stored date and moves only a slab that is
 * provably one day off, by at most one day, with no day cursor — see
 * hourlyProduction.ts.)
 *
 * The superseded machinery (the serialNumber walk that was this file's
 * placeSlabs, registerOrder, MAX_RUN_HOURS) is gone rather than left here
 * unused. Dead code with passing tests beside it reads to the next person as
 * the rule in force, and the wrong day on a production report is not a cheap
 * mistake to inherit.
 */
export interface PlaceableSlab {
  /** yyyy-mm-dd — the slab's effective production date (productionDateOf). */
  productionDate: string | null | undefined;
  inTime: string | null | undefined; // HH:MM
  outTime: string | null | undefined; // HH:MM
  /** Register order — the production sequence. Optional: with neither hint
   *  present the caller's array order is taken as the sequence. */
  serialNumber?: number | null;
  createdAt?: string | number | Date | null;
}

export interface PlacedSlab<T> {
  slab: T;
  /** Absolute minutes (whole days since the epoch × 1440 + clock), null when
   *  the slab has no such time. */
  inAbs: number | null;
  outAbs: number | null;
}

/** Minutes since midnight for an HH:MM string, or null if unusable. */
export function toMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Whole days since the epoch for a yyyy-mm-dd string, or null. UTC, so no
 *  timezone shifts the day. */
export function dayNum(d: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((d ?? "").trim());
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** The yyyy-mm-dd for a whole-days-since-epoch number — the inverse of dayNum,
 *  in UTC, so the date a bucket is labelled with never drifts with a timezone. */
export function dateFromDayNum(dn: number): string | null {
  if (!Number.isFinite(dn)) return null;
  return new Date(dn * 86_400_000).toISOString().slice(0, 10);
}

/** A comparable number for a createdAt (Date, epoch ms, or ISO string); 0 when
 *  absent or unparseable, so it never reorders ahead of a real timestamp. */
function createdAtValue(v: string | number | Date | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

/** Register order = production order: serialNumber, then createdAt. Stable, so
 *  with no hints the caller's own order stands as the sequence. */
