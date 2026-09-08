"use client";
// The holds placed against an order and what can still be done with them:
// release some or all of the slabs. Nothing else — there is no extension
// (answer 11).
//
// A hold's status is not decorative. ACTIVE means those slabs are RESERVED in
// finished goods right now; EXPIRED means the inventory sweep gave them back
// when the days ran out, and the order went back to the stock check; CONSUMED
// means a packing list took them. Release is offered only on an ACTIVE hold,
// and only to a login that may write — the same rule the route enforces.
import { useState } from "react";
import { Badge, Empty, fmt } from "@/components/ui";
import { postJson } from "@/lib/fab/postJson";
import { hoursLeft, stillHeldSlabs, holdExpiryLine } from "@/lib/commercial/holds-rules";
import type { HoldDto } from "@/lib/commercial/types";

const btn = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";
const btnDanger = "rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40";
const input = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none";

const TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  ACTIVE: "green", CONSUMED: "brand", EXPIRED: "amber", RELEASED: "red",
};

function whenLeft(h: HoldDto): string {
  const hrs = hoursLeft(h.expiresAt, new Date());
  if (hrs <= 0) return "lapsed";
  if (hrs < 48) return `${Math.round(hrs)}h left`;
  return `${Math.round(hrs / 24)} day(s) left`;
}

export function HoldsPanel({ holds, canWrite, onChanged }: {
  holds: HoldDto[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<number[]>([]);

  async function release(h: HoldDto, only: number[] | null) {
    setBusy(h.id); setError(null); setNote(null);
    const r = await postJson(`/api/office/commercial/holds/${h.id}/release`, {
      reason: reason.trim() || null,
      ...(only && only.length ? { slabNumbers: only } : {}),
    });
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Could not release"); return; }
    setNote(`${r.data?.released ?? 0} slab(s) released${r.data?.notOnHold?.length ? `; ${r.data.notOnHold.length} were not on the hold` : ""}.`);
    setPicked([]); setReason("");
    onChanged();
  }

  if (!holds.length) return <Empty>No stock has been held for this order yet.</Empty>;

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {note && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{note}</div>}
      {holds.map((h) => {
        const still = stillHeldSlabs(h.slabs);
        const sqft = h.slabs.reduce((s, x) => s + (x.sqft ?? 0), 0);
        const isOpen = openId === h.id;
        return (
          <div key={h.id} className="rounded-xl border border-gray-200">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="font-medium text-gray-900">{h.reference}</span>
              <Badge tone={TONE[h.status] ?? "brand"}>{h.status.toLowerCase()}</Badge>
              <span className="text-sm text-gray-600">{still.length} of {h.slabs.length} slab(s) held · {fmt(sqft, 2)} sqft</span>
              <span className="text-sm text-gray-500">
                {h.status === "ACTIVE" && <>{whenLeft(h)} · </>}
                {holdExpiryLine(h.status, new Date(h.expiresAt).toLocaleString("en-IN"))}
              </span>
              <span className="text-xs text-gray-400">{h.placedByName ?? "—"} · {new Date(h.placedAt).toLocaleDateString("en-IN")}</span>
              <button type="button" className={`${btn} ml-auto`} onClick={() => { setOpenId(isOpen ? null : h.id); setPicked([]); }}>
                {isOpen ? "Hide slabs" : "Slabs"}
              </button>
            </div>
            {h.releaseReason && <div className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-500">Released: {h.releaseReason}</div>}
            {h.notes && <div className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-500">{h.notes}</div>}

            {isOpen && (
              <div className="border-t border-gray-100">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
                      <tr>
                        {canWrite && h.status === "ACTIVE" && <th className="w-10 px-3 py-2"></th>}
                        <th className="px-3 py-2 text-left">Slab</th>
                        <th className="px-3 py-2 text-left">Design</th>
                        <th className="px-3 py-2 text-left">Thickness</th>
                        <th className="px-3 py-2 text-left">Batch</th>
                        <th className="px-3 py-2 text-left">Grade</th>
                        <th className="px-3 py-2 text-right">Sqft</th>
                        <th className="px-3 py-2 text-left">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {h.slabs.map((s) => {
                        const held = s.releasedAt == null && s.packedAt == null;
                        return (
                          <tr key={s.id}>
                            {canWrite && h.status === "ACTIVE" && (
                              <td className="px-3 py-1.5">
                                <input
                                  type="checkbox" className="h-4 w-4" disabled={!held}
                                  checked={picked.includes(s.slabNumber)}
                                  onChange={(e) => setPicked((p) => e.target.checked ? [...p, s.slabNumber] : p.filter((n) => n !== s.slabNumber))}
                                  aria-label={`Release slab ${s.slabNumber}`}
                                />
                              </td>
                            )}
                            <td className="px-3 py-1.5 font-medium text-gray-900">{s.slabNumber}</td>
                            <td className="px-3 py-1.5">{s.design ?? "—"}</td>
                            <td className="px-3 py-1.5">{s.thickness ?? "—"}</td>
                            <td className="px-3 py-1.5 text-gray-500">{s.batchNumber ?? s.batchKey ?? "—"}</td>
                            <td className="px-3 py-1.5">{s.grade ?? "—"}</td>
                            <td className="px-3 py-1.5 text-right">{s.sqft == null ? "—" : fmt(s.sqft, 2)}</td>
                            <td className="px-3 py-1.5 text-xs text-gray-500">
                              {s.packedAt ? "packed" : s.releasedAt ? "released" : "held"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {canWrite && h.status === "ACTIVE" && (
                  <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 px-3 py-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Reason</span>
                      <input className={`${input} w-64`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer dropped the line" />
                    </label>
                    <button type="button" className={btnDanger} disabled={busy === h.id || picked.length === 0} onClick={() => void release(h, picked)}>
                      Release {picked.length} picked
                    </button>
                    <button type="button" className={btnDanger} disabled={busy === h.id || still.length === 0} onClick={() => void release(h, null)}>
                      Release all {still.length}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
