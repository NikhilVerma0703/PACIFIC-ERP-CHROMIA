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
import { GritSiloRows } from "@/components/office/GritSiloRows";

const API = "/api/office/costing-admin/batch-rates";

interface CatalogueItem {
  item: string; category: string; label: string; unit: string; hint: string; variants?: boolean;
}
interface SavedLine {
  id: string; item: string; seq: number; category: string;
  qty: number | null; rate: number; description: string; note: string | null; unit: string;
  savedBy: string; savedAt: string;
}
/** One person's sign-off mark. A side carries a LIST of these now — both
 *  verifiers can hold one each — and an empty list means nobody has yet. */
interface SignMark { status: "verified" | "stale"; by: string; at: string }
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
  /** Suppliers to suggest — this batch's own, plus its card's resin suppliers. */
  descriptions?: string[];
  /** Who has signed this batch off — every mark, per side. */
  signoff?: { WEIGHTS: SignMark[]; COSTS: SignMark[] };
}

/** A row being edited. Blank qty means "whatever is left". */
interface DraftLine { qty: string; rate: string; description: string; note: string }

const inp = "w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
// Dosing factors are small and exact — cobalt is 0.0857% of resin weight — and
// two decimals on the way to the screen shows a different rule than the one in
// force. Four is enough for every factor the card holds.
const factor = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 });

// The families whose lines carry a QUANTITY somebody types. Pigment and the
// chemicals used to be here and are not any more: their kilograms come from a
// dosing percentage of resin weight, so this panel already knows the weight and
// asking for it again was asking somebody to re-type a number the screen had
// computed - and to be wrong about it. See DOSED_FAMILIES just below, which
// says "Never weighed" about the very same materials.
//
// The consequence, stated: a dosed material now carries ONE line - one supplier
// and one price for the batch. With no typed weight there is nothing to divide
// between two suppliers, so a split would have no meaning.
const SPLITTABLE = new Set(["RESIN", "GRIT", "FILLER"]);

/** The families, in the order the line consumes them. */
const FAMILY_ORDER = ["RESIN", "GRIT", "FILLER", "PIGMENT", "CHEMICAL", "DOSING", "BASIS"] as const;
const FAMILY_LABEL: Record<string, string> = {
  RESIN: "Resin", GRIT: "Grit", FILLER: "Filler", PIGMENT: "Pigment",
  CHEMICAL: "Chemicals", DOSING: "Dosing rules", BASIS: "This batch's exchange rate",
};
const FAMILY_NOTE: Record<string, string> = {
  RESIN: "Weighed by the mixer.",
  GRIT: "One card per silo — size, type, supplier and price on the same row.",
  FILLER: "Weighed by the mixer.",
  PIGMENT: "Never weighed — the quantity is a percentage of resin weight, set below.",
  CHEMICAL: "Never weighed — the quantities are a percentage of resin weight, set below.",
  DOSING: "The percentages that turn resin weight into the quantities above. One value each, nothing to split.",
  BASIS: "The rate this batch was quoted at. Leave it and the plant default is used.",
};

/** Items that are one value per batch rather than a split quantity. */
const SINGLE_VALUE = new Set(["inr-per-usd"]);

/** The families the mixer NEVER weighs. Their kilograms come from the dosing
 *  rules, so "did the mixer record any" is the wrong question to ask of them —
 *  and asking it is what put a batch's pigment behind "none in this batch". */
const DOSED_FAMILIES = new Set(["PIGMENT", "CHEMICAL"]);

/** TiO2 is dosed on resin weight like the other three. The per-charge rule that
 *  used to sit beside this one is gone, so there is no longer a second dial to
 *  disambiguate — every dosing rule on this panel is the one in force. */
const TIO2_PCT = "tio2-pct-of-resin";

/** Chemical -> the dosing rule that produces its quantity. The inverse of
 *  dosedItem(), and the reason a chemical row can say WHERE its kilograms came
 *  from instead of claiming the mixer weighed them. */
