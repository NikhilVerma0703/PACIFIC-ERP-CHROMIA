"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToDowntime, disputeDowntime, addDowntimePhoto, type RespondRes } from "@/app/mis/actions";
import { DELAY_FIELDS, DELAY_LABEL, fmtDur } from "@/lib/downtimeShared";
import { ReclassifyDelay } from "@/components/ReclassifyDelay";
import type { ReclassRecord } from "@/lib/delayReclass";

const STATUSES = ["Pending", "Attended", "Resolved", "Not required"];
const TONE: Record<string, string> = {
  Resolved: "bg-green-100 text-green-700",
  Attended: "bg-blue-100 text-blue-700",
  Pending: "bg-amber-100 text-amber-700",
  "Not required": "bg-gray-100 text-gray-500",
};

export interface RespondProps {
  misId: string;
  canRespond: boolean;
  status: string | null;
  note: string | null;
  by: string | null;
  at: string | null;
  /** Dispute: maintenance's own duration for one delay type, or null. */
  dispType: string | null;
  dispMinutes: number | null;
  dispBy: string | null;
  dispAt: string | null;
  /** Production's logged minutes per type, to compare the dispute against — and, for
   *  the reclassification below, the hour the move is planned against. */
  minutesByType: Record<string, number>;
  photos: { id: string; filename: string }[];
  /** Applied delay-type corrections on this hour, oldest first. Empty for almost every
   *  row; non-empty means the figures beside it are maintenance's, not production's. */
  reclass: readonly ReclassRecord[];
  /** Separate from canRespond on purpose. A response and a reclassification are gated
   *  on the same role but fail independently: responding is withheld when the SAVED
   *  RESPONSES could not be read (a blind overwrite), correcting is withheld when the
   *  RECLASS LOG could not be read (a second move stacked on an invisible first). */
  canReclass: boolean;
}

