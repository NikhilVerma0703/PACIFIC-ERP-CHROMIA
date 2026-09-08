"use client";
// The design master (answers 13 and 20): design / code / shade / confirmed /
// notes, edited in place, plus "Seed from stock" to add a row for every design
// finished goods knows that is not here yet.
//
// Mounted by the settings screen, which passes readOnly for a login without
// "plan". It must NOT be wrapped in a disabled <fieldset> instead: that turns
// off every control inside, the Find box and the unconfirmed filter included,
// and a viewer who may read a 160-row master then cannot search it. So the
// prop disables exactly the controls that WRITE — the code and notes inputs,
// the shade select, the confirmed checkbox, Seed and Add — and leaves reading
// alone. The route gates "plan" regardless; this is only the honest screen.
//
// Each cell saves on blur / change, one PUT per field, because the owner's
// code list arrives design by design and a Save-all button on 160 rows would
// lose a whole afternoon's typing to one bad code.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { postJson } from "@/lib/fab/postJson";
import { SHADES, guessShade, normaliseDesignName } from "@/lib/commercial/design-rules";
import { ShadeChip } from "@/components/commercial/production/ShadeChip";
import type { DesignCodeDto } from "@/lib/commercial/types";

const btn = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimary = "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const input = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none disabled:bg-gray-50 disabled:text-gray-500";

async function putJson(url: string, body: unknown) {
  let res: Response;
  try {
    res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false as const, error: "No connection — the change was not saved.", data: null };
  }
  const r = await readJson<DesignCodeDto>(res);
  return { ok: r.ok, error: r.error, data: r.data };
}

type Draft = { code: string; notes: string };

