"use client";

// The batch costing as a DOCUMENT — one A4 sheet, the same design as the CEO
// daily report, and printable straight from the button above it.
//
// It imports the CEO report's own stylesheet rather than a copy: "make it like
// the CEO report" is a promise that holds only while there is one design to be
// like. Masthead, figures band, numbered sections, ruled tables and the foot
// are those rules; nothing here is restyled with utilities.
//
// The sheet paginates naturally in print — a batch with forty grit rows is
// longer than one with six — so tables carry `keep` (break-inside: avoid) and
// the @page rule the stylesheet already declares does the rest. Everything
// else on the costing page (picker, sign-off, materials panel, rate card, the
// app shell) is print:hidden, so what comes out of "Print / Save as PDF" is
// this document alone.
//
// NUMBERS ARE THE SHEET'S, UNTOUCHED. This component formats; it does not
// compute. Every figure is read from the report the costing API returned, so
// the document cannot disagree with the screen it was printed from.

import type { ReactNode } from "react";
import s from "@/app/report/ceo/report.module.css";

interface PricedLine {
  group: string; item: string; basis: string; qty: number; unit: string;
  rate: number; amount: number; estimated?: boolean;
}
export interface CostingSheetReport {
  batch: string; design: string;
  window: { firstPress: string | null; lastPress: string | null };
  rateDate: string;
  sheet: {
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
    conversion: { heads: Array<{ head: string; basis: string; perSlab: number }>; perSlab: number; runHours: number; runDays: number };
    final: {
      perSlab3cm: number; perSlab2cm: number; perSqft3cm: number; perSqft2cm: number;
      perSqftUsd3cm: number; perSqftUsd2cm: number;
      materialTotal: number; conversionTotal: number; batchTotal: number;
    };
  };
  variance: {
    lines: Array<{ item: string; primaryQty: number; checkQty: number; unit: string; delta: number; costEffect: number }>;
    netDeltaTonnes: number;
  };
  stats: { pressSlabs: number; runHours: number };
}

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const inr0 = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const num = (n: number, d = 2) => n.toLocaleString("en-IN", { maximumFractionDigits: d });
const DASH = "—";

/** "17–19 Aug 2026" from the two press dates, or whichever half exists. */
function pressedSpan(first: string | null, last: string | null): string {
  const f = first ? new Date(first) : null, l = last ? new Date(last) : null;
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  if (f && l) {
    const sameDay = f.toDateString() === l.toDateString();
    if (sameDay) return fmt(f);
    const sameMonth = f.getMonth() === l.getMonth() && f.getFullYear() === l.getFullYear();
    return sameMonth ? `${f.getDate()}–${fmt(l)}` : `${fmt(f)} – ${fmt(l)}`;
  }
  return f ? fmt(f) : l ? fmt(l) : "press dates not recorded";
}

function Section({ n, name, note }: { n: number; name: string; note?: string }) {
  return (
    <div className={s.section}>
      <span className={s.sectionName}>{n}. {name}</span>
      {note && <span className={s.sectionNote}>{note}</span>}
    </div>
  );
}

function MaterialTable({ lines, total }: { lines: PricedLine[]; total: number }) {
  return (
    <table className={`${s.t} ${s.keep}`}>
      <thead><tr>
        <th>Item</th><th>Basis</th>
        <th className={s.num}>Quantity</th><th className={s.num}>Rate</th><th className={s.num}>Amount</th>
      </tr></thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td className={s.key}>{l.item}{l.estimated ? " (estimate)" : ""}</td>
            <td className={s.muted}>{l.basis}</td>
            <td className={s.num}>{num(l.qty, l.unit === "t" ? 3 : 1)} {l.unit}</td>
            <td className={s.num}>{inr(l.rate)}/{l.unit}</td>
            <td className={s.num}>{inr0(l.amount)}</td>
          </tr>
        ))}
        <tr className={s.total}><td colSpan={4}>Sub-total</td><td className={s.num}>{inr0(total)}</td></tr>
      </tbody>
    </table>
  );
}

