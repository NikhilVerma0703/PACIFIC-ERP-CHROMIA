"use client";

// SEND PIECES OFF THIS SLAB TO SAMPLE STOCK — the fabrication side of sampling
// intake, in one small collapsible control used twice on the supervisor's slab
// card.
//
// TWO PLACEMENTS, TWO REASONS, ONE ENDPOINT. The owner described the fab side
// twice and they are not the same decision:
//
//   SPECIAL_CUT  he picks a slab and sends it to cutting FOR SAMPLES instead of
//                putting PO pieces on it. That choice is made at the top of the
//                card, with the slab — so the control sits in step 1.
//   OFFCUT       a PO slab has been cut and usable pieces are left. Nobody can
//                know that before the cut, so the control sits at the FOOT of
//                the card, after step 4, and only once the slab has gone.
//
// offersReason() in lib/sampling/fabIntake.ts is what decides which of the two a
// given slab shows, and the two are mutually exclusive by physical fact: a slab
// that has not been sent has no leftovers, and one that has is no longer the
// supervisor's to redirect.
//
// WHY IT IS NOT A LINK TO /sampling. The Fabrication Supervisor may ADD sample
// stock and nothing else — not the inventory, not a dispatch — and his own
// FABRICATION branch block in middleware.ts refuses him every /sampling PAGE.
// That is the correct answer: the screens are not his. So the control lives
// under /fab and talks to /api/sampling/intake, which his branch block does
// allow and which samplingGate("addStock") admits him to by name.
//
// IT IS ADDITIVE AND NOTHING ELSE. It creates no cutting job, touches no
// allocation, and does not go near approve-slab's piece creation or the loss
// figure. It records pieces as sample stock with the slab number in
// source_ref — which is the whole bridge back to fabrication, there being no
// foreign key to fab_slab (see the note on SamplingIntake).

import { useState } from "react";
import { SampleIntakeForm, colourNamesOf, useSamplingPickLists } from "@/components/sampling/SampleIntakeForm";
import {
  INTAKE_SOURCE, REASON_LABEL, matchColourName, requireSlabSource, thicknessPrefill,
  type SampleIntakeReason,
} from "@/lib/sampling/fabIntake";

export type SamplingPickLists = ReturnType<typeof useSamplingPickLists>;

export function SampleCutControl({
  reason, slab, lists, onOpen, onSaved,
}: {
  reason: SampleIntakeReason;
  /** pacificQcId is the link back to the QC slab; slabCode is the same slab as
   *  the number a person reads (slab-assignment writes String(qc.slabNumber)
   *  into it). Both travel with the intake — see requireSlabSource. */
  slab: { id?: string | null; slabCode: string; colour: string | null; thicknessMm: number | null; pacificQcId?: string | null };
  /** Loaded ONCE for the whole board and handed down — a board with eight slab
   *  cards on it must not fetch the colour chart eight times. */
  lists: SamplingPickLists;
  /** Tells the board somebody wants the chart, so it can start loading it.
   *  Nothing is fetched until the first control is opened. */
  onOpen: () => void;
  onSaved?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const heading = reason === "SPECIAL_CUT"
    ? "Cut this slab for samples"
    : "Send the leftovers to samples";
  const explain = reason === "SPECIAL_CUT"
    ? "This slab is going to the saw for samples rather than for purchase-order pieces. Record what comes off it and it becomes sample stock against this slab number."
    : "The cut is done and there are usable pieces left over. Record them and they become sample stock against this slab number.";

  // Prefilled from the slab, and each prefill is a real answer rather than a
  // convenience:
  //   * the colour, only if the chart holds exactly one colour of that name —
  //     matchColourName refuses to guess, for the reason size.ts refuses a
  //     unitless thickness;
  //   * the thickness WITH ITS UNIT ("20 mm"), because parseThicknessMm rejects
  //     a bare number and a unitless prefill would look complete and fail;
  //   * the slab number, which is not a field here at all — it is the card this
  //     control is sitting inside.
  const colourHint = matchColourName(colourNamesOf(lists.series), slab.colour);

  // THE SLAB HAS TO BE IDENTIFIABLE BEFORE ANYTHING CAN BE RECORDED AGAINST IT.
  //
  // This used to be `slabSourceRef(slab) ?? ""` handed to a locked field, so a
  // slab with no number produced an intake nobody could trace back — and the
  // field being locked meant nobody could have corrected it either. The same
  // pure check now runs here and in the route, so the control refuses to open
  // rather than collecting a form it knows the server will reject.
  const src = requireSlabSource({ ...slab, slabId: slab.id });

  if (!src.ok) {
    return (
      <p className="text-[11px] italic text-gray-400">
        {heading} — unavailable: {src.reason}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => { onOpen(); setOpen(true); }}
        className="text-xs font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800">
        {heading}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/40 px-4 py-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-xs font-bold text-indigo-900">
            {heading} <span className="font-normal text-indigo-400">· {REASON_LABEL[reason]}</span>
          </h4>
          <p className="mt-0.5 text-[11px] text-indigo-700/70">{explain}</p>
        </div>
        <button onClick={() => setOpen(false)}
          className="shrink-0 text-[11px] text-indigo-400 underline underline-offset-2 hover:text-indigo-700">
          Close
        </button>
      </div>

      {lists.loading ? (
        <p className="py-4 text-center text-xs italic text-indigo-400">Loading the colour chart…</p>
      ) : (
        <SampleIntakeForm
          compact
          series={lists.series}
          sizes={lists.sizes}
          pickListError={lists.error}
          reloadSizes={lists.reloadSizes}
          source={INTAKE_SOURCE[reason]}
          reason={reason}
          sourceRef={src.sourceRef}
          sourceQcId={src.qcId}
          sourceSlabId={src.slabId}
          sourceRefLabel={`Slab number (source ref)`}
          lockSourceRef
          colourHint={colourHint}
          thicknessHint={thicknessPrefill(slab.thicknessMm)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
