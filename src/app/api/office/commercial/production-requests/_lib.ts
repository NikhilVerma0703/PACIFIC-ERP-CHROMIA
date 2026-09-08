// Shared by the production-request handlers (the queue, the reorder, one row,
// its plan changes, the "has production run?" hint) and by the order-scoped
// POST. Not a route.
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import type { CommercialUser } from "@/lib/commercial/access";
import { findDesignRow, parseShade, type PlanningSettingsLike, type DesignColourLike } from "@/lib/commercial/design-rules";
import { recomputeCleaning, abruptJumps, type ChainRowLike } from "@/lib/commercial/production-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** The queue shows the order it came from and who the customer is: a planner
 *  choosing what to run next needs to know whose order is waiting. The plan
 *  changes ride along (newest first) so the "planned but not scheduled" panel
 *  needs no second read. */
export const REQUEST_INCLUDE = {
  order: { select: { id: true, number: true, status: true, client: { select: { id: true, name: true } } } },
  enquiry: { select: { id: true, number: true } },
  changes: { orderBy: { changedAt: "desc" } },
} as const;

export async function loadRequest(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialProductionRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
  if (!row) fail(404, "Production request not found");
  return row;
}

export async function loadOrderForRequest(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialOrder.findUnique({
    where: { id },
    select: { id: true, number: true, status: true, enquiryId: true, client: { select: { id: true, name: true } } },
  });
  if (!row) fail(404, "Order not found");
  return row;
}

export async function loadPlanning(): Promise<PlanningSettingsLike> {
  const s = await loadSettings();
  return s.planning;
}

/** The colour columns every reader of the master needs: the label the queue
 *  stores, the reading that decides an abrupt changeover (round two, answer
 *  14) and the swatch the board draws. */
const COLOUR_SELECT = { design: true, shade: true, labL: true, colourName: true, hex: true } as const;

export interface DesignColourRow extends DesignColourLike {
  design: string;
  shade: string | null;
  labL: number | null;
  colourName: string | null;
  hex: string | null;
}

const colourRow = (r: Record<string, unknown> | null | undefined, design: string): DesignColourRow => ({
  design: String(r?.design ?? design),
  shade: parseShade(r?.shade),
  // Prisma hands back a Decimal; the rule takes a number and plain() would
  // have done the same on the way out.
  labL: r?.labL === null || r?.labL === undefined ? null : Number(r.labL),
  colourName: (r?.colourName as string | null) ?? null,
  hex: (r?.hex as string | null) ?? null,
});

/** The design master's colour for a design (answers 13 and 15), matched
 *  case-blind; every field null when the master has no row for it — the queue
 *  then treats the design as MEDIUM. */
export async function colourForDesign(design: string): Promise<DesignColourRow> {
  const rows: Array<Record<string, unknown> & { design: string }> = await db.commercialDesignCode.findMany({ select: COLOUR_SELECT });
  return colourRow(findDesignRow(rows, design), design);
}

/**
 * Every design's colour, keyed by the design name lower-cased and trimmed —
 * the key every reader of the master matches on. The queue sends this beside
 * its rows so the board can draw the swatch and judge an optimistic re-order
 * by the same L* the server used, without one request per design.
 */
export async function loadColourMap(): Promise<Record<string, DesignColourRow>> {
  const rows: Array<Record<string, unknown> & { design: string }> = await db.commercialDesignCode.findMany({ select: COLOUR_SELECT });
  const out: Record<string, DesignColourRow> = {};
  for (const r of rows) out[String(r.design).trim().toLowerCase()] = colourRow(r, String(r.design));
  return out;
}

/**
 * The rows the cleaning rule runs over (answer 13): every QUEUED / SCHEDULED /
 * IN_PRODUCTION row by priority, PLUS the single most recently PRODUCED row.
 * Only QUEUED / SCHEDULED are ever rewritten (production-rules.planChain); the
 * running row — or, when nothing runs, the last produced one — is loaded
 * because it is what the machine is coming off, and the first queued row's
 * changeover is judged against it (production-rules.predecessorRow). Without
 * it a LIGHT request raised behind a DARK row in production got 3 h, not 6.
 *
 * Each row also says whether it carries an OPEN cleaningHours reduction, so
 * the recompute can leave that hand-set figure alone (cleaningHeld).
 *
 * The design master's COLOUR is joined on by name (round two, answer 14): the
 * request row stores only the shade label it was raised with, and the L* that
 * decides an abrupt changeover lives on the master, where a correction has to
 * reach every row that reads it. There is no foreign key — the request carries
 * the design as stock spells it — so the join is the same case-blind match
 * every other reader of the master makes.
 */
