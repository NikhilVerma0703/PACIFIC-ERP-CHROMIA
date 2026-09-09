"use client";
// The challan form itself — shared by "new challan" and the draft editor on a
// challan's own page, so the two cannot ask for different things.
//
// The consignee may be a client from the master (picked by search, which fills
// the address and the GSTIN) or free text: a display slab going to a showroom
// that is not a customer yet still needs a challan.
import { useCallback, useEffect, useRef, useState } from "react";
import { H2 } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { CHALLAN_UNITS, challanTotals, challanWords, normaliseChallanItems } from "@/lib/commercial/challan-rules";
import type { ChallanItem } from "@/lib/commercial/types";
import { inp, lbl, btnGhost, th, thead, money } from "@/components/commercial/invoices/ui";

export interface ChallanRow {
  description: string;
  qty: string;
  unit: string;
  sqft: string;
  rate: string;
  amount: string;
  hsn: string;
}

export interface ChallanDraft {
  challanDate: string;
  orderId: string;
  consigneeClientId: string;
  consigneeName: string;
  consigneeAddress: string;
  consigneeGstin: string;
  poRef: string;
  commodity: string;
  purpose: string;
  lorryNo: string;
  notes: string;
  numberOverride: string;
  items: ChallanRow[];
}

export const emptyRow = (): ChallanRow => ({ description: "", qty: "", unit: "Nos", sqft: "", rate: "", amount: "", hsn: "" });

export function emptyDraft(date: string, orderId = ""): ChallanDraft {
  return {
    challanDate: date, orderId,
    consigneeClientId: "", consigneeName: "", consigneeAddress: "", consigneeGstin: "",
    poRef: "Verbal", commodity: "Artificial Quartz Slabs", purpose: "",
    lorryNo: "", notes: "", numberOverride: "",
    items: [emptyRow(), emptyRow()],
  };
}

/** The draft as the API wants it. Blank rows are dropped by the rules module. */
export function draftToBody(d: ChallanDraft): Record<string, unknown> {
  return {
    challanDate: d.challanDate,
    orderId: d.orderId || null,
    consigneeClientId: d.consigneeClientId || null,
    consigneeName: d.consigneeName,
    consigneeAddress: d.consigneeAddress || null,
    consigneeGstin: d.consigneeGstin || null,
    poRef: d.poRef || null,
    commodity: d.commodity || null,
    purpose: d.purpose || null,
    lorryNo: d.lorryNo || null,
    notes: d.notes || null,
    numberOverride: d.numberOverride || null,
    items: d.items.map((r) => ({
      description: r.description,
      qty: r.qty === "" ? 0 : Number(r.qty),
      unit: r.unit,
      sqft: r.sqft === "" ? null : Number(r.sqft),
      rate: r.rate === "" ? 0 : Number(r.rate),
      amount: r.amount === "" ? null : Number(r.amount),
      hsn: r.hsn || null,
    })),
  };
}

/** Stored items → editable rows. */
export function rowsFromItems(items: ChallanItem[] | null | undefined): ChallanRow[] {
  const rows = (items ?? []).map((i) => ({
    description: i.description ?? "",
    qty: i.qty === null || i.qty === undefined ? "" : String(i.qty),
    unit: i.unit || "Nos",
    sqft: i.sqft === null || i.sqft === undefined ? "" : String(i.sqft),
    rate: i.rate === null || i.rate === undefined ? "" : String(i.rate),
    amount: i.amount === null || i.amount === undefined ? "" : String(i.amount),
    hsn: i.hsn ?? "",
  }));
  return rows.length ? rows : [emptyRow()];
}

interface ClientRow { id: string; name: string; country?: string | null }

