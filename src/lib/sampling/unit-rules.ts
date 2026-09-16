// BOXES AND STANDS — the pure half (the owner, 2026-09-14: "we want to add to
// track sample boxes and stands in the sampling modules").
//
// No Prisma, no Next, no auth: `node --test` loads this bare, the same rule
// lib/sampling/lifecycle.ts and actions.ts follow. Everything that DECIDES
// lives here; the routes only read the database and apply what these functions
// say.
//
// Explicit .ts extensions on relative imports — node's strict ESM resolver
// does not add one.
import { planRelease, type StockRelease } from "./lifecycle.ts";

export type UnitKind = "BOX" | "STAND";

/** The five Salesforce Dispatch_Type__c values, verbatim. */
export type DispatchType = "Sample Kit" | "New Stand" | "Stand Top-up" | "Loose Samples" | "Replacement";

/**
 * WHAT A REQUEST CONSUMES, and there are THREE answers rather than two.
 *
 *  • Sample Kit  → one Sample Kit Box. The pieces go out in something.
 *  • New Stand   → one STAND, of the variant the rep asked for. When the rep
 *    left Stand_Type_Requested__c blank the answer is "a stand, variant not
 *    yet chosen" and the incharge picks at pack — NEVER a silent Floor Stand,
 *    which is the most expensive of the three and the easiest to send by
 *    accident.
 *  • Stand Top-up, Loose Samples, Replacement → pieces only, no unit.
 *
 * THE TOP-UP IS THE ONE THAT MATTERS. It refills a stand the customer ALREADY
 * has — Sample_Dispatch__c.Sample_Stand__c points at it — so decrementing a
 * stand for it would consume an asset that never leaves the building, and
 * refusing it at zero stands on hand would block a request that needs none.
 * Getting this wrong is silent in both directions, which is why it is a named
 * function with its own tests rather than an `if` inside a route.
 */
export interface UnitNeed {
  /** "BOX" or "STAND", or null when the request consumes no unit at all. */
  kind: UnitKind | null;
  /** The Stand_Type__c variant asked for, when the rep named one. */
  standType: string | null;
  /** True when a stand is needed but nobody has said which kind yet. */
  needsChoice: boolean;
}

const NO_UNIT: UnitNeed = { kind: null, standType: null, needsChoice: false };

export function unitNeeded(dispatchType: string | null | undefined, standTypeRequested?: string | null): UnitNeed {
  const t = String(dispatchType ?? "").trim().toLowerCase();
  if (t === "sample kit") return { kind: "BOX", standType: "Sample Kit Box", needsChoice: false };
  if (t === "new stand") {
    const variant = String(standTypeRequested ?? "").trim();
    return { kind: "STAND", standType: variant || null, needsChoice: variant === "" };
  }
  // Stand Top-up, Loose Samples, Replacement — and anything Salesforce adds
  // later that we have not been told about. Consuming nothing is the safe
  // default for an unknown type: the pieces still go out, and nobody loses a
  // stand to a word the ERP did not recognise.
  return NO_UNIT;
}

/**
 * HOW MANY OF A UNIT ARE ACTUALLY AVAILABLE.
 *
 * Committed = units needed by OPEN requests that are ALREADY checked AVAILABLE
 * and are OLDER than the one being asked about. Two deliberate exclusions:
 *
 *  • A request that is SHORT or ON HOLD commits nothing. Otherwise one
 *    oversized request nobody can fill sits at the head of the queue and
 *    starves every later one of stock it is not going to use.
 *  • A NEWER request never commits against an older one, so the answer a
 *    request sees is stable as later requests arrive.
 *
 * This is a COUNT, NOT A RESERVATION: nothing is decremented until the desk
 * actually packs. Two people can be told the same box is available; the lock
 * at pack is what settles it, and that is the honest shape — a reservation
 * that expires is a second thing to get wrong.
 */
export interface UnitAvailability {
  onHand: number;
  committed: number;
  available: number;
  /** Below the type's own floor — the card goes red. */
  low: boolean;
}

export function unitAvailability(onHand: number, committed: number, minQty: number): UnitAvailability {
  const hand = Math.max(0, Math.trunc(Number(onHand) || 0));
  const comm = Math.max(0, Math.trunc(Number(committed) || 0));
  const available = Math.max(0, hand - comm);
  return { onHand: hand, committed: comm, available, low: available < Math.max(0, Math.trunc(Number(minQty) || 0)) };
}

/**
 * MAY THIS UNIT LEAVE? The same shape as lifecycle.checkRelease, deliberately:
 * the incharge reads one kind of sentence whether the shortfall is pieces or
 * the box to put them in.
 */
export interface UnitReleaseCheck {
  ok: boolean;
  shortfall: number;
  reason: string | null;
}

