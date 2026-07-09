"use client";
// "+ Consumables" toggle under each machine entry form: tap to open a small
// panel, add item+qty lines, log them. Entries carry the machine's department
// into the consumables dashboard; stock decrements (floor 0). Fully separate
// from the main entry form — it can never block or alter a slab save.
import { useState, useTransition } from "react";
import { logConsumables } from "@/lib/consumables/quickLog";

export interface ConsumableItem { itemName: string; unit: string; currentStock: number }
interface Line { itemName: string; quantity: string; unit: string; custom?: boolean }

export function ConsumablesQuickLog({ model, dept, items }: { model: string; dept: string; items: ConsumableItem[] }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ itemName: "", quantity: "", unit: "" }]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const upd = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, k) => {
    if (k !== i) return l;
    const next = { ...l, ...patch };
    if (patch.itemName !== undefined) {
      const hit = items.find((x) => x.itemName.toLowerCase() === patch.itemName!.toLowerCase());
      if (hit) next.unit = hit.unit; // unit follows the picked item
    }
    return next;
  }));

  const save = () => start(async () => {
    const payload = lines.map((l) => ({ itemName: l.itemName.trim(), quantity: Number(l.quantity), unit: l.unit.trim() || "PCS" }))
      .filter((l) => l.itemName && Number.isFinite(l.quantity) && l.quantity > 0);
    if (payload.length === 0) { setMsg("Add an item and quantity first."); return; }
    try {
      const r = await logConsumables(model, payload);
      if (r === "ok") { setMsg(`✓ Logged ${payload.length} item(s) to ${dept}`); setLines([{ itemName: "", quantity: "", unit: "" }]); }
      else setMsg(r);
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
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              {items.length > 0 && !l.custom ? (
                <select value={l.itemName} className={`${inp} min-w-[200px] flex-1`}
                  onChange={(e) => e.target.value === "__other__" ? upd(i, { itemName: "", custom: true }) : upd(i, { itemName: e.target.value })}>
                  <option value="">— pick item —</option>
                  {items.map((it) => (
                    <option key={it.itemName} value={it.itemName}>{it.itemName} · {it.unit} · {Math.round(it.currentStock)} in stock</option>
                  ))}
                  <option value="__other__">Other (type manually)…</option>
                </select>
              ) : (
                <span className="flex min-w-[200px] flex-1 items-center gap-1">
                  <input value={l.itemName} onChange={(e) => upd(i, { itemName: e.target.value })}
                    placeholder="Item name" className={`${inp} flex-1`} autoFocus={!!l.custom} />
                  {items.length > 0 && (
                    <button type="button" title="Back to the item list" onClick={() => upd(i, { itemName: "", custom: false })}
                      className="rounded border border-gray-200 px-1.5 py-1 text-[10px] text-gray-500 hover:bg-gray-50">list</button>
                  )}
                </span>
              )}
              <input type="number" step="any" min="0" value={l.quantity} onChange={(e) => upd(i, { quantity: e.target.value })}
                placeholder="Qty" className={`${inp} w-24`} />
              <input value={l.unit} onChange={(e) => upd(i, { unit: e.target.value })} placeholder="Unit" className={`${inp} w-20`} />
              {lines.length > 1 && (
                <button type="button" onClick={() => setLines((p) => p.filter((_, k) => k !== i))} className="text-xs text-gray-400 hover:text-red-600">✕</button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" onClick={() => setLines((p) => [...p, { itemName: "", quantity: "", unit: "" }])}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">+ line</button>
            <button type="button" disabled={pending} onClick={save}
              className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
              {pending ? "Logging…" : "Log consumables"}
            </button>
            {msg && <span className={`text-xs ${msg.startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>{msg}</span>}
          </div>
          <p className="text-[11px] text-gray-400">Goes to the Consumables dashboard under {dept}; known items reduce stock (never below 0). Separate from the slab entry above.</p>
        </div>
      )}
    </div>
  );
}
