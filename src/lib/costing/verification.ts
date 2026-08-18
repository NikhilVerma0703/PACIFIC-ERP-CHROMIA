// Who has checked a batch, and whether the numbers have moved since they did.
//
// Two people sign a batch off and neither of them is the one who priced it: the
// production manager confirms the weights the mixer recorded, the store incharge
// confirms the prices those weights are costed at. Neither sees the other's
// half, and neither sees a total — the costed sheet stays where it was, behind
// the ADMIN-only /office/costing gate.
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
  return [
    `resin=${round3(c.resinKg)}`,
    `filler=${round3(c.fillerKg)}`,
    `charges=${c.mixerCharges}`,
    `unresolved=${round3(c.gritUnresolvedKg)}`,
    `grit=${grit}`,
  ].join("&");
}

/** The priced side — this batch's own lines, plus the card they fall back to. */
export interface PricedShape {
  lines: ReadonlyArray<{ item: string; seq: number; qty: number | null; rate: number }>;
  cardRates: Readonly<Record<string, number>>;
  resinBySupplier: Readonly<Record<string, number>>;
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
  return `lines[${lines}]&card[${card}]&resin[${resin}]`;
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

/** The store incharge signs off prices. STORE is that role — see ROLE_LABEL. */
export function canVerifyCosts(role: string | null | undefined): boolean {
  return role === "STORE";
}

/**
 * Which halves of the screen somebody may READ.
 *
 * Admin reads both because admin already reads the costed sheet next door;
 * hiding a rate here that /office/costing prints in full would be theatre.
 * Everybody else reads exactly the half they sign, which is what keeps the
 * plant's cost base off a screen that two more logins can now open.
 */
export function readableSides(
  role: string | null | undefined,
  email: string | null | undefined,
  raw: string | undefined | null,
): VerifySide[] {
  if (role === "ADMIN") return ["WEIGHTS", "COSTS"];
  const out: VerifySide[] = [];
  if (canVerifyWeights(email, raw)) out.push("WEIGHTS");
  if (canVerifyCosts(role)) out.push("COSTS");
  return out;
}

/**
 * Which halves somebody may SIGN.
 *
 * Not the same list as readableSides: an admin sees both and signs neither. A
 * verification is one named person saying they checked it, and an admin able to
 * tick both boxes turns the pair of signatures into a formality that one login
 * can produce on its own.
 */
export function signableSides(
  role: string | null | undefined,
  email: string | null | undefined,
  raw: string | undefined | null,
): VerifySide[] {
  const out: VerifySide[] = [];
  if (canVerifyWeights(email, raw)) out.push("WEIGHTS");
  if (canVerifyCosts(role)) out.push("COSTS");
  return out;
}
