"use client";

// Grit, silo by silo — where the size and the supplier split are entered.
//
// NOT A PRICING SCREEN, and the guarantee is structural rather than a promise:
// the endpoint behind it has no rate column to return, because neither
// assignment table has one. There is no rupee figure to hide here because there
// is none to send. The price is typed afterwards on the materials panel above.
//
// THE ROWS ARE THE SILOS THE MIXER RECORDED, never a catalogue. That is the
// failure this whole feature replaces: a fixed list of five bands meant tonnage
// from a sixth was invisible, and a material nobody can see is a material nobody
// can price.
//
// A FLAG NEVER BLOCKS A SAVE. Every disagreement between what is entered and
// what the bag records say is reported in words and then ignored by the save
// path — the entered value is what the batch is costed at. The only thing that
// stops a save is malformed input.

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";

const API = "/api/office/grit-assignment";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const SIZE_LIST = "grit-size-options";

const kg = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

interface Flag { verdict: string; entered: string; recorded: string[]; score?: number; reason?: string | null }
interface SiloRow {
  silo: string; kg: number; size: string;
  suppliers: Array<{ seq: number; supplier: string; kg: number }>;
  recordedSizes: string[]; recordedSuppliers: string[];
  sizeFlag: Flag; supplierFlags: Array<Flag & { seq: number }>;
}
interface Payload {
  batchKey: string; batch: string; design: string;
  silos: SiloRow[]; unresolvedKg: number; sizeOptions: string[]; blockers: string[];
}

/** A draft line. kg is a string so a half-typed number does not become NaN. */
interface Draft { supplier: string; kg: string }

