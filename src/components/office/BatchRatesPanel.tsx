"use client";

// Setting one batch's material rates.
//
// The card price sits beside every box, and the difference is shown as soon as
// a number is typed. That is the whole design: a rate 12% above the month's
// card is usually a correction and occasionally a typo, and the only way to
// tell them apart is to see both at once. A form that showed only the box would
// make a mistyped 1610 look exactly like a deliberate 161.
//
// Empty means "use the card". Clearing a rate is a real action, not a blank
// save, so it has its own button and says what it falls back to.

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Empty } from "@/components/ui";

const API = "/api/office/costing-admin/batch-rates";

interface CatalogueItem {
  item: string; category: string; label: string; unit: string; hint: string; variants?: boolean;
}
interface BatchRate { item: string; variant: string; category: string; rate: number; note?: string | null }
interface CardShape {
  onDate: string;
  resinBySupplier: Record<string, number>;
  rates: Record<string, number>;
}
interface Payload {
  batchKey: string;
  catalogue: CatalogueItem[];
  rows: BatchRate[];
  card: CardShape;
}

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** One editable row: an item, optionally a supplier. Resin grows a row per
 *  supplier the card knows; everything else is a single row. */
interface Slot {
  key: string;
  item: string;
  variant: string;
  label: string;
  unit: string;
  hint: string;
  cardRate: number | null;
}

function buildSlots(p: Payload): Slot[] {
  const out: Slot[] = [];
  for (const def of p.catalogue) {
    if (def.variants) {
      // Suppliers the card knows, plus any this batch has already set — a
      // supplier that has left the card must not lose its batch rate.
      const suppliers = new Set([
        ...Object.keys(p.card.resinBySupplier),
        ...p.rows.filter((r) => r.item === def.item && r.variant).map((r) => r.variant),
      ]);
      for (const s of [...suppliers].sort()) {
        out.push({
          key: `${def.item}|${s}`, item: def.item, variant: s,
          label: `${def.label} — ${s}`, unit: def.unit, hint: def.hint,
          cardRate: p.card.resinBySupplier[s] ?? null,
        });
      }
    } else {
      out.push({
        key: `${def.item}|`, item: def.item, variant: "",
        label: def.label, unit: def.unit, hint: def.hint,
        cardRate: p.card.rates[def.item] ?? null,
      });
    }
  }
  return out;
}

export function BatchRatesPanel({
  batchKey, batchLabel, onSaved,
}: {
  batchKey: string;
  batchLabel: string;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}?batchKey=${encodeURIComponent(batchKey)}`, { cache: "no-store" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setNote({ text: d.error ?? `Could not load (${r.status})`, ok: false });
        return;
      }
      const p: Payload = await r.json();
      setData(p);
      const d: Record<string, string> = {};
      for (const row of p.rows) d[`${row.item}|${row.variant}`] = String(row.rate);
      setDraft(d);
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    }
  }, [batchKey]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  if (!open) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Rates for this batch
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              By default {batchLabel} prices at the card in force on its run date. Set a rate here
              when a material was bought for this run at a different price.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(true)} className={btn}>
            Set batch rates
          </button>
        </div>
      </Card>
    );
  }

  const slots = data ? buildSlots(data) : [];
  const setCount = data?.rows.length ?? 0;

  const save = async () => {
    if (!data) return;
    setBusy(true); setNote(null);
    // Only rows with a number go up. A blank box means "use the card", which is
    // the absence of a row rather than a rate of zero.
    const rows = slots
      .map((s) => ({ s, v: (draft[s.key] ?? "").trim() }))
      .filter(({ v }) => v !== "")
      .map(({ s, v }) => ({ item: s.item, variant: s.variant, rate: Number(v) }));
    if (!rows.length) {
      setBusy(false);
      setNote({ text: "Nothing to save — every box is empty, so the card is already in use.", ok: false });
      return;
    }
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchKey, rows }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setNote({ text: d.error ?? `Save failed (${r.status})`, ok: false }); return; }
      setNote({ text: `${d.written} rate(s) saved. The batch has been re-costed.`, ok: true });
      await load();
      onSaved();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally { setBusy(false); }
  };

  const clear = async (slot: Slot) => {
    setBusy(true); setNote(null);
    try {
      const qs = new URLSearchParams({ batchKey, item: slot.item, variant: slot.variant });
      const r = await fetch(`${API}?${qs}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setNote({ text: d.error ?? `Could not clear (${r.status})`, ok: false }); return; }
      setDraft((p) => ({ ...p, [slot.key]: "" }));
      setNote({
        text: `${slot.label} falls back to the ${data?.card.onDate ?? "current"} card.`,
        ok: true,
      });
      await load();
      onSaved();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Rates for this batch · {setCount} set
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Leave a box empty to use the card. Only materials can be set here — manpower,
            electricity, slab area and ₹/USD stay plant-wide, or two batches stop being
            comparable.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>Close</button>
      </div>

      {note && (
        <div className={`mb-3 rounded-xl border px-4 py-2.5 text-sm ${
          note.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
        }`}>
          {note.text}
        </div>
      )}

      {!data ? (
        <Empty>Loading the card…</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">Material</th>
                  <th className="py-2 pr-4 font-medium">Card ({data.card.onDate})</th>
                  <th className="py-2 pr-4 font-medium">This batch</th>
                  <th className="py-2 pr-4 font-medium">Difference</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => {
                  const typed = (draft[slot.key] ?? "").trim();
                  const val = typed === "" ? null : Number(typed);
                  const saved = data.rows.some((r) => r.item === slot.item && r.variant === slot.variant);
                  const delta = val != null && Number.isFinite(val) && slot.cardRate
                    ? Math.round(((val - slot.cardRate) / slot.cardRate) * 1000) / 10
                    : null;
                  return (
                    <tr key={slot.key} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-4">
                        <span className="block text-gray-900">{slot.label}</span>
                        <span className="block text-xs text-gray-400">per {slot.unit}</span>
                      </td>
                      <td className="py-2 pr-4 text-gray-600">
                        {slot.cardRate == null
                          ? <span className="text-amber-700">not on the card</span>
                          : `₹${inr.format(slot.cardRate)}`}
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number" step="0.0001" min="0" inputMode="decimal"
                          value={draft[slot.key] ?? ""}
                          onChange={(e) => setDraft((p) => ({ ...p, [slot.key]: e.target.value }))}
                          placeholder="card"
                          className={`${inp} max-w-[10rem]`}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        {delta == null ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : (
                          // Flagged past 15%: far enough from the card that it
                          // wants a second look before a container is priced
                          // off it, close enough that real movements pass.
                          <Badge tone={Math.abs(delta) > 15 ? "red" : delta === 0 ? "brand" : "amber"}>
                            {delta > 0 ? "+" : ""}{delta}%
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {saved && (
                          <button type="button" disabled={busy} onClick={() => void clear(slot)}
                            className={btnGhost}>
                            Use card
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-3">
            <button type="button" disabled={busy} onClick={() => void save()} className={btn}>
              {busy ? "Saving…" : "Save batch rates"}
            </button>
            <span className="text-xs text-gray-400">
              Saving re-costs the batch immediately — nothing is stored, the sheet is computed on
              every read.
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
