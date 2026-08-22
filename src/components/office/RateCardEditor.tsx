"use client";

// The PLANT-WIDE rates, and how an admin keeps them current.
//
// WHAT THIS NO LONGER SHOWS. Materials — resin, the grit bands, filler, TiO₂,
// the chemicals and the dosing rules — are now set per batch, on the batch
// itself, because that is where the answer actually differs: the resin in one
// run came off a particular purchase order at a particular price. They were
// taking up most of this card while being the wrong place to look, so they are
// gone from here and live in the batch panel below.
//
// Their ROWS are untouched in costing_rate and still resolve by date. That is
// deliberate and load-bearing: per-batch rates are an override with the card as
// fallback, so a batch that sets nothing still prices at those material rates
// exactly as it always did. Removing them from this screen removes a place to
// edit them, not the rates themselves.
//
// WHAT IS LEFT is what genuinely has one value for the whole plant: manpower
// and electricity (monthly figures absorbed by run length), polishing and
// packing per square foot, and the basis figures — slab area, ₹ per USD, days
// per month. Those last three are the denominators every sheet divides by, so
// they must not vary by batch or two batches stop being comparable under the
// same column heading. `buildCostingReport` refuses to compute a sheet at all
// while any of the seven is missing, which is why this card still states the
// gap first and loudly.
//
// Revisions, not edits: saving "electricity ₹62 lakh from 1 Sep" adds a row.
// June batches keep costing at June's rate. That is the whole design.
//
// ADMIN ONLY. The page renders it exclusively for admins; the route enforces
// the same rule again, because a UI condition is not an authorisation.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { isOverridable } from "@/lib/costing/batchRates";

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
// IST, not UTC: toISOString() alone dates an early-morning edit to YESTERDAY
// (UTC is 5h30 behind the plant until 05:29), and effectiveFrom decides which
// batches a rate applies to — a silent one-day backdate is a real error here.
const todayStr = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

