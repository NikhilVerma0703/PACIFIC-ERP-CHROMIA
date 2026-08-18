"use client";

// The costing dashboard: pick a batch, read its sheet.
//
// Layout follows the Simply White reference sheet top to bottom - headline,
// raw material, group share, output & allocation, conversion, basis,
// variance - because that is the order a costing is read and argued in.
// Estimates say so inline; missing rates block loudly instead of pricing at
// zero; and the variance panel is a first-class section, not a footnote,
// because catching 2.81 t booked to the wrong grit size is the reason this
// screen exists.

import { useCallback, useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { BatchRatesPanel } from "@/components/office/BatchRatesPanel";

const API = "/api/office/costing";

interface BatchEntry {
  batchKey: string; batch: string; design: string; slabs: number; cycles: number;
  firstPress: string | null; lastPress: string | null;
}
interface PricedLine {
  group: string; item: string; basis: string; qty: number; unit: string;
  rate: number; amount: number; estimated?: boolean;
}
interface Report {
  batchKey: string; batch: string; design: string;
  window: { firstPress: string | null; lastPress: string | null };
  rateDate: string;
  sheet: null | {
    material: {
      resinAndChemicals: PricedLine[]; gritAndFiller: PricedLine[];
      resinAndChemicalsTotal: number; gritAndFillerTotal: number;
      gritAndFillerTonnes: number; total: number;
      shares: Array<{ label: string; amount: number; pct: number }>;
    };
    output: {
      slabs3cm: number; slabs2cm: number; totalSlabs: number; equivalent3cm: number;
      materialPerEquivalent: number; materialPer2cm: number;
      allocatedTo3cm: number; allocatedTo2cm: number; allocationGap: number;
    };
    conversion: {
      heads: Array<{ head: string; basis: string; perSlab: number }>;
      perSlab: number; runHours: number; runDays: number;
    };
    final: {
      perSlab3cm: number; perSlab2cm: number; perSqft3cm: number; perSqft2cm: number;
      perSqftUsd3cm: number; perSqftUsd2cm: number;
      materialTotal: number; conversionTotal: number; batchTotal: number;
    };
  };
  unpriced: Array<{ item: string; qty: number | null; unit: string; needs: string }>;
  blockedBy: string[];
  /** Materials consumed here with no price entered on this batch. Non-empty
   *  withholds the sheet, same as blockedBy. */
  needsBatchRates: string[];
  variance: {
    lines: Array<{ item: string; primaryQty: number; checkQty: number; unit: string; delta: number; costEffect: number }>;
    totalAbsEffect: number; netDeltaTonnes: number;
  };
  basis: {
    assumptions: string[];
    effectiveFrom: Record<string, string>;
    /** Rates set on this batch rather than taken from the card. */
    batchRates?: string[];
    rowsInForce?: number;
    earliestRevision?: string | null;
    daysPerMonth?: number;
  };
  stats: {
    resinCycles: number; mixerCharges: number; runHours: number; wallClockHours: number;
    stoppages: { count: number; hours: number }; pressSlabs: number;
  };
  /** The "View batch data & edit history" drawer payload — see report.ts. */
  detail: {
    consumption: {
      resinKg: number;
      resinByTank: Array<{ tank: string; cycles: number; kg: number }>;
      gritCharges: Array<{ silo: string; band: string; label: string; kg: number }>;
      gritUnresolvedKg: number;
      fillerKg: number;
      slabs3cm: number;
      slabs2cm: number;
    };
    batchLines: Array<{
      item: string; label: string; seq: number; qty: number | null; unit: string;
      rate: number; description: string; savedBy: string; savedAt: string;
    }>;
    marks: Record<"WEIGHTS" | "COSTS", Array<{ status: "verified" | "stale"; by: string; at: string }>>;
    changes: Array<{ at: string; actor: string | null; summary: string }>;
  };
}

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const inr0 = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const num = (n: number, d = 2) => n.toLocaleString("en-IN", { maximumFractionDigits: d });

const th = "py-2 pr-4 font-medium";
const thead = "border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400";
const td = "py-2 pr-4";
const row = "border-b border-gray-50 last:border-0";
const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h2>
      {children}
    </Card>
  );
}

