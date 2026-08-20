"use client";

import { useState } from "react";
import { postJson } from "@/lib/fab/postJson";
import { REJECT_REASONS } from "@/lib/fab/rejectPiece";
import type { FabProcessType } from "@/lib/fab/processSession";

export function RejectPieceButton({
  pieceId,
  processType,
  onDone,
  onError,
}: {
  pieceId: string;
  processType: FabProcessType;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    const r = await postJson("/api/fab/queues/reject", {
      pieceId, processType, reason, notes,
    });
    setSaving(false);
    if (!r.ok) { onError(r.error ?? "Could not reject."); return; }
    setOpen(false);
    setReason("");
    setNotes("");
    onDone();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="text-xs font-semibold text-red-600 hover:text-red-800 px-2 py-1.5 rounded-lg hover:bg-red-50">
        Reject
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900">Reject piece</h2>
            <p className="text-sm text-gray-500 mt-1">
              The piece stays on record. One qty goes back to Slab &amp; Sink Assignment
              so it can be allocated again. The slab is not reopened.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {REJECT_REASONS.map(r => (
                <button key={r.id} type="button" onClick={() => setReason(r.id)}
                  className={`text-sm py-2 rounded-lg border ${
                    reason === r.id
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="mt-3 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setOpen(false)}
                className="text-sm text-gray-500 px-3 py-2">Cancel</button>
              <button type="button" disabled={!reason || saving} onClick={submit}
                className="text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg">
                {saving ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
