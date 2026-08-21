// Who has checked a batch, and whether the numbers have moved since they did.
//
// Two people sign a batch off and neither of them is the one who priced it: the
// production manager and the store incharge EACH confirm BOTH halves — the
// weights the mixer recorded (consumption) and the prices those weights are
// costed at. That is a deliberate widening, ordered by the owner on 2026-08-18:
// the original design gave each person exactly one half and hid the other
// ("neither sees the other's half"); the owner wants both people to be able to
// mark both the price and the consumption as correct, with every mark carrying
// a name and a time. What has NOT changed: neither of them sees a total or a
// computed sheet — those stay behind the ADMIN-only /office/costing gate. The
// verify screen still ships unit rates and raw quantities only, never anything
// multiplied.
//
// NO IMPORTS, deliberately. Same reason as lib/roles.ts: `node --test` resolves
// neither the "@/" alias nor Prisma, and a verification rule that can only be
// checked by opening a browser is a rule nobody checks. The shapes below are
// structural on purpose so the callers can pass their Prisma rows straight in
// without this module ever knowing what Prisma is.

export type VerifySide = "WEIGHTS" | "COSTS";

export const VERIFY_SIDES: readonly VerifySide[] = ["WEIGHTS", "COSTS"] as const;

export const SIDE_LABEL: Record<VerifySide, string> = {
  WEIGHTS: "Weights",
  COSTS: "Prices",
};

export function isVerifySide(v: unknown): v is VerifySide {
  return v === "WEIGHTS" || v === "COSTS";
}

/** Three decimals is the precision the mixer records carry; more would make a
 *  fingerprint that changes when nothing a human would call a change happened. */
const round3 = (n: number): string =>
  Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "NaN";

/** The weighed side of a batch — what the mixer actually recorded. */
export interface WeighedShape {
  resinKg: number;
  fillerKg: number;
  mixerCharges: number;
  gritUnresolvedKg: number;
  gritCharges: ReadonlyArray<{ silo: string; band: string; kg: number }>;
  /**
   * Silo-wise grit, present ONLY on a batch somebody has assigned.
   *
   * OMITTED — not empty — on every batch that has not, and the guard below
   * depends on that distinction being kept all the way from the loader.
   */
  gritSilos?: ReadonlyArray<{
    silo: string; size: string; kg: number;
    suppliers: ReadonlyArray<{ seq: number; supplier: string; kg: number }>;
  }> | null;
}

/**
 * A stable string for the weighed quantities.
 *
 * SORTED, because the grit charges arrive in whatever order the twenty slot
 * triplets unpivoted in, and a verification that lapsed because two silos came
 * back from the database the other way round would train everybody to click the
 * button without reading it.
 */
export function weightsFingerprint(c: WeighedShape): string {
  const grit = c.gritCharges
    .map((g) => `${g.silo}|${g.band}|${round3(g.kg)}`)
    .sort()
    .join(";");
  const parts = [
    `resin=${round3(c.resinKg)}`,
    `filler=${round3(c.fillerKg)}`,
    `charges=${c.mixerCharges}`,
    `unresolved=${round3(c.gritUnresolvedKg)}`,
    `grit=${grit}`,
  ];
  // THE GUARD IS THE WHOLE TRICK, and it is why this is appended rather than
  // woven into the five parts above. A batch nobody has assigned produces a
  // BYTE-IDENTICAL string to the one it produced before this field existed, so
  // not one standing sign-off lapses on the day this deploys. A mark lapses the
  // first time somebody assigns a silo on that batch — locally caused, expected,
  // and exactly what the mechanism is for.
  //
  // `?.length` and not `!= null`: an empty array must behave as "unassigned",
  // because a loader that returned [] instead of null would otherwise silently
  // move every fingerprint in the plant.
  if (c.gritSilos?.length) {
    parts.push("assign=" + c.gritSilos.map((s) =>
      `${s.silo}~${s.size}~${round3(s.kg)}~` +
      [...s.suppliers].map((p) => `${p.seq}:${p.supplier}:${round3(p.kg)}`).sort().join(","),
    ).sort().join(";"));
  }
  return parts.join("&");
}