function MaterialTable({ lines, totalLabel, total }: { lines: PricedLine[]; totalLabel: string; total: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className={thead}>
          <th className={th}>Item</th><th className={th}>Basis</th>
          <th className={`${th} text-right`}>Quantity</th>
          <th className={`${th} text-right`}>Rate</th>
          <th className={`${th} text-right`}>Amount</th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={row}>
              <td className={`${td} text-gray-900`}>
                {l.item}
                {l.estimated && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">estimate</span>}
              </td>
              <td className={`${td} text-xs text-gray-500`}>{l.basis}</td>
              <td className={`${td} text-right text-gray-900`}>{num(l.qty, l.unit === "t" ? 3 : 1)} {l.unit}</td>
              <td className={`${td} text-right text-gray-600`}>{inr(l.rate)}/{l.unit}</td>
              <td className={`${td} text-right font-medium text-gray-900`}>{inr0(l.amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-200">
            <td className={`${td} font-semibold text-gray-900`} colSpan={4}>{totalLabel}</td>
            <td className={`${td} text-right font-semibold text-gray-900`}>{inr0(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function CostingDashboard() {
  const [batches, setBatches] = useState<BatchEntry[] | null>(null);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Why the batch list could not be read. Distinct from "no batches". */
  const [listError, setListError] = useState("");
  /** The "View batch data & edit history" drawer. Closed on batch change —
   *  history from one batch shown over another's sheet is how a wrong "who
   *  changed this" gets quoted in an argument. */
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    let live = true;
    // A FAILED LOAD MUST NOT READ AS "NO BATCHES". This used to .catch() into
    // an empty array, so when listCostableBatches() threw — which it did on
    // every call, see the ::int cast in batchData.ts — the screen calmly said
    // "No batches with mixer records in this window" and the whole dashboard
    // looked like a plant that had never run. The same trap the fabrication
    // queues had: "empty" and "failed" must never draw the same.
    setListError("");
    // days=365 — the API's own cap, and today it covers every mixer_cycle row
    // there is (the table starts 2026-06). The "look back N days" control is
    // gone on the owner's instruction; it only ever bounded THIS PICKER LIST.
    // The per-batch pull (loadBatchConsumption) filters by batch_key alone, so
    // selecting a batch always fetched everything regardless of the control.
    fetch(`${API}?days=365`, { cache: "no-store" })
      .then(async (r) => {
        const res = await readJson<{ batches: BatchEntry[] }>(r);
        // The old guard caught a bad body but then said "Could not list
        // batches" for it too — so a crash and an empty list read the same.
        if (!res.ok || !res.data) throw new Error(res.error ?? `Could not list batches (HTTP ${res.status}).`);
        return res.data;
      })
      .then((d) => { if (live) setBatches(d.batches ?? []); })
      .catch((e) => {
        if (!live) return;
        setBatches([]);
        setListError(e instanceof Error ? e.message : String(e));
      });
    return () => { live = false; };
  }, []);

  const load = useCallback(async (key: string) => {
    // A reload of the SAME batch (after a rate save) keeps the drawer as the
    // user left it; picking a different batch closes it.
    if (key !== selected) setShowDetail(false);
    setSelected(key);
    setReport(null);
    setError("");
    if (!key) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}?batch=${encodeURIComponent(key)}`, { cache: "no-store" });
      // Read, THEN judge. Parsing first meant a crashed or timed-out route —
      // which answers with an empty body — surfaced as "Unexpected end of JSON
      // input" and the status was never reported.
      const res = await readJson<Report>(r);
      if (!res.ok || !res.data) throw new Error(res.error ?? `Failed (${res.status})`);
      setReport(res.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  const s = report?.sheet ?? null;

  /**
   * Whether this batch can be costed at all yet.
   *
   * A sheet with no slabs on it is not a cheap sheet, it is an undefined one:
   * every per-slab and per-sqft figure divides by zero, the allocation cannot
   * tie back, and the headline prints a confident "₹2,625 / slab" that is
   * conversion cost alone with the entire material cost missing from it. The
   * sheet's own check caught this and said "do not use this sheet" - at the
   * bottom, four sections below the numbers it was disowning.
   *
   * A batch mid-run is the normal way to arrive here: the mixer has logged its
   * consumption and the press has not finished, so there is nothing wrong to
   * fix, only something not to read yet. So the numbers are withheld rather
   * than annotated, and the panel says which figure is missing.
   */
  const notCostable = !!s && s.output.totalSlabs <= 0;

  return (
    <div className="space-y-5">
      {/* ---- batch picker ---- */}
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Batch</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select value={selected} onChange={(e) => void load(e.target.value)} className={selCls}>
            <option value="">Pick a batch…</option>
            {(batches ?? []).map((b) => (
              <option key={b.batchKey} value={b.batchKey}>
                {b.batch} · {b.design} · {b.slabs} slabs · {b.lastPress ?? "no press date"}
              </option>
            ))}
          </select>
          {batches === null && <span className="text-xs text-gray-400">Loading batches…</span>}
          {/* "Nothing ran" and "the list would not load" are different facts and
              must not share a sentence. */}
          {batches?.length === 0 && !listError && (
            <span className="text-xs text-gray-400">No batches with mixer records in the last year.</span>
          )}
          {listError && (
            <span className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
              Batch list failed to load — {listError} Nothing is missing from the plant; this screen could not read it.
            </span>
          )}
          {loading && <span className="text-xs text-gray-400">Computing…</span>}
          {report && (
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="ml-auto self-center text-center text-sm font-medium text-brand hover:underline"
            >
              {showDetail ? "Hide batch data & edit history" : "View batch data & edit history"}
            </button>
          )}
        </div>
        {report && (
          <p className="mt-2 text-xs text-gray-400">
            {report.design} · pressed {report.window.firstPress ?? "?"} to {report.window.lastPress ?? "?"} ·
            {" "}costed at the rate card in force on {report.rateDate} · computed from mixer records just now
          </p>
        )}
        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {/* ---- batch data & edit history drawer ----
            The consumption figures repeat what the sheet below prices — the
            owner said redundancy is fine to trim, so this keeps the raw
            mixer-side facts (what ran, what was weighed, slab counts) and puts
            its weight on THE CHANGES: who set which price when, who marked
            what correct, off the append-only action log. */}
        {report && showDetail && (
          <div className="mt-4 space-y-5 border-t border-gray-200 pt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Mixer cycles ran" value={num(report.stats.resinCycles, 0)} sub={`${num(report.stats.mixerCharges, 0)} mixer charges`} />
              <Kpi label="Slabs · 2 cm" value={num(report.detail.consumption.slabs2cm, 0)} />
              <Kpi label="Slabs · 3 cm" value={num(report.detail.consumption.slabs3cm, 0)} />
              <Kpi label="Run" value={`${num(report.stats.runHours, 1)} h`} sub={`${num(report.stats.stoppages.hours, 1)} h stopped · ${report.stats.pressSlabs} pressed`} />
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Consumption at the mixer</p>
              <div className="overflow-x-auto">
                <table className="w-full max-w-2xl text-sm">
                  <thead><tr className={thead}>
                    <th className={th}>Material</th><th className={th}>Where</th>
                    <th className={`${th} text-right`}>Quantity</th>
                  </tr></thead>
                  <tbody>
                    {report.detail.consumption.resinByTank.map((t) => (
                      <tr key={t.tank} className={row}>
                        <td className={td}>Resin</td>
                        <td className={`${td} text-xs text-gray-500`}>tank {t.tank} · {t.cycles} cycles</td>
                        <td className={`${td} text-right`}>{num(t.kg, 1)} kg</td>
                      </tr>
                    ))}
                    {report.detail.consumption.gritCharges.map((g, i) => (
                      <tr key={`${g.silo}-${g.band}-${i}`} className={row}>
                        <td className={td}>{g.label}</td>
                        <td className={`${td} text-xs text-gray-500`}>silo {g.silo}</td>
                        <td className={`${td} text-right`}>{num(g.kg, 1)} kg</td>
                      </tr>
                    ))}
                    <tr className={row}>
                      <td className={td}>Filler 400#</td>
                      <td className={`${td} text-xs text-gray-500`}>mixer</td>
                      <td className={`${td} text-right`}>{num(report.detail.consumption.fillerKg, 1)} kg</td>
                    </tr>
                    {report.detail.consumption.gritUnresolvedKg > 0 && (
                      <tr className={row}>
                        <td className={`${td} text-amber-700`}>Grit with no silo link</td>
                        <td className={`${td} text-xs text-gray-500`}>unresolved</td>
                        <td className={`${td} text-right text-amber-700`}>{num(report.detail.consumption.gritUnresolvedKg, 1)} kg</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Prices set on this batch — by whom, and when</p>
              {report.detail.batchLines.length === 0 ? (
                <p className="text-sm text-gray-500">None — everything prices at the card.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className={thead}>
                      <th className={th}>Material</th><th className={`${th} text-right`}>Quantity</th>
                      <th className={`${th} text-right`}>Rate</th><th className={th}>Supplier</th>
                      <th className={th}>Set by</th><th className={th}>When</th>
                    </tr></thead>
                    <tbody>
                      {report.detail.batchLines.map((l, i) => (
                        <tr key={i} className={row}>
                          <td className={`${td} text-gray-900`}>{l.label}</td>
                          <td className={`${td} text-right`}>{l.qty == null ? "the rest" : `${num(l.qty, 3)} ${l.unit}`}</td>
                          <td className={`${td} text-right`}>{inr(l.rate)}</td>
                          <td className={`${td} text-xs text-gray-500`}>{l.description || "—"}</td>
                          <td className={td}>{l.savedBy}</td>
                          <td className={`${td} text-xs text-gray-500`}>
                            {new Date(l.savedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Verification — who marked what correct</p>
              <div className="space-y-1 text-sm">
                {(["WEIGHTS", "COSTS"] as const).map((side) => {
                  const marks = report.detail.marks[side];
                  const what = side === "WEIGHTS" ? "Consumption" : "Prices";
                  return (
                    <div key={side} className="flex flex-wrap items-center gap-2">
                      <span className="w-24 text-xs font-medium text-gray-500">{what}</span>
                      {marks.length === 0 ? (
                        <Badge tone="amber">not yet marked</Badge>
                      ) : marks.map((m) => (
                        <span key={m.by} className="flex items-center gap-1.5">
                          <Badge tone={m.status === "verified" ? "green" : "amber"}>
                            {m.status === "verified" ? "correct" : "changed since"}
                          </Badge>
                          <span className="text-xs text-gray-500">
                            {m.by} · {new Date(m.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                          </span>
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Edit history — every change, newest first</p>
              {report.detail.changes.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No recorded changes yet. Price sets, clears and verification marks land here
                  from now on; rate-card revisions keep their own history on the card above.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {report.detail.changes.map((ch, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs text-gray-400">
                        {new Date(ch.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                      <span className="text-gray-700">{ch.summary}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ---- rates for this batch ---- */}
      {report && (
        <BatchRatesPanel
          key={report.batchKey}
          batchKey={report.batchKey}
          batchLabel={report.batch}
          // The unpriced flags live INLINE beside this panel's heading now
          // (owner, 2026-08-18) — the two standalone banner blocks that used to
          // sit below are gone. The guard itself is untouched: report.ts still
          // withholds the sheet while either list is non-empty.
          needsBatchRates={report.needsBatchRates}
          unpriced={report.unpriced.map((u) => u.item)}
          // Re-read the sheet rather than patching it: the report is computed
          // from mixer records and the card on every read, so recomputing is
          // the only way the totals, shares and per-sqft lines all move
          // together with a changed rate.
          onSaved={() => void load(report.batchKey)}
        />
      )}

      {report && report.blockedBy.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">
            The sheet cannot be computed. Still needed: {report.blockedBy.join(", ")}.
          </p>
          {/* "Missing" is only half a diagnosis. A card can look complete on the
              admin panel and still resolve to nothing for THIS batch, because
              the batch ran before any revision was dated. Those two need
              different fixes, so the screen says which one it is. */}
          {report.basis.rowsInForce === 0 ? (
            <p className="mt-1 text-red-700">
              No rate revision was in force on {report.rateDate}
              {report.basis.earliestRevision
                ? ` — the earliest on the card is ${report.basis.earliestRevision}, which is after this batch ran. Backdate a revision to on or before ${report.rateDate}.`
                : ", and the rate card is empty. Load or enter the rates above."}
            </p>
          ) : (
            <p className="mt-1 text-red-700">
              {report.basis.rowsInForce} revision(s) were in force on {report.rateDate}, so the rest
              of the card resolved — only what is listed above is outstanding. The variance panel
              below still shows, so the run stays inspectable meanwhile.
            </p>
          )}
        </div>
      )}

      {/* The standalone "no sheet yet" and "used but not priced" banners are
          gone (owner, 2026-08-18): both facts are flagged inline beside the
          "Materials for this batch" heading in the panel above, which is also
          where the fix happens. report.ts still withholds the sheet — this
          removed two renderings of the same warning, not the guard. */}

      {/* ---- not costable yet: say what is missing, print nothing ---- */}
      {s && notCostable && (
        <Card>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Not costed yet — {report!.batch} · {report!.design}
          </h2>
          <p className="text-sm text-gray-700">
            No slabs have been recorded against this batch, so there is nothing to divide
            the cost over. Every per-slab and per-square-foot figure would be a division by
            zero, and the material cost could not be allocated — so the sheet is withheld
            rather than printed with numbers that do not mean what they appear to.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            The costing appears on its own once the slab count arrives. Nothing needs to be
            re-entered here; the sheet is computed fresh on every load.
          </p>
          {report!.unpriced.length > 0 && (
            <p className="mt-2 text-sm text-amber-700">
              Worth fixing while you wait: {report!.unpriced.length} consumed material
              {report!.unpriced.length === 1 ? " has" : "s have"} no rate — set
              {report!.unpriced.length === 1 ? " it" : " them"} in the materials panel above.
              Those quantities stay out of the total even once slabs are recorded.
            </p>
          )}
        </Card>
      )}

      {/* ---- 1 · headline ---- */}
      {s && !notCostable && (
        <Section title={`Headline — ${report!.batch} · ${report!.design} · ${s.output.totalSlabs} slabs`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Cost / slab · 3 cm" value={inr0(s.final.perSlab3cm)} sub="material + conversion" />
            <Kpi label="Cost / slab · 2 cm" value={inr0(s.final.perSlab2cm)} />
            <Kpi label="Cost / sq ft · 3 cm" value={inr(s.final.perSqft3cm)} sub={`$${s.final.perSqftUsd3cm}`} />
            <Kpi label="Cost / sq ft · 2 cm" value={inr(s.final.perSqft2cm)} sub={`$${s.final.perSqftUsd2cm}`} />
            <Kpi label="Material" value={inr0(s.final.materialTotal)} sub={`${num(100 * s.final.materialTotal / s.final.batchTotal, 1)}% of total`} />
            <Kpi label="Total batch cost" value={inr0(s.final.batchTotal)} sub={`incl. ${inr0(s.final.conversionTotal)} conversion`} />
          </div>
        </Section>
      )}

      {/* ---- 2 · raw material ---- */}
      {s && !notCostable && (
        <Section title="Raw material — quantities are actual mixer consumption">
          <p className="mb-2 text-xs font-medium text-gray-500">Resin and chemicals</p>
          <MaterialTable lines={s.material.resinAndChemicals} totalLabel="Sub-total" total={s.material.resinAndChemicalsTotal} />
          <p className="mb-2 mt-5 text-xs font-medium text-gray-500">Grit and filler — {num(s.material.gritAndFillerTonnes, 3)} t</p>
          <MaterialTable lines={s.material.gritAndFiller} totalLabel="Sub-total" total={s.material.gritAndFillerTotal} />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <p className="mb-2 text-xs font-medium text-gray-500">Material group share</p>
              {s.material.shares.map((g) => (
                <div key={g.label} className="mb-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-700">{g.label}</span>
                    <span className="text-gray-900">{inr0(g.amount)} · {num(g.pct, 1)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(g.pct, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 text-sm">
              <p className="mb-2 text-xs font-medium text-gray-500">Total material cost</p>
              <p className="text-2xl font-semibold text-gray-900">{inr0(s.material.total)}</p>
            </div>
          </div>
        </Section>
      )}

      {/* ---- 3 · output & allocation ---- */}
      {s && !notCostable && (
        <Section title="Output and how material cost is split">
          <div className="overflow-x-auto">
            <table className="w-full max-w-2xl text-sm">
              <thead><tr className={thead}>
                <th className={th}>Step</th><th className={`${th} text-right`}>Slabs</th>
                <th className={`${th} text-right`}>3 cm equivalent</th>
              </tr></thead>
              <tbody>
                <tr className={row}><td className={td}>3 cm slabs</td><td className={`${td} text-right`}>{s.output.slabs3cm}</td><td className={`${td} text-right`}>{num(s.output.slabs3cm)}</td></tr>
                <tr className={row}><td className={td}>2 cm slabs (× 2⁄3)</td><td className={`${td} text-right`}>{s.output.slabs2cm}</td><td className={`${td} text-right`}>{num(s.output.slabs2cm * 2 / 3)}</td></tr>
                <tr className="border-t border-gray-200 font-medium"><td className={td}>Total</td><td className={`${td} text-right`}>{s.output.totalSlabs}</td><td className={`${td} text-right`}>{num(s.output.equivalent3cm)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Material / 3 cm equivalent" value={inr(s.output.materialPerEquivalent)} />
            <Kpi label="Material / 2 cm slab" value={inr(s.output.materialPer2cm)} sub="× 2⁄3" />
            <Kpi label="Allocated to 3 cm" value={inr0(s.output.allocatedTo3cm)} sub={`× ${s.output.slabs3cm} slabs`} />
            <Kpi label="Allocated to 2 cm" value={inr0(s.output.allocatedTo2cm)} sub={`× ${s.output.slabs2cm} slabs`} />
          </div>
          <p className={`mt-3 text-sm ${Math.abs(s.output.allocationGap) < 1 ? "text-green-700" : "text-red-700 font-medium"}`}>
            Check — allocation ties back to total material cost
            {Math.abs(s.output.allocationGap) < 1
              ? ` ✓ (gap ${inr(s.output.allocationGap)})`
              : ` ✗ GAP ${inr(s.output.allocationGap)} — the arithmetic is wrong, do not use this sheet`}
          </p>
        </Section>
      )}

      {/* ---- 4 · conversion ---- */}
      {s && !notCostable && (
        <Section title="Conversion cost per slab — identical for both thicknesses">
          <div className="overflow-x-auto">
            <table className="w-full max-w-3xl text-sm">
              <thead><tr className={thead}>
                <th className={th}>Cost head</th><th className={th}>Basis</th>
                <th className={`${th} text-right`}>Per slab</th>
              </tr></thead>
              <tbody>
                {s.conversion.heads.map((h) => (
                  <tr key={h.head} className={row}>
                    <td className={`${td} text-gray-900`}>{h.head}</td>
                    <td className={`${td} text-xs text-gray-500`}>{h.basis}</td>
                    <td className={`${td} text-right font-medium`}>{inr(h.perSlab)}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 font-semibold">
                  <td className={td} colSpan={2}>Total conversion</td>
                  <td className={`${td} text-right`}>{inr(s.conversion.perSlab)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Absorbed over {num(s.conversion.runHours, 1)} h of run ({num(s.conversion.runDays, 2)} days),
            measured mixer first-mix-to-last — not assumed.
          </p>
        </Section>
      )}

      {/* ---- 5 · variance ---- */}
      {report && (
        <Section title="Variance — two records of the same thing, disagreeing">
          {report.variance.lines.length === 0 ? (
            <p className="text-sm text-green-700">
              Every cross-check agrees: per-charge grit attribution matches whole-silo,
              and the slab counts line up across distributor, JOT and press.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className={thead}>
                    <th className={th}>Disagreement</th>
                    <th className={`${th} text-right`}>Primary</th>
                    <th className={`${th} text-right`}>Check</th>
                    <th className={`${th} text-right`}>Delta</th>
                    <th className={`${th} text-right`}>Worth</th>
                  </tr></thead>
                  <tbody>
                    {report.variance.lines.map((v, i) => (
                      <tr key={i} className={row}>
                        <td className={`${td} text-gray-900`}>{v.item}</td>
                        <td className={`${td} text-right`}>{num(v.primaryQty, 3)} {v.unit}</td>
                        <td className={`${td} text-right`}>{num(v.checkQty, 3)} {v.unit}</td>
                        <td className={`${td} text-right font-medium ${v.delta > 0 ? "text-amber-700" : "text-red-700"}`}>{v.delta > 0 ? "+" : ""}{num(v.delta, 3)}</td>
                        <td className={`${td} text-right`}>{v.costEffect ? inr0(Math.abs(v.costEffect)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {Math.abs(report.variance.netDeltaTonnes) < 0.05
                  ? "Net tonnage delta ≈ 0: quantity moved BETWEEN lines rather than went missing — the signature of silos swapping grit slots mid-run. The totals are safe; the per-size split is what to correct before a rate negotiation."
                  : `Net tonnage delta ${num(report.variance.netDeltaTonnes, 2)} t — quantity did not just move between lines; worth tracing before trusting the split.`}
              </p>
            </>
          )}
        </Section>
      )}

      {/* The "Basis — every assumption, printed" section is REMOVED on the
          owner's instruction (2026-08-18). The data behind it still ships in
          the payload untouched: basis.rowsInForce / earliestRevision drive the
          blockedBy banner above, and stats feeds the batch-data drawer on the
          picker card. Removing the rendering removed nothing other screens or
          the computation rely on. */}
    </div>
  );
}
