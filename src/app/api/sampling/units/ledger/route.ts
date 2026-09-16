// WHY EVERY UNIT COUNT IS WHAT IT IS (scripts/0086).
//
// The ledger is append-only and every change writes into it in the same
// transaction as the change itself, so this route can do the one thing a
// running count can never do for itself: CHECK ITSELF. For each counted type
// it asserts quantity = sum(delta) and reports the difference.
//
// IT REPORTS DRIFT, IT DOES NOT CORRECT IT. A count that disagrees with its
// own history is a fact somebody needs to see, not a number to quietly
// overwrite — the correction is an ADJUST with a reason on it, made by a
// person who has counted the shelf.
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { samplingGate } from "@/lib/sampling/access";
import { ledgerDrift } from "@/lib/sampling/unit-rules";

export const dynamic = "force-dynamic";

function deny(status: number) {
  return Response.json(
    { error: status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
    { status },
  );
}

export async function GET(req: NextRequest) {
  const g = await samplingGate("view");
  if (!g.ok) return deny(g.status);

  const url = new URL(req.url);
  const unitTypeId = (url.searchParams.get("unitTypeId") ?? "").trim() || null;
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));

  const rows = await prisma.samplingUnitLedger.findMany({
    where: unitTypeId ? { unitTypeId } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, delta: true, reason: true, reference: true, note: true,
      createdAt: true, createdById: true, serialId: true,
      unitType: { select: { id: true, name: true, serialised: true } },
    },
  });

  // ── does each counted type still add up? ─────────────────────────────────
  const counted = await prisma.samplingUnitType.findMany({
    where: { serialised: false, active: true },
    select: { id: true, name: true, stock: { select: { quantity: true } } },
  });
  const sums = await prisma.samplingUnitLedger.groupBy({
    by: ["unitTypeId"],
    _sum: { delta: true },
  });
  const sumFor = new Map(sums.map((s) => [s.unitTypeId, Number(s._sum.delta ?? 0)]));

  const checks = counted.map((t) => {
    const quantity = Number(t.stock?.quantity ?? 0);
    const drift = ledgerDrift(quantity, [sumFor.get(t.id) ?? 0]);
    return { id: t.id, name: t.name, quantity, ledgerSum: sumFor.get(t.id) ?? 0, drift, ok: drift === 0 };
  });

  // Who moved it, resolved in one query rather than per row.
  const ids = [...new Set(rows.map((r) => r.createdById).filter(Boolean))] as string[];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameFor = new Map(users.map((u) => [u.id, u.name]));

  return Response.json({
    ok: true,
    rows: rows.map((r) => ({
      id: r.id,
      delta: r.delta,
      reason: r.reason,
      reference: r.reference,
      note: r.note,
      at: r.createdAt,
      by: r.createdById ? (nameFor.get(r.createdById) ?? "—") : "—",
      serialId: r.serialId,
      unitType: r.unitType,
    })),
    checks,
    drifting: checks.filter((c) => !c.ok),
  });
}