export function DowntimeRespond({ misId, canRespond, status, note, by, at, dispType, dispMinutes, dispBy, dispAt, minutesByType, photos, reclass, canReclass }: RespondProps) {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState(status || "Pending");
  const [nt, setNt] = useState(note || "");
  // Dispute form state. Blank minutes = no dispute (or, on save, withdraw an existing one).
  // dDirty: the dispute is only written when the user actually touched these inputs.
  // Without it, a manager whose page predates a COLLEAGUE's dispute would silently
  // withdraw it by saving an unrelated note edit (their box initialised empty).
  const [dTypeSel, setDTypeSel] = useState(dispType || "breakdown");
  const [dMin, setDMin] = useState(dispMinutes != null ? String(dispMinutes) : "");
  const [dDirty, setDDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  // reclass.length counts here even though nothing in this component's own form wrote
  // it: a corrected hour must never render as an empty cell to a reader who cannot
  // write, or the one row on the page whose figures were changed by hand is the one
  // row that says nothing at all.
  const hasAnything = !!status || dispMinutes != null || photos.length > 0 || reclass.length > 0;
  if (!canRespond && !canReclass && !hasAnything) return <span className="text-gray-300">—</span>;

  // The dispute is resolved by PRODUCTION correcting their own entry, so "resolved" is
  // not a stored state — it is the live comparison coming back equal.
  const logged = dispType ? (minutesByType[dispType] ?? 0) : null;
  const agreesNow = dispMinutes != null && logged !== null && Math.round(logged) === Math.round(dispMinutes);

  const save = () => start(async () => {
    // Sequential, first failure reports and stops: each step is independently retryable,
    // and each runs ONLY when its inputs changed — a photo-only save must not rewrite
    // status/note, because the upsert reattributes "Responded by" to the last writer.
    const done: string[] = [];
    if (st !== (status || "Pending") || nt !== (note || "")) {
      const r1: RespondRes = await respondToDowntime(misId, st, nt);
      if (!r1.ok) { setMsg(done.length ? `${done.join(", ")} saved — then: ${r1.message}` : r1.message); return; }
      done.push("response");
    }

    const want = dMin.trim() === "" ? null : Number(dMin);
    const had = dispMinutes != null;
    const changed = dDirty && ((want === null && had) || (want !== null && (want !== dispMinutes || dTypeSel !== dispType)));
    if (changed) {
      const r2 = await disputeDowntime(misId, want === null ? null : dTypeSel, want);
      if (!r2.ok) { setMsg(done.length ? `${done.join(", ")} saved — then: ${r2.message}` : r2.message); return; }
      done.push("dispute");
    }

    const f = fileRef.current?.files?.[0];
    if (f) {
      const fd = new FormData();
      fd.set("misId", misId);
      fd.set("photo", f);
      const r3 = await addDowntimePhoto(fd);
      if (!r3.ok) { setMsg(done.length ? `${done.join(", ")} saved — then: ${r3.message}` : r3.message); return; }
    }

    setMsg("");
    setOpen(false);
    router.refresh();
  });

  return (
    <div className="space-y-1">
      {status && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE[status] ?? "bg-gray-100 text-gray-600"}`}>{status}</span>
          {note && <span className="text-gray-600">{note}</span>}
        </div>
      )}
      {status && (by || at) && <div className="text-[11px] text-gray-400">{by ?? "—"}{at ? ` · ${at}` : ""}</div>}

      {/* The disagreement, always visible once recorded. Production's figure stays the
          figure everywhere numbers are summed; this line is the named counter-claim. */}
      {dispMinutes != null && (
        agreesNow ? (
          <div className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] text-green-700">
            ✓ Duration agreed — {DELAY_LABEL[dispType ?? ""] ?? dispType} now logged {fmtDur(logged ?? 0)}
          </div>
        ) : (
          <div className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
            ⚠ Maintenance says {(DELAY_LABEL[dispType ?? ""] ?? dispType ?? "").toLowerCase()} was{" "}
            <span className="font-semibold">{fmtDur(dispMinutes)}</span> — logged {fmtDur(logged ?? 0)}
            <span className="text-amber-600">{dispBy ? ` · ${dispBy}` : ""}{dispAt ? ` · ${dispAt}` : ""}</span>
          </div>
        )
      )}

      {/* The second, stronger action, deliberately next to the first: same person, same
          job, one screen. The dispute above says "we disagree about the duration" and
          leaves the MIS row alone; this says "those minutes are in the wrong bucket"
          and moves them. Violet, never the dispute's amber — an applied correction must
          not read as an open argument. */}
      <ReclassifyDelay misId={misId} canReclass={canReclass} minutesByType={minutesByType} records={reclass} />

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {photos.map((p) => (
            <a key={p.id} href={`/api/photo?id=${encodeURIComponent(p.id)}`} target="_blank" rel="noreferrer"
               className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-200" title={p.filename}>
              📷 photo
            </a>
          ))}
        </div>
      )}

      {canRespond && !open && (
        <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-medium text-brand hover:underline">{hasAnything ? "Edit" : "Respond"}</button>
      )}
      {canRespond && open && (
        <div className="mt-1 space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2">
          <select value={st} onChange={(e) => setSt(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1 text-xs">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <textarea value={nt} onChange={(e) => setNt(e.target.value)} rows={2} placeholder="What did maintenance do?" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />

          {/* Disagree with the logged duration: pick the type, give your minutes. This is
              recorded beside production's figure — it does not change their entry. */}
          <div className="rounded border border-amber-200 bg-amber-50/60 p-1.5">
            <div className="mb-1 text-[11px] font-medium text-amber-800">Disagree with a logged duration?</div>
            <div className="flex items-center gap-1.5">
              <select value={dTypeSel} onChange={(e) => { setDTypeSel(e.target.value); setDDirty(true); }} className="rounded border border-gray-300 px-1.5 py-1 text-xs">
                {DELAY_FIELDS.map((d) => (
                  <option key={d.key} value={d.key}>{d.label} · logged {fmtDur(minutesByType[d.key] ?? 0)}</option>
                ))}
              </select>
              <input
                type="number" min={0} max={1440} step={1} value={dMin} onChange={(e) => { setDMin(e.target.value); setDDirty(true); }}
                placeholder="min" className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs"
              />
              {dispMinutes != null && (
                <button type="button" onClick={() => { setDMin(""); setDDirty(true); }} className="text-[11px] text-gray-500 hover:underline" title="Save with the box empty to withdraw the dispute">clear</button>
              )}
            </div>
            <div className="mt-1 text-[10px] text-amber-700">
              Recorded next to production&apos;s figure.
              {dDirty && dispMinutes != null && dMin.trim() === "" && " Saving now withdraws the dispute."}
            </div>
          </div>

          <input ref={fileRef} type="file" accept="image/*" className="block w-full text-[11px] text-gray-600 file:mr-2 file:rounded file:border-0 file:bg-gray-200 file:px-2 file:py-1 file:text-[11px]" />

          <div className="flex items-center gap-2">
            <button type="button" disabled={pending} onClick={save} className="rounded bg-brand px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => { setOpen(false); setMsg(""); }} className="text-[11px] text-gray-500 hover:underline">Cancel</button>
            {msg && <span className="text-[11px] text-red-600">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
