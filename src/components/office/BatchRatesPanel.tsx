"use client";

// How this batch's materials were bought.
//
// The mixer weighs one number per material. What was bought is often several
// things, so each material can be SPLIT into lines â€” a quantity, a description
// of what that part was, and its own price. 600 kg from Aypols at â‚¹161 and 400
// from 3n Composits at â‚¹145, rather than one average nobody can reconcile.
//
// Three things the screen has to do, because the arithmetic is unforgiving:
//
//   * show the mixer's quantity next to the boxes. Someone splitting resin
//     against a figure they have to remember from another panel is how 600+400
//     gets typed against a batch that used 1,240 kg.
//   * show what is still unallocated, live, while they type â€” that is the
//     moment it can be fixed, not after a save.
//   * show the card price beside the batch price. A rate well above the card is
//     usually a correction and occasionally a typo, and only seeing both tells
//     them apart.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";

const API = "/api/office/costing-admin/batch-rates";

interface CatalogueItem {
  item: string; category: string; label: string; unit: string; hint: string; variants?: boolean;
}
interface SavedLine {
  id: string; item: string; seq: number; category: string;
  qty: number | null; rate: number; description: string; unit: string;
  savedBy: string; savedAt: string;
}
interface CardShape {
  onDate: string;
  resinBySupplier: Record<string, number>;
  rates: Record<string, number>;
}
interface Payload {
  batchKey: string;
  catalogue: CatalogueItem[];
  rows: SavedLine[];
  card: CardShape;
  /** item -> what the mixer weighed, in the item's own unit. */
  mixer: Record<string, { qty: number; unit: string }>;
}

/** A row being edited. Blank qty means "the rest". */
interface DraftLine { qty: string; rate: string; description: string }

const inp = "w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

const SPLITTABLE = new Set(["RESIN", "GRIT", "FILLER", "PIGMENT", "CHEMICAL"]);

