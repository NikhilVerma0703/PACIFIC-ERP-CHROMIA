"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { batchForSlab } from "@/lib/smartEntry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const s = (v: unknown) => String(v ?? "").trim();
const numOrNull = (v: unknown) => {
  const r = s(v);
  if (!r) return null;
  const n = parseFloat(r);
  return Number.isFinite(n) ? n : null;
};
const dateOrNow = (v: unknown): Date => {
  const r = s(v);
  if (!r) return new Date();
  const d = new Date(r);
  return isNaN(d.getTime()) ? new Date() : d;
};

export interface CuttingResult { ok: boolean; message: string; stamp: number }

export async function createCuttingEntry(
  _prev: CuttingResult | null,
  fd: FormData,
): Promise<CuttingResult> {
  const fail = (message: string): CuttingResult => ({ ok: false, message, stamp: Date.now() });

  const me = await currentUser();
  if (!me) return fail("You must be signed in.");

  const slabNumber = numOrNull(fd.get("slabNumber"));
  if (slabNumber == null) return fail("Slab number is required.");

  const batchRaw = s(fd.get("batchKey"));
  const batchKey = batchRaw ? normalizeBatch(batchRaw) : await batchForSlab(slabNumber) ?? "";
  if (!batchKey) return fail("Could not resolve a batch for that slab — enter the batch key manually.");

  const operator = s(fd.get("operator")) || (me.name ?? me.email ?? "");
  if (!operator) return fail("Operator name is required.");

  try {
    await db.cuttingEntry.create({
      data: {
        slabNumber,
        batchKey,
        design: s(fd.get("design")) || null,
        cutDate: dateOrNow(fd.get("cutDate")),
        operator,
        lengthCm: numOrNull(fd.get("lengthCm")),
        widthCm: numOrNull(fd.get("widthCm")),
        thicknessMm: numOrNull(fd.get("thicknessMm")),
        quantity: parseInt(s(fd.get("quantity")) || "1", 10) || 1,
        purpose: s(fd.get("purpose")) || null,
        remarks: s(fd.get("remarks")) || null,
        createdById: (me as { id?: string }).id ?? null,
      },
    });
  } catch (e) {
    return fail(`Could not save: ${(e as Error).message}`);
  }

  revalidatePath("/cutting");
  return { ok: true, message: `Cutting entry logged for slab ${slabNumber} (batch ${batchKey}).`, stamp: Date.now() };
}

/** Auto-resolve batch from slab number (called client-side on blur). */
export async function resolveBatchFromSlab(slabNumber: number): Promise<string | null> {
  try {
    return await batchForSlab(slabNumber);
  } catch {
    return null;
  }
}
