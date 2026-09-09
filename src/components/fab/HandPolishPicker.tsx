"use client";

// THE WHOLE HAND-POLISH DECISION, IN ONE CONTROL.
//
// The owner, looking at the old card: "the option is — if clicked top, you see
// the sides, choose them, and you see the price for it, put price. Then next is
// bottom, if there, same way. Then side if hand polished, same way. All prices
// are independent between top, bottom and side." And: "remove the UI of the
// pricing and make it clean and easy understanding."
//
// WHAT WAS WRONG WITH TWO CONTROLS
// --------------------------------
// The faces were chosen in FacePolishPicker and priced in PolishTerms, which
// are two boxes stacked on one card, and the seam showed:
//
//   TWO TAB STRIPS       the face chips at the top, and the face tabs again
//                        inside the diagram panel — the same three words twice,
//                        four inches apart, doing different things.
//   A RATE BAND MILES    "PER FACE: Top [1] Bottom [—] Side" sat BELOW the
//   FROM ITS FACE        diagram, so the box for Bottom was nowhere near the
//                        drawing that says what Bottom is. He picked sides in
//                        one panel and priced them in another.
//   ONE TOTAL, AT THE    the only money on screen was the ROW total. Type Rs1
//   BOTTOM, FOR          against the bottom of a 150-piece row and the figure
//   EVERYTHING           that moves covers three faces and 150 pieces, so
//                        nothing tells you the Rs1 landed where you meant.
//
// So the question is asked ONCE, in the order he asks it: pick a face, see that
// face's piece, click its sides, type that face's price, and read what THAT
// costs — right there, under the box that set it.
//
//     POLISH   (Top 4)  (Bottom 2)  (Side)          <- pick a face
//     +--------------------------------------+
//     | Bottom              remove this face |
//     |  +--------+   All four                |
//     |  | 103x9  |                           |
//     |  +--------+   Bottom, Rs per foot [1] |      <- this face's own price
//     |  sides on the bottom only             |
//     |     88.63 ft x Rs1        Rs88.63     |      <- what THIS face costs
//     +---------------------------------------+
//     Top and bottom together    [    ]             <- only when both are on
//     > Other terms ...                             <- folded away
//
// EVERY NUMBER COMES FROM lib/fab/pricing.ts. Nothing is computed here — the
// per-face figures are priceRow's own buckets (RowPricing.edgeLines), so the
// line under the rate box and the row total at the foot of the card cannot
// become two answers to one question.
//
// ─────────────────────── BUCKETS, NOT FACES ─────────────────────────────────
// A side polished on BOTH faces is one bucket, priced once — one trip with the
// piece flipped. It cannot be charged to "top" or to "bottom" without inventing
// a figure, so it appears in BOTH panels, labelled as shared. That is why the
// lines are filtered by `faces` and not by a face name.
//
// ─────────────────────── AND NOTHING SAVES MID-NUMBER ───────────────────────
// Every rupee box is a MoneyInput, which commits on blur or Enter and not on
// each keystroke. See that file for why typing "10" used to be two saved
// prices, the first of which was a perfectly valid Rs1.

import { useMemo, useState } from "react";
import {
  POLISH_FACES, faceSideCounts, isRound,
  type FaceEdges, type PolishFace,
} from "@/lib/fab/shape";
import {
  EDGES, allEdgesFor, PRICING_MODES, parsePricingMode, describePricingMode,
  formatRupees, type Edge, type EdgeSelection, type PricingMode, type RowPricing,
} from "@/lib/fab/pricing";
import { PieceDiagram, RoundDiagram } from "@/components/fab/FacePolishPicker";
import { MoneyInput } from "@/components/fab/MoneyInput";
import type { PolishTermsValue } from "@/components/fab/PolishTerms";

const FACE_LABEL: Record<PolishFace, string> = {
  top: "Top", bottom: "Bottom", side: "Side",
};

/** What each face IS. "Side" is the one people read as a fifth direction rather
 *  than the vertical band, and that misunderstanding is worth a tooltip. */
