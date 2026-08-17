"use client";

// Receiving a slab. The one place a Chromia slab is born inside the ERP.
//
// The form stays open after a successful save and keeps the batch, material and
// date — slabs arrive by the lorry-load, and re-typing the batch for every one
// of forty panels is how people end up back in the spreadsheet. Only the slab
// number clears, which is the only field that genuinely differs row to row.

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { receiveSlab } from "@/lib/chromia/actions";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const label = "mb-1 block text-xs font-medium text-gray-600";
const btn = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";

export function IntakeForm({
  designs, locations,
}: {
  designs: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}) {
  const [slabNo, setSlabNo] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [materialName, setMaterial] = useState("");
  const [receivedDate, setReceived] = useState(new Date().toISOString().slice(0, 10));
  const [designId, setDesign] = useState("");
  const [locationId, setLocation] = useState("");
  const [thickness, setThickness] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [condition, setCondition] = useState("");
  const [remarks, setRemarks] = useState("");

  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [received, setReceivedList] = useState<string[]>([]);
  const slabRef = useRef<HTMLInputElement>(null);

  const submit = () => start(async () => {
    const r = await receiveSlab({
      slabNo, batchNo, materialName,
      receivedDate: receivedDate ? new Date(`${receivedDate}T00:00:00`) : null,
      designId: designId || null,
      locationId: locationId || null,
      thicknessMm: thickness ? Number(thickness) : null,
      lengthMm: length ? Number(length) : null,
      widthMm: width ? Number(width) : null,
      conditionOnArrival: condition,
      remarks,
    });
    setNote({ text: r.ok ? (r.message ?? "Received.") : (r.error ?? "That did not work."), ok: r.ok });
    if (r.ok && r.slabNo) {
      setReceivedList((prev) => [r.slabNo!, ...prev].slice(0, 25));
      setSlabNo("");
      // Straight back to the number field for the next panel off the lorry.
      slabRef.current?.focus();
    }
  });

  return (
    <div className="space-y-5">
      {note && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            note.ok
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {note.text}
        </div>
      )}

      <Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className={label}>Slab number *</span>
            <input
              ref={slabRef} value={slabNo} autoFocus autoComplete="off"
              onChange={(e) => setSlabNo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !pending) submit(); }}
              placeholder="CHR-1042" className={inp}
            />
            <span className="mt-1 block text-xs text-gray-400">
              Its identity for life, across every recalibration.
            </span>
          </label>
          <label className="block">
            <span className={label}>Batch *</span>
            <input
              value={batchNo} onChange={(e) => setBatchNo(e.target.value)}
              placeholder="MAY-04" autoComplete="off" className={inp}
            />
            <span className="mt-1 block text-xs text-gray-400">Created if it is new.</span>
          </label>
          <label className="block">
            <span className={label}>Base material *</span>
            <input
              value={materialName} onChange={(e) => setMaterial(e.target.value)}
              placeholder="Base 18mm" autoComplete="off" className={inp}
            />
          </label>

          <label className="block">
            <span className={label}>Received</span>
            <input type="date" value={receivedDate} onChange={(e) => setReceived(e.target.value)} className={inp} />
          </label>
          <label className="block">
            <span className={label}>Planned design</span>
            <select value={designId} onChange={(e) => setDesign(e.target.value)} className={inp}>
              <option value="">Not decided yet</option>
              {designs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={label}>Where it is</span>
            <select value={locationId} onChange={(e) => setLocation(e.target.value)} className={inp}>
              <option value="">Not recorded</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>

          <label className="block">
            <span className={label}>Thickness (mm)</span>
            <input
              type="number" step="0.001" value={thickness}
              onChange={(e) => setThickness(e.target.value)} className={inp}
            />
            <span className="mt-1 block text-xs text-gray-400">
              Recalibration eats into this — the original is kept.
            </span>
          </label>
          <label className="block">
            <span className={label}>Length (mm)</span>
            <input type="number" step="0.001" value={length} onChange={(e) => setLength(e.target.value)} className={inp} />
          </label>
          <label className="block">
            <span className={label}>Width (mm)</span>
            <input type="number" step="0.001" value={width} onChange={(e) => setWidth(e.target.value)} className={inp} />
          </label>

          <label className="block md:col-span-1">
            <span className={label}>Condition on arrival</span>
            <input
              value={condition} onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g. chipped corner" className={inp}
            />
          </label>
          <label className="block md:col-span-2">
            <span className={label}>Remarks</span>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inp} />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button" onClick={submit}
            disabled={pending || !slabNo.trim() || !batchNo.trim() || !materialName.trim()}
            className={btn}
          >
            {pending ? "Receiving…" : "Receive slab"}
          </button>
          <span className="text-xs text-gray-400">
            Batch, material and date stay put for the next one.
          </span>
        </div>
      </Card>

      {received.length > 0 && (
        <Card>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Received just now · {received.length}
          </h2>
          <div className="flex flex-wrap gap-2">
            {received.map((n) => (
              <Link
                key={n} href={`/chromia/slabs/${encodeURIComponent(n)}`}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:border-brand hover:bg-brand/5"
              >
                {n}
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
