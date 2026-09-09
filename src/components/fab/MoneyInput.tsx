"use client";

// A RUPEE BOX THAT SAVES WHEN YOU HAVE FINISHED TYPING, NOT WHILE YOU TYPE.
//
// The owner, on the hand-polish card: "whenever I enter a number like 10, on
// entering 1 it refreshed. No, it should not be happening. It's a bad UX."
//
// He is describing exactly what the old boxes did. They were controlled inputs
// wired straight to onChange, and every caller answered onChange by POSTing the
// row. So typing "10" was two saves and two round trips:
//
//     keystroke "1"   ->  onChange(1)   ->  POST rate=1   ->  row re-renders
//     keystroke "0"   ->  onChange(10)  ->  POST rate=10  ->  row re-renders
//
// Three things went wrong with that, and all three are money:
//
//   THE FLICKER      the card re-rendered mid-number, and the caller disabled
//                    its inputs while saving, so the box he was typing into
//                    went grey and dropped focus under his hand.
//   A REAL Rs1 ROW   the first save is a COMPLETE, VALID answer. If he was
//                    interrupted, or the second request lost a race with the
//                    first, the row is quoted at Rs1 a foot and nothing says so.
//   TWO WRITERS      "150" is three POSTs to one column, and they can land out
//                    of order. The database's last word was not necessarily
//                    the last thing he typed.
//
// So this box keeps what is being typed to ITSELF and commits once, on blur or
// on Enter — the moment the number is actually finished. One keystroke is never
// a price.
//
// ─────────────────────── EMPTY IS NOT ZERO ──────────────────────────────────
// Kept from the boxes this replaces, because the distinction is money: empty
// means "use the standing rate" and zero means "this is not being charged for".
// readMoney returns null for empty and never falls through Number("") === 0.
//
// ─────────────────────── AND IT NEVER FIGHTS THE TYPIST ─────────────────────
// The draft resyncs from the prop only while the box is NOT focused. A poll
// landing behind him — the boards refresh on their own cycle — cannot reach in
// and rewrite half a number.

import { useEffect, useRef, useState } from "react";

/** Read a box into a number-or-null. EMPTY IS NULL — the standing rate — and
 *  never zero, which is a different and much cheaper answer. A half-typed "1."
 *  or a stray "-" is not a number and is treated as untouched. */
export function readMoney(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** What a value looks like in the box. Null is an empty box, not "0". */
function show(n: number | null): string {
  return n === null ? "" : String(n);
}

export function MoneyInput({
  value, onCommit, placeholder, disabled = false, id, className = "",
  ariaLabel, width = "w-24", tone = "plain",
}: {
  /** The SAVED value. Null is an empty box. */
  value: number | null;
  /** Called ONCE, when the number is finished — on blur, or on Enter. Never
   *  called with the value it already has, so a visit that changed nothing
   *  writes nothing. */
  onCommit: (next: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  ariaLabel?: string;
  width?: string;
  /** plain / set / agreed — a box holding a figure somebody typed should look
   *  unlike one falling back to the card, because "empty" is a decision. */
  tone?: "plain" | "set" | "agreed" | "pair";
}) {
  const [draft, setDraft] = useState(() => show(value));
  const focused = useRef(false);

  // FOLLOW THE SAVED VALUE, BUT NOT OVER THE TYPIST'S HANDS. The boards poll,
  // and "copy row above" writes this row from outside — both must show up here.
  // Neither may edit a number somebody is halfway through.
  useEffect(() => {
    if (!focused.current) setDraft(show(value));
  }, [value]);

  const commit = () => {
    const next = readMoney(draft);
    // Put the box back into canonical form ("10.50" -> "10.5", " " -> ""), so
    // what is on screen is what was saved.
    setDraft(show(next));
    if (next !== value) onCommit(next);
  };

  const skin = {
    plain:  "border-slate-200 focus:border-indigo-400",
    set:    "border-indigo-300 bg-indigo-50/60 text-indigo-900 focus:border-indigo-500",
    agreed: "border-violet-300 bg-violet-50 text-violet-900 focus:border-violet-400",
    pair:   "border-teal-300 bg-white text-teal-900 focus:border-teal-500",
  }[value !== null ? tone : "plain"];

  return (
    <input
      id={id}
      type="number" min={0} step="0.01" inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      value={draft}
      placeholder={placeholder}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          // Stays focused deliberately — Enter means "that's the number", not
          // "I'm done with this row", and he often tabs on to the next face.
        } else if (e.key === "Escape") {
          setDraft(show(value));
        }
      }}
      // THE WHEEL IS NOT A PRICE. A number input scrolls its value under the
      // cursor, so scrolling the card past a focused rate box silently changed
      // it. Nothing else on this screen edits money by accident either.
      onWheel={(e) => { if (focused.current) (e.target as HTMLInputElement).blur(); }}
      className={`${width} text-sm tabular-nums rounded border px-2 py-1 focus:outline-none disabled:opacity-50 ${skin} ${className}`}
    />
  );
}
