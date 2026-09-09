"use client";

// WHAT THIS POLISH COSTS — the three modes, the rate, and the phone-call number.
//
// The owner, on why one rate card cannot serve:
//
//   "Price is not fixed on common, so each time it should be asked how much."
//   "Some will be priced on number of piece — one piece this is the price."
//   "Pricing differs and changeable and vary for each project."
//   "Always have a custom free field for total, so when system feels heavy they
//    call and enter the amount."
//
// So three controls, in the order the question is actually asked:
//
//   1. HOW is it charged   per running foot / per piece / one lump sum
//   2. HOW MUCH            the rate, in whatever unit step 1 implies
//   3. OR JUST THIS        an agreed total that replaces the calculation
//
// ─────────────────────── THE RATE BOX IS EMPTY BY DEFAULT, ON PURPOSE ───────
// Empty means "use the rate card" — Rs15 at 2 cm, Rs20 at 3 cm — which is what
// every ordinary row should do and what every row already written does. The
// placeholder shows the card figure so it is obvious what empty means, and
// nobody has to type a rate unless the job is unusual.
//
// EMPTY IS NOT ZERO, and the box makes that visible because the difference is
// money: zero is a row genuinely not being charged for edge work, empty is the
// standing rate. (The same distinction bit the pricing module itself once —
// `Number(null)` is 0, and reading absent as zero would have priced every row
// in the database at nothing.)
//
// ─────────────────────── AND THE OVERRIDE SHOWS ITS WORKING ─────────────────
// When a total is typed, the calculated figure stays on screen beside it,
// struck through. An override nobody can see past is how a wrong rate card
// survives a year — the point is to WIN the argument on this invoice, not to
// erase what the system thought.

import { useId } from "react";
import { MoneyInput } from "@/components/fab/MoneyInput";
import {
  PRICING_MODES, parsePricingMode, describePricingMode, formatRupees,
  type PricingMode,
} from "@/lib/fab/pricing";

export interface PolishTermsValue {
  /** RUNNING_FOOT / PER_PIECE / LUMP_SUM. Null means RUNNING_FOOT. */
  pricingMode: string | null;
  /** Rupees, in the unit the mode implies. NULL = fall back to the rate card. */
  rate: number | null;
  /** An agreed figure replacing the calculation outright. NULL = calculate. */
  totalOverride: number | null;
  /** scripts/0069 — rupees per foot for a side done on BOTH faces, replacing
   *  two passes at `rate`. NULL = no discount, the two faces are summed. */
  pairRate: number | null;
  /** scripts/0070 — each face's OWN rupees per foot. NULL falls back to `rate`,
   *  which falls back to the card, so empty prices exactly as before 0070. */
  rateTop: number | null;
  rateBottom: number | null;
  rateSide: number | null;
}

/* readMoney moved to components/fab/MoneyInput.tsx along with the boxes that
 * used it. The reason is in that file: these were controlled inputs wired
 * straight to onChange, and every caller answered onChange by SAVING — so
 * typing "10" wrote Rs1 and then Rs10, two requests to one column, and the
 * first of them was a complete and perfectly valid price. */

/**
 * ONE FACE'S OWN RATE — scripts/0070.
 *
 * The owner: "bottom edge have diff price sometime, top have diff price
 * sometime and side have different price sometime."
 *
 * EMPTY IS NOT ZERO. Empty means this face falls back to the row's rate, and
 * that to the card — which is what every row does today and what an ordinary
 * row should keep doing with nobody typing anything. The placeholder shows the
 * figure it would fall back to, so "empty" is legible rather than mysterious.
 */
function FaceRate({
  label, value, fallback, onChange, disabled, hint,
}: {
  label: string;
  value: number | null;
  /** What this face costs when the box is left empty. */
  fallback: number | null;
  onChange: (n: number | null) => void;
  disabled: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="text-[10px] font-medium text-slate-500">{label}</label>
      <div className="flex items-center gap-1">
        <span className="text-slate-400 text-xs">₹</span>
        {/* THE PLACEHOLDER IS NOT THE FALLBACK NUMBER.
            It used to be, and that echoed the SAME figure into all three boxes
            in grey: typing Rs2 in the rate above made Top, Bottom and Side all
            read "2", indistinguishable from three typed values. It read as one
            price linked to all three, which is exactly what it was reported as.
            The fallback is said in words underneath instead, where it cannot be
            mistaken for this face's own answer. */}
        <MoneyInput
          id={id}
          disabled={disabled}
          value={value}
          onCommit={onChange}
          placeholder="—"
          width="w-20"
          tone="set"
          ariaLabel={label}
        />
      </div>
      <span className={`text-[10px] ${value === null ? "text-slate-400" : "text-indigo-600 font-semibold"}`}>
        {hint ?? (value === null
          ? (fallback !== null ? `empty · ₹${fallback}` : "empty · no rate")
          : "this face only")}
      </span>
    </div>
  );
}