export async function loadChainRows(): Promise<Array<ChainRowLike & { orderId: string | null }>> {
  const select = {
    id: true, status: true, priority: true, shade: true, cleaningHours: true, design: true, orderId: true, producedAt: true,
    changes: { where: { field: "cleaningHours", status: "OPEN" }, select: { id: true }, take: 1 },
  };
  const [open, lastProduced]: [Array<Record<string, unknown>>, Record<string, unknown> | null] = await Promise.all([
    db.commercialProductionRequest.findMany({
      where: { status: { in: ["QUEUED", "SCHEDULED", "IN_PRODUCTION"] } },
      select,
      orderBy: [{ priority: "asc" }, { raisedAt: "asc" }],
    }),
    db.commercialProductionRequest.findFirst({
      where: { status: "PRODUCED" },
      select,
      orderBy: [{ producedAt: "desc" }, { priority: "desc" }],
    }),
  ]);
  const rows = lastProduced ? [...open, lastProduced] : open;
  const colours = await loadColourMap();
  return rows.map((r) => {
    const design = String(r.design ?? "");
    const colour = colours[design.trim().toLowerCase()];
    return {
      id: String(r.id), status: String(r.status), priority: Number(r.priority),
      shade: (r.shade as string | null) ?? null, cleaningHours: r.cleaningHours, design,
      labL: colour?.labL ?? null, hex: colour?.hex ?? null, colourName: colour?.colourName ?? null,
      orderId: (r.orderId as string | null) ?? null,
      producedAt: (r.producedAt as Date | null) ?? null,
      cleaningHeld: Array.isArray(r.changes) && r.changes.length > 0,
    };
  });
}

export interface AbruptWarning {
  kind: "abrupt"; id: string; afterId: string; design: string; afterDesign: string;
  labL: number | null; afterLabL: number | null; reason: string; message: string;
}
/** A hand-set cleaning figure the recompute kept because its OPEN reduction
 *  is still on the "planned but not scheduled" panel. */
export interface HeldWarning { kind: "held"; id: string; design: string; kept: number | null; rule: number; message: string }
export type QueueWarning = AbruptWarning | HeldWarning;

/**
 * After anything that changes the chain — a reorder, a new request, a status
 * move, a deletion — every rewritable row's cleaning hours are re-derived
 * against the row now before it (answer 13), and the abrupt DARK → LIGHT
 * changeovers are named so the caller can show them. A recompute is not a
 * planner's cut, so it writes NO commercial_production_plan_change row (that
 * table is for what somebody took off the plan); it does log plan_changed on
 * the order, with the figure it moved from and to, because the order's log is
 * where a figure that changed on its own has to be explainable.
 *
 * A row whose hand-set cleaningHours reduction is still OPEN is NOT rewritten
 * — the panel is still asking about that figure — and comes back as a "held"
 * warning instead, so the board can say the rule was not applied there.
 */
export async function recomputeQueue(by: CommercialUser | null, why: string): Promise<{ recomputed: number; warnings: QueueWarning[] }> {
  const [rows, planning] = await Promise.all([loadChainRows(), loadPlanning()]);
  const { patches, held } = recomputeCleaning(rows, planning);
  if (patches.length) {
    await db.$transaction(patches.map((p) => db.commercialProductionRequest.update({ where: { id: p.id }, data: { cleaningHours: p.cleaningHours } })));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const p of patches) {
      const r = byId.get(p.id);
      if (!r?.orderId) continue;
      await logOrderEvent(r.orderId, "plan_changed", {
        note: `Cleaning hours for ${r.design} ${p.from == null ? "set to" : `${p.from} → `}${p.cleaningHours} — ${why}`,
        by,
        payload: { requestId: p.id, field: "cleaningHours", from: p.from, to: p.cleaningHours, reason: why },
      });
    }
  }
  const warnings: QueueWarning[] = [
    // The message names both designs AND the lightnesses the rule read (round
    // two, answer 14), because "abrupt" is now a distance and the planner has
    // to be able to see the two numbers that made it one.
    ...abruptJumps(rows, planning).map((j): AbruptWarning => ({
      kind: "abrupt", ...j,
      message: `${j.reason} — ${planning.cleaningHoursAbrupt} h of cleaning instead of ${planning.cleaningHoursDefault}`,
    })),
    ...held.map((h): HeldWarning => ({
      kind: "held", ...h,
      message: `${h.design}: cleaning hours kept at ${h.kept ?? "—"} (hand-set; the rule says ${h.rule}) — its reduction is still open on the not-scheduled list`,
    })),
  ];
  return { recomputed: patches.length, warnings };
}