export function RateCardEditor() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  /** The whole card, folded. These rates change perhaps monthly, yet the
   *  full table opened above the batch picker on every visit and pushed the
   *  actual work - pick a batch, price it - below the fold; the owner asked
   *  for a better arrangement. Folded by default WHEN COMPLETE; while rates
   *  are missing or empty it opens itself, because then the rates ARE the
   *  work and hiding them would hide the reason no sheet computes.
   *  Manual choice wins once made. */
  const [foldRates, setFoldRates] = useState<boolean | null>(null);
  /** item|variant -> draft {rate, from, note} for the revision being typed. */
  const [drafts, setDrafts] = useState<Record<string, { rate: string; from: string; note: string }>>({});
  /** Which rows have their revision boxes open. Default is the READ view
   *  (owner, 2026-08-18): always-editable boxes made every glance at the card
   *  look like an edit in progress. Edit opens one row's boxes; Save or Cancel
   *  closes them. */
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(ENDPOINT, { cache: "no-store" });
      if (!r.ok) return; // not an admin or not deployed - stay quiet
      // Read then judge: a 200 with an empty body threw a parser error here,
      // which the catch below swallowed, leaving the card blank with no reason.
      const res = await readJson<State>(r);
      if (res.ok && res.data) setState(res.data);
      else if (res.error) setError(res.error);
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

  /** Only the plant-wide half of the catalogue. isOverridable is the SAME
   *  predicate the batch panel and the write route use, so an item can never be
   *  editable in both places or in neither. */
  const plantWide = useMemo(
    () => (state?.catalogue ?? []).filter((c) => !isOverridable(c.category)),
    [state],
  );

  const byCategory = useMemo(() => {
    const groups: Record<string, CatalogueItem[]> = {};
    for (const c of plantWide) (groups[c.category] ??= []).push(c);
    return groups;
  }, [plantWide]);

  /** Gaps in the plant-wide rates only. The API reports every missing item in
   *  the catalogue, and nagging here about an unset grit band — which is now a
   *  per-batch decision, and one most batches never need — is how a warning
   *  banner becomes something people stop reading. */
  const missingPlantWide = useMemo(() => {
    const keys = new Set(plantWide.map((c) => c.item));
    return (state?.today.missing ?? []).filter((m) => keys.has(m));
  }, [plantWide, state]);

  /** Missing items that ARE materials — mentioned once, quietly, with where to
   *  set them, rather than presented as a fault on this card. */
  const missingMaterials = useMemo(() => {
    const keys = new Set(plantWide.map((c) => c.item));
    return (state?.today.missing ?? []).filter((m) => !keys.has(m));
  }, [plantWide, state]);

  // No variant anywhere on this card now: resin was the only item that split by
  // supplier and it is set per batch. Keeping the parameter "just in case"
  // would leave a branch nothing reaches and a reader would have to prove that
  // for themselves.
  const draft = (k: string) => drafts[k] ?? { rate: "", from: todayStr(), note: "" };
  const setDraft = (k: string, patch: Partial<{ rate: string; from: string; note: string }>) =>
    setDrafts((p) => ({ ...p, [k]: { ...draft(k), ...patch } }));

  const saveDraft = (item: string) => {
    const d = draft(item);
    const rate = Number(d.rate);
    if (!Number.isFinite(rate) || rate <= 0) { setError("The rate must be a number above zero."); return; }
    void save([{ item, rate, effectiveFrom: d.from, note: d.note || undefined }])
      .then(() => setEditing((p) => ({ ...p, [item]: false })));
  };

  /** Who set the revision currently in force for an item.
   *
   *  Derived from the full revision list rather than sent separately: the row
   *  in force is exactly the one whose effective_from the resolved card
   *  reports for the item, and rows already carry createdBy. Rates here have
   *  no variants (materials moved to the batch panel), so item + date is
   *  enough to name the row. */
  const setBy = (item: string): string | null => {
    const since = state?.today.effectiveFrom[item];
    if (!since) return null;
    return state?.rows.find((r) => r.item === item && r.effectiveFrom === since)?.createdBy ?? null;
  };

  /**
   * One line: a READ row — value, when it was last set and by whom — with an
   * Edit button that opens the revision boxes (owner, 2026-08-18). Save closes
   * them again; Cancel walks away without touching the card.
   */
  const line = (c: CatalogueItem) => {
    const k = c.item;
    const current = state?.today.rates[c.item];
    const since = state?.today.effectiveFrom[c.item];
    const who = setBy(c.item);
    const d = draft(k);
    const isEditing = !!editing[k];

    return (
      <div key={k} className="grid grid-cols-1 items-center gap-2 border-b border-gray-50 py-2 last:border-0 sm:grid-cols-12">
        <div className="sm:col-span-4">
          <p className="text-sm text-gray-800">{c.label}</p>
          <p className="text-[11px] text-gray-400">{c.hint}</p>
        </div>
        <div className="sm:col-span-3">
          {current !== undefined
            ? <p className="text-sm font-medium text-gray-900">{fmtRate(current)} <span className="text-xs font-normal text-gray-400">{unitLabel(c)}</span></p>
            : <p className="text-sm text-red-500">not set</p>}
        </div>
        {!isEditing ? (
          <>
            <div className="sm:col-span-2">
              <p className="text-xs text-gray-500">{since ? <>last set {since}</> : "—"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-gray-500">{who ? <>by {who}</> : "—"}</p>
            </div>
            <div className="sm:col-span-1">
              <button type="button" onClick={() => setEditing((p) => ({ ...p, [k]: true }))}
                disabled={busy} className={btnGhost}>Edit</button>
            </div>
          </>
        ) : (
          <>
            <div className="sm:col-span-2">
              <input value={d.rate} onChange={(e) => setDraft(k, { rate: e.target.value })}
                placeholder={`new ${unitLabel(c)}`} inputMode="decimal" className={inp} />
            </div>
            {/* No date picker. The owner asked for the date to select itself, and
                today (IST) is the only value anyone ever chose here — a new rate
                takes effect from the day it is typed. The API still accepts an
                explicit effectiveFrom, so backdating remains possible through it
                if a correction ever genuinely needs one; it is just not a box on
                this row any more. The revisions list keeps showing every date. */}
            <div className="sm:col-span-2">
              <p className="pt-2 text-xs text-gray-500">from today · {d.from}</p>
            </div>
            <div className="flex items-center gap-1.5 sm:col-span-1">
              <button type="button" onClick={() => saveDraft(c.item)}
                disabled={busy || !d.rate} className={btnGhost}>Save</button>
              <button type="button"
                onClick={() => setEditing((p) => ({ ...p, [k]: false }))}
                disabled={busy}
                className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </>
        )}
      </div>
    );
  };

  // null = nobody has chosen: fold when the card is healthy, open when not.
  const folded = foldRates ?? (!!state && !empty && missingPlantWide.length === 0);

  return (
    <Card>
      <div className={folded ? "flex flex-wrap items-center justify-between gap-2" : "mb-3 flex flex-wrap items-center justify-between gap-2"}>
        <button type="button" onClick={() => setFoldRates(!folded)} className="text-left">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400 transition hover:text-gray-600">
            <svg className={"h-3 w-3 transition-transform " + (folded ? "-rotate-90" : "")}
              fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            Plant-wide rates
          </h2>
          <p className="mt-0.5 text-xs text-gray-400">
            {folded
              ? "Manpower, electricity, polishing, packing and the basis figures. Click to open."
              : "One value for the whole plant. Material rates are set on the batch, above."}
          </p>
        </button>
        {state && (
          <span className="flex items-center gap-2 text-xs text-gray-400">
            {empty
              ? <Badge tone="red">empty</Badge>
              : missingPlantWide.length > 0
                ? <Badge tone="amber">{missingPlantWide.length} not set</Badge>
                : <Badge tone="green">complete</Badge>}
            <span>{state.rows.length} revision(s)</span>
          </span>
        )}
      </div>

      {/* Everything below the header only exists while the card is open - the
          fold is real, not visual, so a folded card also skips this render. */}
      {!folded && (<>

        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {empty && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-medium">No rates have been entered.</p>
            <p className="mt-1 text-red-700">
              No batch can be costed until the plant-wide figures below exist. The starter also
              seeds the material rates, which every batch then falls back to unless it sets its
              own — so it is the fastest way to a working sheet, not a commitment to those
              numbers.
            </p>
            <button type="button" onClick={loadStarter} disabled={busy} className={`${btnPrimary} mt-3`}>
              {busy ? "Loading…" : "Load the Simply White rates (Aug 2026)"}
            </button>
          </div>
        )}

        {/* A missing plant-wide rate is not a warning, it is a stop: the report
            refuses to compute a sheet without all seven, because electricity
            silently at zero reads as a cheap batch rather than an unset rate. */}
        {state && !empty && missingPlantWide.length > 0 && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-medium">
              No batch can be costed until these are set: {missingPlantWide.join(", ")}.
            </p>
            <p className="mt-1 text-red-700">
              The sheet needs every one of them — four of the seven are divided by, so a blank
              would print an infinite cost per square foot rather than fail.
            </p>
          </div>
        )}

        {/* Materials are mentioned once and quietly. An unpriced grit band is a
            real gap, but it belongs to whichever batch actually used it, and most
            never will. */}
        {state && !empty && missingMaterials.length > 0 && (
          <p className="mb-3 text-xs text-gray-500">
            {missingMaterials.length} material rate
            {missingMaterials.length === 1 ? " has" : "s have"} never been set
            ({missingMaterials.join(", ")}). Set them on the batches that used them, below — a
            batch consuming one without a rate says so on its own sheet.
          </p>
        )}

        {state && (
          <div className="space-y-4">
            {/* No variant branch any more. Resin was the only item that split by
                supplier, and it is set per batch now — so every line here is a
                single plant-wide value. */}
            {Object.entries(byCategory).map(([cat, items]) => (
              <div key={cat}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{CATEGORY_LABELS[cat] ?? cat}</p>
                <div>{items.map((c) => line(c))}</div>
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
              // Deliberately still every row, materials included. Those rates are
              // the fallback a batch uses when it sets none of its own, and this
              // is the only place left to see or remove one.
              <p className="mt-1 text-xs text-gray-400">
                Every revision, including the material rates batches fall back to.
              </p>
            )}
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
      </>)}
    </Card>
  );
}