export function PolishTerms({
  value, onChange, cardRate, calculated, disabled = false, compact = false,
  pairApplies = false, pairedFeet = 0, singleFeet = 0,
  facesOn = { top: false, bottom: false, side: false },
}: {
  value: PolishTermsValue;
  onChange: (next: PolishTermsValue) => void;
  /** scripts/0069 — TOP AND BOTTOM ARE BOTH SELECTED, so the unified box is
   *  shown. The owner: "when choosen top + bottom show them one unified price
   *  for both." It appears only then, because on a top-only row it would be a
   *  box asking a question that has no answer. */
  pairApplies?: boolean;
  /** scripts/0070 — WHICH FACES ARE ACTUALLY SELECTED. A rate box is shown for
   *  a face only when that face has sides picked: a box for work nobody chose
   *  is a question with no answer, and on a forty-row order it is forty of
   *  them. The owner: "bottom edge have diff price sometime, top have diff
   *  price sometime and side have different price sometime." */
  facesOn?: { top: boolean; bottom: boolean; side: boolean };
  /** Feet of edge done on both faces, COUNTED ONCE — what the pair rate
   *  multiplies. Shown so the figure can be checked against the drawing. */
  pairedFeet?: number;
  /** Feet at the ordinary rate: one face only, plus the side band. */
  singleFeet?: number;
  /** The rate card figure for this row's stone, shown as the placeholder so
   *  "empty" is legible. Null when the thickness is not on the card at all —
   *  in which case a rate MUST be typed, and the box says so. */
  cardRate: number | null;
  /** What the system worked out, shown beside an override. */
  calculated: number;
  disabled?: boolean;
  compact?: boolean;
}) {
  const mode = parsePricingMode(value.pricingMode);
  const { rateLabel } = describePricingMode(mode);
  const rateId = useId();
  const overrideId = useId();
  const pairId = useId();
  const overridden = value.totalOverride !== null;

  const set = (patch: Partial<PolishTermsValue>) => onChange({ ...value, ...patch });

  return (
    <div className={`flex flex-col gap-2 ${compact ? "" : "rounded-lg border border-slate-200 bg-white p-2.5"}`}>
      {/* ---- 1 · how is it charged ---- */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-0.5">
          Charged
        </span>
        {PRICING_MODES.map((m: PricingMode) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
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

      {/* ---- 2 · how much ---- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-0.5">
          <label htmlFor={rateId} className="text-[10px] font-medium text-slate-500">
            {rateLabel}
            {/* SAID OUT LOUD once the per-face boxes are on screen: this one is
                the DEFAULT the empty ones fall back to, not a fourth face. */}
            {mode === "RUNNING_FOOT" && (facesOn.top || facesOn.bottom || facesOn.side) && (
              <span className="text-slate-400 font-normal"> · all faces</span>
            )}
          </label>
          <div className="flex items-center gap-1">
            <span className="text-slate-400 text-xs">₹</span>
            <MoneyInput
              id={rateId}
              disabled={disabled}
              value={value.rate}
              onCommit={(n) => set({ rate: n })}
              placeholder={
                mode === "LUMP_SUM" ? "enter"
                : cardRate !== null ? String(cardRate)
                : "no card rate"
              }
              tone="set"
              ariaLabel={rateLabel}
            />
          </div>
          <span className="text-[10px] text-slate-400">
            {mode === "LUMP_SUM"
              ? "one figure for the whole row"
              : value.rate === null
                ? cardRate !== null
                  ? `empty = the card, ₹${cardRate}`
                  : "this stone is not on the card — a rate is needed"
                : "this row's own rate"}
          </span>
        </div>

        {/* ---- 3 · or just this ---- */}
        <div className="flex flex-col gap-0.5">
          <label htmlFor={overrideId} className="text-[10px] font-medium text-slate-500">
            Or a total agreed
          </label>
          <div className="flex items-center gap-1">
            <span className="text-slate-400 text-xs">₹</span>
            <MoneyInput
              id={overrideId}
              disabled={disabled}
              value={value.totalOverride}
              onCommit={(n) => set({ totalOverride: n })}
              placeholder="calculated"
              width="w-28"
              tone="agreed"
              ariaLabel="An agreed total for this row's hand polish"
            />
          </div>
          {/* THE CALCULATION STAYS ON SCREEN. Struck through, beside the figure
              that beat it — so the disagreement is visible and somebody can ask
              why, which is the entire value of keeping it. */}
          <span className="text-[10px] text-slate-400">
            {overridden ? (
              <>
                replaces{" "}
                <span className="line-through tabular-nums">{formatRupees(calculated)}</span>
              </>
            ) : (
              "empty = use the calculation"
            )}
          </span>
        </div>
      </div>

      {/* ---- 3b · A RATE PER FACE — scripts/0070 --------------------------
          "Bottom edge have diff price sometime, top have diff price sometime
          and side have different price sometime."

          A box appears only for a face that actually has sides picked. Each is
          EMPTY BY DEFAULT and falls back to the rate above, so an ordinary row
          still needs no typing — and a row where the underside is cheaper says
          so in one number rather than being forced through the agreed-total
          escape hatch.

          RUNNING FOOT ONLY, like the pair rate: per piece and lump sum price
          the piece or the row outright and have no per-face arithmetic. */}
      {mode === "RUNNING_FOOT" && (facesOn.top || facesOn.bottom || facesOn.side) && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-slate-50/60 px-2.5 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 self-center">
            Per face
          </span>
          {facesOn.top && (
            <FaceRate label="Top" value={value.rateTop} fallback={value.rate ?? cardRate}
              onChange={(n) => set({ rateTop: n })} disabled={disabled} />
          )}
          {facesOn.bottom && (
            <FaceRate label="Bottom" value={value.rateBottom} fallback={value.rate ?? cardRate}
              onChange={(n) => set({ rateBottom: n })} disabled={disabled} />
          )}
          {facesOn.side && (
            <FaceRate label="Side band" value={value.rateSide} fallback={value.rate ?? cardRate}
              onChange={(n) => set({ rateSide: n })} disabled={disabled}
              hint={value.rateSide === null ? "same as above" : "own rate"} />
          )}
          <p className="text-[10px] text-slate-400 leading-snug flex-1 min-w-[10rem] self-center">
            Empty = the rate above. The side band is its own pass over the
            vertical face and never shares a price with a flat face unless both
            are left empty.
          </p>
        </div>
      )}

      {/* ---- 4 · TOP AND BOTTOM TOGETHER — scripts/0069 -------------------
          The owner: "sometime when choosen top and bottom both they get a price
          — if per feet 10 rs then doing top + bottom we will give them 15 not
          20." And on how to show it: "when choosen top + bottom show them one
          unified price for both."

          SHOWN ONLY WHEN BOTH FACES ARE ON, because on a top-only row it is a
          box asking a question with no answer, and on a forty-row purchase
          order that is forty pieces of noise.

          RUNNING FOOT ONLY. A rate per foot means nothing under per piece or
          lump sum, which price the piece or the row outright — priceRow ignores
          it there, so showing it would be a control that does nothing. */}
      {pairApplies && mode === "RUNNING_FOOT" && (
        <div className="rounded-md border border-teal-200 bg-teal-50/60 px-2.5 py-2">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-0.5">
              <label htmlFor={pairId} className="text-[10px] font-medium text-teal-800">
                Top and bottom together, ₹ per foot
              </label>
              <div className="flex items-center gap-1">
                <span className="text-teal-600 text-xs">₹</span>
                <MoneyInput
                  id={pairId}
                  disabled={disabled}
                  value={value.pairRate}
                  onCommit={(n) => set({ pairRate: n })}
                  placeholder={value.rate !== null ? String(value.rate * 2) : "both faces"}
                  tone="pair"
                  ariaLabel="Rupees per foot for a side polished on both faces"
                />
              </div>
            </div>

            {/* THE WORKING, so nobody has to trust the box. A side done on both
                faces is ONE side of stone and TWO passes over it; the pair rate
                is quoted against the side, not against the passes. */}
            <p className="text-[10px] text-teal-800/80 leading-snug flex-1 min-w-[12rem]">
              {value.pairRate === null ? (
                <>
                  Empty = a shared side costs{" "}
                  <strong className="tabular-nums">
                    {formatRupees((value.rateTop ?? value.rate ?? cardRate ?? 0)
                                + (value.rateBottom ?? value.rate ?? cardRate ?? 0))}
                  </strong>{" "}
                  a foot — the top and bottom rates added. Type one figure here
                  to quote the pair instead of the sum.
                </>
              ) : (
                <>
                  <strong className="tabular-nums">{pairedFeet} ft</strong> done on both
                  faces at <strong className="tabular-nums">{formatRupees(value.pairRate)}</strong>
                  {singleFeet > 0 && (
                    <>
                      {" "}· <strong className="tabular-nums">{singleFeet} ft</strong> on one
                      face at the ordinary rate
                    </>
                  )}
                  . The paired feet are counted <strong>once</strong> — a side polished
                  top and bottom is one trip with the piece flipped.
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
