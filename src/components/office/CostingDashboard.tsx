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
  variance: {
    lines: Array<{ item: string; primaryQty: number; checkQty: number; unit: string; delta: number; costEffect: number }>;
    totalAbsEffect: number; netDeltaTonnes: number;
  };
  basis: { assumptions: string[]; effectiveFrom: Record<string, string> };
  stats: {
    resinCycles: number; mixerCharges: number; runHours: number; wallClockHours: number;
    stoppages: { count: number; hours: number }; pressSlabs: number;
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
  const [days, setDays] = useState(60);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`${API}?days=${days}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (live) setBatches(d.batches ?? []); })
      .catch(() => { if (live) setBatches([]); });
    return () => { live = false; };
  }, [days]);

  const load = useCallback(async (key: string) => {
    setSelected(key);
    setReport(null);
    setError("");
    if (!key) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}?batch=${encodeURIComponent(key)}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `Failed (${r.status})`);
      setReport(d as Report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const s = report?.sheet ?? null;

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
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Look back
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={selCls}>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={120}>120 days</option>
              <option value={365}>a year</option>
            </select>
          </label>
          {batches === null && <span className="text-xs text-gray-400">Loading batches…</span>}
          {batches?.length === 0 && <span className="text-xs text-gray-400">No batches with mixer records in this window.</span>}
          {loading && <span className="text-xs text-gray-400">Computing…</span>}
        </div>
        {report && (
          <p className="mt-2 text-xs text-gray-400">
            {report.design} · pressed {report.window.firstPress ?? "?"} to {report.window.lastPress ?? "?"} ·
            {" "}costed at the rate card in force on {report.rateDate} · computed from mixer records just now
          </p>
        )}
        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      </Card>

      {report && report.blockedBy.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">The sheet cannot be computed: the rate card is missing {report.blockedBy.join(", ")}.</p>
          <p className="mt-1 text-red-700">Set them in the rate card above — quantities are shown below so the batch is still inspectable.</p>
        </div>
      )}

      {report && report.unpriced.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Consumed but not priced — these amounts are NOT in the totals:</p>
          <ul className="mt-1 list-inside list-disc">
            {report.unpriced.map((u, i) => (
              <li key={i}>{u.item}{u.qty != null ? ` — ${num(u.qty)} ${u.unit}` : ""} · needs {u.needs}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- 1 · headline ---- */}
      {s && (
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
      {s && (
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
      {s && (
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
      {s && (
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

      {/* ---- 6 · basis ---- */}
      {report && (
        <Section title="Basis — every assumption, printed">
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
            {report.basis.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="mb-1 text-xs font-medium text-gray-500">Rates used, and since when</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(report.basis.effectiveFrom).map(([k, v]) => (
                <Badge key={k} tone="brand">{k}: {v}</Badge>
              ))}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-500 sm:grid-cols-4">
            <span>{report.stats.resinCycles} resin cycles</span>
            <span>{report.stats.mixerCharges} mixer charges</span>
            <span>{num(report.stats.runHours, 1)} h run · {num(report.stats.stoppages.hours, 1)} h stopped</span>
            <span>{report.stats.pressSlabs} slabs pressed</span>
          </div>
        </Section>
      )}
    </div>
  );
}
