"use client";
// "+ Consumables" toggle under each machine entry form: tap to open a small
// panel, add item+qty lines, log them. Entries carry the machine's department
// into the consumables dashboard; stock decrements (floor 0). Fully separate
// from the main entry form — it can never block or alter a slab save.
//
// THE DROPDOWN WAS ALWAYS HERE AND NOBODY HAD EVER SEEN IT. It renders only
// when `items` is non-empty, `items` is the store's inventory, and that table
// held ZERO rows on 2026-09-04 — so every operator got the free-text fallback
// and the plant reported "we just have a text box". The list could not fill up,
// either, because nothing on the floor could add to it: "Other (type
// manually)" saved an unlinked entry and left the list exactly as empty as it
// found it. So the panel now ADDS: type a name, press enter, and it becomes a
// real stock item that everyone sees from that moment (owner, 2026-09-04).
import { useState, useTransition } from "react";
import { logConsumables } from "@/lib/consumables/quickLog";
import { addConsumableItem } from "@/lib/consumables/items";

export interface ConsumableItem { itemName: string; unit: string; currentStock: number }

/** One consumable on the panel. Several are the normal case — an hour at a
 *  machine draws gloves and emery and grease — so "+ line" adds another and
 *  every line is saved in one go.
 *
 *  `key` IS WHY THIS IS NOT AN ARRAY INDEX. The panel was written keyed by
 *  position, and position is the one thing about a line that changes: remove
 *  the first of three and every line below it shifts up, so React reuses the
 *  removed row's DOM for its neighbour and the open "add an item" panel — which
 *  remembered a NUMBER — reattaches itself to the wrong line. An identity that
 *  the line keeps for its whole life removes the class of bug rather than the
 *  instance of it. */
interface Line { key: string; itemName: string; quantity: string; unit: string }

let lineSeq = 0;
const blankLine = (): Line => ({ key: `l${++lineSeq}`, itemName: "", quantity: "", unit: "" });

/** The select's escape hatch. A sentinel rather than an empty value so that
 *  "nothing picked" and "I want to add one" stay distinguishable. */
