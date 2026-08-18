"use client";

import { useActionState } from "react";
import { awardDisputedSlabs } from "@/app/scoreboard/actions";
import type { Dispute } from "@/lib/shiftScore";

/**
 * One line per slab fight, with the ruling on it.
 *
 * The card used to state the problem and stop — "18 slab claims are disputed",
 * then leave an admin to work out whose they were. Nothing in the data can
 * settle it, but a person can, so the decision belongs on the card next to the
 * evidence: which slabs, who claimed them, and who was running each shift.
 */
export function DisputeRuling({ d }: { d: Dispute }) {
  const [msg, act, pending] = useActionState(awardDisputedSlabs, undefined);
  const err = msg && msg !== "ok" ? msg : null;
  const range = d.from === d.to ? `slab ${d.from}` : `slabs ${d.from}–${d.to}`;

  return (
    <div className="rounded-md border border-red-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span className="font-semibold text-red-900">{range}</span>
        <span className="text-red-500">({d.slabs.length} slab{d.slabs.length === 1 ? "" : "s"})</span>
        <span className="text-gray-500">claimed by</span>
        {d.claimants.map((c) => (
          <span key={c.anchor + c.shift} className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
            {c.label}{c.incharge ? ` · ${c.incharge}` : ""}
          </span>
        ))}
      </div>

      <form action={act} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="slabs" value={d.slabs.join(",")} />
        <label className="text-xs text-gray-600">
          These slabs belong to
          <select
            name="winner"
            defaultValue={d.awardedTo ?? ""}
            className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="">— nobody (excluded from both)</option>
            {d.claimants.map((c) => (
              <option key={c.anchor + c.shift} value={`${c.anchor}${c.shift}`}>
                {c.label}{c.incharge ? ` · ${c.incharge}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Saving…" : "Award"}
        </button>
        {d.awardedTo && (
          <span className="text-xs text-green-700">
            Awarded to {d.claimants.find((c) => `${c.anchor}${c.shift}` === d.awardedTo)?.label ?? d.awardedTo}
            {d.awardedBy ? ` by ${d.awardedBy}` : ""} — they score, the other shift does not.
          </span>
        )}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </form>
    </div>
  );
}