export function GritAssignPanel({ batchKey, onSaved }: { batchKey: string; onSaved?: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [split, setSplit] = useState<Record<string, Draft[]>>({});
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API}?batchKey=${encodeURIComponent(batchKey)}`, { cache: "no-store" });
    const res = await readJson<Payload>(r);
    if (!res.ok || !res.data) { setNote({ text: res.error ?? `Could not load (${res.status})`, ok: false }); return; }
    setData(res.data);
    setSizes(Object.fromEntries(res.data.silos.map((s) => [s.silo, s.size])));
    setSplit(Object.fromEntries(res.data.silos.map((s) => [
      s.silo, s.suppliers.length
        ? s.suppliers.map((p) => ({ supplier: p.supplier, kg: String(p.kg) }))
        : [{ supplier: "", kg: "" }],
    ])));
  }, [batchKey]);

  useEffect(() => { void load(); }, [load]);

  const lines = (silo: string): Draft[] => split[silo] ?? [{ supplier: "", kg: "" }];
  const setLines = (silo: string, next: Draft[]) => setSplit((p) => ({ ...p, [silo]: next }));

  const save = async (row: SiloRow) => {
    setBusy(row.silo); setNote(null);
    try {
      const r = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchKey,
          silos: [{
            silo: row.silo,
            size: sizes[row.silo] ?? "",
            suppliers: lines(row.silo).filter((l) => l.supplier.trim() || l.kg.trim()),
          }],
        }),
      });
      const res = await readJson<{ error?: string }>(r);
      if (!res.ok) { setNote({ text: res.error ?? `Save failed (${res.status})`, ok: false }); return; }
      setNote({ text: `Silo ${row.silo} saved.`, ok: true });
      await load();
      onSaved?.();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally { setBusy(""); }
  };

  if (!data) return <Card><Empty>Loading the silos this batch drew from…</Empty></Card>;
  if (!data.silos.length) {
    return (
      <Card>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Grit — size and supplier per silo</h2>
        <p className="text-sm text-gray-500">The mixer recorded no silo-linked grit for this batch.</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Grit — size and supplier per silo
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          One row per silo, with the weight this batch drew from it. Pick the size that silo ran
          and name who supplied it — the whole weight to one supplier, or split across several.
          A silo runs one size in a batch.{" "}
          <span className="text-gray-400">Prices are set on the materials panel above; nothing here is a price.</span>
        </p>
      </div>

      {note && (
        <div className={`mb-3 rounded-xl border px-4 py-2.5 text-sm ${
          note.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
        }`}>{note.text}</div>
      )}

      {/* One list for every size box on the panel. */}
      <datalist id={SIZE_LIST}>
        {data.sizeOptions.map((s) => <option key={s} value={s} />)}
      </datalist>

      <div className="space-y-3">
        {data.silos.map((row) => {
          const drafts = lines(row.silo);
          const assigned = drafts.reduce((a, l) => a + (Number(l.kg) || 0), 0);
          const left = Math.round((row.kg - assigned) * 10) / 10;
          const balanced = Math.abs(left) <= 0.5;
          const conflict = row.recordedSizes.length > 1;
          // The placeholder carries the recorded size(s). When the bags disagree
          // with themselves it shows BOTH and asks for one — the owner's rule
          // that a silo runs one size, expressed where the choice is made.
          const placeholder = conflict
            ? `${row.recordedSizes.join(" or ")} — pick one`
            : row.recordedSizes[0] ?? "Pick the size";

          return (
            <div key={row.silo} className="rounded-xl border border-gray-200 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-medium text-gray-900">Silo {row.silo}</div>
                <div className="text-xs text-gray-500">{kg.format(row.kg)} kg drawn on this batch</div>
              </div>

              <div className="mt-2 flex flex-wrap items-start gap-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Size</span>
                  <input
                    value={sizes[row.silo] ?? ""}
                    onChange={(e) => setSizes((p) => ({ ...p, [row.silo]: e.target.value }))}
                    list={SIZE_LIST} autoComplete="off" placeholder={placeholder}
                    className={`${inp} max-w-[13rem] ${conflict && !(sizes[row.silo] ?? "") ? "ring-2 ring-amber-300" : ""}`}
                  />
                  <span className="mt-1 block text-xs text-gray-400">
                    {row.recordedSizes.length === 0
                      ? "Nothing recorded a size for these bags."
                      : conflict
                        ? "The bags record two sizes. A silo runs one — pick the one it ran."
                        : `Recorded: ${row.recordedSizes[0]}`}
                  </span>
                </label>

                <div className="min-w-[18rem] flex-1">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Supplier</span>
                  <div className="space-y-1.5">
                    {drafts.map((l, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={l.supplier} placeholder="who supplied it"
                          onChange={(e) => setLines(row.silo, drafts.map((x, j) => j === i ? { ...x, supplier: e.target.value } : x))}
                          className={inp}
                        />
                        <input
                          type="number" step="0.1" min="0" inputMode="decimal"
                          value={l.kg} placeholder="kg"
                          onChange={(e) => setLines(row.silo, drafts.map((x, j) => j === i ? { ...x, kg: e.target.value } : x))}
                          className={`${inp} max-w-[7rem]`}
                        />
                        <button type="button" className="text-xs text-gray-400 hover:text-red-500"
                          onClick={() => setLines(row.silo, drafts.filter((_, j) => j !== i))}>remove</button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button type="button" className={btnGhost}
                      onClick={() => setLines(row.silo, [...drafts, { supplier: "", kg: "" }])}>
                      Split across another supplier
                    </button>
                    {!balanced && left > 0 && (
                      <button type="button" className={btnGhost}
                        onClick={() => setLines(row.silo, [...drafts, { supplier: "", kg: String(left) }])}>
                        Assign the remaining {kg.format(left)} kg
                      </button>
                    )}
                  </div>
                  <p className={`mt-1 text-xs ${balanced ? "text-gray-500" : left > 0 ? "text-amber-700" : "text-red-600"}`}>
                    {balanced
                      ? `${kg.format(assigned)} of ${kg.format(row.kg)} kg assigned`
                      : left > 0
                        ? `${kg.format(left)} kg of silo ${row.silo} is not assigned to anybody`
                        : `the lines add up to ${kg.format(assigned)} kg but the mixer drew ${kg.format(row.kg)} kg`}
                  </p>
                </div>
              </div>

              {/* Flags. Reported, never enforced — the entered value is what the
                  batch is costed at, and saving is not gated by any of these. */}
              {row.sizeFlag.verdict === "mismatch" && (
                <p className="mt-2 text-xs text-amber-700">
                  ⚑ The bags in silo {row.silo} record {row.recordedSizes.join(", ")}. You assigned{" "}
                  {row.sizeFlag.entered} — that is what this batch is costed at.
                </p>
              )}
              {row.supplierFlags.filter((f) => f.verdict === "mismatch").map((f) => (
                <p key={f.seq} className="mt-1 text-xs text-amber-700">
                  ⚑ The bags in silo {row.silo} came from {row.recordedSuppliers.join(", ")}. This line says{" "}
                  {f.entered}{f.reason === "variant-token" ? " — the two differ only in the grade, which is worth a second look" : ""}.
                </p>
              ))}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2">
                <button type="button" className={btn} disabled={busy === row.silo} onClick={() => void save(row)}>
                  {busy === row.silo ? "Saving…" : "Save silo " + row.silo}
                </button>
                {row.size && <Badge tone="green">Assigned {row.size}</Badge>}
              </div>
            </div>
          );
        })}
      </div>

      {data.unresolvedKg > 0 && (
        <p className="mt-3 text-xs text-amber-700">
          {kg.format(data.unresolvedKg)} kg of grit on this batch has no resolvable silo record, so it
          cannot be assigned here. It needs a silo fill record on those charges.
        </p>
      )}
    </Card>
  );
}
