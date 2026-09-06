"use client";
// One packing list, slab by slab, on a screen someone uses standing next to a
// crate. Everything is deliberately big: one FIT button and one UNFIT button
// per row, both at least a thumb wide, and the reason for an UNFIT chosen from
// eight buttons rather than typed — a keyboard on the floor is a keyboard
// nobody uses, and an unfit slab with no reason is a rejection Commercial
// cannot act on.
//
// Verify is enabled only when nothing is left PENDING. The server refuses it
// too; this is so the button never looks available when it is not.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { postJson, patchJson } from "@/lib/fab/postJson";
import { UNFIT_REASONS, fitCounts, PACKING_STATUS_LABEL, type PackingStatus } from "@/lib/commercial/packing-rules";

interface Crate { id: string; crateNo: number; kind: string; netKg: number | null; remarks: string | null }
interface Slab {
  id: string; crateId: string | null; slabNumber: number; customerSlabNo: string | null; customerBatchNo: string | null;
  design: string | null; customerSku: string | null; thickness: string | null; batchNumber: string | null; batchKey: string | null;
  grade: string | null; lengthCm: number | null; widthCm: number | null; sqm: number | null;
  fit: "PENDING" | "FIT" | "UNFIT"; unfitReason: string | null; checkedAt: string | null; sortOrder: number;
}
interface Detail {
  id: string; number: string; status: PackingStatus;
  submittedAt: string | null; verifiedAt: string | null; verifiedByName: string | null; verificationNote: string | null;
  containerNo: string | null; sealNo: string | null; linerOtlNo: string | null; vehicleNo: string | null;
  packagesSummary: string | null; grossWeightKg: number | null; netWeightKg: number | null; notes: string | null;
  orderNumber: string; kind: string; customerPoNumber: string | null; clientName: string; clientCountry: string | null;
  crates: Crate[]; slabs: Slab[];
}

const btnBig = "rounded-xl px-6 py-4 text-base font-semibold transition disabled:opacity-50";
const btnFit = `${btnBig} border-2 border-green-600 text-green-700 hover:bg-green-50`;
const btnFitOn = `${btnBig} border-2 border-green-600 bg-green-600 text-white`;
const btnUnfit = `${btnBig} border-2 border-red-600 text-red-700 hover:bg-red-50`;
const btnUnfitOn = `${btnBig} border-2 border-red-600 bg-red-600 text-white`;

