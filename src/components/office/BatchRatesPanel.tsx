"use client";

// How this batch's materials were bought.
//
// The mixer weighs one number per material. What was bought is often several
// things, so each material can be SPLIT into lines — a quantity, a description
// of what that part was, and its own price. 600 kg from Aypols at ₹161 and 400
// from 3n Composits at ₹145, rather than one average nobody can reconcile.
//
// GROUPED, NOT LISTED. The catalogue is fifteen materials and a typical batch
// touches three or four of them; a flat list put twelve rows reading "no mixer
// quantity for this batch" between the two that mattered. So materials sit
// under their family — Resin, Grit, Filler, Pigment, Chemicals, Dosing — and
// each family opens on what this batch actually consumed, with the rest behind
// a line that says how many there are. Nothing is removed: a material with no
// mixer quantity can still be priced, it just stops competing for attention
// with one that has 1,449 kg against it.
//
// Three things the screen has to do, because the arithmetic is unforgiving:
//
//   * show the mixer's quantity next to the boxes. Someone splitting resin
//     against a figure they have to remember from another panel is how 600+400
//     gets typed against a batch that used 1,240 kg.
//   * show what is still unallocated, live, while they type — that is the
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

/** The families, in the order the line consumes them. */
const FAMILY_ORDER = ["RESIN", "GRIT", "FILLER", "PIGMENT", "CHEMICAL", "DOSING", "BASIS"] as const;
const FAMILY_LABEL: Record<string, string> = {
  RESIN: "Resin", GRIT: "Grit", FILLER: "Filler", PIGMENT: "Pigment",
  CHEMICAL: "Chemicals", DOSING: "Dosing rules", BASIS: "This batch's exchange rate",
};
const FAMILY_NOTE: Record<string, string> = {
  RESIN: "Weighed by the mixer.",
  GRIT: "Weighed per charge, by size band.",
  FILLER: "Weighed by the mixer.",
  PIGMENT: "Not weighed — dosed on resin weight.",
  CHEMICAL: "Not weighed — dosed on resin weight.",
  DOSING: "The percentages that turn resin weight into the quantities above. One value each, nothing to split.",
  BASIS: "The rate this batch was quoted at. Leave it and the plant default is used.",
};

