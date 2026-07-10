import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface CuttingRow {
  id: string;
  slabNumber: number;
  batchKey: string;
  design: string | null;
  cutDate: Date;
  operator: string;
  lengthCm: number | null;
  widthCm: number | null;
  thicknessMm: number | null;
  quantity: number;
  purpose: string | null;
  remarks: string | null;
  createdAt: Date;
  createdBy: { name: string | null; email: string } | null;
}

export async function listCuttingEntries(limit = 100): Promise<CuttingRow[]> {
  try {
    return await db.cuttingEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { createdBy: { select: { name: true, email: true } } },
    });
  } catch {
    return [];
  }
}

export async function listCuttingEntriesByBatch(batchKey: string): Promise<CuttingRow[]> {
  try {
    return await db.cuttingEntry.findMany({
      where: { batchKey: normalizeBatch(batchKey) },
      orderBy: { cutDate: "desc" },
      include: { createdBy: { select: { name: true, email: true } } },
    });
  } catch {
    return [];
  }
}

export async function getCuttingStats(): Promise<{ total: number; today: number }> {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [total, today] = await Promise.all([
      db.cuttingEntry.count(),
      db.cuttingEntry.count({ where: { cutDate: { gte: start } } }),
    ]);
    return { total, today };
  } catch {
    return { total: 0, today: 0 };
  }
}
