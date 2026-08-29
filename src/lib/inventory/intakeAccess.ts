// Slab intake access — who may use /slab-intake, the form that adds a slab
// finished goods is missing (an already-made slab, a Chromia printed slab) and
// corrects the details on one it already has.
//
// AN ENV ALLOWLIST RATHER THAN A ROLE, for the same reason as
// WEIGHTS_VERIFIER_EMAILS (lib/costing/verification.ts): the owner named
// PEOPLE, not a rank. All three intake people happen to be Line Managers, and
// every Line Manager in the plant being able to rewrite the finished-goods
// record of any slab was not what was asked for. An env var rather than a
// constant in the file, because the alternative is colleagues' addresses
// committed to a repository and a deploy every time the duty changes hands.
//
// ADMINS PASS AS WELL, on top of the list — the owner said "only" these three,
// and admins are admitted so the owner himself can open the screen and see
// what his intake people see. Nobody else, whatever their rank: an INCHARGE,
// a LINE_MANAGER not on the list, FINANCE — all refused.
//
// UNSET MEANS NOBODY, never everybody. A misspelled variable that opened the
// screen to all comers is the failure worth designing against.
//
// PURE AND IMPORT-FREE, like lib/sampling/actions.ts and for the same two
// reasons: node --test imports it directly (tests/slabIntakeAccess.test.ts),
// and src/middleware.ts — edge code — imports it to admit the three THROUGH
// their branch caps (the Chromia manager's login is capped to /chromia, the
// fabrication manager's to /fab; without the carve-out the door would be shut
// before the page's own gate ever ran). The async session variant lives in
// ./intakeGate.ts, which needs currentUser() and therefore cannot sit here.

/** The emails allowed to use the slab intake form, from SLAB_INTAKE_EMAILS
 *  (comma-separated; trimmed and lower-cased, so spacing and case in the env
 *  var cannot lock anybody out). */
export function slabIntakeEmails(raw: string | undefined | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/** Whether this login may use the slab intake form: ADMIN always (the owner's
 *  window onto the screen); everyone else only by being on the list. */
export function canUseSlabIntake(
  role: string | null | undefined,
  email: string | null | undefined,
  raw: string | undefined | null,
): boolean {
  if (role === "ADMIN") return true;
  const who = String(email ?? "").trim().toLowerCase();
  if (!who) return false;
  return slabIntakeEmails(raw).includes(who);
}