export function DispatchCheck({ plId }: { plId: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);   // slab id whose reason is being chosen
  const [freeText, setFreeText] = useState("");
  const [verifyNote, setVerifyNote] = useState("");

  const load = useCallback(async () => {
    const res = await readJson<Detail>(await fetch(`/api/office/commercial/dispatch-check/${plId}`, { cache: "no-store" }));
    if (!res.ok) { setError(res.error ?? "Could not load this packing list"); return; }
    setError(null); setD(res.data);
  }, [plId]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => fitCounts(d?.slabs ?? []), [d]);
  const byCrate = useMemo(() => {
    const out = new Map<string, Slab[]>();
    for (const s of d?.slabs ?? []) {
      const k = s.crateId ?? "";
      const arr = out.get(k) ?? [];
      arr.push(s);
      out.set(k, arr);
    }
    return out;
  }, [d]);

  if (error && !d) return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">{error}</div>;
  if (!d) return <Empty>Loading…</Empty>;

  const open = d.status === "SUBMITTED";

  async function mark(slabId: string, fit: "FIT" | "UNFIT", unfitReason?: string) {
    setBusy(slabId); setError(null); setNote(null);
    const r = await patchJson(`/api/office/commercial/dispatch-check/${plId}/slabs/${slabId}`, { fit, unfitReason });
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "That verdict did not save"); return; }
    setAsking(null); setFreeText("");
    await load();
  }

  async function verify() {
    setBusy("verify"); setError(null); setNote(null);
    const r = await postJson(`/api/office/commercial/dispatch-check/${plId}/verify`, { note: verifyNote || undefined });
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Could not finish the check"); return; }
    const data = r.data as { verified?: boolean; removed?: Array<{ slab: number; reason: string }>; stranded?: Array<{ slab: number; reason: string }> };
    // A slab the inventory would not take back stays ON the list rather than
    // vanishing from it, so say so here too — the checker is standing next to it.
    const stranded = data?.stranded?.length
      ? ` ${data.stranded.length} slab(s) could not be put back and are still on this list: ${data.stranded.map((s) => `#${s.slab} (${s.reason})`).join("; ")}.`
      : "";
    setNote(data?.verified
      ? "Verified — the list goes back to Commercial as ready."
      : `Rejected — ${data?.removed?.length ?? 0} slab(s) sent back to stock.${stranded}`);
    setVerifyNote("");
    await load();
  }

  const crateLabel = (id: string): string => {
    if (!id) return "Not in a crate";
    const c = d.crates.find((x) => x.id === id);
    return c ? `Crate ${c.crateNo} · ${c.kind}${c.netKg != null ? ` · ${c.netKg} kg net` : ""}` : "Crate";
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold text-gray-900">{d.number}</h2>
              <Badge tone={d.status === "SUBMITTED" ? "amber" : d.status === "REJECTED" ? "red" : "green"}>
                {PACKING_STATUS_LABEL[d.status] ?? d.status}
              </Badge>
            </div>
            <div className="mt-1 text-lg text-gray-700">{d.orderNumber} · {d.clientName || "—"}</div>
            <div className="mt-1 text-sm text-gray-500">
              {d.packagesSummary ?? `${d.crates.length} package(s)`}
              {d.containerNo ? ` · container ${d.containerNo}` : ""}
              {d.sealNo ? ` · seal ${d.sealNo}` : ""}
              {d.vehicleNo ? ` · vehicle ${d.vehicleNo}` : ""}
            </div>
          </div>
          <Link href="/office/commercial/dispatch-check" className="rounded-xl border border-gray-300 px-5 py-3 text-base font-medium text-gray-700 transition hover:bg-gray-50">
            Back to the queue
          </Link>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-gray-600">{counts.fit} fit · {counts.unfit} unfit · {counts.pending} still to check</span>
            <span className="font-medium text-gray-900">{counts.total - counts.pending} of {counts.total}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${counts.total ? Math.round(((counts.total - counts.pending) / counts.total) * 100) : 0}%` }} />
          </div>
        </div>

        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">{error}</div>}
        {note && <div className="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-base text-green-800">{note}</div>}
        {d.verificationNote && !open && (
          <div className={`mt-3 rounded-xl border px-4 py-3 text-base ${d.status === "REJECTED" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-800"}`}>
            {d.verificationNote}
          </div>
        )}

        {open && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-600" htmlFor="verify-note">Note (optional)</label>
              <input id="verify-note" className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} placeholder="Anything Commercial should know" />
            </div>
            <button type="button"
              className={`rounded-xl px-8 py-4 text-lg font-semibold text-white transition disabled:opacity-50 ${counts.unfit > 0 ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}`}
              disabled={busy !== null || counts.pending > 0}
              title={counts.pending > 0 ? `${counts.pending} slab(s) still to check` : ""}
              onClick={verify}>
              {busy === "verify" ? "Working…" : counts.unfit > 0 ? `Reject — ${counts.unfit} unfit` : "Verify — all fit"}
            </button>
          </div>
        )}
        {open && counts.pending > 0 && (
          <p className="mt-2 text-sm text-gray-500">Every slab has to be marked before the list can be finished.</p>
        )}
      </Card>

      {d.slabs.length === 0 ? <Empty>This list has no slabs.</Empty> : Array.from(byCrate.entries()).map(([crateId, slabs]) => (
        <Card key={crateId || "none"}>
          <h3 className="mb-3 text-base font-semibold text-gray-900">{crateLabel(crateId)} · {slabs.length} slab(s)</h3>
          <div className="flex flex-col gap-3">
            {slabs.map((s) => (
              <div key={s.id} className={`rounded-xl border p-4 ${s.fit === "UNFIT" ? "border-red-200 bg-red-50/60" : s.fit === "FIT" ? "border-green-200 bg-green-50/40" : "border-gray-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-2xl font-semibold tracking-tight text-gray-900">
                      {s.customerSlabNo ? <>{s.customerSlabNo} <span className="text-base font-normal text-gray-400">(ours {s.slabNumber})</span></> : s.slabNumber}
                    </div>
                    <div className="mt-1 text-base text-gray-700">
                      {s.customerSku || s.design || "—"}{s.thickness ? ` · ${s.thickness}` : ""}{s.grade ? ` · grade ${s.grade}` : ""}
                    </div>
                    <div className="mt-0.5 text-sm text-gray-500">
                      Batch {s.customerBatchNo ?? s.batchNumber ?? s.batchKey ?? "—"}
                      {s.lengthCm && s.widthCm ? ` · ${s.lengthCm} × ${s.widthCm} cm` : ""}
                      {s.sqm != null ? ` · ${s.sqm.toFixed(4)} sqm` : ""}
                    </div>
                    {s.fit === "UNFIT" && s.unfitReason && <div className="mt-1 text-base font-medium text-red-700">{s.unfitReason}</div>}
                  </div>
                  <div className="flex gap-3">
                    <button type="button" className={s.fit === "FIT" ? btnFitOn : btnFit} disabled={!open || busy === s.id}
                      onClick={() => mark(s.id, "FIT")}>Fit</button>
                    <button type="button" className={s.fit === "UNFIT" ? btnUnfitOn : btnUnfit} disabled={!open || busy === s.id}
                      onClick={() => { setAsking(asking === s.id ? null : s.id); setFreeText(""); }}>Unfit</button>
                  </div>
                </div>

                {asking === s.id && open && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-white p-4">
                    <p className="mb-2 text-base font-medium text-gray-700">What is wrong with it?</p>
                    <div className="flex flex-wrap gap-2">
                      {UNFIT_REASONS.map((r) => (
                        <button key={r} type="button" className="rounded-xl border border-gray-300 px-4 py-3 text-base transition hover:border-red-400 hover:bg-red-50"
                          disabled={busy === s.id} onClick={() => mark(s.id, "UNFIT", r)}>{r}</button>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <div className="min-w-[14rem] flex-1">
                        <label className="mb-1 block text-sm font-medium text-gray-600" htmlFor={`why-${s.id}`}>Something else</label>
                        <input id={`why-${s.id}`} className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                          value={freeText} onChange={(e) => setFreeText(e.target.value)} />
                      </div>
                      <button type="button" className={`${btnBig} bg-red-600 text-white hover:bg-red-700`} disabled={busy === s.id || !freeText.trim()}
                        onClick={() => mark(s.id, "UNFIT", freeText.trim())}>Mark unfit</button>
                      <button type="button" className={`${btnBig} border border-gray-300 text-gray-700 hover:bg-gray-50`} onClick={() => setAsking(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
