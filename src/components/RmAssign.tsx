"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignRmBags, type PoolLine } from "@/app/store/actions";

const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const kg = (n: number) => n.toLocaleString("en-IN");
type Row = { bagNo: string; weight: string };

export function RmAssign({ lines }: { lines: PoolLine[] }) {
  const router = useRouter();
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([{ bagNo: "", weight: "" }]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const line = useMemo(() => lines.find((l) => l.id === lineId) ?? null, [lines, lineId]);

  const total = rows.reduce((a, r) => a + (parseFloat(r.weight) || 0), 0);
  const over = line ? total > line.remainingKg + 1e-6 : false;

  function setRow(i: number, k: keyof Row, v: string) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r))); }
  function addRow() { setRows((rs) => [...rs, { bagNo: "", weight: "" }]); }
  function delRow(i: number) { setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)); }

  function submit() {
    if (!line) return;
    const bags = rows.map((r) => ({ bagNo: parseFloat(r.bagNo), weight: parseFloat(r.weight) })).filter((b) => Number.isFinite(b.bagNo) && Number.isFinite(b.weight) && b.weight > 0);
    if (!bags.length) { setMsg({ ok: false, text: "Add at least one bag with a number and weight." }); return; }
    setMsg(null);
    start(async () => {
      const r = await assignRmBags(line.id, bags);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) { setRows([{ bagNo: "", weight: "" }]); router.refresh(); }
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Invoice line</span>
          <select value={lineId} onChange={(e) => { setLineId(e.target.value); setMsg(null); }} className={input}>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.invNo} · {l.type} {l.size} {l.grade} · {kg(l.remainingKg)}kg left</option>)}
          </select>
        </label>
        {line && (
          <dl className="mt-3 space-y-1 text-xs text-gray-600">
            <div className="flex justify-between"><dt className="text-gray-400">Supplier</dt><dd>{line.supplier ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Total invoice</dt><dd>{kg(line.totalKg)} kg</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Already assigned</dt><dd>{kg(line.assignedKg)} kg</dd></div>
            <div className="flex justify-between font-semibold text-amber-700"><dt>Remaining to assign</dt><dd>{kg(line.remainingKg)} kg</dd></div>
          </dl>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-2 text-sm font-semibold text-gray-800">Bags handed over</div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={r.bagNo} onChange={(e) => setRow(i, "bagNo", e.target.value)} type="number" placeholder="Bag no" className={input + " max-w-[140px]"} />
              <input value={r.weight} onChange={(e) => setRow(i, "weight", e.target.value)} type="number" placeholder="Weight (kg)" className={input + " max-w-[160px]"} />
              <button onClick={() => delRow(i)} className="rounded-md px-2 py-1 text-xs text-gray-400 hover:text-red-600">✕</button>
            </div>
          ))}
        </div>
        <button onClick={addRow} className="mt-2 text-xs font-medium text-brand hover:underline">+ add another bag</button>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
          <span className={`text-sm font-medium ${over ? "text-red-600" : "text-gray-700"}`}>{rows.filter((r) => r.weight).length} bag(s) · {kg(Math.round(total))} kg</span>
          {over && <span className="text-xs text-red-600">exceeds remaining ({line ? kg(line.remainingKg) : 0} kg)</span>}
          <button onClick={submit} disabled={pending || over} className="ml-auto rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">{pending ? "Assigning…" : "Assign bags"}</button>
        </div>

        {msg && <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.ok ? "✓ " : ""}{msg.text}</div>}
      </div>
    </div>
  );
}