/** Items that are one value per batch rather than a split quantity. */
const SINGLE_VALUE = new Set(["inr-per-usd"]);

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
  /** Families whose unused materials the user has asked to see. */
  const [showUnused, setShowUnused] = useState<Set<string>>(new Set());

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
      // First load only — re-reading after a save must not reopen a panel the
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

  /** Catalogue split into families, each in two piles: what this batch used and
   *  what it did not. "Used" means the mixer weighed some, or somebody has
   *  already priced it — a material with saved lines must never hide. */
  const families = useMemo(() => {
    if (!data) return [];
    const byFamily = new Map<string, { used: CatalogueItem[]; unused: CatalogueItem[] }>();
    for (const c of data.catalogue) {
      const slot = byFamily.get(c.category) ?? { used: [], unused: [] };
      const hasQty = (data.mixer[c.item]?.qty ?? 0) > 0;
      const priced = data.rows.some((r) => r.item === c.item);
      // A dosing rule is always in force — it is the percentage that produced
      // the chemical quantities above it, whatever the batch ran. Judging it by
      // "did the mixer weigh any" hid all four behind "not used in this batch",
      // which is both false and the opposite of useful. The exchange rate is
      // the same: every batch has one, and it is the whole point that it is
      // asked for per batch.
      const alwaysApplies = c.category === "DOSING" || SINGLE_VALUE.has(c.item);
      (hasQty || priced || alwaysApplies ? slot.used : slot.unused).push(c);
      byFamily.set(c.category, slot);
    }
    // Known families first, in line order — then ANY family the catalogue has
    // that this list does not know about. Filtering to FAMILY_ORDER alone would
    // make a newly-added category silently invisible, and a material nobody can
    // see is a material nobody can price.
    const known = FAMILY_ORDER.filter((f) => byFamily.has(f)) as string[];
    const rest = [...byFamily.keys()].filter((f) => !known.includes(f)).sort();
    return [...known, ...rest].map((f) => ({ family: f, ...byFamily.get(f)! }));
  }, [data]);

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
                {savedWhen ? ` — last changed ${savedWhen}` : ""}
                {savedBy ? ` by ${savedBy}` : ""}. The rest price at the card.
              </p>
            ) : (
              <p className="mt-1 text-sm text-gray-500">
                {batchLabel} prices entirely at the card. Split a material into what was actually
                bought — quantity, supplier, price — and it is kept with the batch.
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
    return <Card><Empty>Loading the mixer quantities and the card…</Empty></Card>;
  }

  const lineOf = (item: string): DraftLine[] => drafts[item] ?? [];
  const setLines = (item: string, next: DraftLine[]) =>
    setDrafts((p) => ({ ...p, [item]: next }));

  const cardRateFor = (c: CatalogueItem): number | null => {
    if (c.item === "resin") {
      const vals = Object.values(data.card.resinBySupplier);
      return vals.length === 1 ? vals[0] : null;
    }
    const v = data.card.rates[c.item];
    return Number.isFinite(v) ? v : null;
  };

  /** What the card says, in words. Resin is the one item the card holds per
   *  supplier, and "not on the card" was a lie for it — the rates are there,
   *  there is just more than one. */
  const cardSummary = (c: CatalogueItem): string => {
    if (c.item === "resin") {
      const entries = Object.entries(data.card.resinBySupplier);
      if (!entries.length) return "not on the card";
      return "card: " + entries.map(([s, r]) => `${s} ₹${money.format(r)}`).join(", ");
    }
    const v = cardRateFor(c);
    return v == null ? "not on the card" : `card ₹${money.format(v)}`;
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

  /** One material: the summary strip, and its split editor when open. */
  const materialRow = (c: CatalogueItem, dimmed: boolean) => {
    const lines = lineOf(c.item);
    const mixer = data.mixer[c.item];
    const cardRate = cardRateFor(c);
    const splittable = SPLITTABLE.has(c.category) && !SINGLE_VALUE.has(c.item);
    const isOpen = expanded === c.item;
    const saved = savedItems.includes(c.item);

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
      <div key={c.item}
        className={`rounded-xl border p-3 ${
          saved ? "border-brand/30 bg-brand/5" : dimmed ? "border-gray-100 bg-gray-50/50" : "border-gray-200"
        }`}>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setExpanded(isOpen ? null : c.item)}
            className="min-w-0 flex-1 text-left">
            <span className={`block text-sm font-medium ${dimmed ? "text-gray-500" : "text-gray-900"}`}>
              {c.label}
              <span className="ml-2 text-xs font-normal text-gray-400">per {c.unit}</span>
            </span>
            <span className="block text-xs text-gray-500">
              {mixer
                ? `mixer: ${num.format(mixer.qty)} ${mixer.unit}`
                : splittable ? "not used in this batch"
                  : SINGLE_VALUE.has(c.item) ? "one value for this batch" : "a dosing factor"}
              {" · "}{cardSummary(c)}
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
            {isOpen ? "Done" : saved ? "Edit" : splittable ? "Split" : "Set"}
          </button>
        </div>

        {isOpen && (
          <div className="mt-3 border-t border-gray-200 pt-3">
            {lines.length === 0 && (
              <p className="mb-2 text-sm text-gray-500">
                No lines — {c.label} prices whole at the card
                {cardRate != null ? ` (₹${money.format(cardRate)} per ${c.unit})` : ""}.
              </p>
            )}

            {lines.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                      {splittable && <th className="pb-1 pr-3 font-medium">Quantity ({c.unit})</th>}
                      <th className="pb-1 pr-3 font-medium">Description</th>
                      <th className="pb-1 pr-3 font-medium">₹ per {c.unit}</th>
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
                              placeholder="rate"
                              className={`${inp} max-w-[8rem]`}
                            />
                          </td>
                          <td className="py-1.5 pr-3 text-gray-700">
                            {amount == null ? "—" : `₹${money.format(amount)}`}
                            {/* The check that catches a mistyped rate: a line
                                well off the card is worth a second look before
                                a container is priced from it. */}
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
                      ? `${num.format(left!)} ${mixer.unit} of ${num.format(mixer.qty)} still unallocated — it will price at the card, or be reported unpriced if there is no card rate.`
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
                {busy === c.item ? "Saving…" : "Save"}
              </button>
              {saved && (
                <button type="button" className={btnGhost} disabled={busy === c.item}
                  onClick={() => void clear(c)}>
                  Use the card instead
                </button>
              )}
              {!splittable && (
                <span className="text-xs text-gray-400">
                  {SINGLE_VALUE.has(c.item)
                    ? "One value for the whole batch. Leave it unset to use the plant default."
                    : "A dosing rule is one value — there is nothing to split."}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Materials for this batch · {savedItems.length} priced here
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Quantities come from the mixer. Split a material into what was actually bought —
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

      <div className="space-y-5">
        {families.map(({ family, used, unused }) => {
          const revealed = showUnused.has(family);
          return (
            <section key={family}>
              <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  {FAMILY_LABEL[family] ?? family.toLowerCase()}
                </h3>
                <span className="text-xs text-gray-400">
                  {family === "DOSING"
                    ? `${used.length} rule${used.length === 1 ? "" : "s"}`
                    : family === "BASIS"
                      ? "set per batch"
                      : used.length
                      ? `${used.length} in this batch`
                      : "none in this batch"}
                </span>
                {FAMILY_NOTE[family] && (
                  <span className="text-xs text-gray-400">· {FAMILY_NOTE[family]}</span>
                )}
              </div>

              <div className="space-y-2">
                {used.map((c) => materialRow(c, false))}

                {used.length === 0 && !revealed && (
                  <p className="rounded-xl border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
                    The mixer recorded none of these for {batchLabel}.
                  </p>
                )}

                {revealed && unused.map((c) => materialRow(c, true))}

                {unused.length > 0 && (
                  // Never removed, only tucked away: a size the mixer did not
                  // record can still have been bought for this run, and hiding
                  // it outright would make that unpriceable.
                  <button
                    type="button"
                    onClick={() => setShowUnused((p) => {
                      const n = new Set(p);
                      if (n.has(family)) n.delete(family); else n.add(family);
                      return n;
                    })}
                    className="text-xs text-brand hover:underline"
                  >
                    {revealed
                      ? `Hide the ${unused.length} not used in this batch`
                      : `Show ${unused.length} not used in this batch`}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