function ClientPicker({ value, onPick, disabled }: { value: string; onPick: (c: ClientRow | null) => void; disabled?: boolean }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (text: string) => {
    const r = await fetch(`/api/office/commercial/clients?q=${encodeURIComponent(text)}&limit=10`, { cache: "no-store" });
    const res = await readJson<{ items?: ClientRow[] } | ClientRow[]>(r);
    if (!res.ok) { setError(res.error ?? "Could not search the client master"); setRows([]); return; }
    setError(null);
    const data = res.data;
    setRows(Array.isArray(data) ? data : (data?.items ?? []));
  }, []);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void search(q); }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, open, search]);

  return (
    <div>
      <label className={lbl} htmlFor="ch-client">Consignee from the client master</label>
      <div className="flex gap-2">
        <input id="ch-client" className={inp} disabled={disabled} placeholder="Search a client, or leave blank and type the name below"
          value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
        {value && <button type="button" className={btnGhost} disabled={disabled} onClick={() => { onPick(null); setQ(""); setOpen(false); }}>Clear</button>}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {open && rows.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white text-sm shadow-sm">
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                onClick={() => { onPick(c); setQ(c.name); setOpen(false); }}>
                {c.name}{c.country ? <span className="ml-2 text-xs text-gray-400">{c.country}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ChallanFields({ draft, setDraft, disabled = false, showNumberOverride = true }: {
  draft: ChallanDraft;
  setDraft: (next: ChallanDraft) => void;
  disabled?: boolean;
  showNumberOverride?: boolean;
}) {
  const set = (patch: Partial<ChallanDraft>) => setDraft({ ...draft, ...patch });
  const setRow = (i: number, patch: Partial<ChallanRow>) => {
    const items = draft.items.map((r, j) => (j === i ? { ...r, ...patch } : r));
    set({ items });
  };
  const totals = challanTotals(normaliseChallanItems(draftToBody(draft).items));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <label className={lbl} htmlFor="ch-date">Challan date</label>
          <input id="ch-date" type="date" className={inp} disabled={disabled} value={draft.challanDate} onChange={(e) => set({ challanDate: e.target.value })} />
        </div>
        <div>
          <label className={lbl} htmlFor="ch-po">PO no &amp; date</label>
          <input id="ch-po" className={inp} disabled={disabled} value={draft.poRef} onChange={(e) => set({ poRef: e.target.value })} placeholder="Verbal" />
        </div>
        <div>
          <label className={lbl} htmlFor="ch-commodity">Commodity</label>
          <input id="ch-commodity" className={inp} disabled={disabled} value={draft.commodity} onChange={(e) => set({ commodity: e.target.value })} />
        </div>
        <div>
          <label className={lbl} htmlFor="ch-lorry">Lorry no</label>
          <input id="ch-lorry" className={inp} disabled={disabled} value={draft.lorryNo} onChange={(e) => set({ lorryNo: e.target.value })} />
        </div>
      </div>

      <div>
        <H2>Consignee</H2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ClientPicker
            value={draft.consigneeClientId}
            disabled={disabled}
            onPick={(c) => set(c
              ? { consigneeClientId: c.id, consigneeName: c.name }
              : { consigneeClientId: "", consigneeName: "" })}
          />
          <div>
            <label className={lbl} htmlFor="ch-name">Consignee name</label>
            <input id="ch-name" className={inp} disabled={disabled} value={draft.consigneeName} onChange={(e) => set({ consigneeName: e.target.value })} placeholder="Pacific Granites (India) Pvt Ltd" />
          </div>
          <div className="md:col-span-2">
            <label className={lbl} htmlFor="ch-addr">Consignee address (one line per printed line)</label>
            <textarea id="ch-addr" className={inp} rows={3} disabled={disabled} value={draft.consigneeAddress} onChange={(e) => set({ consigneeAddress: e.target.value })} />
          </div>
          <div>
            <label className={lbl} htmlFor="ch-gstin">Consignee GSTIN</label>
            <input id="ch-gstin" className={inp} disabled={disabled} value={draft.consigneeGstin} onChange={(e) => set({ consigneeGstin: e.target.value.toUpperCase() })} />
          </div>
          <div>
            <label className={lbl} htmlFor="ch-order">Order id (optional — links the challan to an order)</label>
            <input id="ch-order" className={inp} disabled={disabled} value={draft.orderId} onChange={(e) => set({ orderId: e.target.value })} placeholder="Leave blank for a standalone challan" />
          </div>
        </div>
      </div>

      <div>
        <H2>Lines</H2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={thead}>
                <th className={th}>Material description</th>
                <th className={th}>Qty</th>
                <th className={th}>Unit</th>
                <th className={th}>SQFT</th>
                <th className={th}>Rate</th>
                <th className={th}>Amount (approx)</th>
                <th className={th}>HSN</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {draft.items.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0 align-top">
                  <td className="py-1.5 pr-2 min-w-[16rem]"><input className={inp} disabled={disabled} value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} aria-label={`Line ${i + 1} description`} /></td>
                  <td className="py-1.5 pr-2 w-20"><input className={inp} disabled={disabled} inputMode="decimal" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} aria-label={`Line ${i + 1} quantity`} /></td>
                  <td className="py-1.5 pr-2 w-24">
                    <select className={inp} disabled={disabled} value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} aria-label={`Line ${i + 1} unit`}>
                      {CHALLAN_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 pr-2 w-24"><input className={inp} disabled={disabled} inputMode="decimal" value={r.sqft} onChange={(e) => setRow(i, { sqft: e.target.value })} aria-label={`Line ${i + 1} square feet`} /></td>
                  <td className="py-1.5 pr-2 w-24"><input className={inp} disabled={disabled} inputMode="decimal" value={r.rate} onChange={(e) => setRow(i, { rate: e.target.value })} aria-label={`Line ${i + 1} rate`} /></td>
                  <td className="py-1.5 pr-2 w-28"><input className={inp} disabled={disabled} inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} placeholder="auto" aria-label={`Line ${i + 1} amount`} /></td>
                  <td className="py-1.5 pr-2 w-28"><input className={inp} disabled={disabled} value={r.hsn} onChange={(e) => setRow(i, { hsn: e.target.value })} aria-label={`Line ${i + 1} HSN`} /></td>
                  <td className="py-1.5">
                    {!disabled && draft.items.length > 1 && (
                      <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => set({ items: draft.items.filter((_, j) => j !== i) })}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!disabled && <button type="button" className={`${btnGhost} mt-3`} onClick={() => set({ items: [...draft.items, emptyRow()] })}>Add a line</button>}
        <p className="mt-2 text-xs text-gray-400">Leave Amount blank and it is worked out: rate × SQFT when the line has an area, rate × quantity otherwise.</p>
        <div className="mt-3 flex justify-end">
          <dl className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">Total SQFT</dt><dd className="text-gray-900">{totals.totalSqft || "—"}</dd></div>
            <div className="flex justify-between border-t border-gray-100 pt-1 font-semibold"><dt>Grand total</dt><dd>{money(totals.totalAmount, "INR")}</dd></div>
            <div className="pt-1 text-xs text-gray-500">{challanWords(totals.totalAmount)}</div>
          </dl>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={lbl} htmlFor="ch-purpose">Purpose / first printed note</label>
          <textarea id="ch-purpose" className={inp} rows={2} disabled={disabled} value={draft.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="Note: Please note that these items are for display purposes only and not for sale" />
        </div>
        <div>
          <label className={lbl} htmlFor="ch-notes">Internal notes</label>
          <textarea id="ch-notes" className={inp} rows={2} disabled={disabled} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
        {showNumberOverride && (
          <div>
            <label className={lbl} htmlFor="ch-override">Challan number (leave blank to take the next one)</label>
            <input id="ch-override" className={inp} disabled={disabled} value={draft.numberOverride} onChange={(e) => set({ numberOverride: e.target.value })} placeholder="PESPL/DC/20/26" />
          </div>
        )}
      </div>
    </div>
  );
}
