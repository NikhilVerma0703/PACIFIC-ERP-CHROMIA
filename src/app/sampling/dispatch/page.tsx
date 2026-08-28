"use client";

// DISPATCH — build a package, then walk it Released -> Dispatched -> Delivered.
//
// ─────────────────────────────────────────────────────── WHAT "RELEASE" MEANS ───
// The button on the builder says "Release to package", not "Save", because that
// is the moment the pieces come off the shelf: released means they have been
// physically pulled and put in the box, and a count that still showed them would
// promise the same piece to two customers. So the stock decrement, and the
// only refusal that can stop a package, both belong to this first step. There is
// no IN_STOCK status to leave — a dispatch that has not been released does not
// exist (lib/sampling/lifecycle.ts).
//
// A RELEASE THAT WOULD TAKE STOCK BELOW ZERO IS REFUSED, AND THE REFUSAL NAMES
// THE ITEM: "Cappuccino (Leather) 6 × 4 in · 20 mm: only 2 in stock, 5
// requested". planRelease() words it, this screen shows it before the button is
// pressed and the route re-runs the same function under a row lock — so the
// button cannot offer what the server will refuse, and the server's answer is
// never a surprise. ALL OR NOTHING: a package is packed as one thing, and
// releasing three of its four lines sends a box missing a sample nobody
// mentioned.
//
// ───────────────────────────────────────────────────────── THE THREE STAMPS ───
// Each transition shows its own time and the person who made it. That is the
// whole reason the lifecycle lives in three pairs of columns rather than in one
// status field that changes with nobody's name on it — so the board prints all
// three, filled in as they happen, and never shows a status without them.
//
// NO CANCEL AND NO UNDO, deliberately. An undo is not a missing button; it is an
// unanswered question about stock that was already pulled (does it go back on
// the shelf, and at what count?). When somebody wants one, that gets answered
// first and lifecycle.ts gets a new edge.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getJson, patchJson, postJson, type PostResult } from "@/lib/fab/postJson";
import { planRelease } from "@/lib/sampling/lifecycle";
import { sampleSizeLabel } from "@/lib/sampling/size";
import type { InventoryRow } from "@/lib/sampling/inventory";
import { useSamplingPickLists, type SizeOption } from "@/components/sampling/SampleIntakeForm";

/* -- Types ----------------------------------------------------------------- */

interface DispatchLine {
  id: string;
  colourFinishId: string;
  sizeId: string;
  quantity: number;
  colourName: string;
  finish: string;
  sizeLabel: string;
  label: string;
}
interface Dispatch {
  id: string;
  customerName: string;
  destination: string;
  reference: string | null;
  status: string;
  notes: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  dispatchedAt: string | null;
  dispatchedBy: string | null;
  deliveredAt: string | null;
  deliveredBy: string | null;
  pieces: number;
  lines: DispatchLine[];
}

/** A line on the package being built. `label` is how it names itself in a
 *  shortfall — the same words the route uses, because both build it the same
 *  way from the same three parts. */
interface DraftLine {
  colourFinishId: string;
  sizeId: string;
  quantity: number;
  label: string;
}

const STATUS_STYLE: Record<string, string> = {
  RELEASED: "bg-amber-100 text-amber-800",
  DISPATCHED: "bg-blue-100 text-blue-800",
  DELIVERED: "bg-green-100 text-green-800",
};

/** The step this package can take next, worded the way lifecycle.ts's
 *  TRANSITIONS names it. Null at the end of the line. */
function nextStep(status: string): { to: string; label: string } | null {
  if (status === "RELEASED") return { to: "DISPATCHED", label: "Mark dispatched" };
  if (status === "DISPATCHED") return { to: "DELIVERED", label: "Mark delivered" };
  return null;
}

