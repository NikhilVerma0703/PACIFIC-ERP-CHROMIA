"use client";

// What this batch used — the verifiers' way in.
//
// The two people who sign a batch off (the store incharge and the named
// production verifier) were handed the admin's materials panel to enter it
// with: families, expandable rows, "leave blank for the rest", "use the card
// instead", dose-or-weight, per-charge-or-silo. The owner's report, verbatim:
// "they are still saying it's not very intuitive to understand and put weights
// / percentages and costs". So this is ONE flat table, one row per material
// the mixer actually consumed, with the mixer's figure printed next to the
// boxes — Material, what the mixer weighed, supplier, price, status — and a
// Save button on every row.
//
// Three decisions, each made because the arithmetic is unforgiving:
//
//   * NOBODY TYPES A QUANTITY for a single-supplier material. The mixer's
//     figure IS the quantity, so the row sends one line with no quantity and
//     the costing treats it as "all of it". Only a split between two suppliers
//     asks for a quantity — the first supplier's — and the second is shown as
//     the remainder, computed, read-only.
//   * AN EMPTY PRICE BOX MEANS THE CARD, and the box says so: the card rate
//     is printed in grey directly under it ("card ₹159/kg"), as a caption and
//     not as the placeholder, because a placeholder clips at the page's real
//     width ("plant default: ₹8") and a cut-off rate is worse than none.
//     Nothing is silently priced.
//   * A DOSED CHEMICAL shows kilograms and percent side by side, linked live
//     against the resin the mixer weighed. Type either; the stored fact is
//     always the percentage (exactly what report.ts multiplies by), and the
//     preview prints the kilograms the SHEET will print, recomputed from the
//     stored percentage, so the two can never disagree by more than a gram.
//
// THIS IS A CLIENT OF THE EXISTING CONTRACTS, NOT A NEW ONE. Every save here
// is byte-for-byte what BatchRatesPanel would send for the same intent: the
// batch-rates POST (a material's lines as a whole set), the batch-rates DELETE
// (back to the card), and the grit-assignment PUT (one silo, all its supplier
// lines). The admin panel is still the place for anything this table does not
// cover — band rates, three or more suppliers, notes — and it opens from the
// toggle at the bottom, unchanged.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { NO_SILO } from "@/lib/costing/gritAssign";
import { BatchRatesPanel } from "@/components/office/BatchRatesPanel";

const RATES_API = "/api/office/costing-admin/batch-rates";
const GRIT_API = "/api/office/grit-assignment";

// ---------------------------------------------------------------------------
// What the two GETs return — the same shapes BatchRatesPanel and GritSiloRows
// read, restated here so this file type-checks on its own.
// ---------------------------------------------------------------------------

interface CatalogueItem {
  item: string; category: string; label: string; unit: string; hint: string; variants?: boolean;
}
interface SavedLine {
  id: string; item: string; seq: number; category: string;
  qty: number | null; rate: number; description: string; note: string | null; unit: string;
  savedBy: string; savedAt: string;
}
interface CardShape {
  onDate: string;
  resinBySupplier: Record<string, number>;
  rates: Record<string, number>;
}
interface RatesPayload {
  batchKey: string;
  catalogue: CatalogueItem[];
  rows: SavedLine[];
  card: CardShape;
  /** item -> what the mixer weighed, in the item's own unit. The four
   *  chemicals appear here DERIVED from the dose in force, never weighed. */
  mixer: Record<string, { qty: number; unit: string }>;
  descriptions?: string[];
}

interface SiloRow {
  silo: string;
  /** KILOGRAMS drawn from this silo — while ratePerT is rupees per TONNE. */
  kg: number;
  size: string;
  gritType: string;
  suppliers: Array<{ seq: number; supplier: string; kg: number; ratePerT: number | null }>;
}
interface GritPayload {
  batchKey: string;
  batch: string;
  silos: SiloRow[];
  sizeOptions: string[];
  typeOptions: string[];
}

// ---------------------------------------------------------------------------
// Drafts. Every value is a STRING so a half-typed number does not become NaN
// under the cursor, and so "" can mean "use the card" rather than 0.
// ---------------------------------------------------------------------------

/** One supplier's half of a row: who, what they charged, and the note the
 *  full panel may have written — carried through untouched, because the
 *  route replaces a material's lines as a set and a save that forgot the
 *  note would erase it (the cce42a6 data loss, not to be repeated). */
interface Party { supplier: string; price: string; note: string }
const blankParty = (): Party => ({ supplier: "", price: "", note: "" });

interface MaterialDraft { kind: "material"; split: boolean; qtyA: string; a: Party; b: Party }
interface GritDraft { kind: "grit"; size: string; type: string; split: boolean; qtyA: string; a: Party; b: Party }
/** kg is the in-progress WEIGHT text, non-empty only while someone is typing
 *  kilograms; pct is the fact that gets stored. */
interface ChemDraft { kind: "chem"; pct: string; kg: string; supplier: string; price: string; note: string }
/** The exchange rate is one value, but the full panel can still write a
 *  description and a note on its line ("RBI reference 20 Aug"), and the route
 *  replaces the line wholesale — so both ride along here exactly as a
 *  material's Party carries them, or a retyped rate would erase them. */
interface BasisDraft { kind: "basis"; value: string; description: string; note: string }
type Draft = MaterialDraft | GritDraft | ChemDraft | BasisDraft;

// ---------------------------------------------------------------------------
// The rows of the table, derived from the two payloads.
// ---------------------------------------------------------------------------

/** How a material's saved lines map onto this table's two shapes. "complex"
 *  is anything the simple row cannot represent without losing information
 *  (three suppliers, a remainder line first) — shown, never overwritten. */
type Shape = "single" | "split" | "complex";

interface MaterialRow {
  kind: "material"; key: string; def: CatalogueItem;
  total: number | null; unit: string; lines: SavedLine[]; shape: Shape;
}
interface GritRow { kind: "grit"; key: string; silo: SiloRow; shape: Shape }
interface ChemRow {
  kind: "chem"; key: string; chem: CatalogueItem; rule: CatalogueItem;
  chemLines: SavedLine[]; ruleLines: SavedLine[];
  /** Whether this row may write the chemical's price line — false when the
   *  full panel has split it, because one line posted from here would replace
   *  the whole split (BatchRatesPanel.priceHere, mirrored). */
  priceHere: boolean;
}
interface BasisRow { kind: "basis"; key: string; def: CatalogueItem; lines: SavedLine[] }
type Row = MaterialRow | GritRow | ChemRow | BasisRow;

/** Chemical -> the dosing rule that produces its quantity. Restates DOSED_BY
 *  in BatchRatesPanel.tsx, DOSED_CHEMICALS in completeness.ts and the pairs in
 *  the route's mixerQuantities — change one, change all of them. */
const DOSED_BY: ReadonlyArray<readonly [chem: string, rule: string]> = [
  ["tio2", "tio2-pct-of-resin"],
  ["silane", "silane-pct-of-resin"],
  ["cobalt", "cobalt-pct-of-resin"],
  ["catalyst", "catalyst-pct-of-resin"],
];

const BASIS_ITEM = "inr-per-usd";

/** Same tolerance as completeness.ts: anything under this is rounding. */
const EPSILON = 0.005;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const usable = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v > 0;

const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
// A dose typed as kilograms is stored to six decimals of percent (see
// setChemKg), and the status must print the figure the sheet multiplies by.
const pctFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 });

const inp = "w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const btn = "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-50";
const link = "text-xs text-brand underline-offset-2 hover:underline";
const td = "px-3 py-2.5 align-top";

const SUPPLIER_LIST = "simple-entry-suppliers";
const SIZE_LIST = "simple-entry-grit-sizes";
const TYPE_LIST = "simple-entry-grit-types";

/** The status column: a tone and plain words. `warn` is an amber line under a
 *  status whose tone is NOT amber — "supplier not named" on a line that is
 *  priced and passes the sign-off gate, which the route allows and the
 *  verifier should still hear about without the row counting as unpriced. */
interface Status { tone: "green" | "gray" | "amber" | "red"; text: string; sub?: string; warn?: string }
const toneClass: Record<Status["tone"], string> = {
  green: "text-green-700", gray: "text-gray-500", amber: "text-amber-700", red: "text-red-600",
};

/** "Silo 202", or the no-silo bucket in words — never "Silo (no silo)". */
const siloName = (silo: string) => silo === NO_SILO ? "Grit with no silo recorded" : `Silo ${silo}`;
/** The row title: "Grit · Silo 202", but the no-silo bucket already says
 *  "Grit", so it is not doubled into "Grit · Grit with no silo recorded". */