export function BatchRatesPanel({
  batchKey, batchLabel, onSaved,
}: {
  batchKey: string;
  batchLabel: string;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftLine[]>>({});
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  // Null until the first load decides: a batch that already has lines opens
  // showing them. Anything else means someone has to click to find out whether
  // last month's numbers are still there, and a saved figure nobody can see is
  // no better than one that was never saved.
  const [open, setOpen] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}?batchKey=${encodeURIComponent(batchKey)}`, { cache: "no-store" });
      const res = await readJson<Payload>(r);
      if (!res.ok || !res.data) {
        setNote({ text: res.error ?? `Could not load (${res.status})`, ok: false });
        setOpen((v) => v ?? false);
        return;
      }
      const p = res.data;
      setData(p);
      const d: Record<string, DraftLine[]> = {};
      for (const row of p.rows) {
        (d[row.item] ??= []).push({
          qty: row.qty == null ? "" : String(row.qty),
          rate: String(row.rate),
          description: row.description ?? "",
        });
      }
      setDrafts(d);
      // First load only â€” re-reading after a save must not reopen a panel the
      // user has just closed.
      setOpen((v) => v ?? p.rows.length > 0);
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
      setOpen((v) => v ?? false);
    }
  }, [batchKey]);

  useEffect(() => { void load(); }, [load]);

  const savedItems = useMemo(
    () => [...new Set(data?.rows.map((r) => r.item) ?? [])], [data]);
  const lastSaved = data?.rows.map((r) => r.savedAt).sort().at(-1);
  const savedWhen = lastSaved
    ? new Date(lastSaved).toLocaleDateString("en-IN", { dateStyle: "medium" })
    : null;
  const savedBy = data?.rows[0]?.savedBy ?? null;

  if (open === false || open === null) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Materials for this batch
            </h2>
            {savedItems.length > 0 ? (
              <p className="mt-1 text-sm text-gray-700">
                <span className="font-medium">
                  {savedItems.length} material{savedItems.length === 1 ? "" : "s"} priced on {batchLabel}
                </span>
                {savedWhen ? ` â€” last changed ${savedWhen}` : ""}
                {savedBy ? ` by ${savedBy}` : ""}. The rest price at the card.
              </p>
            ) : (
              <p className="mt-1 text-sm text-gray-500">
                {batchLabel} prices entirely at the card. Split a material into what was actually
                bought â€” quantity, supplier, price â€” and it is kept with the batch.
              </p>
            )}
          </div>
          <button type="button" onClick={() => setOpen(true)} className={btn}>
            {savedItems.length > 0 ? "Show and edit" : "Price this batch"}
          </button>
        </div>
      </Card>
    );
  }

  if (!data) {
    return <Card><Empty>Loading the mixer quantities and the cardâ€¦</Empty></Card>;
  }

  const lineOf = (item: string): DraftLine[] => drafts[item] ?? [];
  const setLines = (item: string, next: DraftLine[]) =>
    setDrafts((p) => ({ ...p, [item]: next }));

  const cardRateFor = (c: CatalogueItem): number | null => {
    // Resin is the one item the card holds per supplier, so there is no single
    // number to show. The split is where a supplier gets named now.
    if (c.item === "resin") {
      const vals = Object.values(data.card.resinBySupplier);
      return vals.length === 1 ? vals[0] : null;
    }
    const v = data.card.rates[c.item];
    return Number.isFinite(v) ? v : null;
  };

  const save = async (c: CatalogueItem) => {
    setBusy(c.item); setNote(null);
    const lines = lineOf(c.item)
      .filter((l) => l.rate.trim() !== "")
      .map((l, i) => ({
        seq: i,
        qty: l.qty.trim() === "" ? null : Number(l.qty),
        rate: Number(l.rate),
        description: l.description,
      }));
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchKey, item: c.item, lines }),
      });
      const res = await readJson<{ error?: string }>(r);
      if (!res.ok) { setNote({ text: res.error ?? `Save failed (${res.status})`, ok: false }); return; }
      setNote({
        text: lines.length
          ? `${c.label}: ${lines.length} line${lines.length === 1 ? "" : "s"} saved. The batch has been re-costed.`
          : `${c.label} falls back to the card.`,
        ok: true,
      });
      await load();
      onSaved();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally { setBusy(""); }
  };

  const clear = async (c: CatalogueItem) => {
    setBusy(c.item); setNote(null);
    try {
      const qs = new URLSearchParams({ batchKey, item: c.item });
      const r = await fetch(`${API}?${qs}`, { method: "DELETE" });
      const res = await readJson<{ error?: string }>(r);
      if (!res.ok) { setNote({ text: res.error ?? `Could not clear (${res.status})`, ok: false }); return; }
      setLines(c.item, []);
      setNote({ text: `${c.label} falls back to the ${data.card.onDate} card.`, ok: true });
      await load();
      onSaved();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally { setBusy(""); }
  };

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Materials for this batch Â· {savedItems.length} priced here
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Quantities come from the mixer. Split a material into what was actually bought â€”
            each line gets its own quantity, description and price. Leave one line&rsquo;s
            quantity blank to mean &ldquo;the rest&rdquo;. A material with no lines prices whole
            at the card.
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

      <div className="space-y-2">
        {data.catalogue.map((c) => {
          const lines = lineOf(c.item);
          const mixer = data.mixer[c.item];
          const cardRate = cardRateFor(c);
          const splittable = SPLITTABLE.has(c.category);
          const isOpen = expanded === c.item;
          const saved = savedItems.includes(c.item);

          // Live: what the lines account for against what the mixer weighed.
          let allocated = 0;
          let hasRest = false;
          for (const l of lines) {
            if (l.qty.trim() === "") { hasRest = true; continue; }
            const q = Number(l.qty);
            if (Number.isFinite(q) && q > 0) allocated += q;
          }
          const left = mixer ? Math.round((mixer.qty - allocated) * 1000) / 1000 : null;
          const balanced = hasRest || left == null || Math.abs(left) <= 0.005;

          return (
            <div key={c.item} className={`rounded-xl border p-3 ${saved ? "border-brand/30 bg-brand/5" : "border-gray-200"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setExpanded(isOpen ? null : c.item)}
                  className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-medium text-gray-900">
                    {c.label}
                    <span className="ml-2 text-xs font-normal text-gray-400">per {c.unit}</span>
                  </span>
                  <span className="block text-xs text-gray-500">
                    {mixer
                      ? `mixer: ${num.format(mixer.qty)} ${mixer.unit}`
                      : splittable ? "no mixer quantity for this batch" : "a dosing factor"}
                    {cardRate != null ? ` Â· card â‚¹${money.format(cardRate)}` : " Â· not on the card"}
                  </span>
                </button>

                {saved && (
                  <Badge tone={balanced ? "green" : "amber"}>
                    {lines.length} line{lines.length === 1 ? "" : "s"}
                  </Badge>
                )}
                {saved && !balanced && left != null && (
                  <span className="text-xs text-amber-700">
                    {left > 0 ? `${num.format(left)} ${mixer?.unit} unallocated` : `${num.format(-left)} ${mixer?.unit} over`}
                  </span>
                )}
                <button type="button" onClick={() => setExpanded(isOpen ? null : c.item)} className={btnGhost}>
                  {isOpen ? "Done" : saved ? "Edit" : "Split"}
                </button>
              </div>

              {isOpen && (
                <div className="mt-3 border-t border-gray-200 pt-3">
                  {lines.length === 0 && (
                    <p className="mb-2 text-sm text-gray-500">
                      No lines â€” {c.label} prices whole at the card
                      {cardRate != null ? ` (â‚¹${money.format(cardRate)} per ${c.unit})` : ""}.
                    </p>
                  )}

                  {lines.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                            {splittable && <th className="pb-1 pr-3 font-medium">Quantity ({c.unit})</th>}
                            <th className="pb-1 pr-3 font-medium">Description</th>
                            <th className="pb-1 pr-3 font-medium">â‚¹ per {c.unit}</th>
                            <th className="pb-1 pr-3 font-medium">Amount</th>
                            <th className="pb-1 font-medium" />
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((l, i) => {
                            const q = l.qty.trim() === ""
                              ? (mixer ? Math.max(0, mixer.qty - allocated) : null)
                              : Number(l.qty);
                            const rate = Number(l.rate);
                            const amount = q != null && Number.isFinite(q) && Number.isFinite(rate)
                              ? q * rate : null;
                            return (
                              <tr key={i} className="border-t border-gray-100">
                                {splittable && (
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="number" step="0.001" min="0" inputMode="decimal"
                                      value={l.qty}
                                      onChange={(e) => setLines(c.item,
                                        lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                                      placeholder="the rest"
                                      className={`${inp} max-w-[9rem]`}
                                    />
                                  </td>
                                )}
                                <td className="py-1.5 pr-3">
                                  <input
                                    value={l.description}
                                    onChange={(e) => setLines(c.item,
                                      lines.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                                    placeholder="supplier, PO number, what this was"
                                    className={inp}
                                  />
                                </td>
                                <td className="py-1.5 pr-3">
                                  <input
                                    type="number" step="0.0001" min="0" inputMode="decimal"
                                    value={l.rate}
                                    onChange={(e) => setLines(c.item,
                                      lines.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))}
                                    placeholder="â‚¹"
                                    className={`${inp} max-w-[8rem]`}
                                  />
                                </td>
                                <td className="py-1.5 pr-3 text-gray-700">
                                  {amount == null ? "â€”" : `â‚¹${money.format(amount)}`}
                                  {/* The check that catches a mistyped rate: a
                                      line 40% off the card is worth a second
                                      look before a container is priced off it. */}
                                  {cardRate != null && Number.isFinite(rate) && rate > 0 && (
                                    <span className={`ml-2 text-xs ${
                                      Math.abs((rate - cardRate) / cardRate) > 0.15 ? "text-red-600" : "text-gray-400"
                                    }`}>
                                      {rate === cardRate ? "= card"
                                        : `${rate > cardRate ? "+" : ""}${Math.round(((rate - cardRate) / cardRate) * 1000) / 10}%`}
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 text-right">
                                  <button type="button" className="text-xs text-gray-400 hover:text-red-500"
                                    onClick={() => setLines(c.item, lines.filter((_, j) => j !== i))}>
                                    remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Live reconciliation against the mixer, while they type. */}
                  {splittable && mixer && lines.length > 0 && (
                    <p className={`mt-2 text-xs ${
                      balanced ? "text-gray-500" : left! > 0 ? "text-amber-700" : "text-red-600"
                    }`}>
                      {hasRest
                        ? `One line takes whatever is left of the ${num.format(mixer.qty)} ${mixer.unit}.`
                        : balanced
                          ? `Adds up to the ${num.format(mixer.qty)} ${mixer.unit} the mixer recorded.`
                          : left! > 0
                            ? `${num.format(left!)} ${mixer.unit} of ${num.format(mixer.qty)} still unallocated â€” it will price at the card, or be reported unpriced if there is no card rate.`
                            : `${num.format(-left!)} ${mixer.unit} MORE than the mixer recorded. It will still be priced, and the sheet will say the two disagree.`}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" className={btnGhost}
                      disabled={!splittable && lines.length >= 1}
                      onClick={() => setLines(c.item, [...lines, { qty: "", rate: "", description: "" }])}>
                      {lines.length ? "Add another line" : splittable ? "Add a line" : "Set a value"}
                    </button>
                    <button type="button" className={btn} disabled={busy === c.item}
                      onClick={() => void save(c)}>
                      {busy === c.item ? "Savingâ€¦" : "Save"}
                    </button>
                    {saved && (
                      <button type="button" className={btnGhost} disabled={busy === c.item}
                        onClick={() => void clear(c)}>
                        Use the card instead
                      </button>
                    )}
                    {!splittable && (
                      <span className="text-xs text-gray-400">
                        A dosing rule is one value â€” there is nothing to split.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