function when(at: string | null): string {
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/* -- The screen ------------------------------------------------------------ */

export default function SamplingDispatchPage() {
  const { series, sizes, loading: loadingLists, error: listError } = useSamplingPickLists();

  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [stock, setStock] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, s] = await Promise.all([
      getJson<Dispatch>("/api/sampling/dispatch"),
      getJson<InventoryRow>("/api/sampling/inventory"),
    ]);
    setDispatches(d.data);
    setStock(s.data);
    // Either failure matters: without the stock the builder cannot say what is
    // on the shelf, and a builder that silently assumes zero would refuse
    // everything.
    setLoadError(d.error ?? s.error);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Every write: run it, report its own words on failure, then re-read. The
   *  counts on this screen are the reason another tablet's release matters, so
   *  after any write the only trustworthy numbers are the server's. */
  async function run(fn: () => Promise<PostResult>, success?: (res: PostResult) => string) {
    setBusy(true); setActionError(null); setNotice(null);
    const res = await fn();
    if (!res.ok) setActionError(res.error);
    else if (success) setNotice(success(res));
    setBusy(false);
    await load();
  }

  const onHand = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stock) {
      if (r.sizeId) m.set(`${r.colourFinishId}|${r.sizeId}`, Number(r.quantity));
    }
    return m;
  }, [stock]);

  return (
    <div className="max-w-5xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sample Dispatch</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Build a package, release it off the shelf, then follow it to the customer
          </p>
        </div>
        <button onClick={load} disabled={loading || busy}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition hover:border-gray-300 disabled:opacity-40">
          Refresh
        </button>
      </div>

      {(loadError || listError) && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>This board may be out of date.</b> {loadError ?? listError} Nothing below is confirmed.
        </div>
      )}
      {actionError && (
        <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span><b>Not saved.</b> {actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Dismiss"
            className="shrink-0 font-bold text-red-400 hover:text-red-700">✕</button>
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"
            className="shrink-0 font-bold text-green-400 hover:text-green-700">✕</button>
        </div>
      )}

      <ConsignmentBuilder
        series={series}
        sizes={sizes}
        onHand={onHand}
        busy={busy || loadingLists}
        onRelease={(payload) => run(
          () => postJson("/api/sampling/dispatch", payload),
          (res) => `Released ${res.data?.pieces ?? 0} piece${res.data?.pieces === 1 ? "" : "s"} to ${res.data?.customerName ?? "the customer"} — the stock is off the shelf. Mark it dispatched when it leaves.`,
        )}
      />

      <h2 className="mb-3 mt-8 text-sm font-bold text-slate-800">
        Packages <span className="font-normal text-slate-400">({dispatches.length})</span>
      </h2>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" />
          </svg>
          Loading…
        </div>
      ) : dispatches.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-14 text-center text-sm text-gray-400">
          No packages yet. Build one above — releasing it is what takes the pieces off the shelf.
        </div>
      ) : (
        <div className="space-y-3">
          {dispatches.map((d) => (
            <DispatchCard key={d.id} d={d} busy={busy}
              onAdvance={(to, label) => run(
                () => patchJson("/api/sampling/dispatch", { dispatchId: d.id, to }),
                () => `${d.customerName}'s package: ${label.toLowerCase()}.`,
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* -- Building one ---------------------------------------------------------- */

function ConsignmentBuilder({
  series, sizes, onHand, busy, onRelease,
}: {
  series: ReturnType<typeof useSamplingPickLists>["series"];
  sizes: SizeOption[];
  onHand: Map<string, number>;
  busy: boolean;
  onRelease: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [destination, setDestination] = useState("DOMESTIC");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);

  const [colourName, setColourName] = useState("");
  const [colourFinishId, setColourFinishId] = useState("");
  const [sizeId, setSizeId] = useState("");
  const [qty, setQty] = useState("");

  const colours = useMemo(() => series.flatMap((s) => s.colours), [series]);
  const colour = colours.find((c) => c.name === colourName) ?? null;
  useEffect(() => {
    if (!colour) { setColourFinishId(""); return; }
    setColourFinishId((cur) => (colour.finishes.some((f) => f.id === cur) ? cur : colour.finishes.length === 1 ? colour.finishes[0].id : ""));
  }, [colour]);

  const finish = colour?.finishes.find((f) => f.id === colourFinishId) ?? null;
  const size = sizes.find((s) => s.id === sizeId) ?? null;
  const shelf = colourFinishId && sizeId ? onHand.get(`${colourFinishId}|${sizeId}`) ?? 0 : null;

  /** The same words the route builds, from the same three parts, so a shortfall
   *  read here is the shortfall read there. */
  function labelOf(): string {
    if (!colour || !finish || !size) return "";
    return `${colour.name} (${finish.finish}) ${sampleSizeLabel({
      lengthIn: size.lengthIn, widthIn: size.widthIn, thicknessMm: size.thicknessMm,
    })}`;
  }

  function addLine() {
    const n = Number(qty);
    if (!colourFinishId || !sizeId || !Number.isInteger(n) || n <= 0) return;
    setLines((ls) => {
      // ONE LINE PER ITEM — sampling_dispatch_line is unique on (package,
      // colour+finish, size), and the same item twice is a quantity change.
      const i = ls.findIndex((l) => l.colourFinishId === colourFinishId && l.sizeId === sizeId);
      if (i >= 0) {
        const next = ls.slice();
        next[i] = { ...next[i], quantity: next[i].quantity + n };
        return next;
      }
      return [...ls, { colourFinishId, sizeId, quantity: n, label: labelOf() }];
    });
    setQty("");
  }

  // planRelease, the SAME function the route runs inside its transaction — so
  // what this screen greys out and what the server refuses cannot drift, and the
  // sentence in both places is the one lifecycle.ts writes.
  const plan = useMemo(
    () => planRelease(lines.map((l) => ({
      label: l.label,
      onHand: onHand.get(`${l.colourFinishId}|${l.sizeId}`) ?? 0,
      quantity: l.quantity,
    }))),
    [lines, onHand],
  );

  const ready = customerName.trim() !== "" && lines.length > 0 && plan.ok && !busy;
  const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs disabled:opacity-50";
  const label = "mb-1 block text-[11px] font-medium text-gray-500";

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700">
        + New package
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-bold text-slate-800">New package</h2>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600">
          Close
        </button>
      </div>

      <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="cd-customer">Customer</label>
          <input id="cd-customer" className={field} value={customerName} disabled={busy}
            onChange={(e) => setCustomerName(e.target.value)} placeholder="who it is going to" />
        </div>
        <div>
          <label className={label} htmlFor="cd-dest">Destination</label>
          <select id="cd-dest" className={field} value={destination} disabled={busy}
            onChange={(e) => setDestination(e.target.value)}>
            <option value="DOMESTIC">Domestic</option>
            <option value="INTERNATIONAL">International</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="cd-ref">Their reference (optional)</label>
          <input id="cd-ref" className={field} value={reference} disabled={busy}
            onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>

      {/* The lines. */}
      {lines.length > 0 && (
        <div className="overflow-x-auto border-t border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                {["Item", "Pieces", "On the shelf", ""].map((h) => (
                  <th key={h} scope="col" className="px-5 py-2 text-left font-semibold text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lines.map((l, i) => {
                const have = onHand.get(`${l.colourFinishId}|${l.sizeId}`) ?? 0;
                return (
                  <tr key={`${l.colourFinishId}|${l.sizeId}`}>
                    <td className="px-5 py-2 font-medium text-gray-800">{l.label}</td>
                    <td className="px-5 py-2">
                      <b className={l.quantity > have ? "text-red-700" : "text-gray-900"}>{l.quantity}</b>
                    </td>
                    <td className="px-5 py-2 text-gray-500">{have}</td>
                    <td className="px-5 py-2 text-right">
                      <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={busy}
                        className="text-red-500 underline underline-offset-2 hover:text-red-700 disabled:opacity-40">
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add a line. */}
      <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 px-5 py-3">
        <div className="min-w-[12rem] flex-1">
          <label className={label} htmlFor="cd-colour">Colour</label>
          <select id="cd-colour" className={field} value={colourName} disabled={busy}
            onChange={(e) => setColourName(e.target.value)}>
            <option value="">Choose a colour…</option>
            {series.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {s.colours.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="min-w-[8rem]">
          <label className={label} htmlFor="cd-finish">Finish</label>
          <select id="cd-finish" className={field} value={colourFinishId} disabled={busy || !colour}
            onChange={(e) => setColourFinishId(e.target.value)}>
            <option value="">{colour ? "Finish…" : "Colour first"}</option>
            {(colour?.finishes ?? []).map((f) => <option key={f.id} value={f.id}>{f.finish}</option>)}
          </select>
        </div>
        <div className="min-w-[12rem]">
          <label className={label} htmlFor="cd-size">Size</label>
          <select id="cd-size" className={field} value={sizeId} disabled={busy}
            onChange={(e) => setSizeId(e.target.value)}>
            <option value="">Size…</option>
            {sizes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="cd-qty">Pieces</label>
          <input id="cd-qty" type="number" min={1} className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-xs"
            value={qty} disabled={busy} onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addLine(); }} />
        </div>
        <button onClick={addLine} disabled={busy || !colourFinishId || !sizeId || !(Number(qty) > 0)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40">
          Add line
        </button>
        {shelf !== null && (
          <span className={`text-[11px] ${shelf > 0 ? "text-gray-400" : "text-amber-700"}`}>
            {shelf} on the shelf
          </span>
        )}
      </div>

      <div className="border-t border-gray-100 px-5 py-3">
        <label className={label} htmlFor="cd-notes">Note (optional)</label>
        <input id="cd-notes" className={field} value={notes} disabled={busy}
          onChange={(e) => setNotes(e.target.value)} />
      </div>

      {/* The refusal, in planRelease's own words, EVERY line that cannot be
          met — all or nothing, so a package with one bad line does not go. */}
      {!plan.ok && (
        <div className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <b>This package cannot be released.</b>
          <ul className="mt-1 list-disc pl-4">
            {plan.shortfalls.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
        <p className="text-[11px] text-gray-400">
          Releasing takes {lines.reduce((n, l) => n + l.quantity, 0)} piece
          {lines.reduce((n, l) => n + l.quantity, 0) === 1 ? "" : "s"} off the shelf now — that is
          what &ldquo;released to package&rdquo; means, and it cannot be undone.
        </p>
        <button
          onClick={async () => {
            await onRelease({ customerName: customerName.trim(), destination, reference: reference.trim() || null, notes: notes.trim() || null, lines });
            setLines([]); setCustomerName(""); setReference(""); setNotes(""); setQty(""); setOpen(false);
          }}
          disabled={!ready}
          className="shrink-0 rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-gray-700 disabled:opacity-40">
          Release to package
        </button>
      </div>
    </div>
  );
}

/* -- One package ----------------------------------------------------------- */

function DispatchCard({
  d, busy, onAdvance,
}: {
  d: Dispatch;
  busy: boolean;
  onAdvance: (to: string, label: string) => Promise<void>;
}) {
  const step = nextStep(d.status);
  const stamps: Array<[string, string | null, string | null]> = [
    ["Released", d.releasedAt, d.releasedBy],
    ["Dispatched", d.dispatchedAt, d.dispatchedBy],
    ["Delivered", d.deliveredAt, d.deliveredBy],
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold text-gray-900">{d.customerName}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[d.status] ?? "bg-gray-100 text-gray-600"}`}>
              {d.status}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
              {d.destination === "INTERNATIONAL" ? "International" : "Domestic"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            {d.pieces} piece{d.pieces === 1 ? "" : "s"} · {d.lines.length} line{d.lines.length === 1 ? "" : "s"}
            {d.reference ? ` · ref ${d.reference}` : ""}
          </p>
          {d.notes && <p className="mt-1 text-[11px] text-gray-400">{d.notes}</p>}
        </div>
        {step && (
          <button onClick={() => onAdvance(step.to, step.label)} disabled={busy}
            className="shrink-0 rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-gray-700 disabled:opacity-40">
            {step.label}
          </button>
        )}
      </div>

      {/* EVERY TRANSITION'S TIME AND PERSON. A step not taken yet is shown as
          not taken rather than omitted, so the row reads as a journey with a
          position on it. */}
      <div className="grid gap-2 border-t border-gray-100 px-5 py-3 sm:grid-cols-3">
        {stamps.map(([name, at, by]) => (
          <div key={name}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{name}</p>
            {at ? (
              <>
                <p className="text-xs text-gray-800">{when(at)}</p>
                <p className="text-[11px] text-gray-400">{by ?? "unknown"}</p>
              </>
            ) : (
              <p className="text-xs italic text-gray-300">not yet</p>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-gray-100 px-5 py-3">
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {d.lines.map((l) => (
            <li key={l.id} className="text-xs text-gray-600">
              {l.colourName} <span className="text-gray-400">({l.finish})</span>{" "}
              <span className="font-mono">{l.sizeLabel}</span>
              <b className="ml-1.5 text-gray-900">×{l.quantity}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
