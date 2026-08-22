"use client";

// GRIT, one card per SILO — the block that sits where the size-band cards used
// to, inside the materials panel, wearing the same clothes as Resin and Filler
// either side of it.
//
// WHY THIS REPLACED TWO SCREENS.
//
// There were two: band cards here ("Grit 0.1 - 0.4, mixer weighed 19.104 t,
// Assign") and a separate silo panel below, which carried the size and the
// supplier split and said in its own header that nothing on it was a price. So
// the same tonnage was described twice, in two places, keyed two different ways
// — once by size band and once by silo — and nothing made the two agree. The
// owner asked for one table, and one table is also the only way the numbers can
// stop disagreeing.
//
// THE ROW LIST COMES FROM THE MIXER. A card exists for every silo the mixer drew
// from, whether or not anybody has assigned it. That is deliberate and it is the
// failure the silo feature was built to end: a fixed list of bands meant tonnage
// from a sixth silo was invisible, and a material nobody can see is a material
// nobody can price.
//
// ONE SIZE AND ONE TYPE PER SILO, held by the database (unique on batch_key +
// silo_no), because a silo runs one material at a time. The SPLIT is across
// SUPPLIERS, and each split line carries its OWN price — a silo is split
// precisely because the supplier differs, and a different supplier is a
// different invoice at a different price.
//
// A FLAG NEVER BLOCKS A SAVE. Every disagreement between what is typed and what
// the bag records say is reported in words and then ignored by the save path:
// the typed value is what the batch is costed at. Only malformed input is
// refused.

import { useCallback, useEffect, useState } from "react";

import { NO_SILO } from "@/lib/costing/gritAssign";
import { readJson } from "@/lib/readJson";

const API = "/api/office/grit-assignment";

// Borrowed verbatim from BatchRatesPanel so this block cannot drift out of step
// with the material rows above and below it.
const inp = "w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

const SIZE_LIST = "grit-size-options";
const TYPE_LIST = "grit-type-options";

interface Flag {
  verdict: string;
  entered: string;
  recorded: string[];
  score?: number;
  reason?: string | null;
}

interface SiloRow {
  silo: string;
  kg: number;
  size: string;
  gritType: string;
  suppliers: Array<{ seq: number; supplier: string; kg: number; ratePerT: number | null }>;
  recordedSizes: string[];
  recordedSuppliers: string[];
  sizeFlag: Flag;
  supplierFlags: Array<Flag & { seq: number }>;
}

interface Payload {
  batchKey: string;
  batch: string;
  design: string;
  silos: SiloRow[];
  unresolvedKg: number;
  sizeOptions: string[];
  typeOptions: string[];
  blockers: string[];
}

/** A draft line. Every value is a STRING so a half-typed number does not become
 *  NaN under the user's cursor, and so "" can mean "not priced" rather than 0. */
interface Draft { supplier: string; kg: string; rate: string }

const draftsOf = (s: SiloRow): Draft[] =>
  s.suppliers.length
    ? s.suppliers.map((p) => ({
        supplier: p.supplier,
        kg: String(p.kg),
        // null is "nobody has priced this", and it must render as an empty box
        // rather than a 0 somebody would read as a price.
        rate: p.ratePerT == null ? "" : String(p.ratePerT),
      }))
    : [{ supplier: "", kg: "", rate: "" }];