/** The priced side — this batch's own lines, plus the card they fall back to. */
export interface PricedShape {
  lines: ReadonlyArray<{ item: string; seq: number; qty: number | null; rate: number }>;
  cardRates: Readonly<Record<string, number>>;
  resinBySupplier: Readonly<Record<string, number>>;
  /**
   * The assigned SIZES, and only the sizes. Present only on an assigned batch.
   *
   * A size is a claim about WHICH PRICE the sheet reads, so it belongs in the
   * prices fingerprint as well as the weights one. Supplier and kilogram changes
   * do not: they move provenance on the weights side without changing what any
   * typed rupee figure applies to.
   */
  gritSizes?: ReadonlyArray<{ silo: string; size: string }> | null;
}

/**
 * A stable string for what the batch costs per unit.
 *
 * The CARD IS IN HERE, not just the batch's own lines. A batch that prices
 * nothing itself is costed entirely at the card, so a plant-wide rate revision
 * changes what this batch costs without touching a single row that belongs to
 * it. Fingerprinting only the batch's lines would leave that sign-off standing
 * over numbers nobody checked.
 */
export function costsFingerprint(p: PricedShape): string {
  const lines = p.lines
    .map((l) => `${l.item}#${l.seq}|${l.qty == null ? "rest" : round3(l.qty)}|${round3(l.rate)}`)
    .sort()
    .join(";");
  const card = Object.keys(p.cardRates).sort()
    .map((k) => `${k}=${round3(p.cardRates[k])}`).join(";");
  const resin = Object.keys(p.resinBySupplier).sort()
    .map((k) => `${k}=${round3(p.resinBySupplier[k])}`).join(";");
  // Sizes belong here, and leaving them out was the defect the review caught.
  //
  // Without this: the store incharge prices grit-silo-103 and marks COSTS
  // correct; next morning the size is changed to one she never saw. The weights
  // fingerprint moves, so the WEIGHTS mark lapses — but this function hashes
  // only the saved lines, the card and resin, and the assignment touched none of
  // them. The item key deliberately excludes the size so a re-assignment cannot
  // orphan a price, so the price line does not move either. The sheet then
  // prints the new size under a COSTS signature that still reads "verified".
  //
  // Appended, and guarded on length, for the same byte-identical reason as the
  // weights side: an unassigned batch hashes exactly as it always did.
  const assign = p.gritSizes?.length
    ? `&assign[${p.gritSizes.map((s) => `${s.silo}=${s.size}`).sort().join(";")}]`
    : "";
  return `lines[${lines}]&card[${card}]&resin[${resin}]${assign}`;
}

/** One stored sign-off. */
export interface VerificationRow {
  side: VerifySide;
  /** What the side's numbers hashed to when the button was pressed. */
  fingerprint: string;
  verifiedBy: string;
  verifiedAt: string;
}

export type VerifyState =
  | { status: "unverified" }
  | { status: "verified"; by: string; at: string }
  | { status: "stale"; by: string; at: string };

/** One person's mark on one side — "unverified" has no row, so a list of these
 *  is never padded with it; an empty list IS unverified. */
export interface VerifyMark {
  status: "verified" | "stale";
  by: string;
  at: string;
}

/**
 * Every mark on one side, oldest first.
 *
 * A LIST, not a single state, because two people may now both hold a mark on
 * the same side and each lapses independently: the store incharge's mark can
 * stand while the production manager's has gone stale under a corrected mixer
 * row they signed before. Collapsing that to one state would either hide a
 * signature or report a staleness that belongs to somebody else's.
 */
export function verifyMarks(
  rows: readonly VerificationRow[],
  side: VerifySide,
  current: string,
): VerifyMark[] {
  return rows
    .filter((r) => r.side === side)
    .sort((a, b) => a.verifiedAt.localeCompare(b.verifiedAt))
    .map((r) => ({
      status: r.fingerprint === current ? "verified" as const : "stale" as const,
      by: r.verifiedBy,
      at: r.verifiedAt,
    }));
}

/**
 * What to show for one side.
 *
 * "stale" is the whole reason a fingerprint is stored rather than a bare
 * boolean. The weights come from mixer records that are edited on half a dozen
 * other screens, and the prices move whenever the card is revised — so hooking
 * every write path that could invalidate a sign-off would mean finding all of
 * them, and missing one silently leaves a batch marked checked over numbers
 * that changed after the check. Comparing the numbers themselves cannot miss.
 */
