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

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { BatchRatesPanel } from "@/components/office/BatchRatesPanel";
import { SignoffCard, type SignState } from "@/components/office/SignoffCard";
import { RateCardEditor } from "@/components/office/RateCardEditor";
import { CostingSheet } from "@/components/office/CostingSheet";

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
    usd: {
      rate: number; perSlab3cm: number; perSlab2cm: number;
      resinAndChemicalsTotal: number; gritAndFillerTotal: number; materialTotal: number;
      conversionPerSlab: number; conversionTotal: number; batchTotal: number;
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

export function CostingDashboard() {
  const [batches, setBatches] = useState<BatchEntry[] | null>(null);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  // The single collapsible below the picker. Closed at first load, always;
  // opened by the person, or by a sheet that cannot be computed (see effect).
  const [inputsOpen, setInputsOpen] = useState(false);
  const [signoffVersion, setSignoffVersion] = useState(0);
  const [signState, setSignState] = useState<SignState | null>(null);
  const [error, setError] = useState("");
  /** Why the batch list could not be read. Distinct from "no batches". */
  const [listError, setListError] = useState("");
  /** The "View batch data & edit history" drawer. Closed on batch change —
   *  history from one batch shown over another's sheet is how a wrong "who
   *  changed this" gets quoted in an argument. */
  /** Sign-off, from THIS page. The marks were already displayed here and the
   *  buttons lived on /office/batch-verify - two admin pages sharing one
   *  batch picker and the same panels, which is the duplication the owner
   *  pointed at. Admin signs since 2026-08-21, so the buttons belong beside
   *  the marks. The named verifiers keep their own page: it never shows a
   *  computed sheet, and this one is ADMIN-only.
   *  The API is still the control - an unfinished batch answers 409 with the
   *  list of what is missing, and that answer is shown, not paraphrased. */

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

  const loadSeq = useRef(0);
  const load = useCallback(async (key: string) => {
    // A reload of the SAME batch (after a rate save) keeps the drawer as the
    // user left it; picking a different batch closes it.
    // The collapsible closes on a batch switch precisely so one batch's facts
    // are never read over another's.
    if (key !== selected) { setInputsOpen(false); setSignState(null); }
    setSelected(key);
    // Only a batch SWITCH blanks the sheet. A same-batch re-read (after a save
    // or a mark) keeps the current sheet and the sign-off card on screen while
    // the fresh one loads — unmounting them threw away the card's own note and
    // re-read the sign-off from scratch on every mark.
    if (key !== selected || !key) setReport(null);
    setError("");
    // Sequence number: only the LATEST request may set the sheet. Two batches
    // picked quickly, with the first answer arriving last, left the select on
    // one batch and the summary line and sheet on the other (reproduced).
    const seq = ++loadSeq.current;
    // (a pick cleared while a load is in flight: that load's finally is now
    // ignored, so the spinner is cleared here)
    if (!key) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API}?batch=${encodeURIComponent(key)}`, { cache: "no-store" });
      // Read, THEN judge. Parsing first meant a crashed or timed-out route —
      // which answers with an empty body — surfaced as "Unexpected end of JSON
      // input" and the status was never reported.
      const res = await readJson<Report>(r);
      if (seq !== loadSeq.current) return;
      if (!res.ok || !res.data) throw new Error(res.error ?? `Failed (${res.status})`);
      setReport(res.data);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError((e as Error).message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
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

  const pricedCount = report ? new Set(report.detail.batchLines.map((l) => l.item)).size : 0;
  const signChip = (side: "WEIGHTS" | "COSTS") => {
    const marks = signState?.verification?.[side];
    if (!marks) return <span className="text-gray-400">…</span>;
    if (marks.length === 0) return <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">not marked</span>;
    if (marks.some((m) => m.status === "stale")) return <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">changed since</span>;
    return <span className="rounded bg-green-50 px-1.5 py-0.5 font-medium text-green-700">correct · {marks.length}</span>;
  };
  // A sheet that cannot be computed has its fix inside the collapsible, and no
  // document to stand in front of — so it opens itself. Only then.
  const cannotCompute = !!report && (report.blockedBy.length > 0 || notCostable);
  useEffect(() => { if (cannotCompute) setInputsOpen(true); }, [cannotCompute, report?.batchKey]);

  return (
    <div className="space-y-4">
      {/* ---- ONE line: which batch, and its facts. The page title lives here
          too — a heading block of its own was a section for a sentence. ---- */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">Batch costing</h1>
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
          <span className="text-xs text-gray-400">
            {report.design} · pressed {report.window.firstPress ?? "?"} to {report.window.lastPress ?? "?"} · rates as on {report.rateDate}
          </span>
        )}
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">{error}</div>}

      {/* ---- Inputs & sign-off: ONE collapsible, closed at first load.
          Everything that is not the document lives in here — the sign-off
          card, the materials panel, the batch data and edit history, the
          plant-wide rates — so the page opens on the picker, one summary
          line, and the sheet. It opens itself only when the sheet cannot be
          computed, because then the fix is in here and there is no document
          to be centre stage. The sign-off card stays MOUNTED while closed
          (hidden, not unrendered) so the summary line can show the two marks
          without a second fetch; the heavier panels mount only when opened. ---- */}
      {report && (
        <div className="rounded-xl border border-gray-200 bg-white/70 print:hidden">
          <button type="button" onClick={() => setInputsOpen((v) => !v)} aria-expanded={inputsOpen}
            className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              <svg className={"h-3 w-3 transition-transform " + (inputsOpen ? "" : "-rotate-90")} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              Inputs &amp; sign-off
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>{pricedCount} material{pricedCount === 1 ? "" : "s"} priced on this batch</span>
              <span>·</span>
              <span>Consumption {signChip("WEIGHTS")}</span>
              <span>Prices {signChip("COSTS")}</span>
            </span>
            <span className="ml-auto text-xs font-medium text-brand">{inputsOpen ? "Close" : "Open"}</span>
          </button>
          <div className={inputsOpen ? "space-y-5 border-t border-gray-200 p-4" : "hidden"}>
            <SignoffCard batchKey={report.batchKey} version={signoffVersion}
              onChanged={() => void load(report.batchKey)} onState={setSignState} />
            {inputsOpen && (
              <>
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
          onSaved={() => { setSignoffVersion((v) => v + 1); void load(report.batchKey); }}
        />
                <Card>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Batch data &amp; edit history</h2>
                  <p className="mb-3 mt-0.5 text-xs text-gray-400">What ran and what was weighed; who set which price when; every change, newest first.</p>
                  <div className="space-y-5">
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
                        <td className={`${td} text-amber-700`}>Grit with no size band on its bags</td>
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
                </Card>
                <RateCardEditor />
              </>
            )}
          </div>
        </div>
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

      {/* ---- the sheet, as a document ----
          Headline, raw material, output, conversion and variance used to be
          five cards here. They are now one A4 document in the CEO report's
          design (CostingSheet), with its own Print / Save as PDF — everything
          above it is print:hidden, so the printout is the document alone. */}
      {s && !notCostable && <CostingSheet report={{ ...report!, sheet: s }} />}

      {/* The "Basis — every assumption, printed" section is REMOVED on the
          owner's instruction (2026-08-18). The data behind it still ships in
          the payload untouched: basis.rowsInForce / earliestRevision drive the
          blockedBy banner above, and stats feeds the batch-data drawer on the
          picker card. Removing the rendering removed nothing other screens or
          the computation rely on. */}
    </div>
  );
}
