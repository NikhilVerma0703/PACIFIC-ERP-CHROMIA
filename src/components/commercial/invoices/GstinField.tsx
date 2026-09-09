"use client";
// The registration dropdown and the ONE question it asks (round two, answer
// 19): choosing anything that is not the company's own registration asks
// "Apply this registration to every sheet of the export workbook?" once, at
// the moment of choosing, and the answer rides into the invoice snapshot as
// gstinApplyAll — where export-workbook/mapping.ts obeys it.
//
// The question is put on an EXPORT invoice only. A DTA invoice's paperwork is
// the one sheet and the delivery challan — there is no workbook for the answer
// to reach across, so asking there asks about sheets that will never exist.
// That invoice takes the unasked default (gstinScopeUnasked) instead.
//
// The dialog is rendered in the screen, not window.confirm(): a browser
// confirm cannot say what either answer means, cannot be read by the same
// styling as the rest of the form, and is blocked outright in some browsers.
// Escape and "Keep the current one" both leave the selection where it was, so
// closing the question is never itself an answer.
//
// One component for both places a registration is chosen — the new-invoice
// form on the order's Invoice tab and the draft's Registration card — so the
// question cannot end up worded two ways or asked in one place only.
import { useEffect, useRef, useState } from "react";
import {
  GSTIN_APPLY_ALL_QUESTION, GSTIN_APPLY_ALL_YES, GSTIN_APPLY_ALL_NO,
  gstinQuestionApplies, gstinScopeUnasked, gstinScopeNote, gstinWithLabel,
} from "@/lib/commercial/invoice-rules";
import { inp, lbl } from "./ui";
import type { GstinChoiceDto } from "./useInvoiceChoices";

export interface GstinFieldProps {
  id: string;
  label?: string;
  /** The invoice's kind. Only an EXPORT invoice has a workbook, so only there
   *  is the scope question worth putting — a DTA takes the unasked default. */
  kind: string;
  /** From the choices route; null while it is still loading. */
  choices: GstinChoiceDto[] | null;
  /** The chosen registration. "" means the company's own (the first choice). */
  value: string;
  applyAll: boolean;
  disabled?: boolean;
  /** A registration a snapshot carries that Settings no longer offers, kept on
   *  the list so an existing invoice does not silently re-point itself. */
  extra?: { gstin: string; label: string | null } | null;
  onChange: (gstin: string, applyAll: boolean) => void;
}

export function GstinField({ id, label = "Issued under GSTIN", kind, choices, value, applyAll, disabled, extra, onChange }: GstinFieldProps) {
  const [pending, setPending] = useState<string | null>(null);
  const yesRef = useRef<HTMLButtonElement | null>(null);

  const own = choices?.[0]?.gstin ?? "";
  const current = value || own;
  // A registration the invoice carries that Settings has since dropped is kept
  // on the list — but only once the real list has arrived, or the one stale
  // entry would be the whole dropdown while it loads.
  const stale = choices && extra && extra.gstin && !choices.some((c) => c.gstin === extra.gstin)
    ? [{ gstin: extra.gstin, label: extra.label ? `${extra.label} — no longer in Settings` : "no longer in Settings" }]
    : [];
  const options: Array<{ gstin: string; label: string }> = [...(choices ?? []), ...stale];
  const scope = gstinScopeNote(own, { gstin: current, gstinApplyAll: applyAll }, kind);

  // The question owns the keyboard while it is up: Escape leaves the choice
  // alone, and the focus starts on an answer so it cannot be missed.
  useEffect(() => { if (pending) yesRef.current?.focus(); }, [pending]);
  // Switching the new-invoice form to DTA while the question is up takes the
  // workbook away from under it. Close it the way Escape does — leaving the
  // selection where it was — rather than leave a question about sheets this
  // invoice will never print, or answer it on the clerk's behalf.
  useEffect(() => {
    if (pending && !gstinQuestionApplies(own, pending, kind)) setPending(null);
  }, [pending, own, kind]);

  const pick = (picked: string) => {
    // The company's own asks nothing — every sheet carries it either way — and
    // neither does a DTA invoice, which has no export workbook for the answer
    // to reach across (round two, answer 19). Both take the unasked default.
    if (gstinQuestionApplies(own, picked, kind)) setPending(picked);
    else onChange(picked, gstinScopeUnasked(own, picked));
  };
  const answer = (yes: boolean) => {
    if (pending) onChange(pending, yes);
    setPending(null);
  };

  return (
    <div>
      <label className={lbl} htmlFor={id}>{label}</label>
      <select
        id={id}
        className={inp}
        disabled={disabled || !choices}
        value={current}
        onChange={(e) => pick(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape" && pending) { e.preventDefault(); setPending(null); } }}
      >
        {options.length === 0 && <option value="">Loading…</option>}
        {options.map((c) => <option key={c.gstin} value={c.gstin}>{c.gstin} — {c.label}</option>)}
      </select>
      {scope && <p className="mt-1 text-xs text-gray-500">{scope}</p>}
      {pending && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={GSTIN_APPLY_ALL_QUESTION}
          className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3"
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setPending(null); } }}
        >
          <p className="text-sm font-medium text-amber-900">{GSTIN_APPLY_ALL_QUESTION}</p>
          <p className="mt-1 text-xs text-amber-800">
            {gstinWithLabel(pending, options.find((c) => c.gstin === pending)?.label ?? null)} is not the company&apos;s own
            registration. <strong>{GSTIN_APPLY_ALL_YES}</strong> puts it in the GSTIN cell of the packing list, the
            customer&apos;s copy and Annexure C1 as well. <strong>{GSTIN_APPLY_ALL_NO}</strong> leaves those three on the
            company&apos;s own and prints it on this invoice alone.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button ref={yesRef} type="button" className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-800" onClick={() => answer(true)}>{GSTIN_APPLY_ALL_YES}</button>
            <button type="button" className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-amber-100" onClick={() => answer(false)}>{GSTIN_APPLY_ALL_NO}</button>
            <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-amber-800 underline" onClick={() => setPending(null)}>Keep the current one</button>
          </div>
        </div>
      )}
    </div>
  );
}
