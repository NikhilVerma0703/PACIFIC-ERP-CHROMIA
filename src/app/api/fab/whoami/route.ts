// GET /api/fab/whoami
//
// WHICH JOB THE PERSON LOOKING AT THIS SCREEN HOLDS.
//
// One field, and it exists because two screens now serve two kinds of person.
// The owner put the slab allocation board in the cutter's hands — "we have slab
// allocation page made for supervisor, that need to be included to the cutter as
// well" — and the same board must not offer him every decision on it:
//
//   THE ALLOCATION      his. He is standing at the stone; he picks it, puts rows
//                       on it, and cuts.
//   HAND EDGE POLISH    NOT his. The owner was specific about who settles it:
//                       "this is chosen and done by supervisor, or else the one
//                       manager who uploads the PO." The finished-edges route
//                       still gates on SUPERVISOR, so a cutter clicking that
//                       picker would get a 403 — and a control that refuses is
//                       worse than one that is not there, because it reads as
//                       the software being broken rather than the decision
//                       belonging to somebody else.
//
// So the board asks who it is drawing for and leaves that step out, with a line
// in its place saying whose it is. Same reasoning as the sample order hiding
// steps 3 and 4 rather than greying them.
//
// THIS IS NOT A SECURITY BOUNDARY AND MUST NEVER BE TREATED AS ONE. It decides
// what to DRAW. Every route the board calls gates itself with fabGate, and would
// go on refusing a forged answer here exactly as it does now. A screen that
// hides a button is a courtesy; the route that refuses the request is the rule.
//
// Gated at EMPLOYEE, which is everyone already inside the fabrication module —
// it tells you about yourself and nobody else.

import { fabGate } from "@/lib/fab/access";

export async function GET() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  return Response.json({
    /** EMPLOYEE | SUPERVISOR | MANAGER | ADMIN — from branch and role rank, the
     *  one hierarchy (lib/fab/access.ts). Never null here: fabGate already
     *  refused anybody fabTierOf could not place. */
    tier: g.tier,
    /** The cutting board compares this against a job's operator to work out
     *  whose bench a slab is on. Sent here so a client has one place to ask. */
    userId: String((g.user as { id?: string })?.id ?? ""),
    name: ((g.user as { name?: string | null })?.name) ?? null,
  });
}
