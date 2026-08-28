"use client";

// SAMPLE REQUESTS — asking the floor to cut samples.
//
// The owner: "sampling page, they create the request — catalogue requirement —
// and request the samples and send to supervisor. He the same way chooses the
// slab and adds pieces and quantity and sends to cutting, then polished (no sink
// and fabri in the samples) and pushed to package."
//
// So this screen is the FRONT of a job, not a stock adjustment. /sampling/add-
// stock records pieces that already exist — offcuts found on the floor, samples
// already cut. This asks for pieces that do not exist yet, and the answer comes
// back days later as stock on a shelf.
//
// A REQUEST IS LINES, and a line is a shelf and a count: colour, finish, size,
// how many. Those four are what a shelf IS — sampling_stock is keyed on
// colour+finish and size — so every line maps onto exactly the shelf its pieces
// will land on when they are packed.
//
// MORE THAN ONE LINE, because the owner was explicit: "we don't only get one
// size on samples — we may cut same slab different sizes and quantity too." One
// request, many sizes, and the supervisor fills them off whatever slabs suit.
//
// ─────────────────────────────────── WHAT HAPPENS AFTER SEND ────────────────
// The request becomes a project on the supervisor's ordinary slab board. He
// picks slabs, sends them to cutting, and the pieces cross the same cutting and
// polishing queues as everything else — skipping sink and fabrication, which a
// flat sample never sees. Packing a piece is what puts it on the shelf.
//
// The progress on each request below is read from that same pipeline, so it
// cannot drift: ordered, on slabs, cut, packed, and how many actually reached a
// shelf. The last two differ only when a line could not say which shelf it was
// ordered against, and that is worth seeing.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getJson, postJson } from "@/lib/fab/postJson";
import { FINISHES } from "@/lib/catalogue/colours";
import { parseSampleSize } from "@/lib/sampling/size";
import {
  useSamplingPickLists, type CatalogueColour, type SizeOption,
} from "@/components/sampling/SampleIntakeForm";

interface RequestLine {
  id: string;
  label: string | null;
  rowLetter: string | null;
  colour: string | null;
  finish: string | null;
  sizeLabel: string | null;
  quantity: number;
  onSlabs: number;
  released: number;
}
interface SampleRequest {
  id: string;
  code: string;
  requestedFor: string;
  status: string;
  createdAt: string;
  note: string | null;
  ordered: number;
  onSlabs: number;
  released: number;
  packed: number;
  credited: number;
  lines: RequestLine[];
}

// ─────────────────────────────────── THE FORM IS GROUPED BY COLOUR ──────────
//
// The owner, looking at a flat list of lines: "I want a plus for the same colour
// different size, so I add there. If different colour then we choose different
// colour, like add another colour."
//
// He is right, and the flat list had it backwards. Asking for four sizes of
// Astral Mist in suede meant choosing that colour and that finish FOUR TIMES,
// out of a hundred and twenty-nine colours, with nothing on screen tying the
// four together — and one mis-click in the fourth dropdown sends a size to the
// wrong shelf without ever looking wrong.
//
// So a request is now COLOUR BLOCKS, and each block holds its sizes:
//
//   Astral Mist · Suede          <- chosen once
//     12 x 22 x 20 mm   x10
//     11 x 11 x 20 mm   x25      <- "+" adds a row here
//   Cappuccino Dark · Polished
//     11 x 11 x 20 mm   x25
//
// That is the shape of the request as it is actually thought about, and it is
// also exactly the shape of the shelf: sampling_stock is keyed on colour+finish
// and size, so a block is a colour+finish and each row under it is one shelf.
//
// THE WIRE FORMAT DID NOT CHANGE. On send, blocks are flattened back to the flat
// lines /api/sampling/requests already takes — each row becomes one line
// carrying its block's colour and finish. Grouping is how a person thinks about
// the request; a list of shelves is what the floor needs, and neither has to
// learn the other's shape.

/** One size under a colour block. Kept as strings — this is a form, and a
 *  half-typed size is not a number yet. */
interface DraftSize {
  key: number;
  sizeId: string;      // "" means the typed size below
  length: string;
  width: string;
  thickness: string;
  quantity: string;
}

/** One colour+finish, and every size wanted in it. */
interface DraftGroup {
  key: number;
  colourId: string;
  finish: string;
  sizes: DraftSize[];
}