const FACE_HINT: Record<PolishFace, string> = {
  top: "The top arris — where the top face meets the edge band. The usual one.",
  bottom: "The bottom arris, on the underside. Chosen when the edge is seen from below.",
  side: "The edge band itself — the vertical thickness face. Normally machine polished; choose it when it is being done by hand instead.",
};

/** Which key on the terms holds each face's own rate. */
const RATE_KEY: Record<PolishFace, "rateTop" | "rateBottom" | "rateSide"> = {
  top: "rateTop", bottom: "rateBottom", side: "rateSide",
};

function faceOn(shape: unknown, sel: EdgeSelection | undefined): boolean {
  const e = sel ?? {};
  return isRound(shape) ? !!e.round : EDGES.some((k) => !!e[k]);
}

export function HandPolishPicker({
  shape, lengthIn, widthIn, unit,
  faces, terms, priced, cardRate,
  disabled = false, onChange,
}: {
  shape: unknown;
  lengthIn: number | null;
  widthIn: number | null;
  /** fab_requirement.dim_unit — the unit the CUSTOMER ordered in, for the
   *  drawing's caption. Display only; the feet come from the inches. */
  unit?: string | null;
  faces: FaceEdges;
  terms: PolishTermsValue;
  /** THIS ROW, ALREADY PRICED, from the caller's own priceRow call. Passed in
   *  rather than computed here so the figures beside the boxes and the total at
   *  the foot of the card are literally the same numbers. */
  priced: RowPricing;
  /** The standing rate for this row's stone — Rs15 at 2 cm, Rs20 at 3 cm — shown
   *  as what "empty" means. Null when the thickness is not on the card, in
   *  which case a rate has to be typed and the box says so. */
  cardRate: number | null;
  disabled?: boolean;
  /** Faces and terms together, because they are one decision: a rate without
   *  the faces it was quoted for is a number with no shape. Called once per
   *  finished edit — never per keystroke. */
  onChange: (faces: FaceEdges, terms: PolishTermsValue) => void;
}) {
  const round = isRound(shape);
  const mode = parsePricingMode(terms.pricingMode);
  const perFoot = mode === "RUNNING_FOOT";
  const counts = useMemo(() => faceSideCounts(shape, faces), [shape, faces]);
  const active = useMemo(
    () => POLISH_FACES.filter((f) => faceOn(shape, faces[f])),
    [shape, faces],
  );

  // Which face's panel is open. Follows the last face switched on, so clicking
  // "Bottom" puts you straight into choosing bottom's sides — the sequence the
  // owner described, with no second click to get there.
  const [editing, setEditing] = useState<PolishFace>(active[0] ?? "top");
  const shown = active.includes(editing) ? editing : (active[0] ?? null);

  // "OTHER TERMS" IS FOLDED AWAY, AND CANNOT BE FOLDED OVER SOMETHING SET.
  //
  // Per piece, lump sum and the agreed total are the unusual cases — the owner
  // called the expanded version clumsy, and on an ordinary row they are three
  // controls nobody touches. But a row that IS on one of them must show it: a
  // hidden agreed total is an invoice nobody can see past. So the disclosure
  // opens on request and stays open on its own whenever the row is off the
  // default, whatever the button says.
  // ── IS THERE A SECOND RATE BOX AT ALL? ──────────────────────────────────
  //
  // The owner: "already right at the shape we put the per-foot price — then
  // why below do I see again a per running foot, and 0 in that?"
  //
  // He is right, and the old label made it worse. `terms.rate` is not a second
  // price competing with the face boxes; it is the FALLBACK the empty ones
  // inherit. Under RUNNING_FOOT it therefore has a job only when some chosen
  // face has been left empty — if all three carry their own figure, the row
  // rate can never be reached, and a box that cannot affect the money is a
  // second opinion on screen for no reason.
  //
  // IT IS NOT HIDDEN WHEN IT STILL BITES, and that is the whole care here. Row
  // I of PI 1200 has edge_rate = 0 stored with the bottom face empty, so the
  // bottom really is priced at ₹0 — hiding the box would leave a ₹0 nobody can
  // see and nobody can clear. Under PER_PIECE and LUMP_SUM it is the ONLY rate
  // there is, so it always shows.
  const someFaceEmpty = POLISH_FACES.some(
    (f) => faceOn(shape, faces[f]) && terms[RATE_KEY[f]] === null,
  );
  const fallbackApplies = !perFoot || someFaceEmpty || active.length === 0;
  const showRowRate = fallbackApplies;

  const offDefault =
    !perFoot
    || terms.totalOverride !== null
    // A stored row rate is only worth forcing the panel open when it can
    // actually reach the money. Otherwise it is a dead number and opening the
    // panel on every row of a forty-row order to show it is the noise the
    // fold exists to remove.
    || (terms.rate !== null && fallbackApplies);
  const [asked, setAsked] = useState(false);
  const showMore = asked || offDefault;

  const set = (patch: Partial<PolishTermsValue>) => onChange(faces, { ...terms, ...patch });

  /** Switching a face ON selects EVERY side of it, deliberately: "top and
   *  bottom edges too, on all four sides" is the common case, and the diagram
   *  appears immediately showing exactly what was chosen with the count on the
   *  chip — a visible default, not a silent one. Taking two off is two clicks;
   *  building four up would be four. */
  function pickFace(f: PolishFace) {
    if (disabled) return;
    setEditing(f);
    if (faceOn(shape, faces[f])) return;    // already on — just open its panel
    onChange({ ...faces, [f]: allEdgesFor(shape) }, terms);
  }

  /** Turn a face off. ITS OWN RATE GOES WITH IT — a rate left behind for work
   *  nobody is doing comes back the next time somebody ticks the face, and
   *  prices it at a figure agreed for a different job.
   *
   *  AND SO DOES THE PAIR RATE, when the face leaving is one of the two it is
   *  about. "Top and bottom together for Rs15" is meaningless once there is no
   *  bottom; priceRow already charges nothing for it (there are no shared feet
   *  to multiply), but leaving the figure in the column means it silently
   *  applies again the moment somebody re-ticks the face. */
  function dropFace(f: PolishFace) {
    if (disabled) return;
    const next: FaceEdges = { ...faces };
    delete next[f];
    const nextTerms: PolishTermsValue = { ...terms, [RATE_KEY[f]]: null };
    if (f === "top" || f === "bottom") nextTerms.pairRate = null;
    onChange(next, nextTerms);
  }

  function toggleEdge(f: PolishFace, e: Edge) {
    if (disabled) return;
    const cur: EdgeSelection = { ...(faces[f] ?? {}) };
    if (cur[e]) delete cur[e]; else cur[e] = true;
    // Clearing the last side turns the FACE off, rather than leaving an empty
    // selection that reads as "chosen" and prices as zero.
    if (!faceOn(shape, cur)) { dropFace(f); return; }
    onChange({ ...faces, [f]: cur }, terms);
  }

  function allSides(f: PolishFace) {
    if (disabled) return;
    onChange({ ...faces, [f]: allEdgesFor(shape) }, terms);
  }

  // The buckets belonging to the open face. PAIR carries both top and bottom,
  // so it shows in either panel — see the header note on buckets.
  const shownLines = shown ? priced.edgeLines.filter((l) => l.faces.includes(shown)) : [];
  const faceRate = shown ? terms[RATE_KEY[shown]] : null;
  const faceFallback = terms.rate ?? cardRate;
  const pairApplies = counts.top > 0 && counts.bottom > 0;

  return (
    <div className="flex flex-col gap-2">
      {/* ── ONE ROW OF CHIPS. The face is chosen here and NOWHERE ELSE. The
             second tab strip that used to sit inside the panel is gone: the
             chip carries the count, opens the panel, and is the only place the
             answer changes. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-0.5">
          Polish
        </span>
        {POLISH_FACES.map((f) => {
          const on = faceOn(shape, faces[f]);
          const open = on && f === shown;
          return (
            <button
              key={f} type="button" disabled={disabled}
              onClick={() => pickFace(f)}
              aria-pressed={on}
              title={FACE_HINT[f]}
              className={`text-[11px] font-semibold rounded-full border px-2.5 py-1 transition disabled:opacity-50 disabled:cursor-not-allowed ${
                open ? "bg-indigo-600 border-indigo-600 text-white"
                : on ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
              }`}
            >
              {FACE_LABEL[f]}
              {on && (
                <span className={`ml-1.5 tabular-nums ${open ? "text-indigo-200" : "text-indigo-500"}`}>
                  {round ? "ring" : counts[f]}
                </span>
              )}
            </button>
          );
        })}
        {active.length === 0 && (
          <span className="text-[11px] text-slate-400 ml-1">
            none — click a face to hand polish it
          </span>
        )}
      </div>

      {/* ── THE OPEN FACE: its piece, its sides, its price, its money ─────── */}
      {shown && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-slate-200 bg-white">
            <span className="text-[11px] font-semibold text-slate-700">
              {FACE_LABEL[shown]} — {round ? "the whole edge" : "choose the sides"}
            </span>
            <button
              type="button" disabled={disabled} onClick={() => dropFace(shown)}
              title={`Take the hand polish off the ${FACE_LABEL[shown].toLowerCase()} altogether, and its rate with it`}
              className="text-[10px] text-slate-400 hover:text-red-600 disabled:opacity-40 transition"
            >
              remove this face
            </button>
          </div>

          <div className="p-2.5 flex flex-col gap-2.5">
            <div className="flex items-start gap-3 flex-wrap">
              {round ? (
                <RoundDiagram
                  shape={shape} lengthIn={lengthIn} widthIn={widthIn}
                  on={!!faces[shown]?.round}
                  onToggle={() => (faces[shown]?.round ? dropFace(shown) : allSides(shown))}
                  disabled={disabled} unit={unit}
                />
              ) : (
                <PieceDiagram
                  lengthIn={lengthIn} widthIn={widthIn}
                  edges={faces[shown] ?? {}}
                  onToggle={(e) => toggleEdge(shown, e)}
                  disabled={disabled} unit={unit}
                />
              )}

              {!round && (
                <div className="flex flex-col gap-1 pt-1">
                  <button
                    type="button" disabled={disabled} onClick={() => allSides(shown)}
                    className="text-[11px] rounded border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:border-slate-300 disabled:opacity-50"
                  >
                    All four
                  </button>
                  <div className="text-[10px] text-slate-400 leading-tight mt-0.5 max-w-[8rem]">
                    front and back run the length; left and right run the width
                  </div>
                </div>
              )}

              {/* ── THIS FACE'S OWN PRICE, BESIDE THIS FACE'S OWN DRAWING ───
                  "All prices are independent between top, bottom and side."
                  Empty falls back to the row's rate and then to the card, so an
                  ordinary row still needs no typing — and the fallback is said
                  in words rather than echoed into the box as a grey number,
                  which read as three linked prices. */}
              {perFoot && (
                <div className="flex flex-col gap-0.5 min-w-[11rem]">
                  <label className="text-[10px] font-medium text-slate-500">
                    {FACE_LABEL[shown]} &middot; &#8377; per foot
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 text-xs">&#8377;</span>
                    {/* KEYED BY FACE, AND THAT IS NOT CosMETIC.
                        There is ONE box here and three faces behind it, so
                        switching face reuses the same input instance. Its draft
                        resyncs in an effect, which runs AFTER paint — so for one
                        frame the box showed the PREVIOUS face's rate under the
                        new face's label. Caught on row I: Top ₹150, click
                        Bottom, and Bottom's empty box flashed "150" over the
                        line that says "empty = ₹0". Somebody reads that flash
                        and believes the bottom is quoted.
                        A key per face mounts a fresh box instead, seeded right
                        the first time it paints. */}
                    <MoneyInput
                      key={shown}
                      value={faceRate}
                      onCommit={(n) => set({ [RATE_KEY[shown]]: n } as Partial<PolishTermsValue>)}
                      placeholder="—"
                      disabled={disabled}
                      tone="set"
                      ariaLabel={`Rupees per foot for the ${FACE_LABEL[shown].toLowerCase()}`}
                    />
                  </div>
                  <span className={`text-[10px] ${faceRate === null ? "text-slate-400" : "text-indigo-600 font-semibold"}`}>
                    {faceRate !== null
                      ? "saved — this face only"
                      : faceFallback !== null
                        ? `empty = ₹${faceFallback}${terms.rate !== null ? ", the row's rate" : ", the card"}`
                        : "empty — and this stone has no card rate"}
                  </span>
                </div>
              )}
            </div>

            {/* ── WHAT THIS FACE COSTS. THE PRICE FOR THAT PARTICULAR WORK,
                   not the row roll-up: the buckets priceRow actually charged,
                   with the feet and the rate that made each one. */}
            {shownLines.length > 0 ? (
              <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs tabular-nums">
                {shownLines.map((l) => (
                  <div key={l.key} className="flex items-baseline justify-between gap-3 py-0.5">
                    <span className="text-slate-500 text-[11px]">
                      {l.label}
                      {l.key === "PAIR" && (
                        <span className="ml-1 text-teal-700 font-semibold">&middot; shared, counted once</span>
                      )}
                      {l.feet > 0 && (
                        <span className="text-slate-400">
                          {" · "}{l.feet} ft{l.rate !== null && ` × ${formatRupees(l.rate)}`}
                        </span>
                      )}
                    </span>
                    <span className="font-semibold text-slate-800">{formatRupees(l.cost)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-slate-400">
                {priced.unpriced
                  ? "Nothing is charged for this face yet — see the note under the card."
                  : "No rate on this face yet, so it costs nothing."}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── TOP AND BOTTOM TOGETHER — an OVERRIDE, and only ever one line ───
             "If per foot is Rs10 then doing top + bottom we will give them 15,
             not 20." Shown only when both faces are on, because on a top-only
             row it is a box asking a question with no answer. Running foot
             only: per piece and lump sum price the piece or the row outright
             and have no per-face arithmetic to discount. */}
      {pairApplies && perFoot && (
        <div className="rounded-md border border-teal-200 bg-teal-50/60 px-2.5 py-2 flex flex-wrap items-center gap-2">
          <label className="text-[10px] font-medium text-teal-800">
            Top and bottom together, &#8377; per foot
          </label>
          <div className="flex items-center gap-1">
            <span className="text-teal-600 text-xs">&#8377;</span>
            <MoneyInput
              value={terms.pairRate}
              onCommit={(n) => set({ pairRate: n })}
              placeholder={priced.pairEffectiveRate !== null ? String(priced.pairEffectiveRate) : "both"}
              disabled={disabled} tone="pair" width="w-20"
              ariaLabel="Rupees per foot for a side polished on both faces"
            />
          </div>
          <span className="text-[10px] text-teal-800/80 flex-1 min-w-[12rem] leading-snug">
            {terms.pairRate === null ? (
              <>
                Empty = the two rates added
                {priced.pairEffectiveRate !== null && (
                  <>, <strong className="tabular-nums">{formatRupees(priced.pairEffectiveRate)}</strong> a foot</>
                )}
                . One figure here quotes the pair instead of the sum.
              </>
            ) : (
              <>
                <strong className="tabular-nums">{priced.pairedFeet} ft</strong> shared, charged{" "}
                <strong>once</strong> at this rate — a side polished top and bottom is one
                trip with the piece flipped.
              </>
            )}
          </span>
        </div>
      )}

      {/* ── EVERYTHING UNUSUAL, FOLDED AWAY ─────────────────────────────────
             The mode buttons, the row-wide default rate and the phone-call
             total. All three were on screen at all times and all three are for
             the exception, which is what made the card read as clutter. */}
      <div>
        <button
          type="button"
          onClick={() => setAsked((a) => !a)}
          aria-expanded={showMore}
          className="text-[10px] font-medium text-slate-400 hover:text-indigo-700 transition"
        >
          {showMore ? "▾" : "▸"} Other terms — per piece, lump sum, one rate for every face, an agreed total
          {offDefault && (
            <span className="ml-1.5 text-indigo-600 font-semibold">
              {!perFoot ? describePricingMode(mode).label
                : terms.totalOverride !== null ? "agreed total"
                : "row rate set"}
            </span>
          )}
        </button>

        {showMore && (
          <div className="mt-1.5 rounded-lg border border-slate-200 bg-white p-2.5 flex flex-col gap-2.5">
            {/* 1 · how is it charged */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-0.5">
                Charged
              </span>
              {PRICING_MODES.map((m: PricingMode) => (
                <button
                  key={m} type="button" disabled={disabled}
                  onClick={() => set({ pricingMode: m })}
                  aria-pressed={m === mode}
                  className={`text-[11px] font-medium rounded border px-2 py-0.5 transition disabled:opacity-50 ${
                    m === mode
                      ? "bg-slate-800 border-slate-800 text-white"
                      : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {describePricingMode(m).label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-4">
              {/* 2 · THE FALLBACK, NAMED AS ONE. Under running foot this is
                     what a face left empty inherits — never a second price for
                     work a face box has already quoted. Shown only when some
                     chosen face is actually empty; under per piece and lump sum
                     it is the only rate there is. */}
              {showRowRate && (
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-medium text-slate-500">
                  {perFoot
                    ? <>Any face left empty, ₹ per foot</>
                    : describePricingMode(mode).rateLabel}
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-slate-400 text-xs">&#8377;</span>
                  <MoneyInput
                    value={terms.rate}
                    onCommit={(n) => set({ rate: n })}
                    placeholder={
                      mode === "LUMP_SUM" ? "enter"
                      : cardRate !== null ? String(cardRate)
                      : "no card rate"
                    }
                    disabled={disabled} tone="set"
                    ariaLabel={describePricingMode(mode).rateLabel}
                  />
                </div>
                <span className={`text-[10px] ${
                  perFoot && terms.rate === 0 ? "text-amber-700 font-semibold" : "text-slate-400"
                }`}>
                  {mode === "LUMP_SUM" ? "one figure for the whole row"
                    : terms.rate === null
                      ? cardRate !== null ? `empty = the card, ₹${cardRate}` : "this stone is not on the card"
                      // ZERO IS SAID OUT LOUD, because it is the one stored
                      // value that looks like "nothing set" and is not. An
                      // empty box means the card rate; a typed 0 means the work
                      // is free, and an empty face inherits it. That is a real
                      // decision and it should look like one.
                      : perFoot && terms.rate === 0
                        ? "₹0 — an empty face is priced FREE. Clear the box to use the card instead."
                        : "the fallback — a face with its own rate still wins"}
                </span>
              </div>
              )}

              {/* 3 · the phone-call number */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-medium text-slate-500">Or a total agreed</label>
                <div className="flex items-center gap-1">
                  <span className="text-slate-400 text-xs">&#8377;</span>
                  <MoneyInput
                    value={terms.totalOverride}
                    onCommit={(n) => set({ totalOverride: n })}
                    placeholder="calculated"
                    disabled={disabled} tone="agreed" width="w-28"
                    ariaLabel="An agreed total for this row's hand polish"
                  />
                </div>
                {/* THE CALCULATION STAYS ON SCREEN, struck through beside the
                    figure that beat it. An override nobody can see past is how
                    a wrong rate card survives a year. */}
                <span className="text-[10px] text-slate-400">
                  {terms.totalOverride !== null ? (
                    <>replaces <span className="line-through tabular-nums">{formatRupees(priced.calculatedEdgeCost)}</span></>
                  ) : "empty = use the calculation"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
