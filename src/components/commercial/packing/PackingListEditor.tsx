"use client";
// The packing list itself: the stuffing header, the crates, and every slab
// with its crate, the customer's numbering and the measured centimetres.
//
// Editing is field-by-field on blur rather than one big Save: a list is built
// over an afternoon by someone reading a tape measure off a slab, and a form
// that loses twenty rows because the session lapsed before Save is a form that
// gets kept on paper instead. Everything that changes what is in the crates is
// closed once the list is with the dispatch team (canEdit), while the header —
// container, seal, vehicle, weights — stays open until the slabs have gone,
// because those are known at stuffing time, after the check.
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Badge, Empty, Kpi } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { postJson, patchJson, deleteJson } from "@/lib/fab/postJson";
import {
  canEdit, canEditHeader, canSubmit, canReopen, canFinalise, canDispatch, canRecheck,
  PACKING_STATUS_LABEL, CRATE_KINDS, parseSlabNumbers, fitCounts, packagesSummary,
  crateGroups, measurementRows, type PackingStatus,
} from "@/lib/commercial/packing-rules";
import { sizeInUnit, sizeToCm, MEASUREMENT_UNITS, type MeasurementUnit } from "@/lib/commercial/measure";
import { SwapSlabPicker } from "@/components/commercial/dispatch/SwapSlabPicker";

// ── shapes the API hands back ────────────────────────────────────────────────
interface Crate { id: string; crateNo: number; kind: string; grossKg: number | null; netKg: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null; remarks: string | null }
interface Slab {
  id: string; crateId: string | null; slabNumber: number; customerSlabNo: string | null; customerBatchNo: string | null;
  design: string | null; customerSku: string | null; thickness: string | null; batchKey: string | null; batchNumber: string | null;
  grade: string | null; lengthCm: number | null; widthCm: number | null; sqm: number | null; sqft: number | null;
  fit: "PENDING" | "FIT" | "UNFIT"; unfitReason: string | null; checkedAt: string | null; sortOrder: number;
}
interface Hold { id: string; reference: string; status: string; expiresAt: string; slabs: Array<{ slabNumber: number; releasedAt: string | null; packedAt: string | null }> }
interface Order { id: string; number: string; kind: string; status: string; client: { id: string; name: string; country: string | null } | null; holds: Hold[] }
interface PList {
  id: string; number: string; status: PackingStatus; orderId: string;
  containerNo: string | null; sealNo: string | null; linerOtlNo: string | null; vehicleNo: string | null;
  grossWeightKg: number | null; netWeightKg: number | null; packagesSummary: string | null; notes: string | null;
  /** cm | in — what the size columns and the sheets show (answer 17). */
  measurementUnit: MeasurementUnit;
  createdByName: string | null; createdAt: string; submittedAt: string | null; verifiedAt: string | null;
  verifiedByName: string | null; verificationNote: string | null; finalisedAt: string | null; dispatchedAt: string | null;
  crates: Crate[]; slabs: Slab[]; order: Order;
  invoices?: Array<{ id: string; number: string; kind: string; status: string }>;
}

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const cell = "w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm transition focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20 disabled:border-transparent disabled:bg-transparent disabled:text-gray-500";
const label = "mb-1 block text-xs font-medium text-gray-600";
const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const btnDanger = "rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60";

const TONE: Record<PackingStatus, "brand" | "green" | "amber" | "red"> = {
  DRAFT: "brand", SUBMITTED: "amber", VERIFIED: "green", REJECTED: "red", FINAL: "green", DISPATCHED: "green",
};
const FIT_TONE: Record<string, "brand" | "green" | "amber" | "red"> = { PENDING: "brand", FIT: "green", UNFIT: "red" };

const when = (v: string | null): string => (v ? new Date(v).toLocaleString("en-IN") : "—");
const n3 = (v: number | null): string => (v == null ? "" : String(v));

/** One editable cell: its own value, committed on blur or Enter, only when it
 *  actually changed. Nothing is saved by simply tabbing through the table. */
