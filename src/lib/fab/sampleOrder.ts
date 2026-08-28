// SAMPLE ORDERS — the sampling desk's own work, running through the fabrication
// floor's existing pipeline.
//
// The owner: "from this CTS too you can get pieces, send the extra pieces. Or
// sampling page, they create the request — catalogue requirement — and request
// the samples and send to supervisor. He the same way chooses the slab and adds
// pieces and quantity and sends to cutting, then polished (no sink and fabri in
// the samples) and pushed to package."
//
// So sample stock arrives TWO WAYS, and they are not the same event:
//
//   OFFCUT     a PO slab has been cut and usable pieces are left over. Recorded
//              where they are found, on the supervisor's slab card. The slab
//              stays CTS — fabrication cut it, and the offcuts are what was left
//              over, not what the slab became. (fabIntake.ts, and the guard in
//              markQcSlabSample.)
//   ORDERED    somebody wants forty 11 x 11 Carrara Royale in suede. That is a
//              JOB, not a windfall: a slab has to be chosen, pieces cut,
//              polished and packed before the stock exists.
//
// This module is about the second.
//
// ─────────────────────────────────── IT IS THE SAME PIPELINE, ON PURPOSE ────
// A sample order is a fab_project whose kind is SAMPLE. Its rows are
// fab_requirements, its pieces are fab_pieces, and they move through the same
// slab board and the same cutting, polishing and packaging queues as everything
// else. One set of screens, one set of piece codes, one place an operator looks.
//
// The alternative — a parallel set of tables and queues — means an operator
// choosing between two cutting screens depending on what is on the saw, and two
// copies of every rule that would then drift apart. Sampling work is not a
// different kind of work; it is the same work for a different customer.
//
// ─────────────────────────────────── WHAT IS DIFFERENT ──────────────────────
// "No sink and fabri in the samples." A sample is a flat piece of stone: cut,
// polished, packed. It never has a sink cut into it, so by requirement-derive's
// own rule — fabricationRequired = sinkRequired — it never reaches fabrication
// either. That is not a setting somebody could get wrong; on a sample row it is
// refused outright (checkSampleSink below).
//
// And at the END the piece does not ship to a customer. Packing it credits the
// sample shelf: colour + finish + size, quantity one, traceable to the slab it
// came off. planSampleCredit says what that write is.
//
// PURE, AND IT IMPORTS NOTHING — the rule from pricing.ts, sinkSplit.ts and
// slabMark.ts, so `node --test` reaches it and a client component can use it.

/** What a fab_project is FOR. A column rather than a separate table because a
 *  sample order is the same shape of thing as a purchase order — it has rows,
 *  slabs, pieces and a floor to cross. */
