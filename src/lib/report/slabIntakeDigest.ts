// The digest's one database read. Everything else — the window arithmetic and
// the words — is in slabIntakeDigestText.ts, which imports nothing so the tests
// can reach it; it is all re-exported here so callers see one module.
import { prisma } from "@/lib/prisma";
import { INTAKE_SOURCE, type Digest, type DigestSlab, type DigestWindow } from "@/lib/report/slabIntakeDigestText";

export * from "@/lib/report/slabIntakeDigestText";

/** Everything the form did in one window, grouped by slab, newest slab last. */
export async function buildIntakeDigest(win: DigestWindow): Promise<Digest> {
  const db = prisma as unknown as {
    slabEvent: { findMany: (q: unknown) => Promise<Array<{
      slabNumber: number; kind: string; field: string | null;
      oldValue: string | null; newValue: string | null; changedBy: string | null; at: Date;
    }>> };
    finishedSlab: { findMany: (q: unknown) => Promise<Array<{
      slabNumber: number; design: string | null; grade: string | null;
      batchNumber: string | null; status: string | null; bayNumber: string | null;
    }>> };
  };

  const events = await db.slabEvent.findMany({
    where: { source: INTAKE_SOURCE, at: { gte: win.from, lt: win.to } },
    orderBy: { at: "asc" },
  });
  if (!events.length) {
    return { window: win, slabs: [], addedCount: 0, correctedCount: 0, photoCount: 0, people: [] };
  }

  const nums = [...new Set(events.map((e) => e.slabNumber))];
  const rows = await db.finishedSlab.findMany({
    where: { slabNumber: { in: nums } },
    select: { slabNumber: true, design: true, grade: true, batchNumber: true, status: true, bayNumber: true },
  });
  const byNum = new Map(rows.map((r) => [r.slabNumber, r]));

  const FIELD: Record<string, string> = {
    design: "design", grade: "grade", slabThickness: "thickness", qualityIssue: "quality issues",
    polishType: "polish", rwStatus: "R/W status", repolishStatus: "repolish status",
    batchNumber: "batch", lengthIn: "length", widthIn: "width", bayNumber: "bay",
    frameNumber: "frame", status: "status", notes: "notes", reservation: "reservation",
  };

  const bySlab = new Map<number, DigestSlab>();
  for (const e of events) {
    const cur = byNum.get(e.slabNumber);
    let d = bySlab.get(e.slabNumber);
    if (!d) {
      d = {
        slabNumber: e.slabNumber, added: false,
        design: cur?.design ?? null, grade: cur?.grade ?? null,
        batch: cur?.batchNumber ?? null, status: cur?.status ?? null, bay: cur?.bayNumber ?? null,
        photos: 0, changes: [], by: [], at: e.at,
      };
      bySlab.set(e.slabNumber, d);
    }
    d.at = e.at;
    if (e.changedBy && !d.by.includes(e.changedBy)) d.by.push(e.changedBy);
    if (e.kind === "created") d.added = true;
    else if (e.kind === "photo") d.photos += 1;
    else if (e.kind === "manual_correction") {
      const name = FIELD[e.field ?? ""] ?? e.field ?? "a field";
      d.changes.push(`${name} ${e.oldValue ?? "—"} → ${e.newValue ?? "—"}`);
    }
  }

  const slabs = [...bySlab.values()].sort((a, b) => a.slabNumber - b.slabNumber);
  return {
    window: win,
    slabs,
    addedCount: slabs.filter((s) => s.added).length,
    correctedCount: slabs.filter((s) => !s.added && s.changes.length > 0).length,
    photoCount: slabs.reduce((a, s) => a + s.photos, 0),
    people: [...new Set(slabs.flatMap((s) => s.by))].sort(),
  };
}

