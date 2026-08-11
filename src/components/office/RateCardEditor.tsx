"use client";

// The rate card, and how an admin keeps it current.
//
// costing_rate is the floor the costing dashboard stands on: every quantity
// the mixer records is priced by a row here, picked by the batch's run date.
// With the table empty the dashboard renders and computes nothing, which
// reads as broken rather than unconfigured - so this card states the gap
// first and loudly, and offers the reference sheet's rates as a one-click
// starting card.
//
// Revisions, not edits: saving "resin ₹158 from 1 Sep" adds a row. June
// batches keep costing at June's rate. That is the whole design.
//
// ADMIN ONLY. The page renders it exclusively for admins; the route enforces
// the same rule again, because a UI condition is not an authorisation.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui";

const ENDPOINT = "/api/office/costing-admin/rates";

const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-60";
const inp = "w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

interface CatalogueItem {
  item: string; category: string; label: string; unit: string; hint: string; variants?: boolean;
}
interface RateRow {
  id: string; category: string; item: string; variant: string; unit: string;
  rate: number; effectiveFrom: string; note: string | null; createdBy: string;
}
interface TodayCard {
  resinBySupplier: Record<string, number>;
  rates: Record<string, number>;
  effectiveFrom: Record<string, string>;
  missing: string[];
}
interface State { catalogue: CatalogueItem[]; rows: RateRow[]; today: TodayCard }

const CATEGORY_LABELS: Record<string, string> = {
  RESIN: "Resin", GRIT: "Grit", FILLER: "Filler", PIGMENT: "Pigment",
  CHEMICAL: "Chemicals", DOSING: "Dosing rules", CONVERSION: "Conversion", BASIS: "Basis",
};
const UNIT_LABELS: Record<string, string> = {
  kg: "₹/kg", t: "₹/tonne", sqft: "₹/sq ft", month: "₹/month",
  slab: "sq ft", usd: "₹", day: "days", pct: "%",
};
// Basis and dosing items are values, not prices - "75 sq ft", not "₹75".
const unitLabel = (c: CatalogueItem) =>
  c.category === "BASIS"
    ? (c.item === "inr-per-usd" ? "₹ per USD" : c.item === "sqft-per-slab" ? "sq ft" : "days")
    : c.category === "DOSING"
      ? (c.unit === "pct" ? "% of resin" : "kg/charge")
      : UNIT_LABELS[c.unit] ?? c.unit;

const fmtRate = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const todayStr = () => new Date().toISOString().slice(0, 10);

