// Whether a batch is FINISHED being entered — the gate in front of a sign-off.
//
// The owner's rule (2026-08-19): the two verifiers may enter everything on the
// materials panel themselves, but they cannot mark a batch verified "till
// everything is entered including cost and splits (obviously for splits make
// sure total mixer amount is split)". This module is that rule, stated once.
//
// Three things make a batch complete:
//
//   1. PRICE — every material the batch consumed resolves a price: lines
//      entered on this batch, or a rate-card rate. A quantity nobody can price
//      is reported "unpriced" on the sheet, and a sign-off over an unpriced
//      quantity would be a signature on a number that is not there.
//
//   2. DOSE — the four chemicals are never weighed; their kilograms are a
//      percentage of resin weight. A missing dose means the material's
//      quantity does not exist, which is worse than unpriced — so "no dose
//      set" blocks whenever the batch has resin for the rule to act on.
//
//   3. SPLIT — a material somebody assigned suppliers to must account for the
//      FULL mixer-weighed total. This is deliberately STRICTER than
//      splitMaterial(), which prices a shortfall at the card and merely flags
//      it: pricing the remainder is the right behaviour for a sheet that must
//      always total, and the wrong one for an approval — a verifier signing a
//      split that covers 6.2 t of 8.05 t is signing "I checked where the resin
//      came from" over 1.85 t nobody said anything about. The panel's own
//      remainder rule is honoured: ONE blank-quantity line takes whatever is
//      left, so a split ending in a blank line is complete by construction.
//      A material with NO assignments is fine — it prices whole at the card,
//      which the panel says out loud — provided rule 1 holds for it.
//
// What this does NOT do: touch existing marks. The rule is asked only when a
// NEW mark is being made (POST on the mark API); marks made before the rule
// existed stand until they lapse on their own fingerprint.
//
// NO IMPORTS, deliberately — same reason as verification.ts and batchRates.ts
// beside it: `node --test` resolves neither the "@/" alias nor Prisma, and an
// approval gate that can only be checked by opening a browser is a gate nobody
// checks. The few constants shared with those modules (the epsilon, the dosing
// map) are restated here with a pointer rather than imported.

/** One saved line on a batch's material — the shape the routes already hold.
 *  Structural on purpose: Prisma rows pass straight in. */
export interface CompletenessLine {
  item: string;
  seq: number;
  /** Null means "whatever is left of the mixer's quantity" — the remainder-taker. */
  qty: number | null;
  rate: number;
  category: string;
}

/** The weighed half, as loadBatchConsumption returns it (extra fields welcome). */
export interface CompletenessConsumption {
  resinKg: number;
  fillerKg: number;
  gritCharges: ReadonlyArray<{ band: string; kg: number }>;
}

/** The card in force on the batch's run date — effectiveRateCard's shape. */
export interface CompletenessCard {
  rates: Readonly<Record<string, number>>;
  resinBySupplier: Readonly<Record<string, number>>;
}

export interface BatchCompleteness {
  ok: boolean;
  /** Human-readable, in the order the panel lists the materials — each one
   *  names the material and what is missing, because the person reading this
   *  is the person who has to go and finish it. Empty exactly when ok. */
  blockers: string[];
}

/** Chemical -> the dosing rule that produces its quantity. Restates DOSED_BY
 *  in BatchRatesPanel.tsx and the pairs in mixerQuantities() — one list, three
 *  sites, because neither client code nor a Prisma-importing route can be
 *  imported from here. Change one, change all three. */
const DOSED_CHEMICALS: ReadonlyArray<readonly [chem: string, rule: string]> = [
  ["tio2", "tio2-pct-of-resin"],
  ["silane", "silane-pct-of-resin"],
  ["cobalt", "cobalt-pct-of-resin"],
  ["catalyst", "catalyst-pct-of-resin"],
];

/** Same tolerance as batchRates.ts: quantities are kilos and tonnes read off
 *  scales, so anything under this is rounding, not a real shortfall. */
const EPSILON = 0.005;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Rates and doses must be positive finite to count — a zero rate prices a
 *  material at nothing and makes the batch look cheap, which is the quiet
 *  failure this whole gate exists to catch. Mirrors the report's usable(). */
const usable = (v: number | undefined): v is number =>
  v !== undefined && Number.isFinite(v) && v > 0;

/** What the batch consumed, in the item's own unit — resin in kg, filler and
 *  grit in tonnes, chemicals derived from the dose in force. The SAME map the
 *  batch-rates editor shows, because a gate that reconciles splits against a
 *  different total than the one on screen would block a split the screen
 *  called balanced. */
function consumedTotals(
  c: CompletenessConsumption,
  doseFor: (rule: string) => number | undefined,
): Array<{ item: string; qty: number; unit: string }> {
  const out: Array<{ item: string; qty: number; unit: string }> = [];

  if (usable(c.resinKg)) out.push({ item: "resin", qty: c.resinKg, unit: "kg" });

  // Grit per band, in tonnes — bands are already normalised upstream.
  const byBand = new Map<string, number>();
  for (const g of c.gritCharges) {
    if (!Number.isFinite(g.kg) || g.kg <= 0) continue;
    byBand.set(g.band, (byBand.get(g.band) ?? 0) + g.kg);
  }
  for (const band of [...byBand.keys()].sort()) {
    out.push({ item: `grit-${band}`, qty: byBand.get(band)! / 1000, unit: "t" });
  }

  if (usable(c.fillerKg)) out.push({ item: "filler-400", qty: c.fillerKg / 1000, unit: "t" });

  // The four chemicals exist only where a dose does — a missing dose is
  // reported as its own blocker by the caller, not silently as "no quantity".
  if (usable(c.resinKg)) {
    for (const [chem, rule] of DOSED_CHEMICALS) {
      const d = doseFor(rule);
      if (usable(d)) out.push({ item: chem, qty: (c.resinKg * d) / 100, unit: "kg" });
    }
  }
  return out;
}