const gritTitle = (silo: string) => silo === NO_SILO ? siloName(silo) : `Grit · ${siloName(silo)}`;

/** ₹159/kg — the shape the status column speaks in. */
const rateText = (rate: number, unit: string) => `₹${money.format(rate)}/${unit}`;

// ---------------------------------------------------------------------------

export function SimpleMaterialsEntry({ batchKey, batchLabel, onSaved }: {
  batchKey: string;
  batchLabel: string;
  /** Called after every successful save: the parent bumps the sign-off card's
   *  version (a save lapses standing marks and moves the completeness answer)
   *  and re-reads its detail. */
  onSaved: () => void;
}) {
  const [rates, setRates] = useState<RatesPayload | null>(null);
  const [grit, setGrit] = useState<GritPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** What the drafts looked like straight after the last load — a row's Save
   *  button is disabled until its draft differs from this. */
  const [baseline, setBaseline] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState("");
  /** The result of the last save, per row, in full sentences. */
  const [notes, setNotes] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [fullOpen, setFullOpen] = useState(false);
  // Bumped after every save made HERE so the full panel, if it is open,
  // remounts and re-reads — it only reloads after its own saves, and two
  // views of the same batch disagreeing is the failure this screen exists to
  // end.
  const [panelVersion, setPanelVersion] = useState(0);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${RATES_API}?batchKey=${encodeURIComponent(batchKey)}`, { cache: "no-store" }),
        fetch(`${GRIT_API}?batchKey=${encodeURIComponent(batchKey)}`, { cache: "no-store" }),
      ]);
      const res1 = await readJson<RatesPayload>(r1);
      const res2 = await readJson<GritPayload>(r2);
      if (!res1.ok || !res1.data) {
        setLoadError(res1.error ?? `Could not load this batch's materials (${res1.status})`);
        return false;
      }
      // The grit GET 404s on a batch with no mixer records where the rates
      // GET does not; that is "no silos", not an error worth a red box.
      const g: GritPayload = res2.ok && res2.data
        ? res2.data
        : { batchKey, batch: batchLabel, silos: [], sizeOptions: [], typeOptions: [] };
      if (!res2.ok && res2.status !== 404) {
        setLoadError(res2.error ?? `Could not load the grit silos (${res2.status})`);
      } else {
        setLoadError(null);
      }
      setRates(res1.data);
      setGrit(g);
      const d = draftsFrom(res1.data, g);
      setDrafts(d);
      setBaseline(d);
      return true;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [batchKey, batchLabel]);

  useEffect(() => { void load(); }, [load]);

  // -------------------------------------------------------------------------
  // The rows, in the order the line consumes them: resin, grit, filler, the
  // four dosed chemicals, then the exchange rate.
  // -------------------------------------------------------------------------
  const rows = useMemo<Row[]>(() => {
    if (!rates || !grit) return [];
    const out: Row[] = [];
    const byItem = (item: string) =>
      rates.rows.filter((r) => r.item === item).sort((a, b) => a.seq - b.seq);
    const find = (item: string) => rates.catalogue.find((c) => c.item === item);

    const material = (item: string) => {
      const def = find(item);
      if (!def) return;
      const m = rates.mixer[item];
      const lines = byItem(item);
      // Shown when the mixer weighed some, or when somebody has already priced
      // it — a material with saved lines must never hide.
      if (!(usable(m?.qty) || lines.length > 0)) return;
      out.push({
        kind: "material", key: `mat:${item}`, def, lines,
        total: usable(m?.qty) ? m.qty : null, unit: m?.unit ?? def.unit,
        shape: materialShape(lines),
      });
    };

    material("resin");
    for (const s of grit.silos) {
      if (!(s.kg > 0)) continue;
      out.push({
        kind: "grit", key: `grit:${s.silo}`, silo: s,
        shape: s.suppliers.length <= 1 ? "single" : s.suppliers.length === 2 ? "split" : "complex",
      });
    }
    material("filler-400");

    const resinKg = rates.mixer["resin"]?.qty ?? 0;
    for (const [chemKey, ruleKey] of DOSED_BY) {
      const chem = find(chemKey);
      const rule = find(ruleKey);
      if (!chem || !rule) continue;
      const chemLines = byItem(chemKey);
      const ruleLines = byItem(ruleKey);
      // The chemicals are never weighed. They apply wherever the batch has
      // resin for the dose to act on (completeness demands a dose then), and
      // wherever something has already been entered for them.
      if (!(resinKg > 0 || chemLines.length > 0 || ruleLines.length > 0)) continue;
      out.push({
        kind: "chem", key: `chem:${chemKey}`, chem, rule, chemLines, ruleLines,
        priceHere: !(chemLines.length > 1 || chemLines.some((l) => l.qty != null)),
      });
    }

    const basis = find(BASIS_ITEM);
    if (basis) out.push({ kind: "basis", key: "basis", def: basis, lines: byItem(BASIS_ITEM) });
    return out;
  }, [rates, grit]);

  // -------------------------------------------------------------------------
  // Facts the status column and the card captions need.
  // -------------------------------------------------------------------------

  const card = rates?.card;
  const resinKg = usable(rates?.mixer["resin"]?.qty) ? rates!.mixer["resin"].qty : null;

  /** hasGritAssignment, as report.ts and completeness.ts see it: ANY silo
   *  with a row flips the whole batch onto the silo path. */
  const onSiloPath = (grit?.silos ?? []).some((s) => s.size !== "" || s.suppliers.length > 0);

  /** The card rate for a material, or null. Resin has no single card rate —
   *  the card prices it PER SUPPLIER (card.resinBySupplier, never
   *  card.rates["resin"]) and report.ts charges un-entered resin tank by tank
   *  from those — so only a typed supplier that matches a card supplier
   *  resolves one figure. A card with a single supplier is NOT taken as the
   *  answer for a supplier it does not name, and not for a blank box either:
   *  the blank box is costed by the tank map, which the Status lists. */
  const cardRateFor = (item: string, supplier = ""): number | null => {
    if (!card) return null;
    if (item === "resin") {
      const m = card.resinBySupplier;
      const want = supplier.trim().toLowerCase();
      const hit = want ? Object.keys(m).find((k) => usable(m[k]) && k.trim().toLowerCase() === want) : undefined;
      return hit ? m[hit] : null;
    }
    const v = card.rates[item];
    return usable(v) ? v : null;
  };

  /** The card's resin suppliers and their rates, in the order the card lists
   *  them — the Status prints this wherever one resin figure cannot be named. */
  const resinCardList = (unit: string): string =>
    Object.entries(card?.resinBySupplier ?? {})
      .filter(([, v]) => usable(v))
      .map(([s, v]) => `${s} ${rateText(v, unit)}`)
      .join(", ");

  /** Whether the card prices a material at all — the completeness test. */
  const carded = (item: string): boolean => {
    if (!card) return false;
    if (item === "resin") return Object.values(card.resinBySupplier).some((v) => usable(v));
    return usable(card.rates[item]);
  };

  /** The dose in force for a rule, and where it came from: the batch's own
   *  line (LAST by seq with a usable rate) beats the card. Mirrors
   *  dosingOverrides / completeness.doseFor exactly. */
  const doseInForce = (row: ChemRow): { value: number; fromBatch: boolean } | null => {
    let own: number | null = null;
    for (const l of row.ruleLines) if (usable(l.rate)) own = l.rate;
    if (own != null) return { value: own, fromBatch: true };
    const v = card?.rates[row.rule.item];
    return usable(v) ? { value: v, fromBatch: false } : null;
  };

  /** The grey caption under a price box: the card rate, said out loud, so an
   *  empty box visibly means the card. It must agree with the Status beside
   *  it — so resin with no matching supplier points at the Status (which
   *  lists every card supplier) and never claims "no card rate" while the
   *  card prices resin. */
  const cardCaption = (item: string, unit: string, supplier = ""): string => {
    const c = cardRateFor(item, supplier);
    if (c != null) return `card ${rateText(c, unit)}`;
    const word = unit === "t" ? "tonne" : unit;
    if (item === "resin" && carded(item)) return `₹ per ${word} · card rate by supplier, see Status`;
    return `₹ per ${word} · no card rate`;
  };

  // -------------------------------------------------------------------------
  // Status, from the DATA (never the draft): the same facts completeness.ts
  // blocks on, in the words a verifier reads.
  // -------------------------------------------------------------------------

  const materialStatus = (item: string, label: string, unit: string, total: number | null, lines: SavedLine[]): Status => {
    if (lines.length === 0) {
      if (!carded(item)) return { tone: "amber", text: "Needs a price", sub: "nothing entered here and nothing on the card" };
      if (item === "resin") {
        return { tone: "gray", text: `Card rate ${resinCardList(unit)} (not entered here)` };
      }
      return { tone: "gray", text: `Card rate ${rateText(cardRateFor(item)!, unit)} (not entered here)` };
    }
    let assigned = 0, rests = 0, unusable = 0;
    for (const l of lines) {
      if (!usable(l.rate)) { unusable += 1; continue; }
      if (l.qty == null) { rests += 1; continue; }
      if (usable(l.qty)) assigned += l.qty; else unusable += 1;
    }
    assigned = r3(assigned);
    if (unusable > 0 || rests > 1) {
      return { tone: "red", text: "Needs a look", sub: `${label} has a line with no usable price or quantity — open the full panel` };
    }
    if (total != null) {
      const short = r3(total - assigned);
      if (short < -EPSILON) {
        return { tone: "red", text: `More assigned than weighed`, sub: `${num.format(assigned)} ${unit} assigned, ${num.format(total)} ${unit} weighed` };
      }
      if (short > EPSILON && rests === 0) {
        return { tone: "amber", text: `${num.format(short)} ${unit} still to assign`, sub: `${num.format(assigned)} of ${num.format(total)} ${unit} has a supplier` };
      }
    }
    const who = lines.map((l) => `${rateText(l.rate, unit)}${l.description ? ` · ${l.description}` : ""}`);
    return { tone: "green", text: `Set on this batch: ${who.join(" + ")}`, warn: unnamedWarn(lines.map((l) => l.description)) };
  };

  /** "supplier not named" — a line saved with a price and no supplier. The
   *  route and the full panel both allow it, and the sign-off gate does not
   *  block on it, but the supplier is the point of the column. */
  const unnamedWarn = (suppliers: string[]): string | undefined => {
    const missing = suppliers.filter((s) => !(s ?? "").trim()).length;
    if (missing === 0) return undefined;
    if (suppliers.length === 1) return "supplier not named";
    return missing === suppliers.length ? "suppliers not named" : "one supplier not named";
  };

  /** The worse of several tones, in the order the gate would read them. */
  const worst = (...s: Status[]): Status["tone"] => {
    const order: Status["tone"][] = ["red", "amber", "gray", "green"];
    return order.find((t) => s.some((x) => x.tone === t)) ?? "gray";
  };

  /** A size key ("grit-0.6-1.2") in the words the verifier reads ("0.6 – 1.2",
   *  "Glass grit # 8-16") — from the catalogue label, never the key. */
  const sizeWord = (k: string): string =>
    (rates?.catalogue.find((c) => c.item === k)?.label ?? k).replace(/^Grit /, "");

  /** Until a silo is entered, grit is costed per SIZE for the whole batch —
   *  from the card's per-size rate, or from size lines the full panel set —
   *  and neither GET says which silo ran which size. So every silo row on
   *  this path reads the same batch-wide facts, says so, and judges each
   *  size exactly as completeness.ts does (materialStatus on the size item):
   *  a size whose panel-entered split is short shows as short here, and a
   *  size with no card rate shows as unpriced here, rather than every silo
   *  reading "priced" while the sign-off card lists a blocker. */
  const cardPathStatus = (): Status => {
    if (!rates) return { tone: "gray", text: "" };
    const sizes = Object.keys(rates.mixer).filter((k) => k.startsWith("grit-") && usable(rates.mixer[k].qty));
    // Grit whose records yield no size at all is invisible to the per-size
    // costing — neither priced nor blocked — and only entering the silo
    // prices it.
    if (sizes.length === 0) {
      return { tone: "amber", text: "Needs a price", sub: "no size is recorded for this grit, so nothing prices it — enter the size, supplier and price here" };
    }
    const judged = sizes.map((k) => {
      const qty = rates.mixer[k].qty;
      const lines = rates.rows.filter((r) => r.item === k);
      return { k, qty, lines, st: materialStatus(k, sizeWord(k), "t", qty, lines) };
    });
    const tone = worst(...judged.map((j) => j.st));
    // When every size is at the card and fine, the lead sentence says "at the
    // card" once; otherwise each card-costed size says "from the card" itself
    // so it reads right beside a panel-priced or unpriced one.
    const plainCard = judged.every((j) => j.lines.length === 0 && j.st.tone === "gray");
    const list = judged.map(({ k, qty, lines, st }) => {
      const amount = `${sizeWord(k)} (${num.format(qty)} t)`;
      if (lines.length === 0) {
        return st.tone === "gray"
          ? `${rateText(cardRateFor(k)!, "t")} for ${amount}${plainCard ? "" : " from the card"}`
          : `no price for ${amount} — nothing entered and nothing on the card`;
      }
      return st.tone === "green"
        ? `${amount} priced in the full panel at ${st.text.replace(/^Set on this batch: /, "")}`
        : `${amount}: ${st.text.toLowerCase()}${st.sub ? ` (${st.sub})` : ""} — in the full panel`;
    }).join("; ");
    // What is NOT known per silo is said per silo: the size this one ran.
    const perSilo = sizes.length === 1
      ? "type the supplier and price here to price this silo by itself"
      : "which size this silo ran is not recorded until it is entered here — type its size, supplier and price to price it by itself";
    if (plainCard) return { tone, text: `Costed at the card: ${list} until a supplier is named`, sub: perSilo };
    if (tone === "gray") return { tone, text: `Costed by size: ${list}`, sub: perSilo };
    if (tone === "green") return { tone, text: `Priced by size in the full panel: ${list}`, sub: perSilo };
    // Amber or red: lead with the worst size's own words ("0.1 – 0.4: 19.015 t
    // still to assign"), and list every size underneath.
    const lead = judged.find((j) => j.st.tone === tone)!;
    return { tone, text: `${sizeWord(lead.k)}: ${lead.st.text.toLowerCase()}`, sub: `${list} · ${perSilo}` };
  };

  const gritStatus = (s: SiloRow): Status => {
    if (!onSiloPath) return cardPathStatus();
    const assigned = s.size !== "" || s.suppliers.length > 0;
    if (!assigned) return { tone: "red", text: "Needs a size, supplier and price", sub: "the batch is priced silo by silo now, so every silo must be entered" };
    if (s.size === "") return { tone: "red", text: "Needs a size" };
    if (s.suppliers.length === 0) return { tone: "red", text: "Needs a supplier and price" };
    const unpriced = s.suppliers.filter((p) => p.ratePerT == null);
    if (unpriced.length) {
      return { tone: "amber", text: "Needs a price", sub: `${unpriced.map((p) => p.supplier || "a supplier").join(", ")} — no price per tonne yet` };
    }
    const priced = s.suppliers.reduce((a, p) => a + p.kg, 0);
    const short = r3(s.kg - priced);
    if (short > EPSILON) return { tone: "amber", text: `${num.format(short)} kg still to assign`, sub: `${num.format(priced)} of ${num.format(s.kg)} kg has a supplier` };
    if (short < -EPSILON) return { tone: "red", text: "More assigned than drawn", sub: `${num.format(priced)} kg assigned, ${num.format(s.kg)} kg drawn` };
    const who = s.suppliers.map((p) => `${rateText(p.ratePerT!, "t")}${p.supplier ? ` · ${p.supplier}` : ""}`);
    return { tone: "green", text: `Set on this batch: ${who.join(" + ")}`, warn: unnamedWarn(s.suppliers.map((p) => p.supplier)) };
  };

  /** Two facts for a chemical: the dose and the price. Both are printed;
   *  the tone is the worse of the two. */
  const chemStatus = (row: ChemRow): { dose: Status; price: Status } => {
    const d = doseInForce(row);
    const dose: Status = d == null
      ? { tone: "red", text: "Needs a dose", sub: "nothing on this batch and nothing on the card" }
      : d.fromBatch
        ? { tone: "green", text: `Dose set on this batch: ${pctFmt.format(d.value)}% of resin` }
        : { tone: "gray", text: `Card dose ${pctFmt.format(d.value)}% of resin (not entered here)` };
    const price = materialStatus(row.chem.item, row.chem.label, "kg", null, row.chemLines);
    if (!row.priceHere && price.tone === "green") price.sub = "priced in the full panel";
    return { dose, price };
  };

  const basisStatus = (row: BasisRow): Status => {
    const own = row.lines.filter((l) => usable(l.rate)).at(-1);
    if (own) return { tone: "green", text: `Set on this batch: ₹${money.format(own.rate)} per USD` };
    const c = cardRateFor(BASIS_ITEM);
    if (c != null) return { tone: "gray", text: `Plant default ₹${money.format(c)} per USD (not entered here)` };
    return { tone: "amber", text: "Needs a figure", sub: "the cost sheet needs it; the sign-off does not" };
  };

  const rowTone = (row: Row): Status["tone"] => {
    switch (row.kind) {
      case "material": return materialStatus(row.def.item, row.def.label, row.unit, row.total, row.lines).tone;
      case "grit": return gritStatus(row.silo).tone;
      case "chem": { const s = chemStatus(row); return worst(s.dose, s.price); }
      case "basis": return basisStatus(row).tone;
    }
  };

  // -------------------------------------------------------------------------
  // Draft plumbing.
  // -------------------------------------------------------------------------

  const draftOf = <T extends Draft>(key: string): T | undefined => drafts[key] as T | undefined;
  const patch = <T extends Draft>(key: string, f: (d: T) => T) =>
    setDrafts((p) => ({ ...p, [key]: f(p[key] as T) }));
  const changed = (key: string) => JSON.stringify(drafts[key]) !== JSON.stringify(baseline[key]);

  const say = (key: string, text: string, ok: boolean) =>
    setNotes((n) => ({ ...n, [key]: { text, ok } }));

  // -------------------------------------------------------------------------
  // The three writes this table makes. Bodies are exactly what BatchRatesPanel
  // and GritSiloRows send for the same intent.
  // -------------------------------------------------------------------------

  const postLines = async (
    item: string,
    lines: Array<{ seq: number; qty: number | null; rate: number; description: string; note?: string }>,
  ): Promise<string | null> => {
    const r = await fetch(RATES_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchKey, item, lines }),
    });
    const res = await readJson<{ error?: string }>(r);
    return res.ok ? null : (res.error ?? `Save failed (${res.status})`);
  };

  /** Back to the card. A 404 means nothing was there to clear — already at
   *  the card, which is the state being asked for, so not an error. */
  const deleteLines = async (item: string): Promise<string | null> => {
    const qs = new URLSearchParams({ batchKey, item });
    const r = await fetch(`${RATES_API}?${qs}`, { method: "DELETE" });
    const res = await readJson<{ error?: string }>(r);
    if (res.ok || res.status === 404) return null;
    return res.error ?? `Could not clear (${res.status})`;
  };

  const putSilo = async (silo: {
    silo: string; size: string; gritType: string;
    suppliers: Array<{ supplier: string; kg: number; ratePerT: number | "" }>;
  }): Promise<string | null> => {
    const r = await fetch(GRIT_API, {
      method: "PUT",                       // the route has no POST
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchKey, silos: [silo] }),
    });
    const res = await readJson<{ ok?: boolean; error?: string }>(r);
    return res.ok ? null : (res.error ?? `Save failed (${res.status})`);
  };

  /** Runs one row's save: the work, then the reload and the parent's
   *  onSaved. try/finally, because readJson never throws but fetch does —
   *  a dropped connection must not leave "Saving…" on the button for ever.
   *  And WHICH half failed changes the answer: a throw before the save landed
   *  means nothing was written; a throw from the reload means it was. */
  const run = async (key: string, work: () => Promise<string | null>) => {
    setBusy(key);
    setNotes((n) => { const rest = { ...n }; delete rest[key]; return rest; });
    let saved = false;
    try {
      const result = await work();
      if (result == null) return;         // refused client-side; the row already says why
      saved = true;
      const ok = await load();
      say(key, ok ? result : `${result} (The screen could not refresh — reload to see it.)`, true);
      setPanelVersion((v) => v + 1);
      onSaved();
    } catch (e) {
      const detail = e instanceof Error && e.message ? `: ${e.message}` : ".";
      say(key, saved
        ? `Saved, but the screen could not refresh${detail} Reload to see it.`
        : `Could not reach the server. Nothing was saved${detail}`, saved);
    } finally {
      setBusy("");
    }
  };

  /** The price typed in a box, or a refusal. Blank is allowed to mean "none"
   *  only where the caller says so. */
  const readPrice = (raw: string, what: string, unit: string): { price: number } | { error: string } => {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n) || n <= 0) {
      return { error: `${what} needs a price above zero — type the rupees paid per ${unit}.` };
    }
    return { price: n };
  };

  /** " from Aypols", or " — supplier not named" when the box was left blank:
   *  the save is allowed (the route and the full panel allow it) but the
   *  result sentence must not read as if a supplier were on record. */
  const fromWho = (supplier: string): string =>
    supplier.trim() ? ` from ${supplier.trim()}` : " — supplier not named";

  // --- a weighed material: resin, filler ------------------------------------

  const saveMaterial = (row: MaterialRow) => run(row.key, async () => {
    const d = draftOf<MaterialDraft>(row.key);
    if (!d) return null;
    const label = row.def.label;
    const item = row.def.item;
    const unit = row.unit;
    const had = row.lines.length > 0;

    if (!d.split) {
      if (d.a.price.trim() === "") {
        // A supplier typed beside a blank price cannot be stored — the route
        // keeps no line without a rate — and must be refused, not dropped
        // (the batch-1413 silent-drop bug).
        if (d.a.supplier.trim() !== "") {
          say(row.key, `${label}: enter the price too, or clear the supplier — a supplier cannot be saved without a price.`, false);
          return null;
        }
        // Supplier and price both blank is "back to the card", and the DELETE
        // takes the line's note with it — the same as the full panel's "use
        // the card instead". The note is invisible here (carried only so a
        // re-save does not erase it), so it must not be the one thing that
        // silently blocks the way back; it is named in the result instead.
        if (had) {
          const e = await deleteLines(item);
          if (e) { say(row.key, e, false); return null; }
          return `${label} now prices at the card rate again.${d.a.note.trim() ? " The note the full panel kept on this line is cleared with it." : ""}`;
        }
        return null;
      }
      const p = readPrice(d.a.price, label, unit);
      if ("error" in p) { say(row.key, p.error, false); return null; }
      // ONE line, NO quantity: the whole of what the mixer weighed, at this
      // price. Description and note travel every time (cce42a6).
      const e = await postLines(item, [{ seq: 0, qty: null, rate: p.price, description: d.a.supplier, note: d.a.note }]);
      if (e) { say(row.key, e, false); return null; }
      const qty = row.total != null ? `${num.format(row.total)} ${unit} ` : "";
      return `${label}: ${qty}at ${rateText(p.price, unit)}${fromWho(d.a.supplier)}. The batch has been re-costed.`;
    }

    // A split between two suppliers: a typed quantity for the first, and the
    // second takes whatever is left — a blank-quantity LAST line, which is
    // complete by construction and self-adjusts if the mixer figure is ever
    // corrected.
    if (row.total == null) {
      say(row.key, `${label} has no mixer figure to split — open the full panel.`, false);
      return null;
    }
    const q = Number(d.qtyA);
    if (d.qtyA.trim() === "" || !Number.isFinite(q) || q <= 0 || q >= row.total - EPSILON) {
      const kgHint = unit === "t" && Number.isFinite(q) && q > 20 * row.total
        ? ` ${num.format(q)} looks like kilograms typed into a tonnes box — if you meant ${num.format(q)} kg, type ${num.format(q / 1000)}.`
        : "";
      say(row.key, `The first supplier's quantity must be more than 0 and less than the ${num.format(row.total)} ${unit} the mixer weighed.${kgHint}`, false);
      return null;
    }
    const pa = readPrice(d.a.price, `The first supplier of ${label}`, unit);
    if ("error" in pa) { say(row.key, pa.error, false); return null; }
    const pb = readPrice(d.b.price, `The second supplier of ${label}`, unit);
    if ("error" in pb) { say(row.key, pb.error.replace(" — type the rupees", ", or go back to one supplier — type the rupees"), false); return null; }
    const e = await postLines(item, [
      { seq: 0, qty: q, rate: pa.price, description: d.a.supplier, note: d.a.note },
      { seq: 1, qty: null, rate: pb.price, description: d.b.supplier, note: d.b.note },
    ]);
    if (e) { say(row.key, e, false); return null; }
    const rest = r3(row.total - q);
    return `${label}: ${num.format(q)} ${unit} at ${rateText(pa.price, unit)}${fromWho(d.a.supplier)}, `
      + `the other ${num.format(rest)} ${unit} at ${rateText(pb.price, unit)}${fromWho(d.b.supplier)}. The batch has been re-costed.`;
  });

  // --- a grit silo ----------------------------------------------------------

  const saveGrit = (row: GritRow) => run(row.key, async () => {
    const d = draftOf<GritDraft>(row.key);
    if (!d) return null;
    const s = row.silo;
    const name = siloName(s.silo);
    // Size AND a supplier, always: a silo saved with a size and no supplier
    // line flips the batch onto the silo path and blocks the sign-off at
    // once ("has no supplier or price against its N kg").
    if (d.size.trim() === "") { say(row.key, `${name}: pick the size it ran (for example 0.1-0.4).`, false); return null; }
    if (d.a.supplier.trim() === "") { say(row.key, `${name}: type the supplier — a silo cannot be saved without one.`, false); return null; }
    const rateOf = (raw: string, who: string): { rate: number | "" } | { error: string } => {
      if (raw.trim() === "") return { rate: "" };    // "" travels as "" → stored null = not priced yet, never 0
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return { error: `${who} on ${name.toLowerCase()} needs a price above zero, or none at all.` };
      return { rate: n };
    };
    const ra = rateOf(d.a.price, d.a.supplier.trim());
    if ("error" in ra) { say(row.key, ra.error, false); return null; }

    let suppliers: Array<{ supplier: string; kg: number; ratePerT: number | "" }>;
    let what: string;
    if (!d.split) {
      // The GET's kg verbatim, so the sum balances to the 0.005 kg the
      // sign-off gate measures with.
      suppliers = [{ supplier: d.a.supplier, kg: s.kg, ratePerT: ra.rate }];
      what = `${num.format(s.kg)} kg from ${d.a.supplier.trim()}${ra.rate === "" ? " (no price yet)" : ` at ${rateText(ra.rate, "t")}`}`;
    } else {
      if (d.b.supplier.trim() === "") { say(row.key, `${name}: type the second supplier too, or go back to one supplier.`, false); return null; }
      const q = Number(d.qtyA);
      if (d.qtyA.trim() === "" || !Number.isFinite(q) || q <= 0 || q >= s.kg - EPSILON) {
        say(row.key, `The first supplier's quantity must be more than 0 and less than the ${num.format(s.kg)} kg drawn from ${name.toLowerCase()}.`, false);
        return null;
      }
      const rb = rateOf(d.b.price, d.b.supplier.trim());
      if ("error" in rb) { say(row.key, rb.error, false); return null; }
      const rest = r3(s.kg - q);     // rounded, so the two lines sum to the silo to the gram
      suppliers = [
        { supplier: d.a.supplier, kg: q, ratePerT: ra.rate },
        { supplier: d.b.supplier, kg: rest, ratePerT: rb.rate },
      ];
      what = `${num.format(q)} kg from ${d.a.supplier.trim()}${ra.rate === "" ? "" : ` at ${rateText(ra.rate, "t")}`}, `
        + `the other ${num.format(rest)} kg from ${d.b.supplier.trim()}${rb.rate === "" ? "" : ` at ${rateText(rb.rate, "t")}`}`;
    }
    const e = await putSilo({ silo: s.silo, size: d.size, gritType: d.type, suppliers });
    if (e) { say(row.key, e, false); return null; }
    const unpriced = suppliers.some((p) => p.ratePerT === "");
    // Saving the FIRST silo moves the whole batch onto the silo path; every
    // other silo must then be entered too, and the person should hear that
    // here rather than discover it from the sign-off card.
    const flipped = !onSiloPath;
    const others = (grit?.silos ?? []).filter((x) => x.silo !== s.silo && x.kg > 0).length;
    return `${name} saved: ${d.size.trim()}${d.type.trim() ? ` ${d.type.trim()}` : ""}, ${what}.`
      + (unpriced ? " It still needs a price per tonne before the batch can be signed off." : "")
      + (flipped && others > 0 ? ` Grit on this batch is now priced silo by silo — the other ${others} silo${others === 1 ? "" : "s"} need${others === 1 ? "s" : ""} a size, supplier and price too.` : "")
      + " The batch has been re-costed.";
  });

  // --- a dosed chemical -----------------------------------------------------

  /** What one half of a chemical row wants done on the wire, decided before
   *  anything is sent. */
  type ChemOp = { kind: "post"; value: number } | { kind: "delete" } | { kind: "none" };

  const saveChem = (row: ChemRow) => run(row.key, async () => {
    const d = draftOf<ChemDraft>(row.key);
    if (!d) return null;
    const { chem, rule } = row;
    const cardPct = cardRateFor(rule.item);

    // BOTH HALVES ARE READ AND REFUSED BEFORE EITHER IS WRITTEN. The dose and
    // the price are two items on the wire but one press of Save, and a
    // refusal on the price after the dose had already landed left the batch
    // re-dosed server-side while the row still read the old dose and the
    // sign-off card was never told — the half-changed batch this whole
    // screen promises not to produce. So the dose is only read here; the
    // writes come after both halves have passed, dose first.

    // 1. THE DOSE. The rule line carries no supplier — it is a percentage,
    //    not a purchase.
    let dose: ChemOp;
    const pctRaw = d.pct.trim();
    if (pctRaw === "") {
      if (cardPct == null) {
        say(row.key, `${chem.label} needs a dose — type the % of resin or the kg used; there is nothing on the card to fall back to.`, false);
        return null;
      }
      dose = row.ruleLines.length > 0 ? { kind: "delete" } : { kind: "none" };
    } else {
      const pct = Number(pctRaw);
      if (!Number.isFinite(pct) || pct <= 0) {
        say(row.key, `${chem.label} needs a dose above zero — a % of resin weight, or the kg used.`, false);
        return null;
      }
      dose = { kind: "post", value: pct };
    }

    // 2. THE PRICE, only when this row may write it (not split in the full
    //    panel).
    let price: ChemOp = { kind: "none" };
    if (row.priceHere) {
      const priceRaw = d.price.trim();
      if (priceRaw === "") {
        if (d.supplier.trim()) {
          say(row.key, `${chem.label}: enter the price too, or clear the supplier — a supplier cannot be saved without a price.`, false);
          return null;
        }
        // Supplier and price both blank is "back to the card"; the DELETE
        // takes the line's note with it, as the full panel's clear does, and
        // the invisible note is not allowed to block the way back.
        price = row.chemLines.length > 0 ? { kind: "delete" } : { kind: "none" };
      } else {
        const p = Number(priceRaw);
        if (!Number.isFinite(p) || p <= 0) {
          say(row.key, `${chem.label} needs a price above zero, or none at all to use the card.`, false);
          return null;
        }
        price = { kind: "post", value: p };
      }
    }

    if (dose.kind === "none" && price.kind === "none") {
      say(row.key, `${chem.label}: nothing to save — both boxes already mean the card.`, true);
      return null;
    }

    // 3. THE WRITES, dose first: if it fails there is nothing to price and
    //    the batch is left exactly as it was.
    const parts: string[] = [];
    if (dose.kind === "delete") {
      const e = await deleteLines(rule.item);
      if (e) { say(row.key, e, false); return null; }
      parts.push(`dose back to the card's ${pctFmt.format(cardPct!)}% of resin`);
    } else if (dose.kind === "post") {
      const e = await postLines(rule.item, [{ seq: 0, qty: null, rate: dose.value, description: "" }]);
      if (e) { say(row.key, e, false); return null; }
      const kg = resinKg != null ? ` = ${num.format((resinKg * dose.value) / 100)} kg` : "";
      parts.push(`dose ${pctFmt.format(dose.value)}% of resin weight${kg}`);
    }
    // Description AND note go on every price save — the route replaces the
    // set wholesale, and omitting them is exactly the cce42a6 loss.
    if (price.kind === "delete") {
      const e = await deleteLines(chem.item);
      if (e) { say(row.key, e, false); return null; }
      parts.push(`price back to the card${d.note.trim() ? " (the note the full panel kept on it is cleared with it)" : ""}`);
    } else if (price.kind === "post") {
      // qty null: the whole derived weight, at this price.
      const e = await postLines(chem.item, [{ seq: 0, qty: null, rate: price.value, description: d.supplier, note: d.note }]);
      if (e) { say(row.key, e, false); return null; }
      parts.push(`${rateText(price.value, "kg")}${fromWho(d.supplier)}`);
    }
    return `${chem.label}: ${parts.join("; ")}. The batch has been re-costed.`;
  });

  // --- the exchange rate ----------------------------------------------------

  const saveBasis = (row: BasisRow) => run(row.key, async () => {
    const d = draftOf<BasisDraft>(row.key);
    if (!d) return null;
    const raw = d.value.trim();
    if (raw === "") {
      if (row.lines.length === 0) return null;
      const e = await deleteLines(BASIS_ITEM);
      if (e) { say(row.key, e, false); return null; }
      return "The exchange rate is back to the plant default.";
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) {
      say(row.key, "The exchange rate needs a figure above zero — rupees per US dollar.", false);
      return null;
    }
    // One value, no quantity — the route refuses a split here. The
    // description and note the full panel may have written on this line ride
    // along from the loaded row, exactly as the panel re-sends them, so a
    // retyped rate never erases "RBI reference 20 Aug" (cce42a6 again).
    const e = await postLines(BASIS_ITEM, [{ seq: 0, qty: null, rate: v, description: d.description, note: d.note }]);
    if (e) { say(row.key, e, false); return null; }
    return `This batch is costed at ₹${money.format(v)} per USD. The batch has been re-costed.`;
  });

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------

  if (loadError && !rates) {
    return <Card><p className="text-sm text-red-600">{loadError}</p></Card>;
  }
  if (!rates || !grit) {
    return <Card><Empty>Reading what the mixer weighed and the rate card…</Empty></Card>;
  }

  const materialRows = rows.filter((r) => r.kind !== "basis");
  // Until a silo is entered, every silo row repeats the same batch-wide grit
  // facts (cardPathStatus), so the header counts grit ONCE there — three rows
  // reading "needs a price" is one missing price, not three, and the sign-off
  // card lists it once. On the silo path each silo is its own answer.
  const counted = onSiloPath
    ? materialRows
    : materialRows.filter((r, i, all) => r.kind !== "grit" || all.findIndex((x) => x.kind === "grit") === i);
  const tones = counted.map(rowTone);
  const setHere = tones.filter((t) => t === "green").length;
  const needs = tones.filter((t) => t === "amber" || t === "red").length;

  const statusCell = (...ss: Status[]) => (
    <div className="space-y-1">
      {ss.map((s, i) => (
        <div key={i}>
          <span className={`text-sm font-medium ${toneClass[s.tone]}`}>{s.text}</span>
          {s.sub && <span className="block text-xs text-gray-400">{s.sub}</span>}
          {s.warn && <span className="block text-xs text-amber-700">{s.warn}</span>}
        </div>
      ))}
    </div>
  );

  const saveButton = (key: string, onClick: () => void, label = "Save") => (
    <button type="button" className={btn} disabled={busy === key || !changed(key)} onClick={onClick}>
      {busy === key ? "Saving…" : label}
    </button>
  );

  const supplierBox = (value: string, onChange: (v: string) => void, ph = "who it was bought from") => (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph}
      list={SUPPLIER_LIST} autoComplete="off" className={inp} />
  );
  /** A price box: the placeholder is the UNIT ONLY ("₹ per kg"), and the card
   *  figure goes in a grey caption directly under the box. The caption is
   *  text, so it wraps instead of clipping — at the page's real width the
   *  box has ~86px of text room and "card: ₹12,499/t" does not fit in it. */
  const priceBox = (value: string, onChange: (v: string) => void, unitWord: string, caption: string, ariaLabel: string) => (
    <div>
      <input type="number" step="0.0001" min="0" inputMode="decimal" value={value}
        onChange={(e) => onChange(e.target.value)} placeholder={`₹ per ${unitWord}`} aria-label={ariaLabel}
        className={`${inp} max-w-[11rem]`} />
      {caption && <span className="mt-0.5 block text-xs text-gray-400">{caption}</span>}
    </div>
  );

  /** The result of the last save on a row, under the row, full width. */
  const noteRow = (key: string) => {
    const n = notes[key];
    if (!n) return null;
    return (
      <tr key={`${key}:note`}>
        <td colSpan={6} className="px-3 pb-3 pt-0">
          <p className={`rounded-lg border px-3 py-1.5 text-xs ${
            n.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
          }`}>
            {n.text}
          </p>
        </td>
      </tr>
    );
  };

  /** "Priced in the full panel" — a row this table can show but must not
   *  overwrite, because a save from here would replace a split it cannot
   *  represent. */
  const complexCell = (
    <p className="text-xs text-gray-500">Priced in the full panel — open it below to change this.</p>
  );

  /** One line under the silo rows, said rather than hidden: the grit-assignment
   *  API has no way back from a silo save (its PUT upserts the silo, and the
   *  one DELETE that would withdraw it has no screen), so a silo once named
   *  stays named and the batch stays priced silo by silo. That is a limit of
   *  the API, not of this table, and the verifier should know it BEFORE the
   *  first silo Save flips the batch — it is the one save here without the
   *  plain undo every price box has (clear it, Save, back to the card). */
  const gritLimitRow = (
    <tr key="grit:limit">
      <td colSpan={6} className="px-3 pb-2 pt-0">
        <p className="text-xs text-gray-400">
          Silos: a silo once named stays named — change it, do not expect to clear it. The silo record keeps no way back,
          so once one silo is saved the grit on this batch is priced silo by silo from then on.
        </p>
      </td>
    </tr>
  );

  // --- a weighed material row -------------------------------------------------
  const materialTr = (row: MaterialRow) => {
    const d = draftOf<MaterialDraft>(row.key);
    const st = materialStatus(row.def.item, row.def.label, row.unit, row.total, row.lines);
    const unit = row.unit;
    const unitWord = unit === "t" ? "tonne" : unit;
    const rest = d?.split && row.total != null && Number.isFinite(Number(d.qtyA)) && Number(d.qtyA) > 0
      ? r3(row.total - Number(d.qtyA)) : null;
    return (
      <tr key={row.key} className="border-t border-gray-100">
        <td className={td}>
          <span className="block text-sm font-medium text-gray-900">{row.def.label}</span>
          <span className="block text-xs text-gray-400">weighed by the mixer</span>
        </td>
        <td className={td}>
          {row.total == null ? (
            <span className="text-sm text-gray-400">no mixer figure</span>
          ) : (
            <>
              <span className="block text-sm text-gray-900">{num.format(row.total)} {unit}</span>
              {unit === "t" && <span className="block text-xs text-gray-400">{num.format(row.total * 1000)} kg</span>}
            </>
          )}
        </td>
        {row.shape === "complex" || !d ? (
          <td className={td} colSpan={2}>{complexCell}</td>
        ) : (
          <>
            <td className={td}>
              <div className="space-y-2">
                {supplierBox(d.a.supplier, (v) => patch<MaterialDraft>(row.key, (x) => ({ ...x, a: { ...x.a, supplier: v } })))}
                {d.split && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-gray-500">
                      <input type="number" step="0.001" min="0" inputMode="decimal" value={d.qtyA}
                        aria-label={`${row.def.label} from the first supplier (${unit})`}
                        onChange={(e) => patch<MaterialDraft>(row.key, (x) => ({ ...x, qtyA: e.target.value }))}
                        placeholder={`how much (${unit})`} className={`${inp} max-w-[9rem]`} />
                      <span>{unit} from the first supplier</span>
                    </label>
                    {supplierBox(d.b.supplier, (v) => patch<MaterialDraft>(row.key, (x) => ({ ...x, b: { ...x.b, supplier: v } })), "the second supplier")}
                    <span className="block text-xs text-gray-500">
                      {rest == null
                        ? `the second supplier takes what is left of the ${row.total != null ? num.format(row.total) : "—"} ${unit}`
                        : rest > EPSILON
                          ? `the remaining ${num.format(rest)} ${unit} from the second supplier`
                          : `nothing left for the second supplier — type less than ${row.total != null ? num.format(row.total) : "—"} ${unit}`}
                    </span>
                  </>
                )}
                {row.total != null && (
                  <button type="button" className={link}
                    onClick={() => patch<MaterialDraft>(row.key, (x) =>
                      x.split ? { ...x, split: false, qtyA: "", b: blankParty() } : { ...x, split: true })}>
                    {d.split ? "Back to one supplier" : "Split between two suppliers"}
                  </button>
                )}
              </div>
            </td>
            <td className={td}>
              <div className="space-y-2">
                {priceBox(d.a.price, (v) => patch<MaterialDraft>(row.key, (x) => ({ ...x, a: { ...x.a, price: v } })),
                  unitWord, cardCaption(row.def.item, unit, d.a.supplier), `${row.def.label} price per ${unitWord}`)}
                {d.split && priceBox(d.b.price, (v) => patch<MaterialDraft>(row.key, (x) => ({ ...x, b: { ...x.b, price: v } })),
                  unitWord, cardCaption(row.def.item, unit, d.b.supplier), `${row.def.label} second supplier price per ${unitWord}`)}
              </div>
            </td>
          </>
        )}
        <td className={td}>{statusCell(st)}</td>
        <td className={`${td} text-right`}>
          {row.shape !== "complex" && d && saveButton(row.key, () => void saveMaterial(row))}
        </td>
      </tr>
    );
  };

  // --- a grit silo row --------------------------------------------------------
  const gritTr = (row: GritRow) => {
    const d = draftOf<GritDraft>(row.key);
    const s = row.silo;
    const st = gritStatus(s);
    const rest = d?.split && Number.isFinite(Number(d.qtyA)) && Number(d.qtyA) > 0 ? r3(s.kg - Number(d.qtyA)) : null;
    return (
      <tr key={row.key} className="border-t border-gray-100">
        <td className={td}>
          <span className="block text-sm font-medium text-gray-900">{gritTitle(s.silo)}</span>
          {d && row.shape !== "complex" ? (
            <div className="mt-1.5 space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <span className="w-8">Size</span>
                <input list={SIZE_LIST} value={d.size} placeholder="0.1-0.4" aria-label={`${siloName(s.silo)} size`}
                  onChange={(e) => patch<GritDraft>(row.key, (x) => ({ ...x, size: e.target.value }))}
                  className={`${inp} max-w-[9rem]`} />
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <span className="w-8">Type</span>
                <input list={TYPE_LIST} value={d.type} placeholder="Premium Supreme" aria-label={`${siloName(s.silo)} type`}
                  onChange={(e) => patch<GritDraft>(row.key, (x) => ({ ...x, type: e.target.value }))}
                  className={`${inp} max-w-[9rem]`} />
              </label>
            </div>
          ) : (
            <span className="block text-xs text-gray-400">{[s.size || "no size yet", s.gritType].filter(Boolean).join(" · ")}</span>
          )}
        </td>
        <td className={td}>
          <span className="block text-sm text-gray-900">{num.format(s.kg)} kg</span>
          <span className="block text-xs text-gray-400">{s.silo === NO_SILO ? "weighed against no silo" : "drawn from this silo"}</span>
        </td>
        {row.shape === "complex" || !d ? (
          <td className={td} colSpan={2}>{complexCell}</td>
        ) : (
          <>
            <td className={td}>
              <div className="space-y-2">
                {supplierBox(d.a.supplier, (v) => patch<GritDraft>(row.key, (x) => ({ ...x, a: { ...x.a, supplier: v } })), "who supplied it")}
                {d.split && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-gray-500">
                      <input type="number" step="0.001" min="0" inputMode="decimal" value={d.qtyA}
                        aria-label={`${siloName(s.silo)} kg from the first supplier`}
                        onChange={(e) => patch<GritDraft>(row.key, (x) => ({ ...x, qtyA: e.target.value }))}
                        placeholder="how much (kg)" className={`${inp} max-w-[9rem]`} />
                      <span>kg from the first supplier</span>
                    </label>
                    {supplierBox(d.b.supplier, (v) => patch<GritDraft>(row.key, (x) => ({ ...x, b: { ...x.b, supplier: v } })), "the second supplier")}
                    <span className="block text-xs text-gray-500">
                      {rest == null
                        ? `the second supplier takes what is left of the ${num.format(s.kg)} kg`
                        : rest > EPSILON
                          ? `the remaining ${num.format(rest)} kg from the second supplier`
                          : `nothing left for the second supplier — type less than ${num.format(s.kg)} kg`}
                    </span>
                  </>
                )}
                <button type="button" className={link}
                  onClick={() => patch<GritDraft>(row.key, (x) =>
                    x.split ? { ...x, split: false, qtyA: "", b: blankParty() } : { ...x, split: true })}>
                  {d.split ? "Back to one supplier" : "Split between two suppliers"}
                </button>
              </div>
            </td>
            <td className={td}>
              <div className="space-y-2">
                {/* No card caption: a silo's price is what is typed for it, and
                    the card's per-size rate the batch is costed at until then
                    is in the Status. The unit is the caption, because the price
                    is per TONNE while the weight beside it is kilograms. */}
                {priceBox(d.a.price, (v) => patch<GritDraft>(row.key, (x) => ({ ...x, a: { ...x.a, price: v } })),
                  "tonne", "per tonne, not per kg", `${siloName(s.silo)} price per tonne`)}
                {d.split && priceBox(d.b.price, (v) => patch<GritDraft>(row.key, (x) => ({ ...x, b: { ...x.b, price: v } })),
                  "tonne", "per tonne, not per kg", `${siloName(s.silo)} second supplier price per tonne`)}
              </div>
            </td>
          </>
        )}
        <td className={td}>{statusCell(st)}</td>
        <td className={`${td} text-right`}>
          {row.shape !== "complex" && d && saveButton(row.key, () => void saveGrit(row))}
        </td>
      </tr>
    );
  };

  // --- a dosed chemical row ---------------------------------------------------
  const chemTr = (row: ChemRow) => {
    const d = draftOf<ChemDraft>(row.key);
    const st = chemStatus(row);
    const cardPct = cardRateFor(row.rule.item);
    // What is in force while they type: the typed percentage, else the card's.
    const typed = d ? Number(d.pct) : NaN;
    const typedOk = d != null && d.pct.trim() !== "" && Number.isFinite(typed) && typed > 0;
    const effPct = typedOk ? typed : cardPct;
    // The kilograms the SHEET will print: resin × the STORED percentage / 100
    // (report.ts dose()), never the raw kg somebody typed.
    const sheetKg = resinKg != null && effPct != null ? (resinKg * effPct) / 100 : null;
    const kgShown = d == null ? "" : d.kg !== "" ? d.kg : typedOk && resinKg != null ? String(r3((resinKg * typed) / 100)) : "";

    const setPct = (v: string) => patch<ChemDraft>(row.key, (x) => ({ ...x, pct: v, kg: "" }));
    const setKg = (v: string) => patch<ChemDraft>(row.key, (x) => {
      if (resinKg == null) return x;
      if (v.trim() === "") return { ...x, kg: "", pct: "" };          // both blank = the card
      const w = Number(v);
      if (!Number.isFinite(w) || w <= 0) return { ...x, kg: v };
      // Six decimals of percentage keeps the round-trip honest: 1,792.312 kg
      // of 22,404 kg resin is 7.999964%, and the sheet kg recomputed from that
      // differs from what was typed by well under a gram.
      return { ...x, kg: v, pct: String(Math.round((w / resinKg) * 100 * 1e6) / 1e6) };
    });

    return (
      <tr key={row.key} className="border-t border-gray-100">
        <td className={td}>
          <span className="block text-sm font-medium text-gray-900">{row.chem.label}</span>
          <span className="block text-xs text-gray-400">not weighed — comes from the dose</span>
        </td>
        <td className={td}>
          {d ? (
            <div className="space-y-1.5">
              {resinKg != null && (
                <label className="flex items-center gap-2 text-xs text-gray-500">
                  {/* Unit-only placeholders; the card dose is the caption
                      under both boxes, where it cannot clip. */}
                  <input type="number" step="0.001" min="0" inputMode="decimal" value={kgShown}
                    onChange={(e) => setKg(e.target.value)} aria-label={`${row.chem.label} kg used`}
                    placeholder="kg" className={`${inp} max-w-[9rem]`} />
                  <span>kg used</span>
                </label>
              )}
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <input type="number" step="0.0001" min="0" inputMode="decimal" value={d.pct}
                  onChange={(e) => setPct(e.target.value)} aria-label={`${row.chem.label} % of resin`}
                  placeholder="%" className={`${inp} max-w-[9rem]`} />
                <span>% of resin</span>
              </label>
              <span className="block text-xs text-gray-400">
                {resinKg == null
                  ? cardPct != null
                    ? `card: ${pctFmt.format(cardPct)}% dose — no resin figure on this batch, so the kg cannot be worked out; type the %`
                    : "no resin figure on this batch — the kg cannot be worked out, type the %"
                  : effPct == null
                    ? `no card dose — type either box, against ${num.format(resinKg)} kg resin`
                    : `${typedOk ? "" : "card: "}${pctFmt.format(effPct)}% dose of ${num.format(resinKg)} kg resin = ${num.format(sheetKg!)} kg`}
              </span>
            </div>
          ) : null}
        </td>
        {!row.priceHere || !d ? (
          <td className={td} colSpan={2}>{complexCell}</td>
        ) : (
          <>
            <td className={td}>
              {supplierBox(d.supplier, (v) => patch<ChemDraft>(row.key, (x) => ({ ...x, supplier: v })))}
            </td>
            <td className={td}>
              {priceBox(d.price, (v) => patch<ChemDraft>(row.key, (x) => ({ ...x, price: v })),
                "kg", cardCaption(row.chem.item, "kg"), `${row.chem.label} price per kg`)}
            </td>
          </>
        )}
        <td className={td}>{statusCell(st.dose, st.price)}</td>
        <td className={`${td} text-right`}>
          {d && saveButton(row.key, () => void saveChem(row))}
        </td>
      </tr>
    );
  };

  // --- the exchange rate row --------------------------------------------------
  const basisTr = (row: BasisRow) => {
    const d = draftOf<BasisDraft>(row.key);
    const st = basisStatus(row);
    const c = cardRateFor(BASIS_ITEM);
    return (
      <tr key={row.key} className="border-t border-gray-100">
        <td className={td}>
          <span className="block text-sm font-medium text-gray-900">Exchange rate</span>
          <span className="block text-xs text-gray-400">the rate this batch was quoted at</span>
        </td>
        <td className={td}><span className="text-xs text-gray-400">one figure for the whole batch</span></td>
        <td className={td}><span className="text-xs text-gray-400">—</span></td>
        <td className={td}>
          {d && (
            <div className="space-y-2">
              <input type="number" step="0.0001" min="0" inputMode="decimal" value={d.value}
                onChange={(e) => patch<BasisDraft>(row.key, (x) => ({ ...x, value: e.target.value }))}
                placeholder="₹ per USD" aria-label="Rupees per USD" className={`${inp} max-w-[11rem]`} />
              <span className="block text-xs text-gray-400">
                {c != null ? `plant default ₹${money.format(c)} per USD` : "₹ per USD · no plant default"}
              </span>
            </div>
          )}
        </td>
        <td className={td}>{statusCell(st)}</td>
        <td className={`${td} text-right`}>{d && saveButton(row.key, () => void saveBasis(row))}</td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            What this batch used · {batchLabel}
          </h2>
          {materialRows.length > 0 && (
            <p className="mt-1 text-sm font-medium text-gray-800">
              {setHere} of {counted.length} material{counted.length === 1 ? "" : "s"} priced on this batch
              {" · "}
              {needs === 0
                ? <span className="text-green-700">nothing still needs a price</span>
                : <span className="text-amber-700">{needs} still need{needs === 1 ? "s" : ""} a price</span>}
            </p>
          )}
          <p className="mt-1 max-w-3xl text-xs text-gray-500">
            For each material below, type the supplier and the price paid per unit, then press Save on that row.
            Leave a price box empty to use the card rate printed in grey under it; the Status column says what the batch is costed at either way.
          </p>
        </div>

        {loadError && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">{loadError}</p>
        )}

        {/* One datalist per kind of box, rendered once. */}
        <datalist id={SUPPLIER_LIST}>
          {(rates.descriptions ?? []).map((s) => <option key={s} value={s} />)}
        </datalist>
        <datalist id={SIZE_LIST}>
          {grit.sizeOptions.map((s) => <option key={s} value={s} />)}
        </datalist>
        <datalist id={TYPE_LIST}>
          {grit.typeOptions.map((t) => <option key={t} value={t} />)}
        </datalist>

        {/* No materials means no table at all — the exchange rate alone has
            nothing to apply to on a batch the mixer never weighed. */}
        {materialRows.length === 0 ? (
          <Empty>The mixer recorded nothing for {batchLabel}, so there is nothing to price.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className={td}>Material</th>
                  {/* "How much", not "what the mixer weighed": on the four
                      chemical rows this column holds the dose boxes the
                      verifier TYPES, and each row's own sub-label says whether
                      its figure was weighed or dosed. */}
                  <th className={td}>How much went in</th>
                  <th className={td}>Supplier</th>
                  <th className={td}>Price per unit</th>
                  <th className={td}>Status</th>
                  <th className={td} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const tr = row.kind === "material" ? materialTr(row)
                    : row.kind === "grit" ? gritTr(row)
                      : row.kind === "chem" ? chemTr(row)
                        : basisTr(row);
                  const lastGrit = row.kind === "grit" && rows[i + 1]?.kind !== "grit";
                  return [tr, noteRow(row.key), lastGrit ? gritLimitRow : null];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Everything this table does not cover — band rates, three or more
          suppliers, notes — is still on the admin's panel, which opens here
          unchanged. Closed by default: it is the screen the verifiers found
          hard, and the table above is meant to be enough on an ordinary day. */}
      <div>
        <button type="button" className={link} onClick={() => setFullOpen((o) => !o)}>
          {fullOpen ? "Hide the full panel" : "Open the full panel"}
        </button>
        <span className="ml-2 text-xs text-gray-400">
          for grit priced by size, three or more suppliers, notes, or anything the table above does not cover
        </span>
      </div>
      {fullOpen && (
        <BatchRatesPanel
          key={`${batchKey}:${panelVersion}`}
          batchKey={batchKey}
          batchLabel={batchLabel}
          onSaved={() => { void load(); onSaved(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drafts from the server's rows — the panel's own habit of reloading what was
// saved rather than trusting local state.
// ---------------------------------------------------------------------------

function materialShape(lines: SavedLine[]): Shape {
  if (lines.length === 0) return "single";
  if (lines.length === 1) return lines[0].qty == null ? "single" : "split";
  if (lines.length === 2 && lines[0].qty != null) return "split";
  return "complex";
}

const partyOf = (l: SavedLine | undefined): Party =>
  l ? { supplier: l.description ?? "", price: String(l.rate), note: l.note ?? "" } : blankParty();

function draftsFrom(rates: RatesPayload, grit: GritPayload): Record<string, Draft> {
  const out: Record<string, Draft> = {};
  const byItem = (item: string) =>
    rates.rows.filter((r) => r.item === item).sort((a, b) => a.seq - b.seq);

  for (const item of ["resin", "filler-400"]) {
    const lines = byItem(item);
    const shape = materialShape(lines);
    if (shape === "complex") continue;
    out[`mat:${item}`] = shape === "single"
      ? { kind: "material", split: false, qtyA: "", a: partyOf(lines[0]), b: blankParty() }
      : { kind: "material", split: true, qtyA: String(lines[0].qty), a: partyOf(lines[0]), b: partyOf(lines[1]) };
  }

  for (const s of grit.silos) {
    if (s.suppliers.length > 2) continue;
    const p = (x: SiloRow["suppliers"][number] | undefined): Party =>
      x ? { supplier: x.supplier, price: x.ratePerT == null ? "" : String(x.ratePerT), note: "" } : blankParty();
    out[`grit:${s.silo}`] = s.suppliers.length <= 1
      ? { kind: "grit", size: s.size, type: s.gritType, split: false, qtyA: "", a: p(s.suppliers[0]), b: blankParty() }
      : { kind: "grit", size: s.size, type: s.gritType, split: true, qtyA: String(s.suppliers[0].kg), a: p(s.suppliers[0]), b: p(s.suppliers[1]) };
  }

  for (const [chem, rule] of DOSED_BY) {
    // The dose box shows the batch's OWN percentage when it has one (last by
    // seq with a usable rate) and is otherwise empty, so the card dose shows
    // as the placeholder and blank visibly means the card.
    let own: number | null = null;
    for (const l of byItem(rule)) if (usable(l.rate)) own = l.rate;
    const chemLines = byItem(chem);
    const single = chemLines.length <= 1 && !chemLines.some((l) => l.qty != null) ? chemLines[0] : undefined;
    out[`chem:${chem}`] = {
      kind: "chem", pct: own == null ? "" : String(own), kg: "",
      supplier: single?.description ?? "", price: single ? String(single.rate) : "", note: single?.note ?? "",
    };
  }

  const basis = byItem(BASIS_ITEM).filter((l) => usable(l.rate)).at(-1);
  out["basis"] = {
    kind: "basis", value: basis ? String(basis.rate) : "",
    description: basis?.description ?? "", note: basis?.note ?? "",
  };
  return out;
}
