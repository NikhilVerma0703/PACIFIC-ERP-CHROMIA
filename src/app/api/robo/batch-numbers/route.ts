import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonBatchNo } from "@/lib/robo/batchNo";

/**
 * GET /api/robo/batch-numbers — every batch number on record, most-recent
 * first, deduped so the dozen spellings of one batch ("D-1372", "d1372",
 * "1372") appear once (the canonical rule from batchNo.ts, keeping the newest
 * spelling as the label).
 *
 * Feeds the Batch Number box on Reports and Downloads two ways at once: the
 * whole list is the dropdown, and the FIRST element is the latest batch, which
 * both screens select by default when they open.
 */
export async function GET() {
  const recipes = await prisma.roboBatchRecipe.findMany({
    where: { batchNo: { not: null } },
    select: { batchNo: true },
    orderBy: { createdAt: "desc" },
  });

  const seen = new Set<string>();
  const batchNumbers: string[] = [];
  for (const r of recipes) {
    const display = (r.batchNo ?? "").trim();
    if (!display) continue; // a stored "" is not a batch number
    const key = canonBatchNo(display);
    if (!key || seen.has(key)) continue; // one entry per real batch
    seen.add(key);
    batchNumbers.push(display);
  }

  return NextResponse.json({ batchNumbers });
}