const ADD_NEW = "__add_new__";

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
  // The list is STATE, not the prop: adding an item has to put it in the
  // dropdown at once, on this page, without a reload. The prop is the seed.
  const [list, setList] = useState<ConsumableItem[]>(items);
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);
  const [batchNo, setBatchNo] = useState(batch ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The add-an-item row: WHICH LINE asked for it (by key, not position), and
  // what is being typed.
  const [adding, setAdding] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [addPending, startAdd] = useTransition();

  const upd = (key: string, patch: Partial<Line>) => setLines((p) => p.map((l) => {
    if (l.key !== key) return l;
    const next = { ...l, ...patch };
    if (patch.itemName !== undefined) {
      const hit = list.find((x) => x.itemName.toLowerCase() === patch.itemName!.toLowerCase());
      if (hit) next.unit = hit.unit; // unit follows the picked item
    }
    return next;
  }));

  /** Create the item, put it in the dropdown, and select it on the line that
   *  asked. An item that already existed is selected rather than refused —
   *  the operator wanted an item by that name and there is one. */
  const addItem = (key: string) => startAdd(async () => {
    const name = newName.trim();
    if (name.length < 2) { setAddMsg("Type the item's name first."); return; }
    setAddMsg(null);
    try {
      const r = await addConsumableItem(model, name, newUnit);
      if (!r.ok) { setAddMsg(r.error); return; }
      setList((p) => (p.some((x) => x.itemName.toLowerCase() === r.item.itemName.toLowerCase())
        ? p
        : [...p, r.item].sort((a, b) => a.itemName.localeCompare(b.itemName))));
      upd(key, { itemName: r.item.itemName, unit: r.item.unit });
      setAdding(null); setNewName(""); setNewUnit("");
      setMsg(r.existed ? `“${r.item.itemName}” was already on the list — picked it.` : `✓ Added “${r.item.itemName}” to the list`);
    } catch {
      setAddMsg("Could not reach the server — try again.");
    }
  });

  const save = () => start(async () => {
    const payload = lines.map((l) => ({ itemName: l.itemName.trim(), quantity: Number(l.quantity), unit: l.unit.trim() || "PCS" }))
      .filter((l) => l.itemName && Number.isFinite(l.quantity) && l.quantity > 0);
    if (payload.length === 0) { setMsg("Add an item and quantity first."); return; }
    try {
      const r = await logConsumables(model, payload, { batch: batchNo });
      if (r === "ok") {
        setMsg(`✓ Logged ${payload.length} item${payload.length === 1 ? "" : "s"} to ${dept}${batchNo.trim() ? ` on batch ${batchNo.trim()}` : ""}`);
        setLines([blankLine()]);
        setAdding(null);
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
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-600">Batch</span>
            <input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="e.g. D1425"
              className={`${inp} w-40`} />
            <span className="text-[11px] text-gray-400">so it shows on that batch&apos;s sign-off sheet</span>
          </label>

          {lines.map((l) => (
            <div key={l.key} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <select value={l.itemName} className={`${inp} min-w-[200px] flex-1`}
                  onChange={(e) => {
                    if (e.target.value === ADD_NEW) { setAdding(l.key); setAddMsg(null); setNewName(""); setNewUnit(""); }
                    else upd(l.key, { itemName: e.target.value });
                  }}>
                  <option value="">{list.length ? "— pick item —" : "— no items yet, add one —"}</option>
                  {list.map((it) => (
                    <option key={it.itemName} value={it.itemName}>{it.itemName} · {it.unit} · {Math.round(it.currentStock)} in stock</option>
                  ))}
                  <option value={ADD_NEW}>+ Add a new item…</option>
                </select>
                <input type="number" step="any" min="0" value={l.quantity} onChange={(e) => upd(l.key, { quantity: e.target.value })}
                  placeholder="Qty" className={`${inp} w-24`} />
                <input value={l.unit} onChange={(e) => upd(l.key, { unit: e.target.value })} placeholder="Unit" className={`${inp} w-20`} />
                {lines.length > 1 && (
                  <button type="button" title="Remove this line"
                    onClick={() => {
                      // Close the add panel if it belonged to the line going
                      // away, or it would hang open over somebody else's row.
                      setAdding((a) => (a === l.key ? null : a));
                      setLines((p) => p.filter((x) => x.key !== l.key));
                    }}
                    className="text-xs text-gray-400 hover:text-red-600">✕</button>
                )}
              </div>

              {adding === l.key && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/25 bg-brand/[0.03] p-2">
                  <input value={newName} autoFocus placeholder="New item name"
                    onChange={(e) => { setNewName(e.target.value); setAddMsg(null); }}
                    // Enter adds it — the owner asked for "type and press enter".
                    // The panel is not inside the entry <form>, so this cannot
                    // submit a slab; it is still handled explicitly so a stray
                    // keypress can never do anything but add an item.
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(l.key); } if (e.key === "Escape") setAdding(null); }}
                    className={`${inp} min-w-[180px] flex-1`} />
                  <input value={newUnit} placeholder="Unit (e.g. KG)"
                    onChange={(e) => setNewUnit(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(l.key); } if (e.key === "Escape") setAdding(null); }}
                    className={`${inp} w-28`} />
                  <button type="button" disabled={addPending} onClick={() => addItem(l.key)}
                    className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
                    {addPending ? "Adding…" : "Add to list"}
                  </button>
                  <button type="button" onClick={() => setAdding(null)}
                    className="rounded-lg border border-gray-300 px-2.5 py-2 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
                  {addMsg && <span className="text-xs text-red-600">{addMsg}</span>}
                  <span className="basis-full text-[11px] text-gray-400">Everyone sees it in this list from now on, and the store can set its opening stock.</span>
                </div>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" onClick={() => setLines((p) => [...p, blankLine()])}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">+ another consumable</button>
            <button type="button" disabled={pending} onClick={save}
              className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
              {pending ? "Logging…" : "Log consumables"}
            </button>
            {msg && <span className={`text-xs ${msg.startsWith("✓") ? "text-emerald-600" : msg.startsWith("“") ? "text-gray-600" : "text-red-600"}`}>{msg}</span>}
          </div>
          <p className="text-[11px] text-gray-400">Goes to the Consumables dashboard under {dept}; known items reduce stock (never below 0). Separate from the slab entry above.</p>
        </div>
      )}
    </div>
  );
}