/**
 * Is this batch complete enough to approve?
 *
 * Pure and side-effect free: the mark API calls it server-side (the control),
 * and the verify screen shows its blockers beside the disabled buttons (the
 * courtesy). Both read the same answer because there is only one function.
 *
 * `labels` maps item keys to what the screen calls them ("tio2" -> "TiO₂");
 * a key with no label falls back to itself so a new catalogue item is named
 * rather than invisible.
 */
export function batchCompleteness(
  consumption: CompletenessConsumption | null,
  lines: readonly CompletenessLine[],
  card: CompletenessCard,
  labels: Readonly<Record<string, string>> = {},
): BatchCompleteness {
  const blockers: string[] = [];
  const label = (item: string) => labels[item] ?? item;

  // A batch with no mixer records has nothing to be incomplete about — and the
  // mark API refuses it earlier anyway ("no mixer records for that batch").
  if (!consumption) return { ok: true, blockers };

  // The dose in force per rule: the batch's own line beats the card, and among
  // a batch's own lines the LAST by seq wins — the same resolution as
  // dosingOverrides() in batchRates.ts, restated because this module cannot
  // import it (see the header).
  const batchDose: Record<string, number> = {};
  for (const l of [...lines].sort((a, b) => a.seq - b.seq)) {
    if (l.category !== "DOSING") continue;
    if (usable(l.rate)) batchDose[l.item] = l.rate;
  }
  const doseFor = (rule: string): number | undefined =>
    usable(batchDose[rule]) ? batchDose[rule]
      : usable(card.rates[rule]) ? card.rates[rule]
        : undefined;

  const totals = consumedTotals(consumption, doseFor);

  // Lines per consumed material, seq-ordered. Dose rules and basis items are
  // values, not quantities — they never appear in `totals`, so they are never
  // split-checked here.
  const byItem = new Map<string, CompletenessLine[]>();
  for (const l of lines) {
    const bucket = byItem.get(l.item) ?? [];
    bucket.push(l);
    byItem.set(l.item, bucket);
  }
  for (const bucket of byItem.values()) bucket.sort((a, b) => a.seq - b.seq);

  for (const { item, qty: total, unit } of totals) {
    const own = byItem.get(item) ?? [];

    if (own.length === 0) {
      // No assignments: prices whole at the card, which the panel says is the
      // normal case. Complete — unless the card has nothing either, which is
      // the "unpriced" state the sheet reports and a sign-off must refuse.
      const carded = item === "resin"
        ? Object.values(card.resinBySupplier).some((v) => usable(v))
        : usable(card.rates[item]);
      if (!carded) {
        blockers.push(`${label(item)}: no price — nothing entered on this batch and nothing on the rate card`);
      }
      continue;
    }

    // Assignments exist: they must account for the full mixer-weighed total.
    // The route already refuses rate<=0, qty<=0 and second blanks on the way
    // in, but this recounts from what is STORED rather than trusting that —
    // an import or an older row is exactly what a defensive rule is for.
    let assigned = 0;
    let rests = 0;
    let unusable = 0;
    for (const l of own) {
      if (!usable(l.rate)) { unusable += 1; continue; }
      if (l.qty == null) { rests += 1; continue; }
      if (usable(l.qty)) assigned += l.qty; else unusable += 1;
    }
    assigned = r3(assigned);
    const short = r3(total - assigned);

    if (unusable > 0) {
      blockers.push(`${label(item)}: ${unusable} line${unusable === 1 ? " has" : "s have"} no usable price or quantity`);
    }
    if (rests > 1) {
      // Two blank lines cannot both be "the rest" — the sheet would price one
      // of them at nothing and nobody would know which.
      blockers.push(`${label(item)}: ${rests} lines are all left blank for "the rest" — only one can be`);
    }
    if (short < -EPSILON) {
      // Over-assignment blocks even when a blank line is present: the blank
      // takes what is LEFT, and there is less than nothing left.
      blockers.push(
        `${label(item)}: split covers ${r3(assigned)} ${unit} but the mixer weighed ${r3(total)} ${unit} — more assigned than recorded`,
      );
    } else if (short > EPSILON && rests === 0) {
      // The screenshot case, and the heart of the owner's ask: quantities that
      // do not add up to the mixer total, with no remainder-taker to absorb
      // the difference. (With exactly one blank line the split is complete by
      // construction — that line IS the remaining quantity.)
      blockers.push(`${label(item)}: split covers ${r3(assigned)} ${unit} of ${r3(total)} ${unit} weighed`);
    }
  }

  // Dose rules last, matching the panel's family order (Dosing sits at the
  // bottom). Only where the batch has resin for the percentage to act on — a
  // rule with nothing to dose produces no quantity and needs no value.
  if (usable(consumption.resinKg)) {
    for (const [chem, rule] of DOSED_CHEMICALS) {
      if (doseFor(rule) === undefined) blockers.push(`${label(chem)}: no dose set`);
    }
  }

  return { ok: blockers.length === 0, blockers };
}
