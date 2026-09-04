"use client";

// What this batch consumed, station by station — the sheet Satya and the store
// incharge fill in when they sign a batch off.
//
// IT OPENS FILLED IN EVEN WHEN NOTHING WAS LOGGED, which is the whole point.
// Every station the batch actually passed gets a block, named with whoever the
// batch's own records say was standing there, and one empty line ready to
// type. A station that never ran the batch is not shown at all — a sheet that
// asked what the Kreos consumed on a batch that never went near it would be
// asking people to invent numbers.
//
// Lines the FLOOR logged are marked as such. A figure the station reported
// while it was working and a figure the office reconstructed a week later are
// different kinds of evidence, and the person signing should be able to see
// which is which before they put their name to it.
//
// NO TOTALS, ANYWHERE. Quantity and unit price sit side by side and are never
// multiplied here — the same rule the rest of this screen obeys (see
// lib/costing/verification.ts). What a batch cost is the admin costing sheet's
// answer to give, behind its own gate.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";

const API = "/api/office/batch-consumables";

interface Line {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  pricedBy: string | null;
  pricedAt: string | null;
  operatorName: string | null;
  enteredBy: string | null;
  fromFloor: boolean;
  date: string;
}
interface Station {
  station: string; label: string; department: string;
  operators: string[]; ran: boolean; lines: Line[];
}
interface Sheet {
  batchKey: string; stations: Station[];
  items: { itemName: string; unit: string }[];
  unplaced: Line[];
  me?: string;
}

/** A row as the sheet edits it — strings, so a half-typed number is not 0 and
 *  an emptied price box is "not priced" rather than free. */
interface Draft {
  key: string;
  id?: string;
  station: string;
  itemName: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  operatorName: string;
  fromFloor: boolean;
  pricedBy: string | null;
}

const inp = "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const ADD_NEW = "__free__";
let seq = 0;
const nextKey = () => `new-${++seq}`;

const draftOf = (l: Line, station: string): Draft => ({
  key: l.id, id: l.id, station,
  itemName: l.itemName, quantity: String(l.quantity ?? ""), unit: l.unit ?? "",
  unitPrice: l.unitPrice == null ? "" : String(l.unitPrice),
  operatorName: l.operatorName ?? "", fromFloor: l.fromFloor, pricedBy: l.pricedBy,
});
const blank = (station: string, operator: string): Draft => ({
  key: nextKey(), station, itemName: "", quantity: "", unit: "", unitPrice: "",
  operatorName: operator, fromFloor: false, pricedBy: null,
});

