"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoLastRoboSlabDelete } from "./undoActions";

/**
 * "Restore last deleted slab" — admin only, and shown only when there is one.
 *
 * It names the slab rather than saying "undo". An undo button with no subject
 * is one an admin will not press, because they cannot tell what it is about to
 * bring back; and on a page whose whole risk is an accidental delete, a vague
 * control is worse than none.
 */
export function UndoDeleteButton({ summary, by, at }: { summary: string; by: string | null; at: string | null }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-amber-900">
          <b>{summary}</b>
          <span className="text-amber-700">
            {by ? ` · by ${by}` : ""}{at ? ` · ${new Date(at).toLocaleString()}` : ""}
          </span>
          <div className="text-[11px] text-amber-700">
            The slab and its delay logs were kept and can be put back exactly as they were.
          </div>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => {
            const r = await undoLastRoboSlabDelete();
            setMsg(r.message);
            if (r.ok) router.refresh();
          })}
          className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          {pending ? "Restoring…" : "Restore it"}
        </button>
      </div>
      {msg && <div className="mt-1 text-[11px] text-amber-900">{msg}</div>}
    </div>
  );
}
