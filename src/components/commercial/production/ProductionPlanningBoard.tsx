"use client";
// The Production Planning queue.
//
// A shortfall lands HERE first (answer 13: Varun is told by private Telegram
// and mail, once the credentials exist). This screen shows, in the order the
// plant should run them, what Commercial is short of, for whose order, how
// short, how long it has been waiting — and, since answer 13, the PLAN: the
// shade of each design, the slabs and hours planned, and the cleaning hours the
// changeover before it costs (3, or 6 when a light design follows a dark one).
// A light row straight after a dark one is flagged; the owner wants the
// sequence to drift slowly from light to dark and back.
//
// Planned slabs / hours / cleaning hours are edited in place by a login with
// `plan`. A reduction is never simply gone: it appears on the "Planned but not
// scheduled" panel until the planner adds it back or removes it. Anyone who
// may write can type the cleaning note and the planned batch, and can delete a
// request the plant has not started (answer 15).
//
// Reordering is drag-and-drop with ▲▼ beside it: the planner may be on a
// tablet, where a drag across a scrolling list is unreliable. Both send the
// same thing — the FULL ordered list of ids — so the server never has to guess
// what moved.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Card, Empty, H2, Kpi, fmt } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { patchJson, postJson, deleteJson } from "@/lib/fab/postJson";
import {
  moveInList, reorderOnDrop, nextStatusButtons, canChangeStatus, canEditNotes, canEditPlan, canDeleteRequest,
  abruptJumps, figureLabel, label as statusLabel, OPEN_STATUSES, type PlanFigureField,
} from "@/lib/commercial/production-rules";
import { ShadeChip } from "@/components/commercial/production/ShadeChip";
import type { PlanChangeDto } from "@/lib/commercial/types";

const DRAG_TYPE = "application/x-commercial-production-request";

const btn = "rounded-lg border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-700 transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";
const btnDanger = "rounded-lg border border-red-300 px-2.5 py-1 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40";
const input = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none";
const figureInput = "w-20 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm focus:border-brand focus:outline-none";

const TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  QUEUED: "amber", SCHEDULED: "brand", IN_PRODUCTION: "brand", PRODUCED: "green", CANCELLED: "red",
};

interface QueueRow {
  id: string;
  design: string;
  thickness: string;
  finish: string | null;
  qtyRequired: number;
  qtyAvailable: number;
  qtyShort: number;
  priority: number;
  status: string;
  cleaningNote: string | null;
  plannedBatch: string | null;
  notes: string | null;
  raisedByName: string | null;
  raisedAt: string;
  scheduledAt: string | null;
  startedAt: string | null;
  producedAt: string | null;
  cancelledAt: string | null;
  producedBatchKeys: string[];
  notifiedVia: string | null;
  plannedSlabs: number | null;
  plannedHours: number | null;
  cleaningHours: number | null;
  shade: string | null;
  changes: PlanChangeDto[];
  order: { id: string; number: string; status: string; client: { id: string; name: string } | null } | null;
}

interface ListReply { items: QueueRow[]; total: number; page: number; limit: number }

// What a recompute reports back (production-requests/_lib): an abrupt DARK →
// LIGHT changeover, or a hand-set cleaning figure the rule was NOT applied to
// because its reduction is still open on the panel below.
type Warning =
  | { kind: "abrupt"; id: string; afterId: string; design: string; afterDesign: string; message: string }
  | { kind: "held"; id: string; design: string; kept: number | null; rule: number; message: string };

/** One OPEN plan change as /production-requests/changes returns it: the row
 *  plus its request, so the panel can name a design whose request is not on
 *  the page the queue happened to load. */
interface OpenChange extends PlanChangeDto {
  request: {
    id: string; design: string; thickness: string; status: string;
    order: { id: string; number: string; status: string; client: { id: string; name: string } | null } | null;
  } | null;
}

type Draft = { cleaningNote: string; plannedBatch: string; plannedSlabs: string; plannedHours: string; cleaningHours: string };
const draftOf = (r: QueueRow): Draft => ({
  cleaningNote: r.cleaningNote ?? "", plannedBatch: r.plannedBatch ?? "",
  plannedSlabs: r.plannedSlabs == null ? "" : String(r.plannedSlabs),
  plannedHours: r.plannedHours == null ? "" : String(r.plannedHours),
  cleaningHours: r.cleaningHours == null ? "" : String(r.cleaningHours),
});