export default function DesignCodesEditor({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [rows, setRows] = useState<DesignCodeDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  const [newDesign, setNewDesign] = useState("");

  const take = useCallback((items: DesignCodeDto[]) => {
    setRows(items);
    setDrafts(Object.fromEntries(items.map((r) => [r.design, { code: r.code ?? "", notes: r.notes ?? "" }])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/office/commercial/design-codes", { cache: "no-store" });
    const r = await readJson<{ items: DesignCodeDto[] }>(res);
    setLoading(false);
    if (!r.ok || !r.data) { setError(r.error ?? "Could not read the design master"); return; }
    setError(null);
    take(r.data.items);
  }, [take]);

  useEffect(() => { void load(); }, [load]);

  async function save(design: string, body: Record<string, unknown>, said: string) {
    setBusy(design); setError(null); setNote(null);
    const r = await putJson(`/api/office/commercial/design-codes/${encodeURIComponent(design)}`, body);
    setBusy(null);
    if (!r.ok || !r.data) { setError(r.error ?? "Could not save"); void load(); return; }
    const row = r.data;
    setRows((rs) => {
      const i = rs.findIndex((x) => x.design === row.design);
      const next = i === -1 ? [...rs, row] : rs.map((x) => (x.design === row.design ? row : x));
      return next.sort((a, b) => a.design.localeCompare(b.design));
    });
    setDrafts((m) => ({ ...m, [row.design]: { code: row.code ?? "", notes: row.notes ?? "" } }));
    setNote(said);
  }

  async function seed() {
    setBusy("seed"); setError(null); setNote(null);
    const r = await postJson("/api/office/commercial/design-codes/seed", {});
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Could not seed"); return; }
    take((r.data?.items ?? []) as DesignCodeDto[]);
    const n = Number(r.data?.inserted ?? 0);
    setNote(n ? `${n} design(s) added from stock, shade guessed and unconfirmed: ${(r.data?.designs as string[] ?? []).slice(0, 8).join(", ")}${n > 8 ? "…" : ""}` : "Every design in stock already has a row.");
  }

  async function addByHand() {
    const design = normaliseDesignName(newDesign);
    if (!design) return;
    await save(design, { shade: guessShade(design), shadeConfirmed: false }, `${design} added — shade guessed ${guessShade(design).toLowerCase()}, confirm it when you know.`);
    setNewDesign("");
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (!onlyUnconfirmed || !r.shadeConfirmed)
      && (!needle || r.design.toLowerCase().includes(needle) || (r.code ?? "").toLowerCase().includes(needle)));
  }, [rows, q, onlyUnconfirmed]);

  const unconfirmed = rows.filter((r) => !r.shadeConfirmed).length;
  const uncoded = rows.filter((r) => !r.code).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Find</span>
          <input className={`${input} w-56`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Design or code" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
          <input type="checkbox" className="h-4 w-4" checked={onlyUnconfirmed} onChange={(e) => setOnlyUnconfirmed(e.target.checked)} />
          Unconfirmed shades only
        </label>
        <span className="pb-2 text-xs text-gray-500">{rows.length} design(s) · {unconfirmed} shade(s) unconfirmed · {uncoded} without a code</span>
        <button type="button" className={`${btnPrimary} ml-auto`} disabled={readOnly || busy === "seed"} onClick={() => void seed()}
          title={readOnly ? "Only production planning may change the design master" : "Add a row for every finished-goods design not here yet"}>
          {busy === "seed" ? "Seeding…" : "Seed from stock"}
        </button>
      </div>

      {/* No read-only banner here: the settings screen already prints one
          above this editor, and two identical notices stacked read as a bug. */}
      {error &&<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {note && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{note}</div>}

      {loading && !rows.length ? (
        <Empty>Loading the design master…</Empty>
      ) : rows.length === 0 ? (
        <Empty>No designs yet. Seed from stock to start with every design finished goods knows, or add one below.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-2 py-2 text-left">Design</th>
                <th className="px-2 py-2 text-left">Code</th>
                <th className="px-2 py-2 text-left">Shade</th>
                <th className="px-2 py-2 text-left">Confirmed</th>
                <th className="px-2 py-2 text-left">Notes</th>
                <th className="px-2 py-2 text-left">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((r) => {
                const d = drafts[r.design] ?? { code: r.code ?? "", notes: r.notes ?? "" };
                const saving = busy === r.design;
                return (
                  <tr key={r.design} className={saving ? "opacity-60" : ""}>
                    <td className="px-2 py-1.5 font-medium text-gray-900">
                      {r.design}
                      <div className="mt-0.5"><ShadeChip shade={r.shade} confirmed={r.shadeConfirmed} /></div>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className={`${input} w-40 font-mono uppercase`} value={d.code} placeholder="VGWT10301A" disabled={readOnly}
                        onChange={(e) => setDrafts((m) => ({ ...m, [r.design]: { ...d, code: e.target.value } }))}
                        onBlur={() => { if ((r.code ?? "") !== d.code.trim().toUpperCase()) void save(r.design, { code: d.code }, `${r.design}: code saved.`); }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        className={`${input} w-32`} value={r.shade ?? ""} disabled={readOnly}
                        onChange={(e) => void save(r.design, { shade: e.target.value || null, shadeConfirmed: e.target.value !== "" }, `${r.design}: shade ${e.target.value ? e.target.value.toLowerCase() : "cleared"}${e.target.value ? " and confirmed" : ""}.`)}
                      >
                        <option value="">— none —</option>
                        {SHADES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox" className="h-4 w-4" checked={r.shadeConfirmed} disabled={readOnly || !r.shade}
                          onChange={(e) => void save(r.design, { shadeConfirmed: e.target.checked }, `${r.design}: shade ${e.target.checked ? "confirmed" : "marked unconfirmed"}.`)}
                        />
                        {r.shadeConfirmed ? <Badge tone="green">confirmed</Badge> : <Badge tone="amber">guess</Badge>}
                      </label>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className={`${input} w-full min-w-[180px]`} value={d.notes} placeholder="Owner's list, Sept" disabled={readOnly}
                        onChange={(e) => setDrafts((m) => ({ ...m, [r.design]: { ...d, notes: e.target.value } }))}
                        onBlur={() => { if ((r.notes ?? "") !== d.notes.trim()) void save(r.design, { notes: d.notes }, `${r.design}: note saved.`); }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-xs text-gray-400">{new Date(r.updatedAt).toLocaleDateString("en-IN")}</td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-sm text-gray-500">Nothing matches.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Add a design by hand</span>
          <input className={`${input} w-64`} value={newDesign} onChange={(e) => setNewDesign(e.target.value)} placeholder="Exactly as stock spells it"
            disabled={readOnly}
            onKeyDown={(e) => { if (e.key === "Enter") void addByHand(); }} />
        </label>
        <button type="button" className={btn} disabled={readOnly || !newDesign.trim() || !!busy} onClick={() => void addByHand()}>Add</button>
        <span className="pb-2 text-xs text-gray-400">A design added here gets a guessed shade, unconfirmed, like a seeded one.</span>
      </div>
    </div>
  );
}