export function checkUnitRelease(label: string, onHand: number, quantity: number): UnitReleaseCheck {
  const hand = Math.max(0, Math.trunc(Number(onHand) || 0));
  const want = Math.trunc(Number(quantity) || 0);
  if (want <= 0) return { ok: false, shortfall: 0, reason: `${label}: a package consumes at least one` };
  if (hand >= want) return { ok: true, shortfall: 0, reason: null };
  const shortfall = want - hand;
  return { ok: false, shortfall, reason: `${label}: ${hand} of ${want} available` };
}

/**
 * The whole package in one answer — the pieces through planRelease, then the
 * unit. ALL OR NOTHING, and the unit is checked LAST so that a package short
 * of both reports the pieces first, which is what the incharge can do
 * something about.
 */
export interface PackageCheck {
  ok: boolean;
  shortfalls: string[];
}

export function checkPackage(pieces: StockRelease[], unit: { label: string; onHand: number; quantity: number } | null): PackageCheck {
  const plan = planRelease(pieces);
  const shortfalls = plan.ok ? [] : [...plan.shortfalls];
  if (unit) {
    const u = checkUnitRelease(unit.label, unit.onHand, unit.quantity);
    if (!u.ok && u.reason) shortfalls.push(u.reason);
  }
  return { ok: shortfalls.length === 0, shortfalls };
}

/**
 * The serial number the ERP PROPOSES for a new stand: the type's initials and
 * a four-digit run. FS-0007, WD-0002, CD-0011.
 *
 * PROPOSES, NOT ASSIGNS. The incharge may overtype it, because the number on
 * the metal wins over the number the software would have liked — a stand that
 * came from a supplier with its own plate keeps that plate.
 *
 * The sequence is the count of serials the type already has, passed in rather
 * than read, so this stays pure and a caller that holds a lock decides what
 * "already has" means.
 */
export function proposeSerial(typeName: string, existing: number): string {
  const initials = String(typeName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 3) || "SU";
  const n = Math.max(0, Math.trunc(Number(existing) || 0)) + 1;
  return `${initials}-${String(n).padStart(4, "0")}`;
}

/**
 * Can a serial legally move from here to there? The stand's lifecycle, stated
 * once, in the same style as lifecycle.checkTransition for packages.
 *
 * A RETURNED STAND GOES NOWHERE BY ITSELF. Back to IN_STOCK or on to RETIRED
 * is a question about the condition of a physical object, and only a person who
 * has looked at it can answer — the same reason the sample lifecycle has no
 * undo. So RETURNED has two exits and neither is automatic.
 */
export const UNIT_SERIAL_NEXT: Record<string, readonly string[]> = {
  IN_STOCK: ["RELEASED", "RETIRED"],
  RELEASED: ["DISPATCHED", "IN_STOCK"],     // IN_STOCK: the package was unpacked before it left
  DISPATCHED: ["INSTALLED", "RETURNED"],
  INSTALLED: ["RETURNED"],
  RETURNED: ["IN_STOCK", "RETIRED"],
  RETIRED: [],
};

export function checkSerialTransition(from: string, to: string): { ok: boolean; reason: string | null } {
  const next = UNIT_SERIAL_NEXT[String(from).toUpperCase()];
  if (!next) return { ok: false, reason: `${from} is not a status a stand can be in` };
  if (next.includes(String(to).toUpperCase())) return { ok: true, reason: null };
  if (String(from).toUpperCase() === String(to).toUpperCase()) {
    return { ok: false, reason: `This stand is already ${to.toLowerCase().replace("_", " ")}` };
  }
  return { ok: false, reason: `A ${from.toLowerCase().replace("_", " ")} stand cannot go straight to ${to.toLowerCase().replace("_", " ")}` };
}

/**
 * AN ADJUSTMENT NEEDS A REASON. A count that changed because somebody typed a
 * number, with nothing saying why, is how a ledger stops being evidence. The
 * route refuses one without it; this is the rule it asks.
 */
export function adjustmentIssue(delta: number, note: string | null | undefined): string | null {
  const d = Math.trunc(Number(delta) || 0);
  if (d === 0) return "An adjustment of zero changes nothing — say what the new count should be.";
  if (!String(note ?? "").trim()) return "Say why the count is being corrected — an adjustment without a reason is not evidence.";
  return null;
}

/** quantity = sum(delta): what the admin page asserts per counted type. */
export function ledgerDrift(quantity: number, deltas: ReadonlyArray<number>): number {
  const sum = deltas.reduce((n, d) => n + (Math.trunc(Number(d) || 0)), 0);
  return (Math.trunc(Number(quantity) || 0)) - sum;
}