function ageDays(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

const fig = (v: number | null | undefined, digits = 1) => (v == null ? "—" : fmt(v, digits));

export function ProductionPlanningBoard({ actions }: { actions: string[] }) {
  const mayPlan = canChangeStatus(actions);
  const mayEditPlan = canEditPlan(actions);
  const mayWrite = canEditNotes(actions);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [history, setHistory] = useState<QueueRow[]>([]);
  const [order, setOrder] = useState<string[]>([]);          // the ids in screen order
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [received, setReceived] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [serverWarnings, setServerWarnings] = useState<Warning[]>([]);
  const [openChanges, setOpenChanges] = useState<OpenChange[]>([]);
  const [openTotal, setOpenTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    // The open reductions come from their OWN endpoint, not from the changes
    // riding on the loaded rows: the queue is paged (200) and the history is
    // the last 30, so a cut on a request outside those windows used to vanish
    // from the panel — and answer 13 says a reduction is never simply gone.
    const [qr, hr, cr] = await Promise.all([
      fetch(`/api/office/commercial/production-requests?status=${OPEN_STATUSES.join(",")}&limit=200`, { cache: "no-store" }),
      fetch("/api/office/commercial/production-requests?status=PRODUCED,CANCELLED&limit=30", { cache: "no-store" }),
      fetch("/api/office/commercial/production-requests/changes?status=OPEN&limit=200", { cache: "no-store" }),
    ]);
    const queue = await readJson<ListReply>(qr);
    const hist = await readJson<ListReply>(hr);
    const cuts = await readJson<{ items: OpenChange[]; total: number }>(cr);
    setLoading(false);
    if (cuts.ok && cuts.data) { setOpenChanges(cuts.data.items); setOpenTotal(cuts.data.total); }
    if (!queue.ok || !queue.data) { setError(queue.error ?? "Could not read the queue"); return; }
    setError(null);
    setRows(queue.data.items);
    setOrder(queue.data.items.map((r) => r.id));
    setDrafts(Object.fromEntries(queue.data.items.map((r) => [r.id, draftOf(r)])));
    if (hist.ok && hist.data) setHistory(hist.data.items);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The "has production run?" hint, one call per queued row after the list is
  // in. Deliberately separate: it reads finished goods and must never hold the
  // queue itself up.
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const r of rows) {
        if (seen.current.has(r.id)) continue;
        seen.current.add(r.id);
        const res = await fetch(`/api/office/commercial/production-requests/${r.id}/suggest`, { cache: "no-store" });
        const j = await readJson<{ received: number }>(res);
        if (!alive) return;
        if (j.ok && j.data) setReceived((m) => ({ ...m, [r.id]: j.data!.received }));
      }
    })();
    return () => { alive = false; };
  }, [rows]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const ordered = useMemo(() => order.map((id) => byId.get(id)).filter((r): r is QueueRow => !!r), [order, byId]);

  // The abrupt jumps as the screen currently shows the queue — screen position
  // stands in for priority so an optimistic reorder is judged before the
  // server answers.
  const jumps = useMemo(() => {
    const set = new Set<string>();
    for (const j of abruptJumps(ordered.map((r, i) => ({ ...r, priority: i + 1 })))) set.add(j.id);
    return set;
  }, [ordered]);

  async function commitOrder(ids: string[]) {
    setOrder(ids);                       // optimistic: the list must not jump under the cursor
    setBusy("reorder"); setError(null); setNote(null);
    const r = await patchJson("/api/office/commercial/production-requests/reorder", { ids });
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Could not save the new order"); void load(); return; }
    const warnings = (r.data?.warnings ?? []) as Warning[];
    setServerWarnings(warnings);
    setNote(`Queue re-ordered — ${r.data?.updated ?? ids.length} request(s) renumbered`
      + (r.data?.recomputed ? `, cleaning hours changed on ${r.data.recomputed}` : "")
      + (() => {
        const abrupt = warnings.filter((w) => w.kind === "abrupt").length;
        const held = warnings.filter((w) => w.kind === "held").length;
        return (abrupt ? `; ${abrupt} abrupt dark → light changeover(s)` : "")
          + (held ? `; ${held} hand-set cleaning figure(s) kept` : "");
      })() + ".");
    if (Array.isArray(r.data?.items)) {
      const items = r.data.items as QueueRow[];
      setRows(items);
      setOrder(items.map((x) => x.id));
      setDrafts(Object.fromEntries(items.map((x) => [x.id, draftOf(x)])));
    }
  }

  async function patchRow(id: string, body: Record<string, unknown>, said: string) {
    setBusy(id); setError(null); setNote(null);
    const r = await patchJson(`/api/office/commercial/production-requests/${id}`, body);
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Could not save"); void load(); return; }
    const w = (r.data?.warnings ?? []) as Warning[];
    if (w.length) setServerWarnings(w);
    setNote(said + (r.data?.changesWritten ? ` ${r.data.changesWritten} plan change(s) logged.` : ""));
    await load();
  }

  async function saveFigure(r: QueueRow, field: PlanFigureField, raw: string) {
    const current = r[field];
    const typed = raw.trim();
    const same = (typed === "" && current == null) || (typed !== "" && current != null && Number(typed) === Number(current));
    if (same) return;
    await patchRow(r.id, { [field]: typed === "" ? null : typed }, `${figureLabel(field)} for ${r.design}: ${fig(current)} → ${typed || "—"}.`);
  }

  async function resolveChange(rowId: string, changeId: string, action: "addBack" | "remove", said: string) {
    setBusy(changeId); setError(null); setNote(null);
    const r = await postJson(`/api/office/commercial/production-requests/${rowId}/changes/${changeId}`, { action });
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Could not resolve"); return; }
    setNote(said);
    await load();
  }

  async function remove(r: QueueRow) {
    const ok = window.confirm(`Delete the production request for ${r.qtyShort} slab(s) of ${r.design} ${r.thickness}${r.order ? ` (${r.order.number})` : ""}?\n\nThe order's log keeps the fact; the queue forgets the request.`);
    if (!ok) return;
    setBusy(r.id); setError(null); setNote(null);
    const res = await deleteJson(`/api/office/commercial/production-requests/${r.id}`);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "Could not delete"); return; }
    setNote(`Request for ${r.design} ${r.thickness} deleted.`);
    await load();
  }

  // The routes return both kinds in one array (AbruptWarning | HeldWarning).
  const abruptWarnings = useMemo(() => serverWarnings.filter((w) => w.kind === "abrupt"), [serverWarnings]);
  const heldWarnings = useMemo(() => serverWarnings.filter((w) => w.kind === "held"), [serverWarnings]);

  const kpis = useMemo(() => ({
    queued: rows.filter((r) => r.status === "QUEUED").length,
    scheduled: rows.filter((r) => r.status === "SCHEDULED").length,
    running: rows.filter((r) => r.status === "IN_PRODUCTION").length,
    slabs: rows.reduce((n, r) => n + (r.plannedSlabs ?? r.qtyShort), 0),
    hours: rows.reduce((n, r) => n + (r.plannedHours ?? 0) + (r.cleaningHours ?? 0), 0),
  }), [rows]);

  if (loading && !rows.length) return <Empty>Loading the queue…</Empty>;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Queued" value={kpis.queued} />
        <Kpi label="Scheduled" value={kpis.scheduled} />
        <Kpi label="In production" value={kpis.running} />
        <Kpi label="Slabs planned" value={fmt(kpis.slabs)} sub="across every open request" />
        <Kpi label="Hours planned" value={fmt(kpis.hours, 1)} sub="run + cleaning, where set" />
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {note && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{note}</div>}
      {abruptWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="font-medium">Abrupt changeovers in this order</div>
          <ul className="mt-1 list-disc pl-5">{abruptWarnings.map((w) => <li key={w.id}>{w.message}</li>)}</ul>
        </div>
      )}
      {/* A different fact, and it must not read as a sequencing problem: the
          recompute left these cleaning hours alone because a planner set them
          by hand and the reduction is still open on the panel below. */}
      {heldWarnings.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <div className="font-medium">Cleaning hours kept as the planner set them</div>
          <ul className="mt-1 list-disc pl-5">{heldWarnings.map((w) => <li key={w.id}>{w.message}</li>)}</ul>
        </div>
      )}
      {!mayPlan && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          You can read the queue{mayWrite ? ", type cleaning notes and planned batches, and delete a request the plant has not started" : ""}.
          Re-ordering, scheduling, the planned figures and marking produced belong to production planning.
        </div>
      )}

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <H2>The queue — lowest number runs first</H2>
          <button type="button" className={`${btn} ml-auto`} onClick={() => void load()}>Refresh</button>
        </div>

        {ordered.length === 0 ? (
          <Empty>Nothing is waiting on production.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {ordered.map((r, i) => {
              const d = drafts[r.id] ?? draftOf(r);
              const hint = received[r.id];
              const abrupt = jumps.has(r.id);
              const inChain = r.status === "QUEUED" || r.status === "SCHEDULED";
              const del = canDeleteRequest(r.status, actions);
              return (
                <li
                  key={r.id}
                  draggable={mayPlan && !busy}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, r.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(r.id);
                  }}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  onDragOver={(e) => { if (!mayPlan || !dragId) return; e.preventDefault(); setOverId(r.id); }}
                  onDragLeave={() => setOverId((o) => (o === r.id ? null : o))}
                  onDrop={(e) => {
                    if (!mayPlan) return;
                    e.preventDefault();
                    const id = e.dataTransfer.getData(DRAG_TYPE) || dragId;
                    setDragId(null); setOverId(null);
                    if (!id || id === r.id) return;
                    void commitOrder(reorderOnDrop(order, id, r.id));
                  }}
                  className={`rounded-xl border bg-white p-3 ${overId === r.id ? "border-brand ring-2 ring-brand/20" : abrupt ? "border-amber-300" : "border-gray-200"} ${dragId === r.id ? "opacity-50" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">{i + 1}</span>
                    <div className="min-w-[180px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{r.design}</span>
                        <ShadeChip shade={r.shade} />
                      </div>
                      <div className="text-xs text-gray-500">{r.thickness}{r.finish ? ` · ${r.finish}` : ""}</div>
                    </div>
                    <div className="min-w-[110px] text-sm">
                      <div><span className="font-semibold text-gray-900">{fmt(r.qtyShort)}</span> slab(s) short</div>
                      <div className="text-xs text-gray-500">needed {fmt(r.qtyRequired)} · had {fmt(r.qtyAvailable)}</div>
                    </div>
                    <div className="min-w-[150px] text-sm">
                      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Plan</div>
                      <div className="text-gray-800">
                        {fig(r.plannedSlabs, 0)} slabs · {fig(r.plannedHours)} h
                        <span className={`ml-1 ${abrupt ? "font-semibold text-amber-700" : "text-gray-500"}`}>+ {fig(r.cleaningHours)} h clean</span>
                      </div>
                    </div>
                    <div className="min-w-[180px] text-sm">
                      {r.order ? (
                        <Link href={`/office/commercial/orders/${r.order.id}?tab=stock`} className="font-medium text-brand hover:underline">{r.order.number}</Link>
                      ) : <span className="text-gray-400">no order</span>}
                      <div className="text-xs text-gray-500">{r.order?.client?.name ?? "—"}</div>
                    </div>
                    <div className="min-w-[130px] text-xs text-gray-500">
                      raised {new Date(r.raisedAt).toLocaleDateString("en-IN")}
                      <div>{ageDays(r.raisedAt)} day(s) ago · {r.raisedByName ?? "—"}</div>
                    </div>
                    <Badge tone={TONE[r.status] ?? "brand"}>{statusLabel(r.status)}</Badge>
                    {hint !== undefined && (
                      <Badge tone={hint >= r.qtyShort ? "green" : hint > 0 ? "amber" : "brand"}>
                        {hint} received since
                      </Badge>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      {mayPlan && (
                        <>
                          <button type="button" className={btn} disabled={i === 0 || !!busy} aria-label="Move up"
                            onClick={() => void commitOrder(moveInList(order, i, -1))}>▲</button>
                          <button type="button" className={btn} disabled={i === ordered.length - 1 || !!busy} aria-label="Move down"
                            onClick={() => void commitOrder(moveInList(order, i, 1))}>▼</button>
                        </>
                      )}
                      {/* Answer 15's rule EXPLAINS itself rather than hiding.
                          A missing Delete reads as "this screen cannot delete
                          at all" and sends Commercial hunting for a control
                          that is simply not theirs on this row; disabled with
                          canDeleteRequest's own words says which row and why —
                          the same way the order stage strip refuses a step. */}
                      <button
                        type="button" className={btnDanger}
                        disabled={!del.ok || busy === r.id}
                        title={del.ok ? "Delete this request (answer 15)" : del.reason}
                        aria-label={del.ok ? `Delete the request for ${r.design} ${r.thickness}` : del.reason}
                        onClick={() => void remove(r)}
                      >Delete</button>
                    </span>
                  </div>

                  {abrupt && inChain && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
                      Abrupt changeover: a light design straight after a dark one — {fig(r.cleaningHours)} h of cleaning. Move a medium design between them to run the ordinary clean.
                    </div>
                  )}

                  {(r.notes || r.notifiedVia) && (
                    <div className="mt-2 text-xs text-gray-500">
                      {r.notes}
                      {r.notifiedVia && <span className="ml-2 text-gray-400">· told via {r.notifiedVia}</span>}
                    </div>
                  )}

                  {(mayWrite || mayEditPlan) ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
                      {mayEditPlan && (
                        <>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Planned slabs</span>
                            <input className={figureInput} type="number" min={0} step={1} value={d.plannedSlabs}
                              onChange={(e) => setDrafts((m) => ({ ...m, [r.id]: { ...d, plannedSlabs: e.target.value } }))}
                              onBlur={() => void saveFigure(r, "plannedSlabs", d.plannedSlabs)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Planned hours</span>
                            <input className={figureInput} type="number" min={0} step={0.5} value={d.plannedHours}
                              onChange={(e) => setDrafts((m) => ({ ...m, [r.id]: { ...d, plannedHours: e.target.value } }))}
                              onBlur={() => void saveFigure(r, "plannedHours", d.plannedHours)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Cleaning h</span>
                            <input className={figureInput} type="number" min={0} step={0.5} value={d.cleaningHours} title="Re-derived from the row before it whenever the queue is re-ordered"
                              onChange={(e) => setDrafts((m) => ({ ...m, [r.id]: { ...d, cleaningHours: e.target.value } }))}
                              onBlur={() => void saveFigure(r, "cleaningHours", d.cleaningHours)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                          </label>
                        </>
                      )}
                      <label className="flex flex-1 flex-col gap-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Cleaning note</span>
                        <input
                          className={`${input} w-full`} value={d.cleaningNote}
                          placeholder="After Midnight Black — long flush, two idle passes"
                          onChange={(e) => setDrafts((m) => ({ ...m, [r.id]: { ...d, cleaningNote: e.target.value } }))}
                          onBlur={() => { if ((r.cleaningNote ?? "") !== d.cleaningNote) void patchRow(r.id, { cleaningNote: d.cleaningNote }, "Cleaning note saved."); }}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Planned batch</span>
                        <input
                          className={`${input} w-40`} value={d.plannedBatch} placeholder="B-2609"
                          onChange={(e) => setDrafts((m) => ({ ...m, [r.id]: { ...d, plannedBatch: e.target.value } }))}
                          onBlur={() => { if ((r.plannedBatch ?? "") !== d.plannedBatch) void patchRow(r.id, { plannedBatch: d.plannedBatch }, "Planned batch saved."); }}
                        />
                      </label>
                      {mayPlan && (
                        <span className="flex flex-wrap items-center gap-1">
                          {nextStatusButtons(r.status).map((b) => (
                            <button key={b.to} type="button" className={btn} disabled={busy === r.id}
                              onClick={() => void patchRow(r.id, { status: b.to }, `${r.design} ${r.thickness} → ${statusLabel(b.to)}.`)}>
                              {b.label}
                            </button>
                          ))}
                        </span>
                      )}
                    </div>
                  ) : (
                    (r.cleaningNote || r.plannedBatch) && (
                      <div className="mt-2 flex flex-wrap gap-4 border-t border-gray-100 pt-2 text-xs text-gray-500">
                        {r.cleaningNote && <span>Cleaning: {r.cleaningNote}</span>}
                        {r.plannedBatch && <span>Planned batch: {r.plannedBatch}</span>}
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <H2>Planned but not scheduled</H2>
          <span className="text-xs text-gray-400">
            what was taken off a plan and not yet answered
            {openTotal > openChanges.length ? ` · showing ${openChanges.length} of ${openTotal}` : ""}
          </span>
        </div>
        {openChanges.length === 0 ? (
          <Empty>Nothing has been cut from a plan without an answer.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2 py-2 text-left">Design</th>
                  <th className="px-2 py-2 text-left">Order</th>
                  <th className="px-2 py-2 text-left">Figure</th>
                  <th className="px-2 py-2 text-right">Was</th>
                  <th className="px-2 py-2 text-right">Now</th>
                  <th className="px-2 py-2 text-right">Cut</th>
                  <th className="px-2 py-2 text-left">By</th>
                  <th className="px-2 py-2 text-left">Reason</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {openChanges.map((c) => (
                  <tr key={c.id}>
                    <td className="px-2 py-2 font-medium text-gray-900">{c.request?.design ?? "—"} <span className="text-gray-500">{c.request?.thickness ?? ""}</span></td>
                    <td className="px-2 py-2">
                      {c.request?.order ? <Link href={`/office/commercial/orders/${c.request.order.id}?tab=stock`} className="text-brand hover:underline">{c.request.order.number}</Link> : "—"}
                    </td>
                    <td className="px-2 py-2">{figureLabel(c.field)}</td>
                    <td className="px-2 py-2 text-right">{fig(c.fromValue)}</td>
                    <td className="px-2 py-2 text-right">{fig(c.toValue)}</td>
                    <td className="px-2 py-2 text-right font-semibold text-red-700">{fmt(c.delta, 1)}</td>
                    <td className="px-2 py-2 text-xs text-gray-500">{c.changedByName ?? "—"} · {new Date(c.changedAt).toLocaleDateString("en-IN")}</td>
                    <td className="px-2 py-2 text-xs text-gray-500">{c.reason ?? "—"}</td>
                    <td className="px-2 py-2 text-right">
                      {mayPlan ? (
                        <span className="flex justify-end gap-1">
                          <button type="button" className={btn} disabled={busy === c.id}
                            onClick={() => void resolveChange(c.requestId, c.id, "addBack", `${figureLabel(c.field)} for ${c.request?.design ?? "the request"} back to ${fig(c.fromValue)}.`)}>Add back</button>
                          <button type="button" className={btnDanger} disabled={busy === c.id}
                            onClick={() => void resolveChange(c.requestId, c.id, "remove", `${figureLabel(c.field)} cut for ${c.request?.design ?? "the request"} confirmed removed.`)}>Remove</button>
                        </span>
                      ) : <span className="text-xs text-gray-400">planning decides</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <H2>Last 30 produced or cancelled</H2>
        {history.length === 0 ? (
          <Empty>Nothing has been produced or cancelled yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2 py-2 text-left">Design</th>
                  <th className="px-2 py-2 text-left">Thickness</th>
                  <th className="px-2 py-2 text-right">Short</th>
                  <th className="px-2 py-2 text-right">Planned</th>
                  <th className="px-2 py-2 text-left">Order</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left">Ended</th>
                  <th className="px-2 py-2 text-left">Batches</th>
                  {mayPlan && <th className="px-2 py-2"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-2 font-medium text-gray-900">{r.design} <ShadeChip shade={r.shade} /></td>
                    <td className="px-2 py-2">{r.thickness}</td>
                    <td className="px-2 py-2 text-right">{fmt(r.qtyShort)}</td>
                    <td className="px-2 py-2 text-right text-gray-500">{fig(r.plannedSlabs, 0)}</td>
                    <td className="px-2 py-2">
                      {r.order ? <Link href={`/office/commercial/orders/${r.order.id}?tab=stock`} className="text-brand hover:underline">{r.order.number}</Link> : "—"}
                    </td>
                    <td className="px-2 py-2"><Badge tone={TONE[r.status] ?? "brand"}>{statusLabel(r.status)}</Badge></td>
                    <td className="px-2 py-2 text-gray-500">
                      {r.producedAt ? new Date(r.producedAt).toLocaleDateString("en-IN")
                        : r.cancelledAt ? new Date(r.cancelledAt).toLocaleDateString("en-IN") : "—"}
                    </td>
                    <td className="px-2 py-2 text-gray-500">{r.producedBatchKeys?.length ? r.producedBatchKeys.join(", ") : "—"}</td>
                    {mayPlan && (
                      <td className="px-2 py-2 text-right">
                        <button type="button" className={btnDanger} disabled={busy === r.id} onClick={() => void remove(r)}>Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
