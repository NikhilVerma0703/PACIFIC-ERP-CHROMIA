import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { slabIntakeGate } from "@/lib/inventory/intakeGate";
import { prisma } from "@/lib/prisma";
import { SlabIntakeForm } from "./SlabIntakeForm";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = prisma as any;

/**
 * Slab intake — the form for the three named intake people (and admins) to add
 * slabs finished goods is missing (already-made stock, Chromia printed slabs)
 * and to check/override the details on slabs it already has.
 *
 * THE GATE IS RE-CHECKED HERE even though middleware already admitted the
 * request: middleware stops a request at the path, this stops a direct render,
 * and each is useless on its own the day the other is edited. A refusal goes
 * home ("/"), which middleware answers with the refused login's own home page
 * — a UI condition is not an authorisation, and every action in actions.ts
 * re-checks the same gate again for itself.
 *
 * The datalists are read here, server-side, so the form offers the values the
 * inventory actually holds rather than a hardcoded list that drifts (the
 * lesson /api/inventory/filters records). Designs go through DesignAlias to
 * canonical names — offering a merged-away variant would seed tomorrow's
 * spelling drift from the very form built to correct it.
 */
export default async function SlabIntakePage() {
  const gate = await slabIntakeGate();
  if (!gate.ok) redirect(gate.status === 401 ? "/login" : "/");

  // groupBy, not findMany({distinct}) — Prisma does not push `distinct` down to
  // SQL (see /api/inventory/filters). qualityIssue is an ARRAY column, which
  // groupBy cannot unnest, so that one is real SQL.
  const by = (field: string) =>
    db.finishedSlab.groupBy({ by: [field], where: { [field]: { not: null } }, _count: { _all: true } }).catch(() => []);
  const [designRows, polishRows, thicknessRows, bayRows, aliasRows, issueRows] = await Promise.all([
    by("design"), by("polishType"), by("slabThickness"), by("bayNumber"),
    db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []),
    db.$queryRaw`SELECT DISTINCT unnest(quality_issue) AS issue FROM fg_finished_slab`.catch(() => []),
  ]);

  const clean = (rows: any[], field: string): string[] =>
    [...new Set(rows.map((r) => r[field]).filter((v: unknown): v is string => typeof v === "string" && v.trim() !== ""))];

  // Canonical designs: every design in stock mapped through the alias table
  // (case-insensitively, like buildInventoryWhere), unioned with the canonical
  // names themselves, deduped case-insensitively.
  const amap = new Map<string, string>((aliasRows as any[]).map((a) => [String(a.variant).toLowerCase(), String(a.canonical)]));
  const canonSeen = new Map<string, string>();
  for (const d of [...clean(designRows, "design"), ...(aliasRows as any[]).map((a) => String(a.canonical))]) {
    const c = amap.get(d.toLowerCase()) ?? d;
    if (!canonSeen.has(c.toLowerCase())) canonSeen.set(c.toLowerCase(), c);
  }

  const lists = {
    designs: [...canonSeen.values()].sort((a, b) => a.localeCompare(b)),
    issues: clean(issueRows as any[], "issue").sort((a, b) => a.localeCompare(b)),
    polishTypes: clean(polishRows, "polishType").sort((a, b) => a.localeCompare(b)),
    thicknesses: clean(thicknessRows, "slabThickness").sort((a, b) => a.localeCompare(b)),
    bays: clean(bayRows, "bayNumber").sort((a, b) => a.localeCompare(b)),
  };

  return (
    <Shell>
      <SlabIntakeForm lists={lists} />
    </Shell>
  );
}