const DOSED_BY: Readonly<Record<string, string>> = {
  tio2: TIO2_PCT,
  silane: "silane-pct-of-resin",
  cobalt: "cobalt-pct-of-resin",
  catalyst: "catalyst-pct-of-resin",
};

export function BatchRatesPanel({
  batchKey, batchLabel, needsBatchRates = [], unpriced = [], onSaved,
}: {
  batchKey: string;
  batchLabel: string;
  /** Materials consumed here but priced only from the plant card — the sheet
   *  is withheld until they get a price on THIS batch. Flagged inline beside
   *  the heading (owner, 2026-08-18) instead of as standalone banners. */
  needsBatchRates?: string[];
  /** Materials consumed here with no rate anywhere — out of the totals. */
  unpriced?: string[];
  onSaved: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftLine[]>>({});
  // Whether the grit on THIS batch is costed silo-wise yet. Null while the
  // silo rows are still loading, so the band rates do not flash in and out.
  const [gritAssigned, setGritAssigned] = useState<boolean | null>(null);
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
          note: row.note ?? "",
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
      // Pigment and the chemicals are in exactly the same position as the
      // dosing rules: the mixer cannot weigh them, so a batch that used TiO2
      // still has no mixer quantity against it. Judging them by "did the mixer
      // weigh any" filed a material the run certainly consumed under "none in
      // this batch", and a material nobody can see is a material nobody can
      // price — which is the whole job of this panel.
      const alwaysApplies = c.category === "DOSING"
        || DOSED_FAMILIES.has(c.category) || SINGLE_VALUE.has(c.item);
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

  // The one inline flag that replaced two standalone banner blocks (owner,
  // 2026-08-18): anything consumed here that the sheet cannot honestly total —
  // no price on this batch, or no rate anywhere — is named right beside the
  // heading of the panel where the fix happens. Deduped because a material can
  // reach both lists, and the reader wants it named once.
  const flagged = [...new Set([...needsBatchRates, ...unpriced])];
  const priceFlag = flagged.length > 0 ? (
    <p className="mt-1 text-sm font-medium text-amber-700">
      ⚠ {flagged.join(", ")} — used in this batch but not priced yet. To see the
      summary, please set the prices.
    </p>
  ) : null;

  if (open === false || open === null) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Materials for this batch
            </h2>
            {priceFlag}
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

  /** The chemical a dosing rule doses. A rule's key is the chemical's key plus
   *  how it is dosed, so the line can name what the number produces rather than
   *  leaving "TiO2 dose" to be read as a material in its own right. */
  const dosedItem = (c: CatalogueItem): CatalogueItem | undefined => {
    const key = c.item.replace(/-pct-of-resin$/, "");
    return key === c.item ? undefined : data.catalogue.find((x) => x.item === key);
  };

  /**
   * The factor actually in force for a rule, and where it came from.
   *
   * This MIRRORS dosingOverrides() and the order report.ts reads them — a batch
   * that redosed wins over the card, and among a batch's own lines the LAST by
   * seq wins. The route caps a dosing rule at one line, so today there is only
   * ever one; taking the first anyway would mean that the day an import or an
   * older row breaks that assumption, this line quietly describes a factor the
   * sheet is not costing with. A description that disagrees with the number is
   * worse than the jargon it replaced.
   */
  const doseInForce = (item: string): { value: number; fromBatch: boolean } | null => {
    let own: number | null = null;
    for (const r of [...data.rows].filter((r) => r.item === item).sort((a, b) => a.seq - b.seq)) {
      const n = Number(r.rate);
      if (Number.isFinite(n) && n > 0) own = n;
    }
    if (own != null) return { value: own, fromBatch: true };
    const v = data.card.rates[item];
    return Number.isFinite(v) ? { value: v, fromBatch: false } : null;
  };

  /** A dosing rule's unit, in words. "per pct" named the column in the database,
   *  not the thing being typed — and what somebody setting a dose needs to know
   *  is that the number is measured against the resin the mixer weighed. */
  const doseUnit = (c: CatalogueItem): string =>
    c.unit === "pct" ? "% of resin weight" : `${c.unit} per mixer charge`;

  /**
   * What a dosing rule means, for somebody setting one for the first time.
   *
   * "a dosing factor - card Rs 9.14" was wrong in both halves: the number is a
   * percentage of resin weight, not rupees, and nothing on the line said what
   * it produces. Five rows of that is a screen you cannot set without knowing
   * the answer already.
   *
   * So the line states the factor in force and the kilograms it works out to
   * for THIS batch.
   */
  const doseSummary = (c: CatalogueItem): string => {
    const chem = dosedItem(c);
    const name = chem?.label ?? "this chemical";
    const made = chem ? data.mixer[chem.item] : undefined;
    // Only ever appended to a branch where THIS rule is the one that produced
    // the quantity. The mixer map follows the same precedence the report does,
    // so hanging it off the losing rule would credit it with the winner's kg.
    const gives = made
      ? ` — ${num.format(made.qty)} ${made.unit} of ${name} in this batch`
      : "";

    const f = doseInForce(c.item);
    if (f == null) {
      return `Not set — ${name} is reported unpriced until somebody enters the percent of resin weight it is dosed at.`;
    }

    // "for this batch" has to come from the SAME resolution that produced the
    // number, not a separate "does a row exist" test: a saved row this helper
    // rejected would otherwise label the card's factor as the batch's own.
    const card = cardRateFor(c);
    if (f.fromBatch && card != null) {
      return `${factor.format(f.value)}% of resin weight, set here against the card's ${factor.format(card)}%${gives}.`;
    }
    return `${factor.format(f.value)}% of resin weight ${f.fromBatch ? "for this batch" : "on the card"}${gives}.`;
  };

  /** The resin the mixer weighed — what every percentage rule is measured
   *  against, and the only reason this screen can show a dose in kilograms
   *  while somebody is still typing it. */
  const resinKg = (): number | null => {
    const m = data.mixer["resin"];
    return m && Number.isFinite(m.qty) ? m.qty : null;
  };

  /**
   * Whether a dosing row may set its chemical's price.
   *
   * The price is stored on the CHEMICAL, never on the dosing rule — one source
   * of truth, and the Chemicals row keeps working for a delivery split. That is
   * exactly why this has to refuse the split case: the route saves an item's
   * lines as a SET, so writing one price from here would replace them. A batch
   * with 300 kg from one supplier and the rest from another would lose that
   * split the moment somebody corrected the percentage.
   */
  const priceHere = (chem: CatalogueItem | undefined): { ok: boolean; lines: number } => {
    if (!chem) return { ok: false, lines: 0 };
    const saved = data.rows.filter((r) => r.item === chem.item);
    return { ok: !(saved.length > 1 || saved.some((r) => r.qty != null)), lines: saved.length };
  };

  /** Every dosing rule now carries its chemical's price box. There used to be
   *  two TiO₂ rules and only one could own it; with the per-charge rule gone
   *  there is one rule per chemical and no ambiguity to resolve. */
  const rulePricesChem = (_c: CatalogueItem): boolean => true;

  /** One item's lines, saved as the whole set the route expects. */
  const postLines = async (
    item: string,
    lines: Array<{ seq: number; qty: number | null; rate: number; description: string }>,
  ): Promise<string | null> => {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchKey, item, lines }),
    });
    const res = await readJson<{ error?: string }>(r);
    return res.ok ? null : (res.error ?? `Save failed (${res.status})`);
  };

  const deleteLines = async (item: string): Promise<string | null> => {
    const qs = new URLSearchParams({ batchKey, item });
    const r = await fetch(`${API}?${qs}`, { method: "DELETE" });
    const res = await readJson<{ error?: string }>(r);
    return res.ok ? null : (res.error ?? `Could not clear (${res.status})`);
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
        note: l.note,
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

  /**
   * Save a dosing rule and, where this row owns it, the price of what it doses.
   *
   * Two writes, because they are two items — but ONE action, because setting a
   * dose and pricing what it produces is one thought. The percentage goes
   * first: if it fails there is nothing to price, and stopping there leaves the
   * batch exactly as it was rather than half-changed.
   */
  const saveDose = async (c: CatalogueItem) => {
    const chem = dosedItem(c);
    setBusy(c.item); setNote(null);
    try {
      const raw = lineOf(c.item)[0]?.rate.trim() ?? "";
      const pct = Number(raw);
      if (raw === "" || !Number.isFinite(pct) || pct <= 0) {
        setNote({
          text: `${c.label} needs a figure above zero — use “the card instead” to unset it.`,
          ok: false,
        });
        return;
      }
      const err = await postLines(c.item, [{ seq: 0, qty: null, rate: pct, description: "" }]);
      if (err) { setNote({ text: err, ok: false }); return; }

      let priced = "";
      if (chem && rulePricesChem(c) && priceHere(chem).ok) {
        const rawPrice = lineOf(chem.item)[0]?.rate.trim() ?? "";
        const had = data.rows.some((r) => r.item === chem.item);
        if (rawPrice === "") {
          // Blank means the card, and the row said so. Only ever a delete of the
          // single line this editor writes — priceHere() has already refused to
          // touch a split.
          if (had) {
            const e2 = await deleteLines(chem.item);
            if (e2) { setNote({ text: e2, ok: false }); return; }
            priced = ` ${chem.label} falls back to the card.`;
          }
        } else {
          const price = Number(rawPrice);
          if (!Number.isFinite(price) || price <= 0) {
            setNote({
              text: `${chem.label} needs a price above zero, or none at all to use the card.`,
              ok: false,
            });
            return;
          }
          // qty null is "the rest" — which for a chemical nobody weighed is the
          // whole derived weight, priced at this rate.
          const e2 = await postLines(chem.item, [{ seq: 0, qty: null, rate: price, description: "" }]);
          if (e2) { setNote({ text: e2, ok: false }); return; }
          priced = ` ${chem.label} at ₹${money.format(price)} per kg.`;
        }
      }

      setNote({
        text: `${c.label}: ${factor.format(pct)}${doseUnitShort(c)}.${priced} The batch has been re-costed.`,
        ok: true,
      });
      await load();
      onSaved();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally { setBusy(""); }
  };

  /** Both halves back to the card — the button sits under both boxes, so
   *  clearing only one of them would leave the row half-set. */
  const clearDose = async (c: CatalogueItem) => {
    const chem = dosedItem(c);
    setBusy(c.item); setNote(null);
    try {
      const e1 = await deleteLines(c.item);
      if (e1) { setNote({ text: e1, ok: false }); return; }
      setLines(c.item, []);

      let also = "";
      if (chem && rulePricesChem(c) && priceHere(chem).ok
          && data.rows.some((r) => r.item === chem.item)) {
        const e2 = await deleteLines(chem.item);
        if (!e2) { setLines(chem.item, []); also = ` ${chem.label}’s price too.`; }
      }
      setNote({ text: `${c.label} falls back to the ${data.card.onDate} card.${also}`, ok: true });
      await load();
      onSaved();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally { setBusy(""); }
  };

  /** The unit, in the few words that fit after a number. */
  const doseUnitShort = (c: CatalogueItem): string =>
    c.unit === "pct" ? "% of resin weight" : " kg per mixer charge";

  /**
   * A dosing rule, set the way somebody actually thinks about it: the
   * percentage, and the price of the kilograms it produces.
   *
   * Both halves were always settable — but on two rows, in two different
   * families, with the weight that connects them shown on neither. Setting a
   * dose meant knowing that the Silane row up under Chemicals was where the
   * money went. So this row now carries both boxes and does the arithmetic out
   * loud between them, while it is being typed.
   */
  const doseEditor = (c: CatalogueItem) => {
    const chem = dosedItem(c);
    const pctDraft = lineOf(c.item)[0]?.rate ?? "";
    const priceDraft = chem ? lineOf(chem.item)[0]?.rate ?? "" : "";
    const cardPct = cardRateFor(c);
    const cardPrice = chem ? cardRateFor(chem) : null;
    const carries = rulePricesChem(c);
    const split = priceHere(chem);
    const saved = savedItems.includes(c.item);
    const isPct = c.unit === "pct";

    const setPct = (v: string) => setLines(c.item, [{ qty: "", rate: v, description: "", note: "" }]);
    const setPrice = (v: string) => {
      if (chem) setLines(chem.item, [{ qty: "", rate: v, description: "", note: "" }]);
    };

    // Live, from what is in the box — falling back to the card, which is what
    // an empty box means.
    const typed = Number(pctDraft);
    const effPct = pctDraft.trim() !== "" && Number.isFinite(typed) && typed > 0 ? typed : cardPct;
    const resin = resinKg();
    const kg = isPct && resin != null && effPct != null
      ? (resin * effPct) / 100
      : chem ? data.mixer[chem.item]?.qty ?? null : null;

    const typedPrice = Number(priceDraft);
    const effPrice = priceDraft.trim() !== "" && Number.isFinite(typedPrice) && typedPrice > 0
      ? typedPrice : cardPrice;
    const cost = kg != null && effPrice != null ? kg * effPrice : null;

    return (
      <div className="mt-3 border-t border-gray-200 pt-3">
        <div className="flex flex-wrap items-start gap-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {isPct ? "% of resin weight" : "kg per mixer charge"}
            </span>
            <input
              type="number" step="0.0001" min="0" inputMode="decimal"
              value={pctDraft} onChange={(e) => setPct(e.target.value)}
              placeholder={cardPct != null ? factor.format(cardPct) : "not set"}
              className={`${inp} max-w-[10rem]`}
            />
            <span className="mt-1 block text-xs text-gray-400">
              {cardPct != null
                ? `card: ${factor.format(cardPct)}${isPct ? "%" : " kg"}`
                : "nothing on the card"}
            </span>
          </label>

          {carries && chem && split.ok && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                ₹ per kg of {chem.label}
              </span>
              <input
                type="number" step="0.0001" min="0" inputMode="decimal"
                value={priceDraft} onChange={(e) => setPrice(e.target.value)}
                placeholder={cardPrice != null ? money.format(cardPrice) : "not set"}
                className={`${inp} max-w-[10rem]`}
              />
              <span className="mt-1 block text-xs text-gray-400">
                {cardPrice != null ? `card: ₹${money.format(cardPrice)}` : "nothing on the card"}
                {" · blank uses the card"}
              </span>
            </label>
          )}
        </div>

        {/* The arithmetic, out loud. This is the whole point of the row: the
            percentage and the price are two numbers nobody can multiply in
            their head against 41,873 kg of resin. */}
        <p className="mt-3 text-sm text-gray-600">
          {kg == null ? (
            isPct
              ? "The weight appears once this batch has a resin figure and a percentage."
              : "The weight appears once this rule is saved."
          ) : (
            <>
              {isPct && resin != null && effPct != null
                ? `${factor.format(effPct)}% of ${num.format(resin)} kg resin = `
                : ""}
              <span className="font-medium text-gray-900">{num.format(kg)} kg</span>
              {chem ? ` of ${chem.label}` : ""}
              {cost != null && effPrice != null ? (
                <>
                  {" × ₹"}{money.format(effPrice)}{" = "}
                  <span className="font-medium text-gray-900">₹{money.format(cost)}</span>
                  {" on this batch."}
                </>
              ) : (
                <span className="text-amber-700">
                  {" — with no price on the card or here, it is reported unpriced."}
                </span>
              )}
            </>
          )}
        </p>

        {carries && chem && !split.ok && (
          <p className="mt-2 text-xs text-amber-700">
            {chem.label} is split into {split.lines} lines, so its price is set there — open
            {" "}{chem.label} under {(FAMILY_LABEL[chem.category] ?? chem.category).toLowerCase()} above.
            One price typed here would replace that split.
          </p>
        )}
        {!carries && (
          <p className="mt-2 text-xs text-gray-400">
            {chem?.label ?? "This chemical"} is priced on whichever rule is costing the batch —
            the one {c.item === TIO2_PCT ? "below" : "above"}.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={btn} disabled={busy === c.item}
            onClick={() => void saveDose(c)}>
            {busy === c.item ? "Saving…" : "Save"}
          </button>
          {saved && (
            <button type="button" className={btnGhost} disabled={busy === c.item}
              onClick={() => void clearDose(c)}>
              {carries && chem && split.ok ? "Use the card for both" : "Use the card instead"}
            </button>
          )}
        </div>
      </div>
    );
  };

  /**
   * Where a material's quantity came from, said out loud.
   *
   * "mixer: 272.051 kg" was a claim the panel's own family note contradicted
   * two lines above it — the mixer weighs resin, grit and filler and does NOT
   * weigh the four chemicals. Their kilograms are a percentage of resin weight,
   * computed, and a row that presents a derived figure in the same words as a
   * weighed one gives the reader no way to tell which is which. The one they
   * would want to argue with is the derived one.
   */
  const quantityBasis = (c: CatalogueItem): string | null => {
    const m = data.mixer[c.item];
    if (!m) return null;

    const rule = DOSED_BY[c.item];
    if (!rule) return `mixer weighed ${num.format(m.qty)} ${m.unit}`;

    const pct = doseInForce(rule);
    if (pct) {
      return `${factor.format(pct.value)}% of resin weight${pct.fromBatch ? " (set on this batch)" : ""}`
        + ` = ${num.format(m.qty)} ${m.unit}`;
    }
    return `${num.format(m.qty)} ${m.unit}, dosed on resin weight`;
  };

  /**
   * What to suggest in a description box.
   *
   * THIS BATCH's own supplier names, plus the resin suppliers on its own rate
   * card. Deliberately not pooled across batches: a line here asserts that this
   * run bought that material from that supplier, and offering names carried in
   * from other batches makes the likeliest error the easiest click.
   *
   * A <datalist> rather than a <select> because the field must stay free text:
   * "PO 4471" and "trial drum, second delivery" are legitimate values that no
   * dropdown could hold. Typing a new one saves it like any other, and because
   * this list is read back from what has been saved, it is in the dropdown for
   * everybody the next time the panel loads. Nothing to administer.
   */
  const descriptionOptions = (): string[] => {
    // Already deduplicated, sorted and scoped to this batch by the route.
    return data.descriptions ?? [];
  };

  const DESC_LIST_ID = "costing-description-options";

  /** One material: the summary strip, and its split editor when open. */
  const materialRow = (c: CatalogueItem, dimmed: boolean) => {
    const lines = lineOf(c.item);
    const mixer = data.mixer[c.item];
    const cardRate = cardRateFor(c);
    const splittable = SPLITTABLE.has(c.category) && !SINGLE_VALUE.has(c.item);
    const isDosing = c.category === "DOSING";
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
              <span className="ml-2 text-xs font-normal text-gray-400">
                {isDosing ? doseUnit(c) : `per ${c.unit}`}
              </span>
            </span>
            <span className="block text-xs text-gray-500">
              {isDosing ? doseSummary(c) : (
                <>
                  {mixer
                    ? quantityBasis(c)
                    // The card price is off this line deliberately. It is a
                    // plant-wide rate carried in from whenever it was last
                    // revised, and read next to THIS batch's quantity it was
                    // taken for this batch's price. The split editor still
                    // shows it, against the quantity it actually applies to.
                    : DOSED_BY[c.item]
                      ? "no dose set — set the rule below and this fills in"
                      : splittable ? "not used in this batch" : "one value for this batch"}
                </>
              )}
            </span>
          </button>

          {saved && (
            <Badge tone={balanced ? "green" : "amber"}>
              {lines.length} line{lines.length === 1 ? "" : "s"}
            </Badge>
          )}
          {/* splittable, because an "unallocated" figure is computed from a
              quantity the editor no longer asks for on a dosed material - it
              would report a shortfall against a number nobody can change. */}
          {splittable && saved && !balanced && left != null && (
            <span className="text-xs text-amber-700">
              {left > 0 ? `${num.format(left)} ${mixer?.unit} unallocated` : `${num.format(-left)} ${mixer?.unit} over`}
            </span>
          )}
          <button type="button" onClick={() => setExpanded(isOpen ? null : c.item)} className={btnGhost}>
            {isOpen ? "Done" : saved ? "Edit" : splittable ? "Assign" : "Set"}
          </button>
        </div>

        {isOpen && (isDosing ? doseEditor(c) : (
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
                      {splittable && <th className="pb-1 pr-3 font-medium">How much ({c.unit})</th>}
                      <th className="pb-1 pr-3 font-medium">Supplier</th>
                      <th className="pb-1 pr-3 font-medium">₹ per {c.unit}</th>
                      <th className="pb-1 pr-3 font-medium">Note</th>
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
                                // Under a heading that reads "How much (kg)",
                                // "the rest" looked like a value somebody had
                                // typed rather than what leaving it empty does.
                                placeholder="blank = the rest"
                                className={`${inp} max-w-[9rem]`}
                              />
                            </td>
                          )}
                          <td className="py-1.5 pr-3">
                            <input
                              value={l.description}
                              onChange={(e) => setLines(c.item,
                                lines.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                              placeholder="who it was bought from"
                              list={DESC_LIST_ID}
                              autoComplete="off"
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
                          <td className="py-1.5 pr-3">
                            <input
                              value={l.note}
                              onChange={(e) => setLines(c.item,
                                lines.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                              placeholder="PO number, short delivery, anything worth remembering"
                              className={inp}
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
                onClick={() => setLines(c.item, [...lines, { qty: "", rate: "", description: "", note: "" }])}>
                {!splittable && lines.length
                  // Disabled AND labelled "Add another supplier" read as a bug.
                  // A dosed material has one line by design: its kilograms come
                  // from the dosing percentage, so there is no weight to divide
                  // between two of them.
                  ? "One supplier — the weight comes from the dose"
                  : lines.length ? "Add another supplier"
                    : splittable ? "Assign a supplier" : "Set the value"}
              </button>
              {/* The remainder, prefilled.
                  A material is only fully described once its lines add up to
                  what the mixer weighed, and the arithmetic to get there was
                  the user's to do: read the unallocated figure below, subtract,
                  type it back in. Getting it wrong by a kilo leaves a silent
                  remainder priced at the card. One click is the same intent
                  without the subtraction. */}
              {splittable && mixer && left != null && left > 0.005 && !hasRest && (
                <button type="button" className={btnGhost}
                  onClick={() => setLines(c.item,
                    [...lines, { qty: String(left), rate: "", description: "", note: "" }])}>
                  Add the remaining {num.format(left)} {mixer.unit}
                </button>
              )}
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
                  One value for the whole batch. Leave it unset to use the plant default.
                </span>
              )}
            </div>
          </div>
        ))}
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
          {priceFlag}
          <div className="mt-1 max-w-3xl space-y-1 text-sm text-gray-500">
            <p>
              <span className="font-medium text-gray-700">You are setting two things per material:</span>{" "}
              <span className="font-medium text-gray-700">how much</span> came from each supplier,
              and <span className="font-medium text-gray-700">the price per {"\u20B9"}/unit</span> you
              paid them. Either on its own is fine — leave the quantity blank and that supplier
              takes whatever is left of what the mixer weighed.
            </p>
            <p>
              The mixer already knows the total. A material you assign nothing to is priced
              whole at the rate card, which is the normal case — only assign the ones that
              came from more than one place, or at a price the card does not have.
            </p>
          </div>
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

      {/* Who has checked this batch.
          Shown to the admin editing the rates because the person about to
          change one is exactly the person who needs to know it has already
          been signed off - and that saving will send it back for re-checking.
          Read-only: admin sees both and signs neither. */}
      {data.signoff && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-gray-200 px-4 py-2.5 text-xs">
          {([
            ["WEIGHTS", "Consumption"],
            ["COSTS", "Prices"],
          ] as const).map(([side, label]) => {
            // A LIST per side now: both verifiers can hold a mark, each of
            // which lapses on its own when the numbers move under it.
            const marks = data.signoff![side];
            return (
              <span key={side} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-500">{label}</span>
                {marks.length === 0 && (
                  <>
                    <Badge tone="amber">Not yet accepted</Badge>
                    <span className="text-gray-400">waiting on the verifiers</span>
                  </>
                )}
                {marks.map((m) => m.status === "verified" ? (
                  <span key={m.by} className="flex items-center gap-1.5">
                    <Badge tone="green">Accepted</Badge>
                    <span className="text-gray-500">by {m.by}</span>
                  </span>
                ) : (
                  <span key={m.by} className="flex items-center gap-1.5">
                    <Badge tone="amber">Changed since accepted</Badge>
                    <span className="text-amber-700">{m.by} accepted an earlier version</span>
                  </span>
                ))}
              </span>
            );
          })}
        </div>
      )}

      {/* One list for every description box on the panel. Rendered once: a
          datalist per row would be forty copies of the same options. */}
      <datalist id={DESC_LIST_ID}>
        {descriptionOptions().map((d) => <option key={d} value={d} />)}
      </datalist>

      <div className="space-y-5">
        {families.map(({ family, used }) => {
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
                      : DOSED_FAMILIES.has(family)
                        ? `${used.length} material${used.length === 1 ? "" : "s"}`
                        : used.length
                        ? `${used.length} in this batch`
                        : "none in this batch"}
                </span>
                {FAMILY_NOTE[family] && (
                  <span className="text-xs text-gray-400">· {FAMILY_NOTE[family]}</span>
                )}
              </div>

              <div className="space-y-2">
                {/* GRIT IS NOT A CATALOGUE FAMILY ANY MORE. The band cards that
                    stood here priced grit per size band; the silo rows price it
                    per silo and per supplier, which is how it is actually bought.
                    Same <section>, same heading, same card styling as Resin and
                    Filler either side - only the rows underneath changed. */}
                {family === "GRIT" ? (
                  <>
                    <GritSiloRows batchKey={batchKey} onSaved={onSaved} onPath={setGritAssigned} />

                    {/* THE BAND RATES, WHILE THE BAND PATH IS WHAT COSTS THIS
                        BATCH. report.ts switches to the silo path the moment one
                        silo is assigned; until then the batch is costed per size
                        band, and pricing grit at the plant card sets fromCard,
                        which withholds the whole sheet. Removing these rows left
                        398 batches with no way to clear that short of assigning
                        every silo. They disappear as soon as a silo is assigned,
                        so the screen never offers two ways to price the same
                        tonnage at once. */}
                    {gritAssigned === false && used.length > 0 && (
                      <div className="mt-4 space-y-2 border-t border-dashed border-gray-200 pt-4">
                        <p className="text-xs text-gray-500">
                          This batch is still costed <b>by size band</b> — no silo has been assigned
                          yet. Set a band rate here, or assign the silos above and price them
                          individually. These rows go away once you do.
                        </p>
                        {used.map((c) => materialRow(c, false))}
                      </div>
                    )}
                  </>
                ) : used.map((c) => materialRow(c, false))}

                {family !== "GRIT" && used.length === 0 && (
                  <p className="rounded-xl border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
                    The mixer recorded none of these for {batchLabel}.
                  </p>
                )}

              </div>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
