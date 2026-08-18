// The rate card's write surface. ADMIN ONLY - mirrored from the
// finance-admin namespace convention: clerk-facing reads live under
// /api/office/costing, writes live here.
//
// Rows are append-only revisions: "resin went to ₹158 from 1 September" is a
// new row, not an edit, so June batches keep pricing at June's rate. The one
// mutation that is not an append - DELETE - exists for the fat-fingered row,
// and takes the row id so it cannot silently remove more than one.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, currentUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  effectiveRateCard, listRateRows, RATE_ITEM_BY_KEY, RATE_ITEMS, STARTER_RATES,
} from "@/lib/costing/rateCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function GET() {
  if (!(await isAdmin())) return json({ error: "Admins only." }, 403);
  const [rows, card] = await Promise.all([
    listRateRows(),
    effectiveRateCard(new Date()),
  ]);
  return json({ catalogue: RATE_ITEMS, rows, today: card });
}

interface PostedRow {
  item?: unknown; variant?: unknown; rate?: unknown; effectiveFrom?: unknown; note?: unknown;
}

/** yyyy-mm-dd, as a UTC date - the column is @db.Date, time is meaningless. */
function parseDay(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function validate(r: PostedRow): { item: string; variant: string; rate: number; effectiveFrom: Date; note: string | null } | string {
  const item = typeof r.item === "string" ? r.item.trim() : "";
  const def = RATE_ITEM_BY_KEY.get(item);
  if (!def) return `Unknown rate item '${item}'`;
  const variant = typeof r.variant === "string" ? r.variant.trim() : "";
  if (def.variants && !variant) return `'${item}' needs a supplier name`;
  if (!def.variants && variant) return `'${item}' does not take a variant`;
  const rate = Number(r.rate);
  if (!Number.isFinite(rate) || rate <= 0) return `'${item}' needs a rate above zero`;
  const effectiveFrom = parseDay(r.effectiveFrom);
  if (!effectiveFrom) return `'${item}' needs an effective date (yyyy-mm-dd)`;
  const note = typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, 300) : null;
  return { item, variant, rate, effectiveFrom, note };
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return json({ error: "Admins only." }, 403);
  const user = (await currentUser())?.name ?? "admin";

  let body: { rows?: PostedRow[]; starter?: boolean; effectiveFrom?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  // One click on the empty screen: the reference sheet's card.
  if (body.starter) {
    const effectiveFrom = parseDay(body.effectiveFrom) ?? new Date("2026-08-01T00:00:00.000Z");
    body = {
      rows: STARTER_RATES.map((s) => ({
        item: s.item, variant: s.variant ?? "", rate: s.rate,
        effectiveFrom: effectiveFrom.toISOString().slice(0, 10), note: s.note,
      })),
    };
  }

  const posted = Array.isArray(body.rows) ? body.rows : [];
  if (!posted.length) return json({ error: "No rows to save." }, 400);
  if (posted.length > 100) return json({ error: "Too many rows in one save." }, 400);

  const rows = [];
  for (const p of posted) {
    const v = validate(p);
    if (typeof v === "string") return json({ error: v }, 400);
    rows.push(v);
  }

  // Same (item, variant, effective date) posted again is a correction of that
  // revision, not a second revision - upsert, don't fail.
  let written = 0;
  for (const r of rows) {
    const def = RATE_ITEM_BY_KEY.get(r.item)!;
    await prisma.costingRate.upsert({
      where: {
        item_variant_effectiveFrom: {
          item: r.item, variant: r.variant, effectiveFrom: r.effectiveFrom,
        },
      },
      create: {
        category: def.category, item: r.item, variant: r.variant, unit: def.unit,
        rate: r.rate, effectiveFrom: r.effectiveFrom, note: r.note, createdBy: user,
      },
      update: { rate: r.rate, note: r.note, createdBy: user },
    });
    written += 1;
  }

  return json({ ok: true, written });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) return json({ error: "Admins only." }, 403);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return json({ error: "Which row? Pass ?id=" }, 400);
  const gone = await prisma.costingRate.deleteMany({ where: { id } });
  if (!gone.count) return json({ error: "No such row." }, 404);
  return json({ ok: true });
}