export function BatchConsumablesTable({ batchKey, batchLabel, onSaved }: {
  batchKey: string;
  batchLabel?: string;
  onSaved?: () => void;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seed = useCallback((s: Sheet) => {
    setSheet(s);
    setRemoved([]);
    const rows: Draft[] = [];
    for (const st of s.stations) {
      if (!st.ran && st.lines.length === 0) continue;
      for (const l of st.lines) rows.push(draftOf(l, st.station));
      // One empty line per station, so the sheet is typed into rather than
      // built up click by click. It is dropped on save if left blank.
      if (st.lines.length === 0) rows.push(blank(st.station, st.operators[0] ?? ""));
    }
    for (const l of s.unplaced) rows.push(draftOf(l, ""));
    setDrafts(rows);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      // readJson, not r.json(): a 500 or a 504 carries no body, and the parser
      // error it throws would hide the status that says what actually went
      // wrong. See lib/readJson.ts.
      const res = await readJson<Sheet>(await fetch(`${API}?batchKey=${encodeURIComponent(batchKey)}`));
      if (!res.ok || !res.data) { setError(res.error ?? "Could not load this batch's consumables."); setSheet(null); return; }
      seed(res.data);
    } catch {
      setError("Could not reach the server.");
      setSheet(null);
    }
  }, [batchKey, seed]);

  useEffect(() => { void load(); }, [load]);

  const upd = (key: string, patch: Partial<Draft>) => setDrafts((p) => p.map((d) => {
    if (d.key !== key) return d;
    const next = { ...d, ...patch };
    if (patch.itemName !== undefined && sheet) {
      const hit = sheet.items.find((i) => i.itemName.toLowerCase() === patch.itemName!.toLowerCase());
      if (hit && !next.unit) next.unit = hit.unit; // unit follows the item, but never overwrites a typed one
    }
    return next;
  }));

  const drop = (d: Draft) => {
    if (d.id) setRemoved((p) => [...p, d.id!]);
    setDrafts((p) => p.filter((x) => x.key !== d.key));
  };

  const shown = useMemo(
    () => (sheet?.stations ?? []).filter((st) => st.ran || st.lines.length > 0),
    [sheet],
  );

  const save = async () => {
    if (!sheet) return;
    setBusy(true); setNote(null);
    // A line with no item name is the empty row nobody filled in — dropped, not
    // refused, because refusing it would make the pre-filled sheet a trap.
    const edits = drafts
      .filter((d) => d.itemName.trim() && d.station)
      .map((d) => ({
        id: d.id, station: d.station, itemName: d.itemName.trim(),
        quantity: Number(d.quantity || 0), unit: d.unit.trim() || "PCS",
        unitPrice: d.unitPrice.trim() === "" ? null : Number(d.unitPrice),
        operatorName: d.operatorName.trim() || null,
      }));
    if (edits.length === 0 && removed.length === 0) {
      setBusy(false); setNote({ ok: false, text: "Nothing to save yet — type an item on a line." }); return;
    }
    try {
      const res = await readJson<Sheet & { saved: number; deleted: number }>(await fetch(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchKey, edits, deletes: removed }),
      }));
      if (!res.ok || !res.data) { setNote({ ok: false, text: res.error ?? "Could not save." }); setBusy(false); return; }
      const r = res.data;
      seed(r);
      setNote({ ok: true, text: `Saved ${r.saved} line${r.saved === 1 ? "" : "s"}${r.deleted ? `, removed ${r.deleted}` : ""}.` });
      onSaved?.();
    } catch {
      setNote({ ok: false, text: "Could not reach the server." });
    }
    setBusy(false);
  };

  if (error) return <Card><Empty>{error}</Empty></Card>;
  if (!sheet) return <Card><Empty>Loading what this batch consumed…</Empty></Card>;

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Consumables used{batchLabel ? ` — batch ${batchLabel}` : ""}
        </h2>
        <span className="text-[11px] text-gray-400">Quantity and unit price only — this screen never multiplies them.</span>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Every station this batch actually passed, with whoever the batch&apos;s own records name there. Lines the floor
        logged are marked <span className="rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-medium text-emerald-700">from the floor</span>;
        anything else is what you enter here. Set the price against each line.
      </p>

      {shown.length === 0 ? (
        <Empty>This batch has no station records yet, so there is nothing to account for.</Empty>
      ) : (
        <div className="space-y-4">
          {shown.map((st) => {
            const rows = drafts.filter((d) => d.station === st.station);
            return (
              <div key={st.station} className="rounded-xl border border-gray-200">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-3 py-2">
                  <div className="text-sm font-semibold text-gray-800">
                    {st.label}
                    <span className="ml-2 text-xs font-normal text-gray-400">{st.department}</span>
                  </div>
                  <div className="text-xs text-gray-600">
                    {st.operators.length
                      ? <>On the machine: <span className="font-medium text-gray-800">{st.operators.join(", ")}</span></>
                      : <span className="text-gray-400">No operator named on this batch&apos;s records</span>}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 w-28">Consumed</th>
                        <th className="px-3 py-2 w-24">Unit</th>
                        <th className="px-3 py-2 w-32">Price / unit</th>
                        <th className="px-3 py-2 w-44">Person</th>
                        <th className="px-3 py-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d) => (
                        <tr key={d.key} className="border-t border-gray-100 align-top">
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {sheet.items.length > 0 ? (
                                <select value={sheet.items.some((i) => i.itemName === d.itemName) ? d.itemName : ADD_NEW}
                                  onChange={(e) => upd(d.key, { itemName: e.target.value === ADD_NEW ? "" : e.target.value })}
                                  className={`${inp} min-w-[150px]`}>
                                  <option value="">— pick item —</option>
                                  {sheet.items.map((i) => <option key={i.itemName} value={i.itemName}>{i.itemName}</option>)}
                                  <option value={ADD_NEW}>Type a name…</option>
                                </select>
                              ) : null}
                              {(sheet.items.length === 0 || !sheet.items.some((i) => i.itemName === d.itemName)) && (
                                <input value={d.itemName} onChange={(e) => upd(d.key, { itemName: e.target.value })}
                                  placeholder="Item name" className={`${inp} min-w-[140px]`} />
                              )}
                            </div>
                            {d.fromFloor && (
                              <span className="mt-1 inline-block rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-medium text-emerald-700">from the floor</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="number" step="any" min="0" value={d.quantity}
                              onChange={(e) => upd(d.key, { quantity: e.target.value })} className={inp} />
                          </td>
                          <td className="px-3 py-1.5">
                            <input value={d.unit} onChange={(e) => upd(d.key, { unit: e.target.value })}
                              placeholder="KG" className={inp} />
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="number" step="any" min="0" value={d.unitPrice}
                              onChange={(e) => upd(d.key, { unitPrice: e.target.value })}
                              placeholder="₹ / unit" className={inp} />
                            {d.pricedBy && d.unitPrice !== "" && (
                              <span className="mt-0.5 block text-[10px] text-gray-400">priced by {d.pricedBy}</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <input list={`ops-${st.station}`} value={d.operatorName}
                              onChange={(e) => upd(d.key, { operatorName: e.target.value })}
                              placeholder={st.operators[0] ?? "who was there"} className={inp} />
                            <datalist id={`ops-${st.station}`}>
                              {st.operators.map((o) => <option key={o} value={o} />)}
                            </datalist>
                          </td>
                          <td className="px-3 py-1.5">
                            <button type="button" onClick={() => drop(d)}
                              title="Remove this line"
                              className="text-xs text-gray-400 transition hover:text-red-600">✕</button>
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr className="border-t border-gray-100">
                          <td colSpan={6} className="px-3 py-2 text-xs text-gray-400">Nothing recorded here yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-gray-100 px-3 py-2">
                  <button type="button"
                    onClick={() => setDrafts((p) => [...p, blank(st.station, st.operators[0] ?? "")])}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50">
                    + line at {st.label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sheet.unplaced.length > 0 && (
        <p className="mt-3 text-xs text-amber-700">
          {sheet.unplaced.length} line(s) on this batch name a station that is not on the list above. They are kept and shown, unedited, so nothing is lost.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={save}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60">
          {busy ? "Saving…" : "Save the sheet"}
        </button>
        <button type="button" disabled={busy} onClick={() => void load()}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60">
          Discard changes
        </button>
        {note && <span className={`text-sm ${note.ok ? "text-green-700" : "text-red-600"}`}>{note.text}</span>}
      </div>
    </Card>
  );
}
