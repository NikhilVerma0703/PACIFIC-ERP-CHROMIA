// Shared by the design-code handlers. Not a route.
import { prisma } from "@/lib/prisma";
import { commercialCan, type CommercialGate, type CommercialAction } from "@/lib/commercial/access";
import { type CommercialArea } from "@/lib/commercial/access-rules";
import { bad } from "@/lib/commercial/http";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

export const AREA: CommercialArea = "designCodes";

/**
 * The AREA question on top of the action question (round two, answer 15).
 *
 * These routes used to gate `plan`, which was right while `plan` meant "the
 * planner and the manager". Answer 16 narrowed `plan` to the ADMIN ALONE, and
 * gating on it would have taken the design master away from the Commercial
 * Manager on the same day the owner said the manager maintains it — the area
 * table says designCodes is WRITE for him and view for everyone else who
 * reaches it. So the action is `write` and the AREA decides who may:
 * COMMERCIAL_DOCS and the dispatch checker are refused the screen outright,
 * COMMERCIAL_EXEC and COMMERCIAL_LOGISTICS read it, the manager and the admin
 * write it — exactly what /office/commercial/design-codes shows.
 *
 * commercialGate() takes no area yet, so the two questions are asked in two
 * calls; the day it does, these become one gate.
 */
export function areaRefusal(g: CommercialGate, action: CommercialAction) {
  if (commercialCan(g.user, action, AREA)) return null;
  return bad(
    action === "view"
      ? "The design master is not one of this login's screens."
      : "Codes, shades and colours are changed by the Commercial Manager or an admin.",
    403,
  );
}

/** Prisma's unique-violation code: two designs cannot share one item code. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}
