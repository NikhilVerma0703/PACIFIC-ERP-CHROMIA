"use client";
// "+ Consumables" toggle under each machine entry form: tap to open a small
// panel, pick item+qty lines, log them. Entries carry the machine's department
// into the consumables dashboard; stock decrements (floor 0). Fully separate
// from the main entry form — it can never block or alter a slab save.
//
// DROPDOWN ONLY, BY DECISION (owner, 2026-09-04: "only dropdown"). The list is
// the store's inventory and nothing else: no free-text fallback, no adding an
// item from the floor. An item the floor cannot find is an item the store has
// not set up yet, and the panel says so rather than letting a spelling be
// invented at the machine. For one day this panel could create stock items by
// typing a name and pressing enter; that was removed the same day, because
// master data belongs to the store.
//
// THE LIST WAS EMPTY ON 2026-09-04 (0 stock rows), which is why the panel had
// only ever shown a text box: it rendered the select only when handed items.
// Until the store adds items, this panel has nothing to offer and says so.
import { useState, useTransition } from "react";
import { logConsumables } from "@/lib/consumables/quickLog";

export interface ConsumableItem { itemName: string; unit: string; currentStock: number }

/** One consumable on the panel. Several are the normal case — an hour at a
 *  machine draws gloves and emery and grease — so "+ another consumable" adds
 *  a line and every line is saved in one go.
 *
 *  `key` is a stable identity, not an array index: remove the first of three
 *  and every line below it shifts up, so a position-keyed row would have React
 *  reuse the removed row's DOM for its neighbour. */
interface Line { key: string; itemName: string; quantity: string; unit: string }

let lineSeq = 0;
const blankLine = (): Line => ({ key: `l${++lineSeq}`, itemName: "", quantity: "", unit: "" });

export function ConsumablesQuickLog({ model, dept, items, batch }: {
  model: string;
  dept: string;
  items: ConsumableItem[];
  /** The batch this station is running, when the page knows it. The panel asks
   *  for it either way — a line with no batch is invisible on that batch's
   *  sign-off sheet, which is the one place these lines are read. */
  batch?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);
  const [batchNo, setBatchNo] = useState(batch ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const upd = (key: string, patch: Partial<Line>) => setLines((p) => p.map((l) => {
    if (l.key !== key) return l;
    const next = { ...l, ...patch };
    if (patch.itemName !== undefined) {
      const hit = items.find((x) => x.itemName === patch.itemName);
      if (hit) next.unit = hit.unit; // unit follows the picked item
    }
    return next;
  }));

  const save = () => start(async () => {
    const payload = lines.map((l) => ({ itemName: l.itemName.trim(), quantity: Number(l.quantity), unit: l.unit.trim() || "PCS" }))
      .filter((l) => l.itemName && Number.isFinite(l.quantity) && l.quantity > 0);
    if (payload.length === 0) { setMsg("Pick an item and enter a quantity first."); return; }
    try {
      const r = await logConsumables(model, payload, { batch: batchNo });
      if (r === "ok") {
        setMsg(`✓ Logged ${payload.length} item${payload.length === 1 ? "" : "s"} to ${dept}${batchNo.trim() ? ` on batch ${batchNo.trim()}` : ""}`);
        setLines([blankLine()]);
      } else setMsg(r);
    } catch {
      setMsg("Could not reach the server — check the connection and try again."); // never bubbles to the page
    }
  });

  const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline">
        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand/10 text-xs transition ${open ? "rotate-45" : ""}`}>+</span>
        Consumables used {open ? "" : `— log items for ${dept}`}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {items.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No consumables are set up yet. Items are added by the store on the Consumables dashboard; once they are, they appear here.
            </p>
          )}

          {/* REQUIRED, because a line with no batch is read by nothing. The
              sign-off sheet is the only place these lines are shown, and it
              looks them up by batch — so a blank box does not mean "log it
              anyway", it means "log it where nobody will ever see it". */}
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-600">Batch<span className="text-red-500"> *</span></span>
            <input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="e.g. D1425"
              className={`${inp} w-40 ${batchNo.trim() ? "" : "border-amber-400"}`} />
            <span className="text-[11px] text-gray-400">the batch running at this machine — it is what puts the item on that batch&apos;s sign-off sheet</span>
          </label>

          {lines.map((l) => (
            <div key={l.key} className="flex flex-wrap items-center gap-2">
              <select value={l.itemName} disabled={items.length === 0} className={`${inp} min-w-[200px] flex-1 disabled:bg-gray-50 disabled:text-gray-400`}
                onChange={(e) => upd(l.key, { itemName: e.target.value })}>
                <option value="">{items.length ? "— pick item —" : "— no items set up yet —"}</option>
                {items.map((it) => (
                  <option key={it.itemName} value={it.itemName}>{it.itemName} · {it.unit} · {Math.round(it.currentStock)} in stock</option>
                ))}
              </select>
              <input type="number" step="any" min="0" value={l.quantity} onChange={(e) => upd(l.key, { quantity: e.target.value })}
                placeholder="Qty" className={`${inp} w-24`} />
              {/* The unit is the item's, fixed by the store — the same rule the
                  dashboard states ("counted in this unit"). A retyped unit
                  would decrement a PCS-counted stock in KG; the server saves
                  the item's unit regardless, so this is display, not input. */}
              <span className="inline-flex h-[38px] w-20 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">{l.unit || "—"}</span>
              {lines.length > 1 && (
                <button type="button" title="Remove this line"
                  onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                  className="text-xs text-gray-400 hover:text-red-600">✕</button>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" disabled={items.length === 0} onClick={() => setLines((p) => [...p, blankLine()])}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60">+ another consumable</button>
            <button type="button" disabled={pending || items.length === 0} onClick={save}
              className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
              {pending ? "Logging…" : "Log consumables"}
            </button>
            {msg && <span className={`text-xs ${msg.startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>{msg}</span>}
          </div>
          <p className="text-[11px] text-gray-400">Goes to the Consumables dashboard under {dept} and reduces that item&apos;s stock (never below 0). Separate from the slab entry above.</p>
        </div>
      )}
    </div>
  );
}
