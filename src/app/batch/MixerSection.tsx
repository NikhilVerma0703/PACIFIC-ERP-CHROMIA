"use client";

import { Fragment, useState } from "react";
import Link from "next/link";

interface GritLine { mixer: number; cat: string; kg: number; silo: string | null; }
interface Cycle {
  cycle: number | null; operator: string | null; mixers: number[];
  cycleWeight: number; start: string | Date | null; end: string | Date | null;
  gritKg: number; fillerKg: number; resinKg: number;
  gritSilos: string[]; fillerSilo: string | null; lines: GritLine[];
}
interface Silo {
  increment: number | null; siloNo: string | null; sku: string | null;
  weight: number | null; remaining: number | null; date: string | Date | null;
  assignee: string | null; bag: string | null; supplier: string | null; size: string | null;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");
const timeOf = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(11, 16) : "—");
const dateOf = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const dt = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "—");

// Pull the invoice id out of a "INV: <id> ; Bag: <n>" string.
function invOf(bag: string | null): string {
  if (!bag) return "—";
  const m = bag.match(/INV:\s*([^;]+)/i);
  return m ? m[1].trim() : bag;
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-gray-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

export function MixerSection({ cycles, silos, mixerListHref }: { cycles: Cycle[]; silos: Silo[]; mixerListHref: string }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const count = cycles.length;
  const startMs = cycles.map((c) => c.start).filter(Boolean).map((d) => new Date(d as string | Date).getTime());
  const endMs = cycles.map((c) => c.end).filter(Boolean).map((d) => new Date(d as string | Date).getTime());
  const firstStart = startMs.length ? new Date(Math.min(...startMs)) : null;
  const lastEnd = endMs.length ? new Date(Math.max(...endMs)) : null;
  const totalWeight = cycles.reduce((a, c) => a + c.cycleWeight, 0);
  const totalGrit = cycles.reduce((a, c) => a + c.gritKg, 0);
  const totalFiller = cycles.reduce((a, c) => a + c.fillerKg, 0);
  const totalResin = cycles.reduce((a, c) => a + c.resinKg, 0);
  const totalMat = totalGrit + totalFiller + totalResin;
  const pct = (x: number) => (totalMat > 0 ? Math.round((x / totalMat) * 100) : 0);

  // Per-silo size & supplier(s) — used to annotate each cycle's grit/filler lines.
  const siloInfo = new Map<string, { sizes: Set<string>; suppliers: Set<string> }>();
  for (const b of silos) {
    const silo = b.siloNo ?? "—";
    if (!siloInfo.has(silo)) siloInfo.set(silo, { sizes: new Set(), suppliers: new Set() });
    const e = siloInfo.get(silo)!;
    if (b.size) e.sizes.add(b.size);
    if (b.supplier) e.suppliers.add(b.supplier);
  }
  const sizeOf = (silo: string | null) => (silo && siloInfo.get(silo) ? [...siloInfo.get(silo)!.sizes].join(", ") || "—" : "—");
  const supOf = (silo: string | null) => (silo && siloInfo.get(silo) ? [...siloInfo.get(silo)!.suppliers].join(", ") || "—" : "—");

  // Materials & suppliers panel: group silo bags by silo, then by invoice.
  const bySilo = new Map<string, Map<string, { kg: number; bags: number; supplier: Set<string>; size: Set<string> }>>();
  for (const b of silos) {
    const silo = b.siloNo ?? "—";
    const inv = invOf(b.bag);
    if (!bySilo.has(silo)) bySilo.set(silo, new Map());
    const invMap = bySilo.get(silo)!;
    if (!invMap.has(inv)) invMap.set(inv, { kg: 0, bags: 0, supplier: new Set(), size: new Set() });
    const e = invMap.get(inv)!;
    e.kg += b.weight ?? 0; e.bags += 1; if (b.supplier) e.supplier.add(b.supplier); if (b.size) e.size.add(b.size);
  }
  const siloRows: { silo: string; inv: string; supplier: string; size: string; bags: number; kg: number }[] = [];
  for (const [silo, invMap] of bySilo) {
    for (const [inv, e] of invMap) siloRows.push({ silo, inv, supplier: [...e.supplier].join(", ") || "—", size: [...e.size].join(", ") || "—", bags: e.bags, kg: e.kg });
  }

  if (count === 0) {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Mixer cycles</div>
        <div className="rounded-xl border border-dashed border-gray-300 bg-white/50 p-8 text-center text-sm text-gray-500">No mixer cycles for this batch.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Mixer cycles · {count}</h2>
        <Link href={mixerListHref} className="text-sm font-medium text-brand hover:underline">Open mixer list →</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Cycles done" value={count} />
        <Stat label="First cycle start" value={timeOf(firstStart)} sub={dateOf(firstStart)} />
        <Stat label="Last cycle end" value={timeOf(lastEnd)} sub={dateOf(lastEnd)} />
        <Stat label="Total mix weight" value={fmt(totalWeight)} sub="kg" />
        <Stat label="Grit · Filler · Resin" value={<span className="text-lg">{pct(totalGrit)}% · {pct(totalFiller)}% · {pct(totalResin)}%</span>} sub="of mix" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-2 pr-3"></th>
              <th className="py-2 pr-4">Cycle</th>
              <th className="py-2 pr-4">Mixers</th>
              <th className="py-2 pr-4">Grit (kg)</th>
              <th className="py-2 pr-4">Filler (kg)</th>
              <th className="py-2 pr-4">Resin (kg)</th>
              <th className="py-2 pr-4">Silos</th>
              <th className="py-2 pr-4">Operator</th>
              <th className="py-2 pr-4">Start</th>
              <th className="py-2">End</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c, i) => {
              const isOpen = open.has(i);
              return (
                <Fragment key={i}>
                  <tr onClick={() => toggle(i)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-3 text-gray-400">{isOpen ? "▾" : "▸"}</td>
                    <td className="py-2 pr-4 font-medium">{c.cycle ?? "—"}</td>
                    <td className="py-2 pr-4">{c.mixers.length ? c.mixers.map((m) => `M${m}`).join(", ") : "—"}</td>
                    <td className="py-2 pr-4">{fmt(c.gritKg)}</td>
                    <td className="py-2 pr-4">{fmt(c.fillerKg)}</td>
                    <td className="py-2 pr-4">{fmt(c.resinKg)}</td>
                    <td className="py-2 pr-4 text-gray-600">{[...c.gritSilos, ...(c.fillerSilo ? [c.fillerSilo] : [])].join(", ") || "—"}</td>
                    <td className="py-2 pr-4">{c.operator ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-500">{dt(c.start)}</td>
                    <td className="py-2 text-gray-500">{dt(c.end)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-gray-100 bg-gray-50/60">
                      <td></td>
                      <td colSpan={9} className="py-3 pr-4">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Material into cycle {c.cycle ?? "—"}</div>
                        {c.lines.length ? (
                          <table className="w-full max-w-3xl text-xs">
                            <thead>
                              <tr className="text-left text-gray-400">
                                <th className="py-1 pr-4">Mixer</th>
                                <th className="py-1 pr-4">Grit category</th>
                                <th className="py-1 pr-4">Weight (kg)</th>
                                <th className="py-1 pr-4">From silo</th>
                                <th className="py-1 pr-4">Size</th>
                                <th className="py-1">Supplier</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.lines.map((l, j) => (
                                <tr key={j} className="border-t border-gray-200/70">
                                  <td className="py-1 pr-4">M{l.mixer}</td>
                                  <td className="py-1 pr-4">{l.cat}</td>
                                  <td className="py-1 pr-4">{fmt(l.kg)}</td>
                                  <td className="py-1 pr-4 text-gray-600">{l.silo ?? "—"}</td>
                                  <td className="py-1 pr-4 text-gray-600">{sizeOf(l.silo)}</td>
                                  <td className="py-1 text-gray-600">{supOf(l.silo)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : <div className="text-xs text-gray-500">No grit categories recorded.</div>}
                        <div className="mt-2 text-xs text-gray-600">
                          Filler: <b>{fmt(c.fillerKg)} kg</b>{c.fillerSilo ? ` — ${c.fillerSilo}${sizeOf(c.fillerSilo) !== "—" ? ` · ${sizeOf(c.fillerSilo)}` : ""}${supOf(c.fillerSilo) !== "—" ? ` · ${supOf(c.fillerSilo)}` : ""}` : ""} · Resin: <b>{fmt(c.resinKg)} kg</b> · Cycle total: <b>{fmt(c.cycleWeight)} kg</b>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Materials &amp; suppliers</div>
        <p className="mb-2 text-xs text-gray-500">Suppliers and sizes that fed the silos used by this batch. A silo can hold bags from several invoices (drawn FIFO), so this is the batch-level material source, not a per-cycle attribution.</p>
        {siloRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-4">Silo</th>
                  <th className="py-2 pr-4">Supplier</th>
                  <th className="py-2 pr-4">Size</th>
                  <th className="py-2 pr-4">Invoice</th>
                  <th className="py-2 pr-4">Bags</th>
                  <th className="py-2">Weight (kg)</th>
                </tr>
              </thead>
              <tbody>
                {siloRows.map((r, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="py-2 pr-4 font-medium">{r.silo}</td>
                    <td className="py-2 pr-4">{r.supplier}</td>
                    <td className="py-2 pr-4 text-gray-600">{r.size}</td>
                    <td className="py-2 pr-4 text-gray-600">{r.inv}</td>
                    <td className="py-2 pr-4">{r.bags}</td>
                    <td className="py-2">{fmt(r.kg)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 text-gray-700">
                  <td className="py-2 pr-4 font-medium" colSpan={4}>Resin used (from tanks)</td>
                  <td className="py-2 pr-4">—</td>
                  <td className="py-2 font-medium">{fmt(totalResin)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : <div className="text-sm text-gray-500">No silo bags linked to this batch.</div>}
      </div>
    </div>
  );
}