export const PROJECT_KINDS = ["PO", "SAMPLE"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/** Every project that predates sample orders is a PO, and that is correct: they
 *  all came from a purchase order. */
export const DEFAULT_PROJECT_KIND: ProjectKind = "PO";

export function parseProjectKind(value: unknown): ProjectKind | null {
  const t = String(value ?? "").trim().toUpperCase();
  return (PROJECT_KINDS as readonly string[]).includes(t) ? (t as ProjectKind) : null;
}

/** Tolerant read for a column that may not exist yet (before scripts/0059) —
 *  a project with no kind is a PO, which every existing one is. */
export function projectKindOf(value: unknown): ProjectKind {
  return parseProjectKind(value) ?? DEFAULT_PROJECT_KIND;
}

export function isSampleProject(value: unknown): boolean {
  return projectKindOf(value) === "SAMPLE";
}

/**
 * THE SLAB CODE A ROW CARRIES BEFORE ANY SLAB IS CHOSEN.
 *
 * fab_requirement.slab_code is NOT NULL and has no default — it predates slab
 * allocation, when a row named its slab on the sheet it was typed from. Nothing
 * reads it any more (allocations do that job), but the column is still required,
 * and a create that omits it is refused by the database rather than by a
 * validator, so the failure arrives as a 500 with no field named in it.
 *
 * The purchase-order importer writes "UNASSIGNED" for the same reason. This is
 * the same string, deliberately: two spellings of "nobody has picked a slab yet"
 * would sort apart and read as two different states on a screen. It is declared
 * here rather than imported from poParser.ts so that raising a sample request
 * does not drag the whole PDF parser into the route.
 */
export const SAMPLE_REQUIREMENT_SLAB_CODE = "UNASSIGNED";

/* ── ROUTING ──────────────────────────────────────────────────────────────── */

export interface SampleRouting {
  sinkRequired: boolean;
  fabricationRequired: boolean;
  polishRequired: boolean;
}

/**
 * WHAT A SAMPLE PIECE GOES THROUGH: cut, polish, pack.
 *
 * "No sink and fabri in the samples." Stated here as flat values rather than
 * derived, because on a sample it is not a decision anybody makes — it is what
 * a sample IS. deriveRoutingFlags would give the same answer for a row with no
 * sinks, and this exists so the answer cannot change if that rule ever does.
 */
export function sampleRouting(): SampleRouting {
  return { sinkRequired: false, fabricationRequired: false, polishRequired: true };
}

/**
 * MAY THIS ROW HAVE SINKS? Only if it is not a sample.
 *
 * The refusal is a sentence rather than a boolean because it reaches a screen:
 * a supervisor who has just typed a sink count onto a sample row has misread
 * which board he is on, and "invalid" would not tell him that.
 */
export function checkSampleSink(
  kind: unknown,
  sinkQuantity: number | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  const wanted = Math.max(0, Math.floor(Number(sinkQuantity) || 0));
  if (wanted <= 0) return { ok: true };
  if (!isSampleProject(kind)) return { ok: true };
  return {
    ok: false,
    reason:
      "Samples do not have sinks. A sample is cut, polished and packed — nothing on a " +
      "sample order goes to sink cutting or to fabrication, so there is no sink count to set.",
  };
}

/* ── WHAT PACKING A SAMPLE PIECE CREDITS ──────────────────────────────────── */

export interface SamplePieceCredit {
  colourFinishId: string;
  sizeId: string;
  /** Always the pieces packed in this action — sample stock counts pieces. */
  quantity: number;
  /** The slab number, for sampling_intake.source_ref. The bridge back to the
   *  stone, exactly as the offcut path uses it. */
  sourceRef: string | null;
  sourceQcId: string | null;
  sourceSlabId: string | null;
}

export interface SamplePieceInput {
  colourFinishId?: string | null;
  samplingSizeId?: string | null;
  quantity?: number | null;
  slabCode?: string | null;
  pacificQcId?: string | null;
  fabSlabId?: string | null;
}

/**
 * THE STOCK WRITE A PACKED SAMPLE PIECE EARNS, or null.
 *
 * NULL WHEN THE ROW CANNOT SAY WHAT IT IS. A sample requirement carries the
 * colour+finish and the sampling size it was ordered against; without both, the
 * piece is stone that has been cut and polished and belongs on no shelf. That is
 * a real state — a row created before this module, or by an import that did not
 * fill them — and the honest answer is to pack the piece and credit nothing,
 * rather than to guess a shelf and make the count wrong.
 *
 * The caller reports what it skipped; silently crediting the wrong shelf is the
 * one outcome worth going out of the way to prevent.
 */
export function planSampleCredit(input: SamplePieceInput): SamplePieceCredit | null {
  const colourFinishId = String(input?.colourFinishId ?? "").trim();
  const sizeId = String(input?.samplingSizeId ?? "").trim();
  if (!colourFinishId || !sizeId) return null;

  const q = Math.floor(Number(input?.quantity) || 0);
  if (q <= 0) return null;

  const ref = String(input?.slabCode ?? "").trim();
  const qc = String(input?.pacificQcId ?? "").trim();
  const slab = String(input?.fabSlabId ?? "").trim();

  return {
    colourFinishId,
    sizeId,
    quantity: q,
    sourceRef: ref === "" ? null : ref,
    sourceQcId: qc === "" ? null : qc,
    sourceSlabId: slab === "" ? null : slab,
  };
}

/* ── NAMING ───────────────────────────────────────────────────────────────── */

/** Sample orders are numbered in their own series so a code says at a glance
 *  which floor a job came from. Zero-padded to four, which is where a shop
 *  doing a few sample orders a week stays for twenty years. */
export function sampleOrderCode(n: number): string {
  const v = Math.max(1, Math.floor(Number(n) || 1));
  return `SR-${String(v).padStart(4, "0")}`;
}

/** The number back out of a code, or null. Used to find the next one. */
export function sampleOrderNumber(code: unknown): number | null {
  const m = /^SR-(\d+)$/i.exec(String(code ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The next code, given every project code the shop holds. Reads the whole list
 *  rather than counting sample orders: a deleted one must not hand its number
 *  to the next, because piece codes carrying it may still be on stone. */
export function nextSampleOrderCode(existingCodes: Array<string | null | undefined>): string {
  let max = 0;
  for (const c of existingCodes ?? []) {
    const n = sampleOrderNumber(c);
    if (n !== null && n > max) max = n;
  }
  return sampleOrderCode(max + 1);
}