export function verifyState(row: VerificationRow | undefined, current: string): VerifyState {
  if (!row) return { status: "unverified" };
  const same = row.fingerprint === current;
  return same
    ? { status: "verified", by: row.verifiedBy, at: row.verifiedAt }
    : { status: "stale", by: row.verifiedBy, at: row.verifiedAt };
}

/**
 * The emails allowed to sign off weights, from WEIGHTS_VERIFIER_EMAILS.
 *
 * An env var rather than a role, because this is one named person rather than a
 * rank: every Line Manager verifying production weights was not what was asked
 * for. An env var rather than a constant in the file, because the alternative
 * is a colleague's address committed to a repository and a deploy every time
 * the job changes hands.
 *
 * UNSET MEANS NOBODY, never everybody. A misspelled variable that opened the
 * screen to all comers is the failure worth designing against.
 */
export function weightsVerifiers(raw: string | undefined | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function canVerifyWeights(email: string | null | undefined, raw: string | undefined | null): boolean {
  const who = String(email ?? "").trim().toLowerCase();
  if (!who) return false;
  return weightsVerifiers(raw).includes(who);
}

/** The store incharge is a batch verifier by ROLE. STORE is that role — see
 *  ROLE_LABEL. (The other verifier is named by email, above.) */
export function canVerifyCosts(role: string | null | undefined): boolean {
  return role === "STORE";
}

/** Whether this login is one of the two batch verifiers at all. */
export function isBatchVerifier(
  role: string | null | undefined,
  email: string | null | undefined,
  raw: string | undefined | null,
): boolean {
  return canVerifyWeights(email, raw) || canVerifyCosts(role);
}

/**
 * Which halves of the screen somebody may READ.
 *
 * Admin reads both because admin already reads the costed sheet next door;
 * hiding a rate here that /office/costing prints in full would be theatre.
 *
 * BOTH verifiers now read BOTH halves. This supersedes the original
 * one-half-each separation on the owner's instruction (2026-08-18): both the
 * store incharge and the named production verifier must be able to mark both
 * the price AND the consumption as correct, and nobody can check what they
 * cannot see. The cost this accepts, knowingly: each verifier now sees the
 * other half's raw numbers (unit rates for one, quantities for the other).
 * Still no totals, no computed sheet — that boundary stands.
 */
export function readableSides(
  role: string | null | undefined,
  email: string | null | undefined,
  raw: string | undefined | null,
): VerifySide[] {
  if (role === "ADMIN") return ["WEIGHTS", "COSTS"];
  return isBatchVerifier(role, email, raw) ? ["WEIGHTS", "COSTS"] : [];
}

/**
 * Which halves somebody may SIGN.
 *
 * Both verifiers sign both sides (owner, 2026-08-18) — each mark is stored per
 * PERSON, so one signing does not stand in for the other having checked.
 *
 * ADMIN SIGNS TOO (owner, 2026-08-21). This reverses a deliberate rule, so the
 * reasoning it replaces is kept rather than deleted: an admin who can tick both
 * boxes can produce a complete-looking sign-off from one login, which is why
 * admin was originally excluded.
 *
 * What makes that acceptable rather than merely overruled is that nothing here
 * has ever counted signatures. verifyMarks returns EVERY mark with its name and
 * time and the screen lists them, so "two people checked this" is a conclusion
 * a reader draws from the names — not a quorum this module enforces. Admin
 * signing adds a third possible name; it cannot forge either of the other two,
 * and a batch carrying only the admin mark reads as exactly that.
 *
 * If a real quorum is ever wanted — "not verified until two DIFFERENT people
 * have marked this side" — this is the function to build it in, and it would
 * want to exclude admin from the COUNT rather than from the button.
 */
export function signableSides(
  role: string | null | undefined,
  email: string | null | undefined,
  raw: string | undefined | null,
): VerifySide[] {
  if (role === "ADMIN") return ["WEIGHTS", "COSTS"];
  return isBatchVerifier(role, email, raw) ? ["WEIGHTS", "COSTS"] : [];
}