export function CostingSheet({ report }: { report: CostingSheetReport }) {
  const sh = report.sheet;
  const matPct = sh.final.batchTotal > 0 ? (100 * sh.final.materialTotal) / sh.final.batchTotal : 0;
  const excluded = report.stats.pressSlabs - sh.output.totalSlabs;
  const allocOk = Math.abs(sh.output.allocationGap) < 1;

  const print = () => {
    // The browser names the PDF after the page title; for the few seconds of
    // the print dialog the title is the document's own name.
    const prev = document.title;
    document.title = `Costing ${report.batch} ${report.design}`.replace(/\s+/g, " ").trim();
    const restore = () => { document.title = prev; window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
    window.print();
  };

  const kpi = (value: ReactNode, label: string) => (
    <div className={s.kpi}><div className={s.kpiValue}>{value}</div><div className={s.kpiLabel}>{label}</div></div>
  );

  return (
    <div className={s.doc}>
      <div className={s.bar}>
        <span className="text-xs text-gray-500">The costing as a document — A4, the same design as the CEO report.</span>
        <button type="button" onClick={print}
          className="ml-auto rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Print / Save as PDF
        </button>
      </div>

      <div className={s.scroller}>
        <div className={s.sheet}>
          <div className={s.mast}>
            <div>
              <div className={s.wordmark}>PACIFIC SURFACES</div>
              <div className={s.submark}>QUARTZ SURFACES &nbsp;·&nbsp; PRODUCTION PLANT</div>
            </div>
            <div>
              <div className={s.docTitle}>Batch Costing</div>
              <div className={s.docDate}>
                Batch {report.batch} · {report.design} · pressed {pressedSpan(report.window.firstPress, report.window.lastPress)}
              </div>
              <div className={s.docDate}>Rates as in force on {report.rateDate}</div>
            </div>
          </div>
          <hr className={s.mastRule} />

          <div className={s.kpis}>
            {kpi(inr0(sh.final.perSlab3cm), "Cost / slab · 3 cm")}
            {kpi(inr0(sh.final.perSlab2cm), "Cost / slab · 2 cm")}
            {kpi(inr(sh.final.perSqft3cm), `Cost / sq ft · 3 cm · $${sh.final.perSqftUsd3cm}`)}
            {kpi(inr(sh.final.perSqft2cm), `Cost / sq ft · 2 cm · $${sh.final.perSqftUsd2cm}`)}
            {kpi(inr0(sh.final.materialTotal), `Material · ${num(matPct, 1)}% of total`)}
            {kpi(inr0(sh.final.batchTotal), "Total batch cost")}
          </div>

          <p className={s.prose}>
            Batch {report.batch} made <strong>{sh.output.totalSlabs} slabs</strong> — {sh.output.slabs3cm} of 3 cm and {sh.output.slabs2cm} of 2 cm —
            over {num(sh.conversion.runHours, 1)} hours of run. Material came to <strong>{inr0(sh.final.materialTotal)}</strong> ({num(matPct, 1)} per cent
            of the total) and conversion to <strong>{inr0(sh.final.conversionTotal)}</strong>, a batch cost of <strong>{inr0(sh.final.batchTotal)}</strong>:
            {" "}{inr0(sh.final.perSlab3cm)} per 3 cm slab and {inr0(sh.final.perSlab2cm)} per 2 cm slab. Quantities are what the mixer weighed;
            dosed chemicals are dose × resin; prices are the batch&rsquo;s own where set and the rate card elsewhere.
          </p>

          {/* 1 · raw material */}
          <Section n={1} name="Raw material" note="Quantities as the mixer weighed them; dosed chemicals as dose × resin" />
          <div className={s.subLabel}>Resin and chemicals</div>
          <MaterialTable lines={sh.material.resinAndChemicals} total={sh.material.resinAndChemicalsTotal} />
          <div className={s.subLabel} style={{ marginTop: 6 }}>Grit and filler — {num(sh.material.gritAndFillerTonnes, 3)} t</div>
          <MaterialTable lines={sh.material.gritAndFiller} total={sh.material.gritAndFillerTotal} />
          <div className={s.pair} style={{ marginTop: 6 }}>
            <div>
              <div className={s.subLabel}>Share of material cost</div>
              <table className={`${s.t} ${s.keep}`}>
                <thead><tr><th>Group</th><th className={s.num}>Amount</th><th className={s.num}>Share</th></tr></thead>
                <tbody>
                  {sh.material.shares.map((g) => (
                    <tr key={g.label}><td className={s.key}>{g.label}</td><td className={s.num}>{inr0(g.amount)}</td><td className={s.num}>{num(g.pct, 1)}%</td></tr>
                  ))}
                  <tr className={s.total}><td>Total material</td><td className={s.num}>{inr0(sh.material.total)}</td><td className={s.num}>100%</td></tr>
                </tbody>
              </table>
            </div>
            <div />
          </div>

          {/* 2 · output and allocation */}
          <Section n={2} name="Output and allocation" note="How the material cost is split across thicknesses" />
          <div className={s.pair}>
            <div>
              <table className={`${s.t} ${s.keep}`}>
                <thead><tr><th>Step</th><th className={s.num}>Slabs</th><th className={s.num}>3 cm equivalent</th></tr></thead>
                <tbody>
                  <tr><td className={s.key}>3 cm slabs</td><td className={s.num}>{sh.output.slabs3cm}</td><td className={s.num}>{num(sh.output.slabs3cm)}</td></tr>
                  <tr><td className={s.key}>2 cm slabs (× 2⁄3)</td><td className={s.num}>{sh.output.slabs2cm}</td><td className={s.num}>{num(sh.output.slabs2cm * 2 / 3)}</td></tr>
                  <tr className={s.total}><td>Total</td><td className={s.num}>{sh.output.totalSlabs}</td><td className={s.num}>{num(sh.output.equivalent3cm)}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <table className={`${s.t} ${s.keep}`}>
                <thead><tr><th>Allocation</th><th className={s.num}>₹</th></tr></thead>
                <tbody>
                  <tr><td className={s.key}>Material per 3 cm equivalent</td><td className={s.num}>{inr(sh.output.materialPerEquivalent)}</td></tr>
                  <tr><td className={s.key}>Material per 2 cm slab (× 2⁄3)</td><td className={s.num}>{inr(sh.output.materialPer2cm)}</td></tr>
                  <tr><td className={s.key}>Allocated to 3 cm · {sh.output.slabs3cm} slabs</td><td className={s.num}>{inr0(sh.output.allocatedTo3cm)}</td></tr>
                  <tr><td className={s.key}>Allocated to 2 cm · {sh.output.slabs2cm} slabs</td><td className={s.num}>{inr0(sh.output.allocatedTo2cm)}</td></tr>
                  <tr className={s.total}><td>{allocOk ? "Ties back to total material cost" : "DOES NOT tie back — do not use this sheet"}</td>
                    <td className={s.num}>{allocOk ? `✓ gap ${inr(sh.output.allocationGap)}` : `✗ gap ${inr(sh.output.allocationGap)}`}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          {excluded > 0 && (
            <p className={s.note}>
              The press recorded {report.stats.pressSlabs} slabs; {excluded} of them have no thickness recorded at any station (or are 1.2 cm)
              and are not in this count — the cost is divided over the {sh.output.totalSlabs} that do.
            </p>
          )}

          {/* 3 · conversion */}
          <Section n={3} name="Conversion cost per slab" note="Identical for both thicknesses" />
          <table className={`${s.t} ${s.keep}`}>
            <thead><tr><th>Cost head</th><th>Basis</th><th className={s.num}>Per slab</th></tr></thead>
            <tbody>
              {sh.conversion.heads.map((h) => (
                <tr key={h.head}><td className={s.key}>{h.head}</td><td className={s.muted}>{h.basis}</td><td className={s.num}>{inr(h.perSlab)}</td></tr>
              ))}
              <tr className={s.total}><td colSpan={2}>Total conversion</td><td className={s.num}>{inr(sh.conversion.perSlab)}</td></tr>
            </tbody>
          </table>
          <p className={s.note}>
            Absorbed over {num(sh.conversion.runHours, 1)} h of run ({num(sh.conversion.runDays, 2)} days), measured mixer first-mix-to-last — not assumed.
          </p>

          {/* 4 · variance */}
          <Section n={4} name="Variance" note="Two records of the same quantity, disagreeing" />
          {report.variance.lines.length === 0 ? (
            <p className={s.prose}>
              Every cross-check agrees: per-charge grit attribution matches whole-silo, and the slab counts line up across the press count,
              JOT and every pressed slab.
            </p>
          ) : (
            <>
              <table className={`${s.t} ${s.keep}`}>
                <thead><tr>
                  <th>Disagreement</th><th className={s.num}>Primary</th><th className={s.num}>Check</th><th className={s.num}>Delta</th><th className={s.num}>Worth</th>
                </tr></thead>
                <tbody>
                  {report.variance.lines.map((v, i) => (
                    <tr key={i}>
                      <td className={s.key}>{v.item}</td>
                      <td className={s.num}>{num(v.primaryQty, 3)} {v.unit}</td>
                      <td className={s.num}>{num(v.checkQty, 3)} {v.unit}</td>
                      <td className={s.num}>{v.delta > 0 ? "+" : ""}{num(v.delta, 3)}</td>
                      <td className={s.num}>{v.costEffect ? inr0(Math.abs(v.costEffect)) : DASH}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={s.note}>
                {Math.abs(report.variance.netDeltaTonnes) < 0.05
                  ? "Net tonnage delta ≈ 0: quantity moved between lines rather than went missing — the signature of silos swapping grit slots mid-run. The totals are safe; the per-size split is what to correct before a rate negotiation."
                  : `Net tonnage delta ${num(report.variance.netDeltaTonnes, 2)} t — quantity did not just move between lines; worth tracing before trusting the split.`}
              </p>
            </>
          )}

          <div className={s.foot}>
            <span>Computed from the mixer records and the rate card in force on {report.rateDate} · nothing stored, re-costed on every load · Pacific ERP</span>
            <span>Batch {report.batch}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