const NEW_SIZE = "";
let nextKey = 1;

function blankSize(): DraftSize {
  return { key: nextKey++, sizeId: NEW_SIZE, length: "", width: "", thickness: "", quantity: "" };
}
function blankGroup(): DraftGroup {
  return { key: nextKey++, colourId: "", finish: "", sizes: [blankSize()] };
}

const field = "w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs";
const label = "block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1";

export default function SampleRequestsPage() {
  const lists = useSamplingPickLists();
  const [requests, setRequests] = useState<SampleRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [requestedFor, setRequestedFor] = useState("");
  const [note, setNote] = useState("");
  const [groups, setGroups] = useState<DraftGroup[]>([blankGroup()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getJson<SampleRequest>("/api/sampling/requests");
    setLoading(false);
    if (!res.ok) { setLoadError(res.error); return; }
    setRequests(Array.isArray(res.data) ? res.data : []);
    setLoadError(null);
  }, []);

  // The pick lists load themselves (useSamplingPickLists is enabled by
  // default); only the request list is ours to fetch.
  useEffect(() => { load(); }, [load]);

  const colours: CatalogueColour[] = useMemo(
    () => lists.series.flatMap((s) => s.colours),
    [lists.series],
  );
  const sizes: SizeOption[] = lists.sizes;

  function setGroup(key: number, patch: Partial<DraftGroup>) {
    setNotice(null);
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }
  function setSize(groupKey: number, sizeKey: number, patch: Partial<DraftSize>) {
    setNotice(null);
    setGroups((gs) => gs.map((g) => g.key !== groupKey ? g : {
      ...g,
      sizes: g.sizes.map((s) => (s.key === sizeKey ? { ...s, ...patch } : s)),
    }));
  }
  function addSize(groupKey: number) {
    setNotice(null);
    setGroups((gs) => gs.map((g) => g.key !== groupKey ? g : { ...g, sizes: [...g.sizes, blankSize()] }));
  }
  function removeSize(groupKey: number, sizeKey: number) {
    setNotice(null);
    // Never leaves a block with no rows — an empty colour block is a dropdown
    // with nothing to do, and the way out of it is not obvious.
    setGroups((gs) => gs.map((g) => {
      if (g.key !== groupKey) return g;
      const kept = g.sizes.filter((s) => s.key !== sizeKey);
      return { ...g, sizes: kept.length ? kept : [blankSize()] };
    }));
  }

  /** ONE SIZE ROW'S VERDICT, so a refusal shows against the row that caused it
   *  rather than as one message at the bottom of the form. */
  function sizeState(s: DraftSize): { ok: boolean; reason: string | null } {
    const q = Number(s.quantity);
    if (!Number.isInteger(q) || q <= 0) return { ok: false, reason: null };
    if (s.sizeId !== NEW_SIZE) return { ok: true, reason: null };
    // A typed size. parseSampleSize owns the wording of every refusal — the
    // unitless thickness, the millimetre edge, the edge longer than a slab —
    // and it is shown verbatim.
    const touched = [s.length, s.width, s.thickness].some((v) => v.trim() !== "");
    const parsed = parseSampleSize({ length: s.length, width: s.width, thickness: s.thickness });
    if (parsed.ok) return { ok: true, reason: null };
    return { ok: false, reason: touched ? parsed.reason : null };
  }
  /**
   * A THICKNESS NO SLAB HERE IS. Warned about, never refused.
   *
   * A sample is cut from a slab, so it can only be as thick as the stone it
   * comes off, and the stone here is 7, 12, 15, 20, 25 or 30 mm — the set the
   * slab entry screen offers and qcSlabQuery's map knows. "2mm" parses
   * perfectly and is almost certainly 20 typed in a hurry; nothing else on the
   * form would have caught it, and it would have gone to the saw.
   *
   * Not a refusal, because the stock list is a fact about today and this form
   * should not be the thing that stops an unusual order.
   */
  function oddThickness(s: DraftSize): number | null {
    if (s.sizeId !== NEW_SIZE) return null;   // a saved size was already agreed
    const parsed = parseSampleSize({ length: s.length, width: s.width, thickness: s.thickness });
    if (!parsed.ok) return null;
    const mm = parsed.size.thicknessMm;
    return [7, 12, 15, 20, 25, 30].includes(mm) ? null : mm;
  }

  /** A block is ready when its shelf is named and every row under it is. */
  function groupOk(g: DraftGroup): boolean {
    return !!g.colourId && !!g.finish && g.sizes.length > 0 && g.sizes.every((s) => sizeState(s).ok);
  }

  const ready = groups.length > 0 && groups.every(groupOk) && !busy;
  const totalLines = groups.reduce((n, g) => n + g.sizes.length, 0);
  const totalPieces = groups.reduce(
    (n, g) => n + g.sizes.reduce((m, s) => m + (Number(s.quantity) || 0), 0), 0);

  /** Two blocks naming the same shelf. Not refused — it is legal, and the floor
   *  would just cut both — but it is nearly always a second block opened by
   *  mistake when the sizes belonged in the first. */
  const duplicateShelf = useMemo(() => {
    const seen = new Set<string>();
    for (const g of groups) {
      if (!g.colourId || !g.finish) continue;
      const k = `${g.colourId}::${g.finish}`;
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  }, [groups]);

  async function send() {
    if (!ready) return;
    setBusy(true); setError(null); setNotice(null);
    const res = await postJson("/api/sampling/requests", {
      requestedFor: requestedFor.trim() || null,
      note: note.trim() || null,
      // FLATTENED BACK TO LINES. The route takes a list of shelves and knows
      // nothing about blocks; grouping is this screen's idea and stays here.
      lines: groups.flatMap((g) => g.sizes.map((s) => ({
        colourId: g.colourId,
        finish: g.finish,
        quantity: Number(s.quantity),
        ...(s.sizeId !== NEW_SIZE
          ? { sizeId: s.sizeId }
          : { length: s.length, width: s.width, thickness: s.thickness }),
      }))),
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }

    const d = (res.data ?? {}) as { message?: string; sizesCreated?: number; finishesCreated?: number };
    // "It is now an option for everyone" is the consequence of typing a new size
    // or choosing a finish nobody has cut before, and the person who did it is
    // the only one who can still catch a typo.
    const extra = [
      d.sizesCreated ? `${d.sizesCreated} new size${d.sizesCreated === 1 ? "" : "s"} saved` : null,
      d.finishesCreated ? `${d.finishesCreated} colour+finish added to the chart` : null,
    ].filter(Boolean).join(" · ");
    setNotice(`${d.message ?? "Request raised."}${extra ? ` (${extra})` : ""}`);
    setRequestedFor(""); setNote(""); setGroups([blankGroup()]);
    await load();
    // A size typed above is now a shelf option for everyone — pull it back so
    // the next line can pick it instead of typing it again.
    await lists.reloadSizes();
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sample requests</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Ask the floor to cut samples. The supervisor picks slabs, and the pieces reach the
            shelf when they are packed.
          </p>
        </div>
        <Link href="/sampling"
          className="text-xs font-semibold text-slate-600 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition">
          Sample inventory
        </Link>
      </div>

      {/* ---- raise one ---- */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-6">
        <h2 className="text-sm font-bold text-slate-800 mb-3">New request</h2>

        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          <div>
            <label className={label} htmlFor="sr-for">Requested for</label>
            <input id="sr-for" className={field} value={requestedFor} disabled={busy}
              placeholder="Customer, showroom, or who asked"
              onChange={(e) => setRequestedFor(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="sr-note">Note</label>
            <input id="sr-note" className={field} value={note} disabled={busy}
              placeholder="Anything the floor should know"
              onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div className="space-y-3">
          {groups.map((g, gi) => {
            const colour = colours.find((c) => c.id === g.colourId) ?? null;
            const existing = new Set((colour?.finishes ?? []).map((f) => f.finish));
            const shelfNamed = !!colour && !!g.finish;
            return (
              <div key={g.key} className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden">
                {/* ── the shelf: chosen ONCE, however many sizes hang off it ── */}
                <div className="px-3 pt-3 pb-2 bg-white border-b border-slate-200">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Colour {gi + 1}
                    </span>
                    {groups.length > 1 && (
                      <button type="button" disabled={busy}
                        onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))}
                        className="text-[11px] font-semibold text-red-600 hover:text-red-800 disabled:opacity-40">
                        Remove colour
                      </button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className={label}>Colour</label>
                      <select className={field} value={g.colourId} disabled={busy}
                        onChange={(e) => setGroup(g.key, { colourId: e.target.value, finish: "" })}>
                        <option value="">Choose a colour…</option>
                        {lists.series.map((s) => (
                          <optgroup key={s.id} label={s.name}>
                            {s.colours.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={label}>Finish</label>
                      {/* ALL FOUR, on every colour — the chart only ever printed
                          the photographed variants. The row is created on save. */}
                      <select className={field} value={g.finish} disabled={busy || !colour}
                        onChange={(e) => setGroup(g.key, { finish: e.target.value })}>
                        <option value="">{colour ? "Choose…" : "Pick a colour"}</option>
                        {FINISHES.map((f) => (
                          <option key={f} value={f}>
                            {f}{existing.has(f) ? "" : " — new"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {g.finish && colour && !existing.has(g.finish) && (
                    <p className="mt-2 text-[11px] text-amber-700">
                      First time {colour.name} has been asked for in {g.finish.toLowerCase()} — sending
                      makes it an option for everyone.
                    </p>
                  )}
                </div>

                {/* ── the sizes wanted in it ─────────────────────────────────── */}
                <div className="p-3 space-y-2">
                  {g.sizes.map((s, si) => {
                    const state = sizeState(s);
                    const odd = oddThickness(s);
                    const typing = s.sizeId === NEW_SIZE;
                    return (
                      <div key={s.key}>
                        <div className="grid gap-2 sm:grid-cols-12 items-end">
                          <div className="sm:col-span-4">
                            {/* Labels once, on the first row — repeating them
                                down a stack of identical rows is noise. */}
                            {si === 0 && <label className={label}>Size</label>}
                            <select className={field} value={s.sizeId} disabled={busy}
                              onChange={(e) => setSize(g.key, s.key, { sizeId: e.target.value })}>
                              <option value={NEW_SIZE}>Type a size…</option>
                              {sizes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>
                          </div>
                          {typing ? (
                            <>
                              <div className="sm:col-span-2">
                                {si === 0 && <label className={label}>Length (in)</label>}
                                <input className={field} value={s.length} disabled={busy} placeholder="11"
                                  onChange={(e) => setSize(g.key, s.key, { length: e.target.value })} />
                              </div>
                              <div className="sm:col-span-2">
                                {si === 0 && <label className={label}>Width (in)</label>}
                                <input className={field} value={s.width} disabled={busy} placeholder="11"
                                  onChange={(e) => setSize(g.key, s.key, { width: e.target.value })} />
                              </div>
                              <div className="sm:col-span-2">
                                {si === 0 && <label className={label}>Thickness</label>}
                                <input className={field} value={s.thickness} disabled={busy} placeholder="20 mm"
                                  onChange={(e) => setSize(g.key, s.key, { thickness: e.target.value })} />
                              </div>
                            </>
                          ) : (
                            <div className="sm:col-span-6" />
                          )}
                          <div className="sm:col-span-1">
                            {si === 0 && <label className={label}>Pieces</label>}
                            <input type="number" min={1} step={1} className={field} value={s.quantity}
                              disabled={busy} placeholder="qty"
                              onChange={(e) => setSize(g.key, s.key, { quantity: e.target.value })} />
                          </div>
                          <div className="sm:col-span-1 flex justify-end">
                            <button type="button" disabled={busy || g.sizes.length === 1}
                              onClick={() => removeSize(g.key, s.key)}
                              aria-label={`Remove size ${si + 1}`}
                              title={g.sizes.length === 1 ? "A colour needs at least one size" : "Remove this size"}
                              className="text-slate-400 hover:text-red-600 disabled:opacity-25 disabled:hover:text-slate-400 px-2 py-1.5 text-sm font-bold transition">
                              ✕
                            </button>
                          </div>
                        </div>
                        {/* parseSampleSize's own sentence, unedited — it is the
                            only thing that knows why "2" is not a thickness. */}
                        {state.reason && (
                          <p className="mt-1 text-[11px] text-red-600">{state.reason}</p>
                        )}
                        {odd !== null && (
                          <p className="mt-1 text-[11px] text-amber-700">
                            {odd} mm — no slab here is that thick. Stock is 12, 20 or 30 mm.
                            Send it if you mean it.
                          </p>
                        )}
                      </div>
                    );
                  })}

                  <button type="button" disabled={busy || !shelfNamed}
                    onClick={() => addSize(g.key)}
                    title={shelfNamed ? "" : "Choose the colour and finish first"}
                    className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 disabled:opacity-40 disabled:hover:text-indigo-700 transition">
                    + Add another size{colour ? ` of ${colour.name}` : ""}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {duplicateShelf && (
          <p className="mt-2 text-[11px] text-amber-700">
            Two blocks name the same colour and finish. That is allowed, but the sizes probably
            belong in one of them — the shelf they land on is the same either way.
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap mt-3">
          <button type="button" disabled={busy}
            onClick={() => setGroups((gs) => [...gs, blankGroup()])}
            className="text-xs font-semibold text-slate-700 border border-slate-200 hover:border-slate-300 disabled:opacity-40 px-3 py-1.5 rounded-lg transition">
            Add another colour
          </button>
          <button type="button" onClick={send} disabled={!ready}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 transition">
            {busy ? "Sending…" : "Send to supervisor"}
          </button>
          {totalPieces > 0 && (
            <span className="text-[11px] text-slate-500">
              {groups.length} colour{groups.length === 1 ? "" : "s"} &middot;{" "}
              {totalLines} line{totalLines === 1 ? "" : "s"} &middot;{" "}
              {totalPieces} piece{totalPieces === 1 ? "" : "s"}
            </span>
          )}
          {!ready && !busy && (
            <span className="text-[11px] text-slate-400">
              Every colour needs a finish, and every size under it needs a measurement and a count.
            </span>
          )}
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}
        {notice && (
          <p className="mt-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>
        )}
        {lists.error && (
          <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {lists.error}
          </p>
        )}
      </div>

      {/* ---- what is already on the floor ---- */}
      <h2 className="text-sm font-bold text-slate-800 mb-2">On the floor</h2>
      {loadError && (
        <p className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</p>
      )}
      {loading ? (
        <p className="text-xs text-slate-400 py-8 text-center">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-xs text-slate-400 py-8 text-center bg-white rounded-xl border border-slate-100">
          No sample requests yet. The first one raised above appears here, and on the supervisor&apos;s board.
        </p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <details key={r.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <summary className="px-4 py-3 cursor-pointer hover:bg-slate-50 flex items-center gap-3 flex-wrap">
                <span className="font-mono text-sm font-bold text-slate-800">{r.code}</span>
                <span className="text-xs text-slate-500">{r.requestedFor}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {r.status}
                </span>
                <span className="ml-auto flex items-center gap-3 text-[11px] tabular-nums">
                  <span className="text-slate-500">{r.ordered} ordered</span>
                  <span className="text-slate-500">{r.onSlabs} on slabs</span>
                  <span className="text-slate-500">{r.released} cut</span>
                  <span className={r.packed === r.ordered && r.ordered > 0 ? "text-emerald-700 font-semibold" : "text-slate-500"}>
                    {r.packed} packed
                  </span>
                  {/* Packed and credited differ only when a line could not say
                      which shelf it was ordered against. Worth seeing. */}
                  {r.credited !== r.packed && (
                    <span className="text-amber-700 font-semibold" title="Packed pieces that reached a shelf">
                      {r.credited} on the shelf
                    </span>
                  )}
                </span>
              </summary>
              <table className="w-full text-xs border-t border-slate-100">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Row</th>
                    <th className="text-left px-4 py-2 font-semibold">Colour</th>
                    <th className="text-left px-4 py-2 font-semibold">Finish</th>
                    <th className="text-left px-4 py-2 font-semibold">Size</th>
                    <th className="text-right px-4 py-2 font-semibold">Asked</th>
                    <th className="text-right px-4 py-2 font-semibold">On slabs</th>
                    <th className="text-right px-4 py-2 font-semibold">Cut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {r.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2 font-mono font-bold text-slate-700">{l.rowLetter ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-700">{l.colour ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-500">{l.finish ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-500">{l.sizeLabel ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">{l.quantity}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">{l.onSlabs}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">{l.released}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.note && <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-50">{r.note}</p>}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
