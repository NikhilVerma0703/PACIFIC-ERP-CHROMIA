// Per-slab thickness, resolved across every station that records it.
//
// Thickness is NOT captured at the press (the table has no such column) or the
// oven — it lives on Distributor / Kreos (`slab_thickness`), Polish Entry /
// Polish QC (`slab_thickness`) and Jot (`thickness`, plus its 8 measured
// `thickness_at_N` points). A slab therefore has to be looked up wherever it
// happens to be stamped, which is what this module does: one query across all
// five stations, first hit in PRIORITY order wins, values canonicalised to
// "1.2 cm" / "2 cm" / "3 cm" / "7 mm" by canonThickness().
//
// PRIORITY: Jot first — it is the measured reading and covers every slab — then the
// line head (Distributor/Kreos) and the polish stations. This is the SAME precedence
// the production report uses, so the report, the Telegram bot and the thickness written
// onto auto-added rows all agree on one deciding station.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { canonThickness } from "@/lib/thickness";

type Row = { k: string | null; s: number; t: string | null; pr: number };

/** One row per (station, slab) that carries a thickness, tagged with its priority. */
async function thicknessRows(sel: { keys?: string[]; slabs?: number[] }): Promise<Row[]> {
  const keys = sel.keys?.filter(Boolean) ?? [];
  const slabs = (sel.slabs ?? []).filter((n) => Number.isFinite(n));
  if (!keys.length && !slabs.length) return [];
  const where = keys.length
    ? Prisma.sql`batch_key = ANY(${keys}::text[])`
    : Prisma.sql`slab_number = ANY(${slabs}::float8[])`;
  try {
    return await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT batch_key k, slab_number::float8 s, thickness t,      1 pr FROM jot          WHERE ${where} AND slab_number IS NOT NULL AND thickness IS NOT NULL
      UNION ALL
      SELECT batch_key,   slab_number::float8,   slab_thickness,   2    FROM distributor  WHERE ${where} AND slab_number IS NOT NULL AND slab_thickness IS NOT NULL
      UNION ALL
      SELECT batch_key,   slab_number::float8,   slab_thickness,   3    FROM kreos        WHERE ${where} AND slab_number IS NOT NULL AND slab_thickness IS NOT NULL
      UNION ALL
      SELECT batch_key,   slab_number::float8,   slab_thickness,   4    FROM polish_entry WHERE ${where} AND slab_number IS NOT NULL AND slab_thickness IS NOT NULL
      UNION ALL
      SELECT batch_key,   slab_number::float8,   slab_thickness,   5    FROM polish_qc    WHERE ${where} AND slab_number IS NOT NULL AND slab_thickness IS NOT NULL`);
  } catch (e) {
    console.error("thicknessRows failed:", e); // never break a caller, but never fail silently either
    return [];
  }
}

/**
 * slab number -> canonical thickness, for whole batches (`keys`) or specific
 * slab numbers (`slabs`). Highest-priority station wins per slab; slabs with no
 * thickness anywhere are simply absent from the map.
 */
export async function thicknessBySlab(sel: { keys?: string[]; slabs?: number[] }): Promise<Map<number, string>> {
  const rows = await thicknessRows(sel);
  const best = new Map<number, { pr: number; t: string }>();
  for (const r of rows) {
    const t = canonThickness(r.t);
    if (!t) continue;
    const cur = best.get(Number(r.s));
    if (!cur || r.pr < cur.pr) best.set(Number(r.s), { pr: Number(r.pr), t });
  }
  return new Map([...best.entries()].map(([s, v]) => [s, v.t]));
}

export interface BatchMix {
  mix: Map<string, number>; // thickness -> slab count
  noThickness: number;      // press slabs with no thickness stamped at any station
  total: number;            // = the batch's distinct press slab count
}

/**
 * batch key -> thickness split, counted over the batch's PRESS slabs.
 *
 * The press slab list is the authoritative one, so the split is deliberately
 * anchored to it: the thickness stations between them cover a slightly DIFFERENT
 * (and sometimes larger) slab set than press, and a split that didn't add up to
 * the press total would hand the Telegram model two contradictory numbers. Press
 * slabs with no thickness anywhere land in `noThickness`, so mix + noThickness
 * always equals the press count. Dedup + grouping happen in SQL.
 *
 * `since` (optional) restricts the press slabs counted to those pressed on/after that
 * date — needed by the 30-day dashboard card, which must not count a straddling
 * batch's older slabs. Omit it (the default) to count the batch's full press list.
 */
export async function thicknessMixByBatch(keys: string[], since?: Date | null): Promise<Map<string, BatchMix>> {
  const ks = keys.filter(Boolean);
  if (!ks.length) return new Map();
  const from = since ?? null;
  let rows: { k: string; t: string | null; n: number }[] = [];
  try {
    rows = await prisma.$queryRaw<{ k: string; t: string | null; n: number }[]>(Prisma.sql`
      WITH press_slabs AS (
        SELECT DISTINCT batch_key k, slab_number::float8 s FROM press
        WHERE batch_key = ANY(${ks}::text[]) AND slab_number IS NOT NULL
          AND (${from}::timestamptz IS NULL OR (COALESCE(date, imported_at) >= ${from}::timestamptz
               AND COALESCE(date, imported_at) <= now() + interval '2 days'))
      ), src AS (
        SELECT batch_key k, slab_number::float8 s, thickness t,      1 pr FROM jot          WHERE batch_key = ANY(${ks}::text[]) AND slab_number IS NOT NULL AND thickness IS NOT NULL
        UNION ALL
        SELECT batch_key,   slab_number::float8,   slab_thickness,   2    FROM distributor  WHERE batch_key = ANY(${ks}::text[]) AND slab_number IS NOT NULL AND slab_thickness IS NOT NULL
        UNION ALL
        SELECT batch_key,   slab_number::float8,   slab_thickness,   3    FROM kreos        WHERE batch_key = ANY(${ks}::text[]) AND slab_number IS NOT NULL AND slab_thickness IS NOT NULL
        UNION ALL
        SELECT batch_key,   slab_number::float8,   slab_thickness,   4    FROM polish_entry WHERE batch_key = ANY(${ks}::text[]) AND slab_number IS NOT NULL AND slab_thickness IS NOT NULL
        UNION ALL
        SELECT batch_key,   slab_number::float8,   slab_thickness,   5    FROM polish_qc    WHERE batch_key = ANY(${ks}::text[]) AND slab_number IS NOT NULL AND slab_thickness IS NOT NULL
      ), best AS (
        SELECT DISTINCT ON (k, s) k, s, t FROM src ORDER BY k, s, pr
      )
      SELECT p.k, b.t, count(*)::int n
      FROM press_slabs p LEFT JOIN best b ON b.k = p.k AND b.s = p.s
      GROUP BY 1, 2`);
  } catch (e) {
    console.error("thicknessMixByBatch failed:", e);
    return new Map();
  }
  const out = new Map<string, BatchMix>();
  for (const r of rows) {
    const k = String(r.k);
    const e = out.get(k) ?? { mix: new Map<string, number>(), noThickness: 0, total: 0 };
    const n = Number(r.n);
    const t = canonThickness(r.t);
    if (t) e.mix.set(t, (e.mix.get(t) ?? 0) + n);
    else e.noThickness += n;
    e.total += n;
    out.set(k, e);
  }
  return out;
}

/** Sum several batches' splits into one (a parent + its design-switch sub-batches). */
export function mergeMix(mixes: Iterable<BatchMix>): BatchMix {
  const out: BatchMix = { mix: new Map(), noThickness: 0, total: 0 };
  for (const m of mixes) {
    for (const [t, n] of m.mix) out.mix.set(t, (out.mix.get(t) ?? 0) + n);
    out.noThickness += m.noThickness;
    out.total += m.total;
  }
  return out;
}

/** Chart rows for a mix: thickness bars, biggest first (capped), plus a "not recorded" bar. */
export function mixBars(m: BatchMix | undefined, cap = 8): { label: string; count: number }[] {
  if (!m || !m.total) return [];
  const bars = [...m.mix.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })).slice(0, cap);
  if (m.noThickness) bars.push({ label: "not recorded", count: m.noThickness });
  return bars;
}

/** "2 cm×589, 3 cm×503" — plus a "no thickness×N" bucket, so it sums to the press count. */
export function mixLabel(m: BatchMix | undefined): string {
  if (!m || !m.total) return "not recorded";
  const parts = [...m.mix.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`);
  if (m.noThickness) parts.push(`no thickness×${m.noThickness}`);
  return parts.length ? parts.join(", ") : "not recorded";
}