export function GritSiloRows({ batchKey, onSaved }: { batchKey: string; onSaved?: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<Record<string, string>>({});
  const [split, setSplit] = useState<Record<string, Draft[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API}?batchKey=${encodeURIComponent(batchKey)}`, { cache: "no-store" });
    const res = await readJson<Payload>(r);
    if (!res.ok || !res.data) {
      setNote({ text: res.error ?? `Could not load the silos (${res.status})`, ok: false });
      return;
    }
    setData(res.data);
    setSizes(Object.fromEntries(res.data.silos.map((s) => [s.silo, s.size])));
    setTypes(Object.fromEntries(res.data.silos.map((s) => [s.silo, s.gritType])));
    setSplit(Object.fromEntries(res.data.silos.map((s) => [s.silo, draftsOf(s)])));
  }, [batchKey]);

  useEffect(() => { void load(); }, [load]);

  const setLines = (silo: string, next: Draft[]) => setSplit((p) => ({ ...p, [silo]: next }));

  const save = async (row: SiloRow) => {
    setBusy(row.silo);
    setNote(null);
    // try/finally, because readJson never throws but FETCH DOES - a dropped
    // connection, an offline tablet, a navigation mid-request. Without this the
    // button reads "Saving..." for ever and the only way out is a reload, on a
    // screen whose whole job is to be trusted with money.
    try {
      const lines = (split[row.silo] ?? [])
        .filter((l) => l.supplier.trim() !== "" || l.kg.trim() !== "" || l.rate.trim() !== "");
      const r = await fetch(API, {
        method: "PUT",                       // the route has no POST — see its exports
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchKey,
          silos: [{
            silo: row.silo,
            size: sizes[row.silo] ?? "",
            gritType: types[row.silo] ?? "",
            suppliers: lines.map((l) => ({
              supplier: l.supplier,
              kg: l.kg,
              // "" travels as "" and the route turns it into null. Sending 0
              // would price the grit at nothing.
              ratePerT: l.rate.trim() === "" ? "" : l.rate,
            })),
          }],
        }),
      });
      const res = await readJson<{ ok?: boolean }>(r);
      if (!res.ok) { setNote({ text: res.error ?? `Save failed (${res.status})`, ok: false }); return; }
      setNote({ text: `Silo ${row.silo} saved.`, ok: true });
      setOpen(null);
      await load();
      onSaved?.();
    } catch (e) {
      setNote({
        text: e instanceof Error && e.message
          ? `Could not reach the server: ${e.message}`
          : "Could not reach the server. Nothing was saved.",
        ok: false,
      });
    } finally {
      setBusy("");
    }
  };

  if (!data) {
    return (
      <p className="rounded-xl border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
        {note && !note.ok ? note.text : "Reading the silos the mixer drew from…"}
      </p>
    );
  }

  if (!data.silos.length) {
    return (
      <p className="rounded-xl border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
        The mixer recorded no grit for {data.batch}.
      </p>
    );
  }

  /** The sentence under a silo, when what was typed and what the bags say differ.
   *  Reported, never enforced — the typed value is what the batch is costed at. */
  const sizeNote = (row: SiloRow): string | null => {
    const f = row.sizeFlag;
    if (!f || f.verdict === "match" || f.verdict === "no-entry") return null;
    if (f.verdict === "no-silo-value") return "The bags in this silo record no size.";
    if (f.verdict === "match-of-conflict") {
      return `The bags record ${f.recorded.join(", ")}. You picked ${f.entered} — that is what this batch is costed at.`;
    }
    return `The bags in this silo record ${f.recorded.join(", ")}. You assigned ${f.entered} — that is what this batch is costed at.`;
  };

  return (
    <>
      <datalist id={SIZE_LIST}>
        {data.sizeOptions.map((s) => <option key={s} value={s} />)}
      </datalist>
      <datalist id={TYPE_LIST}>
        {data.typeOptions.map((t) => <option key={t} value={t} />)}
      </datalist>

      {note && (
        <div className={`rounded-xl border px-3 py-2 text-xs ${
          note.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
        }`}>
          {note.text}
        </div>
      )}

      {data.silos.map((row) => {
        const drafts = split[row.silo] ?? [];
        const isOpen = open === row.silo;
        const size = sizes[row.silo] ?? "";
        const type = types[row.silo] ?? "";
        const assigned = row.size !== "" || row.suppliers.length > 0;

        const allocated = drafts.reduce((a, l) => {
          const v = Number(l.kg);
          return Number.isFinite(v) && v > 0 ? a + v : a;
        }, 0);
        const left = Math.round((row.kg - allocated) * 1000) / 1000;
        const balanced = Math.abs(left) <= 0.005;
        const unpriced = drafts.some((l) => l.supplier.trim() !== "" && l.rate.trim() === "");
        const note2 = sizeNote(row);

        return (
          <div key={row.silo}
            className={`rounded-xl border p-3 ${assigned ? "border-brand/30 bg-brand/5" : "border-gray-200"}`}>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setOpen(isOpen ? null : row.silo)}
                className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-medium text-gray-900">
                  {/* The no-silo bucket is a row like any other - it takes a
                      size, a type, a supplier and a price - but calling it
                      "Silo (no silo)" would read as a bug. */}
                  {row.silo === NO_SILO ? "Grit with no silo recorded" : `Silo ${row.silo}`}
                  <span className="ml-2 text-xs font-normal text-gray-400">per t</span>
                </span>
                {/* SIZE, TYPE, SUPPLIER, WEIGHT AND PRICE ON THE FACE OF THE ROW.
                    All five were asked for as columns, and a value that only
                    exists behind an Edit click is a value nobody reads - seeing
                    the batch grit without opening anything is the whole point of
                    merging the two screens. */}
                <span className="block text-xs text-gray-500">
                  {assigned
                    ? [size || "no size yet", type || "no type yet"].join(" · ")
                    : `mixer drew ${num.format(row.kg)} kg — not assigned yet`}
                </span>
                {assigned && (
                  <span className="mt-0.5 block text-xs text-gray-500">
                    {row.suppliers.length
                      ? row.suppliers.map((sp) =>
                          `${sp.supplier || "no supplier"} — ${num.format(sp.kg)} kg @ `
                          // NULL is not zero and must never print as one.
                          + (sp.ratePerT == null ? "not priced" : `₹${num.format(sp.ratePerT)}/t`),
                        ).join("   ·   ")
                      : `${num.format(row.kg)} kg drawn — no supplier yet`}
                  </span>
                )}
              </button>

              {assigned && !balanced && (
                <span className="text-xs text-amber-700">
                  {left > 0 ? `${num.format(left)} kg unassigned` : `${num.format(-left)} kg over`}
                </span>
              )}
              {assigned && balanced && unpriced && (
                <span className="text-xs text-amber-700">not priced</span>
              )}

              <button type="button" onClick={() => setOpen(isOpen ? null : row.silo)} className={btnGhost}>
                {isOpen ? "Done" : assigned ? "Edit" : "Assign"}
              </button>
            </div>

            {isOpen && (
              <div className="mt-3 border-t border-gray-200 pt-3">
                <div className="mb-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-600">Size</span>
                    <input list={SIZE_LIST} className={inp} value={size} placeholder="0.1-0.4"
                      onChange={(e) => setSizes((p) => ({ ...p, [row.silo]: e.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-600">Type</span>
                    <input list={TYPE_LIST} className={inp} value={type} placeholder="Premium Supreme G2"
                      onChange={(e) => setTypes((p) => ({ ...p, [row.silo]: e.target.value }))} />
                  </label>
                </div>

                {note2 && (
                  <p className="mb-3 text-xs text-amber-700">▪ {note2}</p>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                        <th className="pb-1 pr-3 font-medium">Supplier</th>
                        <th className="pb-1 pr-3 font-medium">How much (kg)</th>
                        <th className="pb-1 pr-3 font-medium">₹ per t</th>
                        <th className="pb-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.map((l, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="py-1.5 pr-3">
                            <input className={inp} value={l.supplier} placeholder="who supplied it"
                              onChange={(e) => setLines(row.silo,
                                drafts.map((x, j) => j === i ? { ...x, supplier: e.target.value } : x))} />
                          </td>
                          <td className="py-1.5 pr-3">
                            <input type="number" step="0.001" min="0" inputMode="decimal"
                              className={inp} value={l.kg} placeholder="kg"
                              onChange={(e) => setLines(row.silo,
                                drafts.map((x, j) => j === i ? { ...x, kg: e.target.value } : x))} />
                          </td>
                          <td className="py-1.5 pr-3">
                            {/* Blank is a real answer: it means nobody has priced
                                this line yet. It must never be typed as 0. */}
                            <input type="number" step="0.01" min="0" inputMode="decimal"
                              className={inp} value={l.rate} placeholder="not priced yet"
                              onChange={(e) => setLines(row.silo,
                                drafts.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))} />
                          </td>
                          <td className="py-1.5 text-right">
                            {drafts.length > 1 && (
                              <button type="button" className="text-xs text-gray-400 hover:text-red-600"
                                onClick={() => setLines(row.silo, drafts.filter((_, j) => j !== i))}>
                                remove
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" className={btnGhost}
                    onClick={() => setLines(row.silo, [...drafts, { supplier: "", kg: "", rate: "" }])}>
                    Split across another supplier
                  </button>
                  {left > 0.005 && (
                    <button type="button" className={btnGhost}
                      onClick={() => setLines(row.silo, [...drafts, { supplier: "", kg: String(left), rate: "" }])}>
                      Assign the remaining {num.format(left)} kg
                    </button>
                  )}
                  <span className="text-xs text-gray-400">
                    {num.format(allocated)} of {num.format(row.kg)} kg assigned
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" className={btn} disabled={busy === row.silo}
                    onClick={() => void save(row)}>
                    {busy === row.silo ? "Saving…" : `Save silo ${row.silo}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {data.unresolvedKg > 0 && (
        <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-800">
          {num.format(data.unresolvedKg)} kg of grit could not be traced to a silo. It is in the
          batch&rsquo;s weight but on none of the rows above, so nothing here prices it.
        </p>
      )}
    </>
  );
}