export function RateCardEditor() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  /** item|variant -> draft {rate, from, note} for the revision being typed. */
  const [drafts, setDrafts] = useState<Record<string, { rate: string; from: string; note: string }>>({});
  const [newSupplier, setNewSupplier] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(ENDPOINT, { cache: "no-store" });
      if (!r.ok) return; // not an admin or not deployed - stay quiet
      setState(await r.json());
    } catch { /* card renders without counts */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (rows: Array<{ item: string; variant?: string; rate: number; effectiveFrom: string; note?: string }>) => {
    setBusy(true); setError("");
    try {
      const r = await fetch(ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? `Save failed (${r.status})`);
      setDrafts({});
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const loadStarter = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch(ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starter: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? `Load failed (${r.status})`);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const removeRow = async (id: string) => {
    if (!window.confirm("Remove this rate revision? Batches will price at the previous revision.")) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? `Delete failed (${r.status})`);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const empty = state != null && state.rows.length === 0;
  const byCategory = useMemo(() => {
    const groups: Record<string, CatalogueItem[]> = {};
    for (const c of state?.catalogue ?? []) (groups[c.category] ??= []).push(c);
    return groups;
  }, [state]);

  const draftKey = (item: string, variant = "") => `${item}|${variant}`;
  const draft = (k: string) => drafts[k] ?? { rate: "", from: todayStr(), note: "" };
  const setDraft = (k: string, patch: Partial<{ rate: string; from: string; note: string }>) =>
    setDrafts((p) => ({ ...p, [k]: { ...draft(k), ...patch } }));

  const saveDraft = (item: string, variant = "") => {
    const d = draft(draftKey(item, variant));
    const rate = Number(d.rate);
    if (!Number.isFinite(rate) || rate <= 0) { setError("The rate must be a number above zero."); return; }
    void save([{ item, variant: variant || undefined, rate, effectiveFrom: d.from, note: d.note || undefined }]);
  };

  /** One editable line: current rate + the revision inputs. */
  const line = (c: CatalogueItem, variant = "") => {
    const k = draftKey(c.item, variant);
    const current = variant
      ? state?.today.resinBySupplier[variant]
      : state?.today.rates[c.item];
    const since = state?.today.effectiveFrom[variant ? `resin · ${variant}` : c.item];
    const d = draft(k);
    return (
      <div key={k} className="grid grid-cols-1 items-center gap-2 border-b border-gray-50 py-2 last:border-0 sm:grid-cols-12">
        <div className="sm:col-span-4">
          <p className="text-sm text-gray-800">{c.label}{variant ? <span className="text-gray-500"> · {variant}</span> : null}</p>
          <p className="text-[11px] text-gray-400">{c.hint}</p>
        </div>
        <div className="sm:col-span-3">
          {current !== undefined
            ? <p className="text-sm font-medium text-gray-900">{fmtRate(current)} <span className="text-xs font-normal text-gray-400">{unitLabel(c)} · since {since}</span></p>
            : <p className="text-sm text-red-500">not set</p>}
        </div>
        <div className="sm:col-span-2">
          <input value={d.rate} onChange={(e) => setDraft(k, { rate: e.target.value })}
            placeholder={`new ${unitLabel(c)}`} inputMode="decimal" className={inp} />
        </div>
        <div className="sm:col-span-2">
          <input type="date" value={d.from} onChange={(e) => setDraft(k, { from: e.target.value })} className={inp} />
        </div>
        <div className="sm:col-span-1">
          <button type="button" onClick={() => saveDraft(c.item, variant)}
            disabled={busy || !d.rate} className={btnGhost}>Save</button>
        </div>
      </div>
    );
  };

  const resinDef = state?.catalogue.find((c) => c.item === "resin");
  const resinSuppliers = useMemo(() => {
    const fromCard = Object.keys(state?.today.resinBySupplier ?? {});
    const fromRows = (state?.rows ?? []).filter((r) => r.item === "resin").map((r) => r.variant);
    return [...new Set([...fromCard, ...fromRows])].sort();
  }, [state]);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Rate card · admin</h2>
        {state && (
          <span className="flex items-center gap-2 text-xs text-gray-400">
            {empty
              ? <Badge tone="red">empty</Badge>
              : state.today.missing.length > 0
                ? <Badge tone="amber">{state.today.missing.length} rate(s) not set</Badge>
                : <Badge tone="green">complete</Badge>}
            <span>{state.rows.length} revision(s)</span>
          </span>
        )}
      </div>

      {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {empty && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">No rates have been entered.</p>
          <p className="mt-1 text-red-700">
            The costing dashboard prices mixer quantities with this card, so until rates exist
            every batch costs to zero. Start from the Simply White sheet&rsquo;s August 2026 rates
            and revise from there, or type each rate by hand below.
          </p>
          <button type="button" onClick={loadStarter} disabled={busy} className={`${btnPrimary} mt-3`}>
            {busy ? "Loading…" : "Load the Simply White rates (Aug 2026)"}
          </button>
        </div>
      )}

      {state && !empty && state.today.missing.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not yet set: {state.today.missing.join(", ")}. Batches will cost without those lines
          and the dashboard will say so.
        </div>
      )}

      {state && (
        <div className="space-y-4">
          {Object.entries(byCategory).map(([cat, items]) => (
            <div key={cat}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{CATEGORY_LABELS[cat] ?? cat}</p>
              <div>
                {items.map((c) => c.variants
                  ? (
                    <div key={c.item}>
                      {resinSuppliers.map((s) => line(c, s))}
                      <div className="flex items-center gap-2 py-2">
                        <input value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)}
                          placeholder="New supplier name…" className={`${inp} max-w-56`} />
                        <button type="button" disabled={busy || !newSupplier.trim()} className={btnGhost}
                          onClick={() => {
                            const s = newSupplier.trim();
                            setNewSupplier("");
                            setDraft(draftKey("resin", s), {});
                          }}>Add supplier</button>
                        {resinDef && Object.keys(drafts).some((k) => k.startsWith("resin|") && !resinSuppliers.includes(k.split("|")[1]))
                          && Object.keys(drafts).filter((k) => k.startsWith("resin|") && !resinSuppliers.includes(k.split("|")[1]))
                            .map((k) => line(resinDef, k.split("|")[1]))}
                      </div>
                    </div>
                  )
                  : line(c))}
              </div>
            </div>
          ))}
        </div>
      )}

      {state && state.rows.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <button type="button" onClick={() => setShowHistory((v) => !v)}
            className="text-sm font-medium text-brand hover:underline">
            {showHistory ? "Hide history" : `History — all ${state.rows.length} revisions →`}
          </button>
          {showHistory && (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">Item</th>
                  <th className="py-2 pr-4 font-medium">Rate</th>
                  <th className="py-2 pr-4 font-medium">Effective from</th>
                  <th className="py-2 pr-4 font-medium">By</th>
                  <th className="py-2 pr-4 font-medium">Note</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {state.rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4 text-gray-900">{r.item}{r.variant ? ` · ${r.variant}` : ""}</td>
                    <td className="py-2 pr-4 text-gray-900">{fmtRate(r.rate)}</td>
                    <td className="py-2 pr-4 text-gray-600">{r.effectiveFrom}</td>
                    <td className="py-2 pr-4 text-gray-600">{r.createdBy}</td>
                    <td className="py-2 pr-4 text-xs text-gray-400">{r.note ?? ""}</td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => removeRow(r.id)} disabled={busy}
                        className="text-xs text-gray-400 hover:text-red-500">remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
