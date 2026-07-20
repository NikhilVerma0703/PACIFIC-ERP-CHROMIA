"use client";
// The confirm step of confirm-and-split. Two clicks, like WrongBatchFix: the first
// fetches a dry-run preview (real numbers from the same plan the apply will use), the
// second writes — carrying the preview's fingerprint, so if the data moved in between
// the server refuses instead of writing something the user never saw. Until the second
// click, nothing has changed — the panel's promise holds.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MixSplitPreview } from "@/lib/mixerFifo";
import { previewMixSplitAction, confirmMixSplit } from "@/app/batch/mixSplitActions";

export function ConfirmMixSplit({ batch }: { batch: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<MixSplitPreview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const loadPreview = () => {
    if (pending) return;
    start(async () => {
      setMsg(null);
      setPreview(await previewMixSplitAction(batch));
    });
  };
  const run = () => {
    if (pending || !preview || !preview.ok) return;
    const fp = preview.fp;
    start(async () => {
      const r = await confirmMixSplit(batch, fp);
      setMsg(r.message);
      if (r.ok) { setDone(true); setPreview(null); router.refresh(); }
    });
  };

  if (done) return <p className="text-sm font-medium text-green-700">{msg}</p>;

  return (
    <div className="space-y-2 border-t border-amber-200/70 pt-3">
      {!preview && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={loadPreview} disabled={pending}
            className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50">
            {pending ? "Checking…" : "Confirm shared run & split the cycles…"}
          </button>
          {msg && <span className="text-sm text-red-700">{msg}</span>}
        </div>
      )}

      {preview && !preview.ok && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-amber-900">{preview.reason}</p>
          <button onClick={() => setPreview(null)} className="text-xs font-medium text-amber-800 underline">Dismiss</button>
        </div>
      )}

      {preview && preview.ok && (
        <div className="space-y-2">
          <p className="text-sm text-amber-900">
            This will walk <b>{preview.slabs} slabs</b> (slab-number order) through{" "}
            <b>{preview.cycles.assignable} cycles</b> (mixer start-time order) and stamp each line-head row
            with the cycle that fed it — {preview.crossLinked} slab(s) will draw from cycles stamped with the
            other batch. Weights: {preview.weights.fromPress} from press, {preview.weights.fallback} at the{" "}
            {Math.round(preview.weights.medianKg)} kg median.
            {preview.outliers > 0 && (
              <> <b>{preview.outliers} slab(s) sit far outside the run&apos;s slab numbers and will be left unlinked</b> — their numbers deserve a look.</>
            )}
            {preview.alreadyLinked > 0 && (
              <> <b>{preview.alreadyLinked} row(s) already carry a link and will be overwritten</b> (Undo restores them).</>
            )}{" "}
            Batches, weights and stations are untouched; Undo reverses the whole split.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={run} disabled={pending}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              {pending ? "Linking…" : `Yes — one mix fed ${preview.group.join(" + ")}, link the slabs`}
            </button>
            <button onClick={() => setPreview(null)} disabled={pending}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50">
              Cancel
            </button>
            {msg && <span className="text-sm text-red-700">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
