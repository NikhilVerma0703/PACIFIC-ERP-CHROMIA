"use client";
// The order's lines. One row per line, editable in place, plus a row at the
// bottom for the next one.
//
// THE AMOUNT BOX IS THE INTERESTING ONE. Leave it empty and the server works
// it out as qty × rate at 3 dp. Type a figure and that figure stands, because
// the reference proforma's total is NOT qty × rate at printed precision and
// re-deriving it would print a number the customer never agreed to. So the box
// says which of the two is happening rather than silently overwriting.
import { useEffect, useMemo, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { postJson, patchJson, deleteJson } from "@/lib/fab/postJson";
import { THICKNESS_OPTS } from "@/lib/thickness";
import { orderTotals, itemAmount } from "@/lib/commercial/orders-rules";
import type { OrderTabProps, OrderItemDto } from "@/lib/commercial/types";
import { BTN_DANGER, BTN_PRIMARY, ErrorNote, OkNote, money, qty as fmtQty } from "../orders/fields";

interface RowDraft {
  design: string; customerSku: string; description: string; thickness: string; finish: string;
  sizeLabel: string; gradeLabel: string; qtySlabs: string; qty: string; uom: string; rate: string;
  amount: string; hsn: string; isSample: boolean; notes: string;
}

const s = (v: string | null | undefined): string => v ?? "";
const nstr = (v: number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

function draftOf(it: OrderItemDto): RowDraft {
  return {
    design: s(it.design), customerSku: s(it.customerSku), description: s(it.description),
    thickness: s(it.thickness), finish: s(it.finish), sizeLabel: s(it.sizeLabel), gradeLabel: s(it.gradeLabel),
    qtySlabs: nstr(it.qtySlabs), qty: nstr(it.qty), uom: s(it.uom), rate: nstr(it.rate),
    amount: nstr(it.amount), hsn: s(it.hsn), isSample: Boolean(it.isSample), notes: s(it.notes),
  };
}

const blankRow = (uom: string, hsn: string): RowDraft => ({
  design: "", customerSku: "", description: "", thickness: "", finish: "", sizeLabel: "", gradeLabel: "",
  qtySlabs: "", qty: "", uom, rate: "", amount: "", hsn, isSample: false, notes: "",
});

const CELL = "w-full rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-brand disabled:bg-gray-50 disabled:text-gray-500";

export default function ItemsTab({ order, actions, refresh }: OrderTabProps) {
  const mayWrite = actions.includes("write");
  const items = order.items ?? [];
  // The unit and HSN a new line starts with: whatever the order already uses,
  // else the kind's default. Nothing here has to match the settings exactly —
  // the server fills in what the form leaves blank.
  const defaultUom = items[0]?.uom ?? (order.kind === "EXPORT" ? "Square Foot" : "SQFT");
  const defaultHsn = items[0]?.hsn ?? "68101990";

  const base = useMemo(() => Object.fromEntries(items.map((it) => [it.id, draftOf(it)])) as Record<string, RowDraft>, [items]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(base);
  const [adding, setAdding] = useState<RowDraft>(blankRow(defaultUom, defaultHsn));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { setDrafts(base); }, [base]);

  const totals = orderTotals(items);
  const setCell = (id: string, k: keyof RowDraft) => (v: string | boolean) => {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [k]: v } }));
    setNote(null);
  };
  const isDirty = (id: string) => JSON.stringify(drafts[id]) !== JSON.stringify(base[id]);

  function bodyOf(d: RowDraft): Record<string, unknown> {
    return {
      design: d.design, customerSku: d.customerSku, description: d.description, thickness: d.thickness,
      finish: d.finish, sizeLabel: d.sizeLabel, gradeLabel: d.gradeLabel,
      qtySlabs: d.qtySlabs, qty: d.qty, uom: d.uom, rate: d.rate,
      amount: d.amount, hsn: d.hsn, isSample: d.isSample, notes: d.notes,
    };
  }

  async function saveRow(id: string) {
    setBusy(id); setError(null); setNote(null);
    const res = await patchJson(`/api/office/commercial/orders/${order.id}/items/${id}`, bodyOf(drafts[id]));
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "The line was not saved."); return; }
    setNote("Line saved.");
    refresh();
  }

  async function removeRow(id: string) {
    setBusy(id); setError(null); setNote(null);
    const res = await deleteJson(`/api/office/commercial/orders/${order.id}/items/${id}`);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "The line was not removed."); return; }
    setNote("Line removed; the remaining lines were renumbered.");
    refresh();
  }

  async function addRow() {
    setBusy("new"); setError(null); setNote(null);
    const res = await postJson(`/api/office/commercial/orders/${order.id}/items`, bodyOf(adding));
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "The line was not added."); return; }
    setAdding(blankRow(defaultUom, defaultHsn));
    setNote("Line added.");
    refresh();
  }

  const addable = adding.design.trim() !== "" || adding.description.trim() !== "" || adding.customerSku.trim() !== "";

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNote>{error}</ErrorNote>}
      {note && <OkNote>{note}</OkNote>}

      <Card>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Lines</h2>
          <span className="text-xs text-gray-400">
            Amount blank = quantity × rate at 3 decimals. Type an amount to keep exactly that figure.
          </span>
        </div>

        {items.length === 0 && <div className="mb-4"><Empty>No lines on this order yet. Add the first one below.</Empty></div>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="w-10 py-2 pr-2 font-medium">#</th>
                <th className="w-40 py-2 pr-2 font-medium">Design</th>
                <th className="w-40 py-2 pr-2 font-medium">Customer SKU</th>
                <th className="w-56 py-2 pr-2 font-medium">Description</th>
                <th className="w-24 py-2 pr-2 font-medium">Thickness</th>
                <th className="w-24 py-2 pr-2 font-medium">Finish</th>
                <th className="w-28 py-2 pr-2 font-medium">Size</th>
                <th className="w-24 py-2 pr-2 font-medium">Grade</th>
                <th className="w-20 py-2 pr-2 font-medium">Slabs</th>
                <th className="w-24 py-2 pr-2 font-medium">Qty</th>
                <th className="w-28 py-2 pr-2 font-medium">UOM</th>
                <th className="w-24 py-2 pr-2 font-medium">Rate</th>
                <th className="w-28 py-2 pr-2 font-medium">Amount</th>
                <th className="w-24 py-2 pr-2 font-medium">HSN</th>
                <th className="w-16 py-2 pr-2 font-medium">Sample</th>
                <th className="w-40 py-2 pr-2 font-medium">Notes</th>
                <th className="w-36 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it) => {
                const d = drafts[it.id];
                if (!d) return null;
                const dirty = isDirty(it.id);
                const preview = itemAmount(d.qty, d.rate, d.amount.trim() === "" ? undefined : d.amount);
                return (
                  <tr key={it.id} className={d.isSample ? "bg-brand/5" : ""}>
                    <td className="py-2 pr-2 align-top text-gray-400">{it.lineNo}</td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} value={d.design} disabled={!mayWrite} onChange={(e) => setCell(it.id, "design")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} value={d.customerSku} disabled={!mayWrite} onChange={(e) => setCell(it.id, "customerSku")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} value={d.description} disabled={!mayWrite} onChange={(e) => setCell(it.id, "description")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top">
                      <input className={CELL} list="commercial-thickness" value={d.thickness} disabled={!mayWrite} onChange={(e) => setCell(it.id, "thickness")(e.target.value)} />
                    </td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} value={d.finish} disabled={!mayWrite} onChange={(e) => setCell(it.id, "finish")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} value={d.sizeLabel} disabled={!mayWrite} onChange={(e) => setCell(it.id, "sizeLabel")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} value={d.gradeLabel} disabled={!mayWrite} onChange={(e) => setCell(it.id, "gradeLabel")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} inputMode="numeric" value={d.qtySlabs} disabled={!mayWrite} onChange={(e) => setCell(it.id, "qtySlabs")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} inputMode="decimal" value={d.qty} disabled={!mayWrite} onChange={(e) => setCell(it.id, "qty")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} value={d.uom} disabled={!mayWrite} onChange={(e) => setCell(it.id, "uom")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} inputMode="decimal" value={d.rate} disabled={!mayWrite} onChange={(e) => setCell(it.id, "rate")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top">
                      <input className={CELL} inputMode="decimal" value={d.amount} placeholder="auto" disabled={!mayWrite} onChange={(e) => setCell(it.id, "amount")(e.target.value)} />
                      {d.amount.trim() === "" && preview !== null && <div className="mt-0.5 text-[11px] text-gray-400">= {fmtQty(preview)}</div>}
                    </td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} value={d.hsn} disabled={!mayWrite} onChange={(e) => setCell(it.id, "hsn")(e.target.value)} /></td>
                    <td className="py-2 pr-2 align-top text-center">
                      <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand/30"
                        checked={d.isSample} disabled={!mayWrite} onChange={(e) => setCell(it.id, "isSample")(e.target.checked)} />
                    </td>
                    <td className="py-2 pr-2 align-top"><input className={CELL} value={d.notes} disabled={!mayWrite} onChange={(e) => setCell(it.id, "notes")(e.target.value)} /></td>
                    <td className="py-2 align-top">
                      {mayWrite && (
                        <div className="flex gap-1">
                          <button type="button" className={BTN_PRIMARY + " !px-3 !py-1"} disabled={!dirty || busy !== null} onClick={() => void saveRow(it.id)}>
                            {busy === it.id ? "…" : "Save"}
                          </button>
                          <button type="button" className={BTN_DANGER} disabled={busy !== null} onClick={() => void removeRow(it.id)}>Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {mayWrite && (
                <tr className="bg-gray-50/60">
                  <td className="py-2 pr-2 align-top text-gray-400">{items.length + 1}</td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} value={adding.design} placeholder="CARRARA ROYALE" onChange={(e) => setAdding({ ...adding, design: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} value={adding.customerSku} onChange={(e) => setAdding({ ...adding, customerSku: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} list="commercial-thickness" value={adding.thickness} onChange={(e) => setAdding({ ...adding, thickness: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} value={adding.finish} onChange={(e) => setAdding({ ...adding, finish: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} value={adding.sizeLabel} onChange={(e) => setAdding({ ...adding, sizeLabel: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} value={adding.gradeLabel} onChange={(e) => setAdding({ ...adding, gradeLabel: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} inputMode="numeric" value={adding.qtySlabs} onChange={(e) => setAdding({ ...adding, qtySlabs: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} inputMode="decimal" value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} value={adding.uom} onChange={(e) => setAdding({ ...adding, uom: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} inputMode="decimal" value={adding.rate} onChange={(e) => setAdding({ ...adding, rate: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} inputMode="decimal" value={adding.amount} placeholder="auto" onChange={(e) => setAdding({ ...adding, amount: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} value={adding.hsn} onChange={(e) => setAdding({ ...adding, hsn: e.target.value })} /></td>
                  <td className="py-2 pr-2 align-top text-center">
                    <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand/30"
                      checked={adding.isSample} onChange={(e) => setAdding({ ...adding, isSample: e.target.checked })} />
                  </td>
                  <td className="py-2 pr-2 align-top"><input className={CELL} value={adding.notes} onChange={(e) => setAdding({ ...adding, notes: e.target.value })} /></td>
                  <td className="py-2 align-top">
                    <button type="button" className={BTN_PRIMARY + " !px-3 !py-1"} disabled={!addable || busy !== null} onClick={() => void addRow()}>
                      {busy === "new" ? "Adding…" : "Add line"}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <datalist id="commercial-thickness">
          {THICKNESS_OPTS.map((t) => <option key={t} value={t} />)}
        </datalist>
        {mayWrite && !addable && <p className="mt-2 text-xs text-gray-400">A new line needs at least a design, a description or a customer SKU.</p>}
      </Card>

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Totals</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Lines</div>
            <div className="text-2xl font-semibold text-gray-900">{totals.lines}</div>
            <div className="text-xs text-gray-400">{totals.goodsLines} goods · {totals.sampleLines} sample</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Slabs</div>
            <div className="text-2xl font-semibold text-gray-900">{totals.slabs}</div>
            <div className="text-xs text-gray-400">what the stock check has to find</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Quantity</div>
            <div className="text-2xl font-semibold text-gray-900">
              {Object.keys(totals.qtyByUom).length === 0 ? "—" : Object.entries(totals.qtyByUom).map(([u, n]) => `${fmtQty(n)} ${u}`).join(" · ")}
            </div>
            <div className="text-xs text-gray-400">per unit of measurement</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Order value</div>
            <div className="text-2xl font-semibold text-gray-900">{money(totals.amount, order.currency)}</div>
            <div className="text-xs text-gray-400">checklist point 7</div>
          </div>
        </div>
        {totals.hasSamples && (
          <p className="mt-4 text-sm text-gray-500">
            <Badge tone="brand">samples</Badge>{" "}
            {totals.sampleLines} line{totals.sampleLines === 1 ? "" : "s"} on this order {totals.sampleLines === 1 ? "is" : "are"} marked as a free sample — checklist point 8 asks for them by quantity and item.
          </p>
        )}
      </Card>
    </div>
  );
}