function Cell({ value, onCommit, disabled, type = "text", width, placeholder }: {
  value: string; onCommit: (v: string) => void; disabled?: boolean; type?: string; width?: string; placeholder?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <input
      className={cell} style={width ? { width } : undefined} type={type} value={v} disabled={disabled} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export function PackingListEditor({ plId, actions }: { plId: string; actions: string[] }) {
  const mayWrite = actions.includes("write");
  const mayVerify = actions.includes("verify");
  const [list, setList] = useState<PList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [addText, setAddText] = useState("");
  const [addHold, setAddHold] = useState("");
  const [swapping, setSwapping] = useState<string | null>(null); // slab id being swapped (answer 30)
  const [header, setHeader] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await readJson<PList>(await fetch(`/api/office/commercial/packing-lists/${plId}`, { cache: "no-store" }));
    if (!res.ok) { setError(res.error ?? "Could not load this packing list"); return; }
    setError(null);
    setList(res.data);
    setSelected(new Set());
    if (res.data) {
      setHeader({
        containerNo: res.data.containerNo ?? "", sealNo: res.data.sealNo ?? "", linerOtlNo: res.data.linerOtlNo ?? "",
        vehicleNo: res.data.vehicleNo ?? "", grossWeightKg: n3(res.data.grossWeightKg), netWeightKg: n3(res.data.netWeightKg),
        packagesSummary: res.data.packagesSummary ?? "", notes: res.data.notes ?? "",
      });
    }
  }, [plId]);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (fn: () => Promise<{ ok: boolean; error: string | null; data: unknown }>, ok?: (d: unknown) => string) => {
    setBusy(true); setError(null); setNote(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "That did not save"); return false; }
    if (ok) setNote(ok(r.data));
    await load();
    return true;
  }, [load]);

  const editable = !!list && canEdit(list.status) && mayWrite;
  const headerEditable = !!list && canEditHeader(list.status) && mayWrite;

  const counts = useMemo(() => fitCounts(list?.slabs ?? []), [list]);
  const groups = useMemo(() => crateGroups(list?.slabs ?? [], list?.crates ?? []), [list]);
  const sheet = useMemo(() => measurementRows(list?.slabs ?? [], list?.crates ?? []), [list]);
  const autoPackages = useMemo(() => packagesSummary(list?.crates ?? []) ?? "", [list]);
  const holds = useMemo(
    () => (list?.order.holds ?? []).filter((h) => h.status === "ACTIVE" && h.slabs.some((s) => !s.releasedAt && !s.packedAt)),
    [list],
  );
  const parsedAdd = parseSlabNumbers(addText);

  if (error && !list) return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!list) return <Empty>Loading…</Empty>;

  const submitCheck = canSubmit(list.status, list.slabs);
  // The rows are stored in centimetres whatever the list shows; the unit is a
  // lens on the two size columns, applied on the way out and on the way in.
  const unit: MeasurementUnit = list.measurementUnit ?? "cm";
  const inUnit = (cm: number | null): string => n3(sizeInUnit(cm, unit));
  const maySwap = mayWrite && canRecheck(list.status);

  // ── writes ────────────────────────────────────────────────────────────────
  const setUnit = (u: MeasurementUnit) => run(() => patchJson(`/api/office/commercial/packing-lists/${plId}`, { measurementUnit: u }), () => `Sizes now in ${u}.`);
  /** A size typed in the list's unit, saved as the centimetres the row keeps. */
  const commitSize = (id: string, side: "lengthCm" | "widthCm", typed: string) => {
    const v = typed.trim();
    if (v === "") return patchSlab(id, { [side]: null });
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) { setError(`${side === "lengthCm" ? "Length" : "Width"} must be a number of ${unit}`); return Promise.resolve(false); }
    return patchSlab(id, { [side]: sizeToCm(n, unit) });
  };
  const saveHeader = () => run(() => patchJson(`/api/office/commercial/packing-lists/${plId}`, {
    containerNo: header.containerNo, sealNo: header.sealNo, linerOtlNo: header.linerOtlNo, vehicleNo: header.vehicleNo,
    grossWeightKg: header.grossWeightKg === "" ? null : header.grossWeightKg,
    netWeightKg: header.netWeightKg === "" ? null : header.netWeightKg,
    packagesSummary: header.packagesSummary, notes: header.notes,
  }), () => "Header saved.");

  const addCrate = (kind: string) => run(() => postJson(`/api/office/commercial/packing-lists/${plId}/crates`, { kind }), () => `${kind} added.`);
  const patchCrate = (id: string, data: Record<string, unknown>) => run(() => patchJson(`/api/office/commercial/packing-lists/${plId}/crates/${id}`, data));
  const removeCrate = (id: string) => run(() => deleteJson(`/api/office/commercial/packing-lists/${plId}/crates/${id}`), () => "Crate removed; its slabs are unassigned.");
  const patchSlab = (id: string, data: Record<string, unknown>) => run(() => patchJson(`/api/office/commercial/packing-lists/${plId}/slabs/${id}`, data));
  const removeSlab = (id: string) => run(() => deleteJson(`/api/office/commercial/packing-lists/${plId}/slabs/${id}`), () => "Slab taken off the list.");

  const bulkAssign = (crateId: string | null) => run(
    () => patchJson(`/api/office/commercial/packing-lists/${plId}/slabs/assign`, { slabIds: Array.from(selected), crateId }),
    (d) => `${(d as { moved?: number })?.moved ?? 0} slab(s) ${crateId ? "moved" : "unassigned"}.`,
  );

  const addSlabs = () => run(
    () => postJson(`/api/office/commercial/packing-lists/${plId}/slabs`, addHold ? { fromHoldId: addHold } : { slabNumbers: parsedAdd }),
    (d) => {
      const r = d as { added?: number; skipped?: Array<{ slab: number; reason: string }> };
      setAddText(""); setAddHold("");
      return `${r?.added ?? 0} slab(s) added${r?.skipped?.length ? ` — refused: ${r.skipped.map((s) => `#${s.slab} (${s.reason})`).join("; ")}` : ""}`;
    },
  );

  const act = (path: string, body: Record<string, unknown> = {}) => run(
    () => postJson(`/api/office/commercial/packing-lists/${plId}/${path}`, body),
    (d) => {
      const r = d as { removed?: Array<{ slab: number; reason: string }>; dispatched?: number; returnedToStock?: number; stranded?: Array<{ slab: number; reason: string }> };
      const strandedNote = r?.stranded?.length
        ? ` ${r.stranded.length} slab(s) are still PACKED in finished goods: ${r.stranded.map((x) => `#${x.slab} (${x.reason})`).join("; ")}.`
        : "";
      if (path === "submit") return `Sent for the dispatch check${r?.removed?.length ? ` — ${r.removed.length} slab(s) dropped: ${r.removed.map((x) => `#${x.slab} (${x.reason})`).join("; ")}` : ""}.`;
      // A dispatch that could not go answers 409 and lands in the error box with
      // every refused slab named; this only ever reports one that did.
      if (path === "dispatch") return `Dispatched ${r?.dispatched ?? 0} slab(s).`;
      if (path === "reopen") return `Reopened${r?.returnedToStock ? `; ${r.returnedToStock} slab(s) back in stock` : ""}.${strandedNote}`;
      return "Done.";
    },
  );

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{list.number}</h2>
              <Badge tone={TONE[list.status] ?? "brand"}>{PACKING_STATUS_LABEL[list.status] ?? list.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              <Link href={`/office/commercial/orders/${list.order.id}?tab=packing`} className="font-medium text-brand hover:underline">{list.order.number}</Link>
              {" · "}{list.order.client?.name ?? "—"}{" · "}{list.order.kind === "EXPORT" ? "Export" : "Domestic"}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Started {when(list.createdAt)}{list.createdByName ? ` by ${list.createdByName}` : ""}
              {list.submittedAt ? ` · submitted ${when(list.submittedAt)}` : ""}
              {list.verifiedAt ? ` · checked ${when(list.verifiedAt)}${list.verifiedByName ? ` by ${list.verifiedByName}` : ""}` : ""}
              {list.dispatchedAt ? ` · dispatched ${when(list.dispatchedAt)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/office/commercial/packing-lists/${plId}/pdf`} target="_blank" rel="noreferrer" className={btnGhost}>Packing list PDF</a>
            <a href={`/api/office/commercial/packing-lists/${plId}/measurement-list.pdf`} target="_blank" rel="noreferrer" className={btnGhost}>Measurement list PDF</a>
            {mayWrite && canEdit(list.status) && (
              <button type="button" className={btn} disabled={busy || !submitCheck.ok} title={submitCheck.ok ? "" : submitCheck.reason} onClick={() => act("submit")}>
                Send for dispatch check
              </button>
            )}
            {mayWrite && canReopen(list.status) && (
              <button type="button" className={btnGhost} disabled={busy} onClick={() => act("reopen")}>Reopen</button>
            )}
            {mayWrite && canFinalise(list.status) && (
              <button type="button" className={btn} disabled={busy} onClick={() => act("finalise")}>Finalise</button>
            )}
            {mayWrite && canDispatch(list.status) && (
              <button type="button" className={btn} disabled={busy} onClick={() => act("dispatch")}>Mark dispatched</button>
            )}
            {mayVerify && (list.status === "SUBMITTED" || canRecheck(list.status)) && (
              <Link href={`/office/commercial/dispatch-check/${plId}`} className={btnGhost}>Open the check</Link>
            )}
          </div>
        </div>
        {list.verificationNote && (
          <div className={`mt-3 rounded-xl border px-4 py-3 text-sm ${list.status === "REJECTED" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-800"}`}>
            {list.verificationNote}
          </div>
        )}
        {canRecheck(list.status) && (counts.unfit > 0 || counts.pending > 0) && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {counts.unfit > 0
              ? `${counts.unfit} slab(s) refused by the dispatch check — nothing ships until each is swapped for a slab of the same design and thickness (Swap beside the slab).`
              : `${counts.pending} swapped-in slab(s) await the dispatch check — nothing ships until they are marked fit.`}
          </div>
        )}
        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {note && <div className="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{note}</div>}
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Slabs" value={list.slabs.length} />
        <Kpi label="Packages" value={list.crates.length} sub={list.packagesSummary ?? autoPackages ?? undefined} />
        <Kpi label="Sqm" value={sheet.totals.sqm.toFixed(4)} sub={`${sheet.totals.sqft.toFixed(3)} sqft`} />
        <Kpi label="Unassigned" value={list.slabs.filter((s) => !s.crateId).length} sub="not in a crate" />
        <Kpi label="Checked" value={`${counts.fit}/${counts.total}`} sub={counts.unfit ? `${counts.unfit} unfit` : counts.pending ? `${counts.pending} pending` : "all fit"} />
      </div>

      {/* stuffing header */}
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Container &amp; weights</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["containerNo", "Container No."], ["sealNo", "E-Seal No."], ["linerOtlNo", "Liner's OTL No."], ["vehicleNo", "Vehicle No."],
          ] as const).map(([k, l]) => (
            <div key={k}>
              <label className={label} htmlFor={`h-${k}`}>{l}</label>
              <input id={`h-${k}`} className={inp} value={header[k] ?? ""} disabled={!headerEditable}
                onChange={(e) => setHeader((h) => ({ ...h, [k]: e.target.value }))} />
            </div>
          ))}
          <div>
            <label className={label} htmlFor="h-gross">Gross weight (kg)</label>
            <input id="h-gross" className={inp} inputMode="decimal" value={header.grossWeightKg ?? ""} disabled={!headerEditable}
              onChange={(e) => setHeader((h) => ({ ...h, grossWeightKg: e.target.value }))} />
          </div>
          <div>
            <label className={label} htmlFor="h-net">Net weight (kg)</label>
            <input id="h-net" className={inp} inputMode="decimal" value={header.netWeightKg ?? ""} disabled={!headerEditable}
              onChange={(e) => setHeader((h) => ({ ...h, netWeightKg: e.target.value }))} />
          </div>
          <div className="lg:col-span-2">
            <label className={label} htmlFor="h-pkg">Packages</label>
            <input id="h-pkg" className={inp} value={header.packagesSummary ?? ""} disabled={!headerEditable}
              placeholder={autoPackages || "07 Wooden Crate(S) + 08 Sample Box"}
              onChange={(e) => setHeader((h) => ({ ...h, packagesSummary: e.target.value }))} />
            <p className="mt-1 text-xs text-gray-400">Left blank it is written from the crates: {autoPackages || "no crates yet"}.</p>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label className={label} htmlFor="h-notes">Notes</label>
            <input id="h-notes" className={inp} value={header.notes ?? ""} disabled={!headerEditable}
              onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))} />
          </div>
        </div>
        {headerEditable && (
          <div className="mt-3">
            <button type="button" className={btn} disabled={busy} onClick={saveHeader}>Save header</button>
          </div>
        )}
      </Card>

      {/* crates */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Crates · {list.crates.length}</h2>
          {editable && (
            <div className="flex gap-2">
              {CRATE_KINDS.map((k) => (
                <button key={k} type="button" className={btnGhost} disabled={busy} onClick={() => addCrate(k)}>+ {k}</button>
              ))}
            </div>
          )}
        </div>
        {list.crates.length === 0 ? <Empty>No crate yet. Slabs can sit unassigned until you make one.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-2">No.</th>
                  <th className="py-2 pr-2">Kind</th>
                  <th className="py-2 pr-2 text-right">Slabs</th>
                  <th className="py-2 pr-2">Gross kg</th>
                  <th className="py-2 pr-2">Net kg</th>
                  <th className="py-2 pr-2">L cm</th>
                  <th className="py-2 pr-2">W cm</th>
                  <th className="py-2 pr-2">H cm</th>
                  <th className="py-2 pr-2">Remarks</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.crates.map((c) => {
                  const inCrate = list.slabs.filter((s) => s.crateId === c.id).length;
                  return (
                    <tr key={c.id}>
                      <td className="py-1.5 pr-2 w-14"><Cell value={String(c.crateNo)} disabled={!editable} onCommit={(v) => patchCrate(c.id, { crateNo: v })} /></td>
                      <td className="py-1.5 pr-2">
                        <select className={cell} value={c.kind} disabled={!editable} onChange={(e) => patchCrate(c.id, { kind: e.target.value })}>
                          {[...CRATE_KINDS, ...(CRATE_KINDS.includes(c.kind) ? [] : [c.kind])].map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2 text-right text-gray-600">{inCrate}</td>
                      <td className="py-1.5 pr-2 w-20"><Cell value={n3(c.grossKg)} disabled={!editable} onCommit={(v) => patchCrate(c.id, { grossKg: v === "" ? null : v })} /></td>
                      <td className="py-1.5 pr-2 w-20"><Cell value={n3(c.netKg)} disabled={!editable} onCommit={(v) => patchCrate(c.id, { netKg: v === "" ? null : v })} /></td>
                      <td className="py-1.5 pr-2 w-16"><Cell value={n3(c.lengthCm)} disabled={!editable} onCommit={(v) => patchCrate(c.id, { lengthCm: v === "" ? null : v })} /></td>
                      <td className="py-1.5 pr-2 w-16"><Cell value={n3(c.widthCm)} disabled={!editable} onCommit={(v) => patchCrate(c.id, { widthCm: v === "" ? null : v })} /></td>
                      <td className="py-1.5 pr-2 w-16"><Cell value={n3(c.heightCm)} disabled={!editable} onCommit={(v) => patchCrate(c.id, { heightCm: v === "" ? null : v })} /></td>
                      <td className="py-1.5 pr-2"><Cell value={c.remarks ?? ""} disabled={!editable} onCommit={(v) => patchCrate(c.id, { remarks: v })} /></td>
                      <td className="py-1.5 text-right">
                        {editable && <button type="button" className={btnDanger} disabled={busy} onClick={() => removeCrate(c.id)}>Remove</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {groups.length > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            Sheet lines: {groups.map((g) => `${g.description} ${g.thickness} — ${g.slabs} slab(s), ${g.sqm.toFixed(4)} sqm`).join(" · ")}
          </p>
        )}
      </Card>

      {/* slabs */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Slabs · {list.slabs.length}</h2>
            <div className="flex items-center gap-1 text-xs text-gray-500" role="group" aria-label="Unit for slab sizes">
              <span>Sizes in</span>
              {MEASUREMENT_UNITS.map((u) => (
                <button key={u} type="button"
                  className={`rounded-md border px-2 py-0.5 text-xs font-medium transition ${unit === u ? "border-brand bg-brand/10 text-brand" : "border-gray-300 text-gray-600 hover:bg-gray-50"} disabled:opacity-60`}
                  disabled={!editable || busy || unit === u} aria-pressed={unit === u}
                  title={editable ? "" : "The unit can only be switched while the list is with Commercial"}
                  onClick={() => setUnit(u)}>{u}</button>
              ))}
            </div>
          </div>
          {editable && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2">
              <span className="text-sm text-gray-700">{selected.size} selected</span>
              <select className={inp} style={{ width: "auto" }} value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Crate to assign to">
                <option value="">Pick a crate…</option>
                {list.crates.map((c) => <option key={c.id} value={c.id}>Crate {c.crateNo} · {c.kind}</option>)}
              </select>
              <button type="button" className={btn} disabled={busy || !assignTo} onClick={() => bulkAssign(assignTo)}>Assign</button>
              <button type="button" className={btnGhost} disabled={busy} onClick={() => bulkAssign(null)}>Unassign</button>
              <button type="button" className={btnGhost} onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
        </div>

        {list.slabs.length === 0 ? <Empty>No slab on this list.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  {editable && <th className="py-2 pr-2 w-8" />}
                  <th className="py-2 pr-2">Slab</th>
                  <th className="py-2 pr-2">Design / SKU</th>
                  <th className="py-2 pr-2">Batch</th>
                  <th className="py-2 pr-2">Thick</th>
                  <th className="py-2 pr-2">Crate</th>
                  <th className="py-2 pr-2">Cust. slab no</th>
                  <th className="py-2 pr-2">Cust. batch</th>
                  <th className="py-2 pr-2">L {unit}</th>
                  <th className="py-2 pr-2">W {unit}</th>
                  <th className="py-2 pr-2 text-right">Sqm</th>
                  <th className="py-2 pr-2">Check</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.slabs.map((s) => (
                  <React.Fragment key={s.id}>
                  <tr className={s.fit === "UNFIT" ? "bg-red-50/50" : undefined}>
                    {editable && (
                      <td className="py-1.5 pr-2">
                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand/30"
                          checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select slab ${s.slabNumber}`} />
                      </td>
                    )}
                    <td className="py-1.5 pr-2 font-medium text-gray-900">{s.slabNumber}</td>
                    <td className="py-1.5 pr-2 text-gray-700">{s.customerSku || s.design || "—"}</td>
                    <td className="py-1.5 pr-2 text-gray-500">{s.batchNumber ?? s.batchKey ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-gray-500">{s.thickness ?? "—"}</td>
                    <td className="py-1.5 pr-2">
                      <select className={cell} value={s.crateId ?? ""} disabled={!editable} onChange={(e) => patchSlab(s.id, { crateId: e.target.value || null })}>
                        <option value="">—</option>
                        {list.crates.map((c) => <option key={c.id} value={c.id}>{c.crateNo}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2 w-28"><Cell value={s.customerSlabNo ?? ""} disabled={!editable} onCommit={(v) => patchSlab(s.id, { customerSlabNo: v })} /></td>
                    <td className="py-1.5 pr-2 w-28"><Cell value={s.customerBatchNo ?? ""} disabled={!editable} onCommit={(v) => patchSlab(s.id, { customerBatchNo: v })} /></td>
                    <td className="py-1.5 pr-2 w-16"><Cell value={inUnit(s.lengthCm)} disabled={!editable} onCommit={(v) => commitSize(s.id, "lengthCm", v)} /></td>
                    <td className="py-1.5 pr-2 w-16"><Cell value={inUnit(s.widthCm)} disabled={!editable} onCommit={(v) => commitSize(s.id, "widthCm", v)} /></td>
                    <td className="py-1.5 pr-2 text-right text-gray-600">{s.sqm != null ? s.sqm.toFixed(4) : "—"}</td>
                    <td className="py-1.5 pr-2">
                      <Badge tone={FIT_TONE[s.fit] ?? "brand"}>{s.fit === "PENDING" ? "—" : s.fit}</Badge>
                      {s.unfitReason && <span className="ml-1 text-xs text-red-600">{s.unfitReason}</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      {editable && <button type="button" className={btnDanger} disabled={busy} onClick={() => removeSlab(s.id)}>Remove</button>}
                      {maySwap && s.fit === "UNFIT" && (
                        <button type="button" className={btnGhost} disabled={busy} onClick={() => setSwapping(swapping === s.id ? null : s.id)}>Swap</button>
                      )}
                    </td>
                  </tr>
                  {swapping === s.id && maySwap && (
                    <tr>
                      <td colSpan={editable ? 13 : 12} className="pb-3">
                        <SwapSlabPicker plId={plId} slabId={s.id}
                          onCancel={() => setSwapping(null)}
                          onDone={async (msg) => { setSwapping(null); setError(null); setNote(msg); await load(); }} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editable && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Add slabs</h3>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
              <div>
                <label className={label} htmlFor="add-numbers">By number</label>
                <textarea id="add-numbers" className={inp} rows={2} value={addText}
                  onChange={(e) => { setAddText(e.target.value); if (e.target.value) setAddHold(""); }}
                  placeholder="150903, 150904 150905-150910" />
                <p className="mt-1 text-xs text-gray-400">{parsedAdd.length} slab(s) recognised.</p>
              </div>
              <div>
                <label className={label} htmlFor="add-hold">…or from a hold</label>
                <select id="add-hold" className={inp} value={addHold} onChange={(e) => { setAddHold(e.target.value); if (e.target.value) setAddText(""); }}>
                  <option value="">—</option>
                  {holds.map((h) => (
                    <option key={h.id} value={h.id}>{h.reference} · {h.slabs.filter((s) => !s.releasedAt && !s.packedAt).length} slab(s)</option>
                  ))}
                </select>
              </div>
              <button type="button" className={btn} disabled={busy || (!addHold && !parsedAdd.length)} onClick={addSlabs}>Add</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
