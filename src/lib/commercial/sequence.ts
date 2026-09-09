// Document numbers — the server half. One row per key in commercial_sequence;
// the counter step is a single UPSERT ... RETURNING, so two Commercial users
// issuing PIs in the same second get consecutive numbers, never the same one.
// The count()+1 pattern the ported module uses does not have that property
// (src/lib/sales/orderNumber.ts) and has already drifted from its own data.
//
// An override typed by hand wins over the counter, and does NOT advance it —
// a mirrored Tally number must not consume an ERP number. Uniqueness on the
// document table is what catches a duplicate either way.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "./settings";
import { documentNumber, sequenceKey, cleanOverride } from "./numbering";
import type { NumberingKind } from "./settings-defaults";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface IssuedNumber {
  number: string;
  /** null when an override was used. */
  seq: number | null;
  key: string;
  overridden: boolean;
}

/** Advance the counter for `key` and return the value it handed out. */
export async function takeSequence(key: string): Promise<number> {
  const rows: Array<{ n: bigint | number }> = await db.$queryRaw(Prisma.sql`
    INSERT INTO commercial_sequence (key, next_value, updated_at)
    VALUES (${key}, 2, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE
      SET next_value = commercial_sequence.next_value + 1, updated_at = CURRENT_TIMESTAMP
    RETURNING next_value - 1 AS n`);
  return Number(rows[0]?.n ?? 1);
}

/** The number the next document of this kind will get, without taking it. */
export async function peekNext(kind: NumberingKind, at: Date = new Date()): Promise<{ key: string; next: number; preview: string }> {
  const s = await loadSettings();
  const spec = s.numbering[kind];
  const key = sequenceKey(spec, at);
  const row = await db.commercialSequence.findUnique({ where: { key }, select: { nextValue: true } });
  const next = Number(row?.nextValue ?? 1);
  return { key, next, preview: documentNumber(spec, at, next) };
}

/** Set a counter — the settings screen's way of aligning with Tally's next
 *  number. updatedAt is written by hand: the column is @default(now()) with no
 *  @updatedAt (only takeSequence's raw SQL refreshes it), so without this a
 *  counter aligned by an admin kept showing the date it was first USED — and
 *  that column is exactly what the settings screen shows as "last changed". */
export async function setNext(key: string, nextValue: number): Promise<void> {
  const n = Math.max(1, Math.floor(nextValue));
  const now = new Date();
  await db.commercialSequence.upsert({
    where: { key },
    update: { nextValue: n, updatedAt: now },
    create: { key, nextValue: n, updatedAt: now },
  });
}

/** Issue a number for a document dated `at`. */
export async function issueNumber(kind: NumberingKind, at: Date = new Date(), override?: unknown): Promise<IssuedNumber> {
  const s = await loadSettings();
  const spec = s.numbering[kind];
  const key = sequenceKey(spec, at);
  const manual = cleanOverride(override);
  if (manual) return { number: manual, seq: null, key, overridden: true };
  const seq = await takeSequence(key);
  return { number: documentNumber(spec, at, seq), seq, key, overridden: false };
}

/** All counters, for the settings screen. */
export async function listSequences(): Promise<Array<{ key: string; nextValue: number; updatedAt: Date }>> {
  const rows: Array<{ key: string; nextValue: bigint | number; updatedAt: Date }> = await db.commercialSequence.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({ key: r.key, nextValue: Number(r.nextValue), updatedAt: r.updatedAt }));
}
