"use client";
// The picker behind "Swap" (answer 30): a refused slab on a verified or final
// list is replaced by one of the same design and thickness. Design and
// thickness are FIXED here — they are the refused slab's — because a swap is a
// like-for-like the customer never sees on the invoice; a different colour or a
// 2 cm for a 3 cm is a new order line, not a swap. The server offers only what
// it would accept (GET …/slabs/swap?slabId=) and re-checks on POST, so the list
// shown is never longer than the list allowed.
//
// Used from the dispatch-check screen (a floor screen — big rows) and from the
// packing-list editor, so it is sized for a thumb and reads without a table.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { postJson } from "@/lib/fab/postJson";
import { fmtSlabNo } from "@/lib/commercial/packing-rules";

interface Candidate {
  slabNumber: number; batch: string; grade: string | null; status: string;
  heldUnder: string | null; lengthIn: number; widthIn: number; bay: string | null; frame: string | null;
}
interface Offer {
  refused: { id: string; slabNumber: number; design: string | null; thickness: string | null; unfitReason: string | null };
  candidates: Candidate[];
  truncated: boolean;
}
export interface SwapResult { refused: number; replacement: number; reheld: boolean; skipped: Array<{ slab: number; reason: string }> }

const btn = "rounded-xl px-5 py-3 text-base font-semibold transition disabled:opacity-50";

export function SwapSlabPicker({ plId, slabId, onDone, onCancel }: {
  plId: string;
  slabId: string;
  /** Called after a successful swap with a sentence for the screen's note box. */
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await readJson<Offer>(await fetch(`/api/office/commercial/packing-lists/${plId}/slabs/swap?slabId=${encodeURIComponent(slabId)}`, { cache: "no-store" }));
    if (!res.ok) { setError(res.error ?? "Could not look for a replacement"); return; }
    setError(null); setOffer(res.data);
  }, [plId, slabId]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = offer?.candidates ?? [];
    if (!q) return all;
    return all.filter((c) => String(c.slabNumber).includes(q) || c.batch.toLowerCase().includes(q) || (c.grade ?? "").toLowerCase().includes(q));
  }, [offer, filter]);

  async function swap() {
    if (picked === null || !offer) return;
    setBusy(true); setError(null);
    const r = await postJson(`/api/office/commercial/packing-lists/${plId}/slabs/swap`, { slabId, replacementSlabNumber: picked });
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Nothing was swapped"); return; }
    const d = (r.data ?? {}) as Partial<SwapResult>;
    const stranded = d.skipped?.length ? ` ${d.skipped.map((s) => `#${fmtSlabNo(s.slab)}: ${s.reason}`).join("; ")}` : "";
    onDone(`Slab #${fmtSlabNo(offer.refused.slabNumber)} swapped for #${fmtSlabNo(picked)}${d.reheld ? " (the refused slab is back on its hold)" : " (the refused slab is back in stock)"}. The new slab awaits the dispatch check.${stranded}`);
  }

  if (error && !offer) {
    return (
      <div className="mt-4 rounded-xl border border-red-200 bg-white p-4">
        <div className="text-base text-red-700">{error}</div>
        <button type="button" className={`${btn} mt-3 border border-gray-300 text-gray-700 hover:bg-gray-50`} onClick={onCancel}>Close</button>
      </div>
    );
  }
  if (!offer) return <div className="mt-4"><Empty>Looking for slabs of the same design and thickness…</Empty></div>;

  return (
    <div className="mt-4 rounded-xl border border-brand/30 bg-white p-4">
      <p className="text-base font-medium text-gray-800">
        Replace #{fmtSlabNo(offer.refused.slabNumber)} with another {offer.refused.design ?? "slab"}{offer.refused.thickness ? ` · ${offer.refused.thickness}` : ""}
      </p>
      <p className="mt-0.5 text-sm text-gray-500">
        Same design and thickness only. Available slabs, and slabs held for this order. {offer.truncated ? "Only the first 150 are shown — type a batch or number to narrow it." : ""}
      </p>
      {error && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <input
        className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        placeholder="Slab number or batch" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Narrow the replacement slabs" />

      {shown.length === 0 ? (
        <div className="mt-3"><Empty>{offer.candidates.length ? "Nothing matches that." : "No slab of this design and thickness is available or held for this order."}</Empty></div>
      ) : (
        <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-gray-200">
          {shown.map((c) => {
            const on = picked === c.slabNumber;
            return (
              <button key={c.slabNumber} type="button"
                className={`flex w-full items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 text-left last:border-b-0 ${on ? "bg-brand/10" : "hover:bg-gray-50"}`}
                onClick={() => setPicked(c.slabNumber)} aria-pressed={on}>
                <div>
                  <div className="text-lg font-semibold text-gray-900">{fmtSlabNo(c.slabNumber)}</div>
                  <div className="text-sm text-gray-500">
                    Batch {c.batch || "—"}{c.grade ? ` · grade ${c.grade}` : ""}{c.bay ? ` · bay ${c.bay}` : ""}{c.frame ? ` · frame ${c.frame}` : ""} · {c.lengthIn} × {c.widthIn} in
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${c.heldUnder ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                  {c.heldUnder ? `held · ${c.heldUnder}` : "available"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={`${btn} bg-brand text-white hover:bg-brand/90`} disabled={busy || picked === null} onClick={swap}>
          {busy ? "Swapping…" : picked === null ? "Pick a slab" : `Swap in #${fmtSlabNo(picked)}`}
        </button>
        <button type="button" className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
