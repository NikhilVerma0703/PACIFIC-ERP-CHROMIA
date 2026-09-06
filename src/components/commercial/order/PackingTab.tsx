"use client";
// The order's packing lists: what has been built, where each one has got to,
// and the two ways to start another — from a hold (pack what we reserved) or
// by typing slab numbers. The editing itself lives on the packing-list page,
// which is a screen of its own because a list of 47 slabs in 7 crates does not
// fit in a tab beside seven others.
import Link from "next/link";
import { useState } from "react";
import type { OrderTabProps } from "@/lib/commercial/types";
import { Card, Badge, Empty } from "@/components/ui";
import { postJson } from "@/lib/fab/postJson";
import { PACKING_STATUS_LABEL, parseSlabNumbers, type PackingStatus } from "@/lib/commercial/packing-rules";

const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const label = "mb-1 block text-xs font-medium text-gray-600";

const TONE: Record<PackingStatus, "brand" | "green" | "amber" | "red"> = {
  DRAFT: "brand", SUBMITTED: "amber", VERIFIED: "green", REJECTED: "red", FINAL: "green", DISPATCHED: "green",
};

const when = (v: string | null): string => (v ? new Date(v).toLocaleDateString("en-IN") : "—");

export default function PackingTab({ order, actions, refresh }: OrderTabProps) {
  const mayWrite = actions.includes("write");
  const [mode, setMode] = useState<"hold" | "numbers">("hold");
  const [holdId, setHoldId] = useState("");
  const [numbers, setNumbers] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const holds = order.holds.filter((h) => h.status === "ACTIVE" && h.slabs.some((s) => !s.releasedAt && !s.packedAt));
  const parsed = parseSlabNumbers(numbers);

  async function create() {
    setBusy(true); setError(null); setNote(null);
    const body = mode === "hold" ? { fromHoldId: holdId } : { slabNumbers: parsed };
    const r = await postJson(`/api/office/commercial/orders/${order.id}/packing-lists`, body);
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Could not start the packing list"); return; }
    const skipped = (r.data?.skipped ?? []) as Array<{ slab: number; reason: string }>;
    setNumbers(""); setHoldId("");
    setNote(`Packing list ${r.data?.list?.number ?? ""} started${skipped.length ? ` — ${skipped.length} slab(s) refused: ${skipped.map((s) => `#${s.slab} (${s.reason})`).join("; ")}` : ""}`);
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {mayWrite && (
        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Start a packing list</h2>
          {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {note && <div className="mb-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{note}</div>}
          <div className="mb-3 flex gap-2">
            <button type="button" className={`${btnGhost} ${mode === "hold" ? "border-brand text-brand" : ""}`} onClick={() => setMode("hold")}>From a hold</button>
            <button type="button" className={`${btnGhost} ${mode === "numbers" ? "border-brand text-brand" : ""}`} onClick={() => setMode("numbers")}>By slab numbers</button>
          </div>
          {mode === "hold" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <label className={label} htmlFor="pl-hold">Hold</label>
                {holds.length === 0 ? (
                  <p className="text-sm text-gray-500">No hold on this order still has slabs. Place one on the Stock tab, or type the numbers.</p>
                ) : (
                  <select id="pl-hold" className={inp} value={holdId} onChange={(e) => setHoldId(e.target.value)}>
                    <option value="">Pick a hold…</option>
                    {holds.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.reference} · {h.slabs.filter((s) => !s.releasedAt && !s.packedAt).length} slab(s) · lapses {new Date(h.expiresAt).toLocaleDateString("en-IN")}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <button type="button" className={btn} disabled={busy || !holdId} onClick={create}>{busy ? "Working…" : "Create"}</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <label className={label} htmlFor="pl-numbers">Slab numbers</label>
                <textarea id="pl-numbers" className={inp} rows={2} value={numbers} onChange={(e) => setNumbers(e.target.value)}
                  placeholder="150903, 150904 150905-150910" />
                <p className="mt-1 text-xs text-gray-400">{parsed.length} slab(s) recognised. Commas, spaces and ranges all work.</p>
              </div>
              <button type="button" className={btn} disabled={busy || !parsed.length} onClick={create}>{busy ? "Working…" : "Create"}</button>
            </div>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Packing lists · {order.packingLists.length}</h2>
        {order.packingLists.length === 0 ? (
          <Empty>No packing list yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-3">Number</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Slabs</th>
                  <th className="py-2 pr-3 text-right">Crates</th>
                  <th className="py-2 pr-3">Container</th>
                  <th className="py-2 pr-3">Submitted</th>
                  <th className="py-2 pr-3">Verified</th>
                  <th className="py-2 pr-3">Dispatched</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {order.packingLists.map((pl) => (
                  <tr key={pl.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/office/commercial/packing-lists/${pl.id}`} className="font-medium text-brand hover:underline">{pl.number}</Link>
                    </td>
                    <td className="py-2 pr-3"><Badge tone={TONE[pl.status] ?? "brand"}>{PACKING_STATUS_LABEL[pl.status] ?? pl.status}</Badge></td>
                    <td className="py-2 pr-3 text-right">{pl.slabs.length}</td>
                    <td className="py-2 pr-3 text-right">{pl.crates.length}</td>
                    <td className="py-2 pr-3 text-gray-600">{pl.containerNo ?? "—"}</td>
                    <td className="py-2 pr-3 text-gray-600">{when(pl.submittedAt)}</td>
                    <td className="py-2 pr-3 text-gray-600">{when(pl.verifiedAt)}</td>
                    <td className="py-2 pr-3 text-gray-600">{when(pl.dispatchedAt)}</td>
                    <td className="py-2 text-right">
                      <Link href={`/api/office/commercial/packing-lists/${pl.id}/pdf`} target="_blank" className="text-xs font-medium text-brand hover:underline">PL PDF</Link>
                      <span className="px-1 text-gray-300">·</span>
                      <Link href={`/api/office/commercial/packing-lists/${pl.id}/measurement-list.pdf`} target="_blank" className="text-xs font-medium text-brand hover:underline">Measmt</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
