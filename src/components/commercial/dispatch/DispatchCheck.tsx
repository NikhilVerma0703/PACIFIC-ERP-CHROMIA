"use client";
// One packing list, line by line, on a screen someone uses standing next to a
// crate. Everything is deliberately big: one FIT button and one UNFIT button
// per row, both at least a thumb wide, and the reason for an UNFIT chosen from
// eight buttons rather than typed — a keyboard on the floor is a keyboard
// nobody uses, and an unfit line with no reason is a rejection Commercial
// cannot act on.
//
// TWO KINDS OF LINE, ONE CHECK (round four, answer 1). A cut-to-size list packs
// pieces and used to arrive here as an empty screen that passed itself; it is
// now checked piece by piece exactly as a slab list is checked slab by slab,
// and the two kinds are shown TOGETHER under the crate they are in, because
// that is how they are stacked in front of the man holding the tablet. The
// crate a line belongs to is decided in packing-rules (checkerGroups), not
// here, so that "mark this crate correct" marks exactly the lines printed
// under that heading and nothing else.
//
// THREE WAYS TO SAY CORRECT, and the two bulk ones never overwrite an UNFIT:
// one line, one crate, the whole list. The server enforces that rule twice over
// (mark-fit route); the buttons here report back what they skipped, because a
// checker who is told "38 marked correct" and not told about the two findings
// still in the crate will walk away believing it is clear.
//
// A VERIFIED or FINAL list is still open to a verdict (answer 30): the loading
// bay is where a slab passed last week turns out cracked. Marking it UNFIT here
// changes nothing else — the list keeps its status, nothing is unpacked — and
// the dispatch route refuses until the slab is swapped (answer 31). The Swap
// button beside such a slab is Commercial's (a `write` action); a verify-only
// login does not see it rather than seeing it fail. There is no swap beside an
// unfit PIECE: it was cut to a customer's size and there is no shelf of
// replacements to pick one off — it is recut, which is Commercial's work on the
// reopened list.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { postJson, patchJson } from "@/lib/fab/postJson";
import {
  UNFIT_REASONS, fitCounts, checkerGroups, canRecheck, PACKING_STATUS_LABEL,
  type PackingStatus, type BulkFitScope,
} from "@/lib/commercial/packing-rules";
import { pieceSize } from "@/lib/commercial/pieces-rules";
import { sizeInUnit, type MeasurementUnit } from "@/lib/commercial/measure";
import { SwapSlabPicker } from "./SwapSlabPicker";

interface Crate { id: string; crateNo: number; kind: string; netKg: number | null; remarks: string | null }
interface Slab {
  id: string; crateId: string | null; slabNumber: number; customerSlabNo: string | null; customerBatchNo: string | null;
  design: string | null; customerSku: string | null; thickness: string | null; batchNumber: string | null; batchKey: string | null;
  grade: string | null; lengthCm: number | null; widthCm: number | null; sqm: number | null;
  fit: "PENDING" | "FIT" | "UNFIT"; unfitReason: string | null; checkedAt: string | null; sortOrder: number;
}
interface Piece {
  id: string; crateId: string | null; crateNo: string | null; drawingNo: string | null; pieceNo: string | null;
  design: string; lengthMm: number | null; widthMm: number | null; thicknessMm: number | null;
  sqft: number | null; quantity: number; room: string | null; weightKg: number | null; notes: string | null;
  fit: "PENDING" | "FIT" | "UNFIT"; unfitReason: string | null; checkedAt: string | null;
}
interface Detail {
  id: string; number: string; status: PackingStatus;
  submittedAt: string | null; verifiedAt: string | null; verifiedByName: string | null; verificationNote: string | null;
  containerNo: string | null; sealNo: string | null; linerOtlNo: string | null; vehicleNo: string | null;
  packagesSummary: string | null; grossWeightKg: number | null; netWeightKg: number | null; notes: string | null;
  orderNumber: string; kind: string; customerPoNumber: string | null; clientName: string; clientCountry: string | null;
  measurementUnit: MeasurementUnit;
  crates: Crate[]; slabs: Slab[]; pieces: Piece[];
  /** The signed-in login's Commercial actions, from the route. */
  actions?: string[];
}

const btnBig = "rounded-xl px-6 py-4 text-base font-semibold transition disabled:opacity-50";
const btnFit = `${btnBig} border-2 border-green-600 text-green-700 hover:bg-green-50`;
const btnFitOn = `${btnBig} border-2 border-green-600 bg-green-600 text-white`;
const btnUnfit = `${btnBig} border-2 border-red-600 text-red-700 hover:bg-red-50`;
const btnUnfitOn = `${btnBig} border-2 border-red-600 bg-red-600 text-white`;
const btnSwap = `${btnBig} border-2 border-brand text-brand hover:bg-brand/5`;
const btnBulk = "rounded-xl border-2 border-green-600 px-5 py-3 text-base font-semibold text-green-700 transition hover:bg-green-50 disabled:opacity-40";

const TONE: Record<string, "brand" | "green" | "amber" | "red"> = { SUBMITTED: "amber", REJECTED: "red", VERIFIED: "green", FINAL: "green" };

/** What a row is called in the asking/busy state — two tables, two id spaces. */
const rowKey = (kind: "slab" | "piece", id: string): string => `${kind}:${id}`;

export function DispatchCheck({ plId }: { plId: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** An answer that names lines it did NOT mark is not good news. */
  const [noteWarn, setNoteWarn] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);   // row whose reason is being chosen
  const [swapping, setSwapping] = useState<string | null>(null); // slab id being swapped
  const [freeText, setFreeText] = useState("");
  const [verifyNote, setVerifyNote] = useState("");

  const load = useCallback(async () => {
    const res = await readJson<Detail>(await fetch(`/api/office/commercial/dispatch-check/${plId}`, { cache: "no-store" }));
    if (!res.ok) { setError(res.error ?? "Could not load this packing list"); return; }
    setError(null); setD(res.data);
  }, [plId]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => fitCounts(d?.slabs ?? [], d?.pieces ?? []), [d]);
  const groups = useMemo(() => checkerGroups(d?.crates ?? [], d?.slabs ?? [], d?.pieces ?? []), [d]);

  if (error && !d) return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">{error}</div>;
  if (!d) return <Empty>Loading…</Empty>;

  const open = d.status === "SUBMITTED";
  const late = canRecheck(d.status);
  const canMark = open || late;
  const maySwap = late && (d.actions ?? []).includes("write");
  const unit = d.measurementUnit ?? "cm";
  const size = (cm: number | null): string => { const v = sizeInUnit(cm, unit); return v == null ? "" : String(v); };
  const lines = d.slabs.length + d.pieces.length;

  function say(text: string, warn = false) { setNote(text); setNoteWarn(warn); }

  async function mark(kind: "slab" | "piece", id: string, fit: "FIT" | "UNFIT", unfitReason?: string) {
    const key = rowKey(kind, id);
    setBusy(key); setError(null); setNote(null);
    const r = await patchJson(`/api/office/commercial/dispatch-check/${plId}/${kind === "slab" ? "slabs" : "pieces"}/${id}`, { fit, unfitReason });
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "That verdict did not save"); return; }
    setAsking(null); setFreeText("");
    if (late && fit === "UNFIT") {
      say(kind === "slab"
        ? "Marked unfit. Nothing ships until Commercial swaps this slab."
        : "Marked unfit. Nothing ships until Commercial recuts this line.", true);
    }
    await load();
  }

  async function markBulk(scope: BulkFitScope, pending: number) {
    if (scope.kind === "all" && !window.confirm(`Mark all ${pending} unchecked line(s) on ${d?.number} correct?\n\nAnything already marked unfit is left exactly as it is.`)) return;
    const key = scope.kind === "all" ? "bulk:all" : `bulk:${scope.key}`;
    setBusy(key); setError(null); setNote(null);
    const r = await postJson(`/api/office/commercial/dispatch-check/${plId}/mark-fit`,
      scope.kind === "all" ? { scope: "all" } : { scope: "crate", crate: scope.key });
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Those lines did not save"); return; }
    const data = r.data as { note?: string; marked?: number; skippedUnfit?: number };
    say(data?.note ?? "Marked correct.", (data?.skippedUnfit ?? 0) > 0);
    await load();
  }

  async function verify() {
    setBusy("verify"); setError(null); setNote(null);
    const r = await postJson(`/api/office/commercial/dispatch-check/${plId}/verify`, { note: verifyNote || undefined });
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Could not finish the check"); return; }
    const data = r.data as {
      verified?: boolean;
      removed?: Array<{ slab: number; reason: string }>;
      stranded?: Array<{ slab: number; reason: string }>;
      unfitPieces?: Array<{ label: string; reason: string }>;
    };
    // A slab the inventory would not take back stays ON the list rather than
    // vanishing from it, so say so here too — the checker is standing next to it.
    const stranded = data?.stranded?.length
      ? ` ${data.stranded.length} slab(s) could not be put back and are still on this list: ${data.stranded.map((s) => `#${s.slab} (${s.reason})`).join("; ")}.`
      : "";
    // And an unfit CUT-TO-SIZE line never goes back at all: there is nothing in
    // finished goods to return a piece cut to a customer's size to. It stays,
    // flagged, for Commercial to recut.
    const kept = data?.unfitPieces?.length
      ? ` ${data.unfitPieces.length} cut-to-size line(s) stay on this list to be recut: ${data.unfitPieces.map((p) => `${p.label} (${p.reason})`).join("; ")}.`
      : "";
    say(data?.verified
      ? "Verified — the list goes back to Commercial as ready."
      : `Rejected — ${data?.removed?.length ?? 0} slab(s) sent back to stock.${stranded}${kept}`,
      !data?.verified);
    setVerifyNote("");
    await load();
  }

  const groupLabel = (g: (typeof groups)[number]): string => {
    if (g.onList) {
      const c = d.crates.find((x) => x.id === g.crateId);
      return c ? `Crate ${c.crateNo} · ${c.kind}${c.netKg != null ? ` · ${c.netKg} kg net` : ""}` : "Crate";
    }
    // A crate number the customer's cut-to-size sheet prints that is not a
    // crate row of ours (pieces-rules matchCrate). It is still a box on the
    // floor, so it gets its own heading rather than being tipped in with the
    // lines that are in no crate at all.
    if (g.crateNo) return `Crate ${g.crateNo} · as printed on the cut-to-size sheet`;
    // A key with no crate to name it is a crate row that has gone since these
    // lines were put in it. Say that rather than "not in a crate", which would
    // read as a deliberate choice somebody made.
    return g.key ? "A crate that is no longer on this list" : "Not in a crate";
  };

  const countLabel = (slabs: number, pieces: number): string =>
    [slabs ? `${slabs} slab(s)` : "", pieces ? `${pieces} cut-to-size line(s)` : ""].filter(Boolean).join(" · ") || "nothing";

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold text-gray-900">{d.number}</h2>
              <Badge tone={TONE[d.status] ?? "green"}>{PACKING_STATUS_LABEL[d.status] ?? d.status}</Badge>
            </div>
            <div className="mt-1 text-lg text-gray-700">{d.orderNumber} · {d.clientName || "—"}</div>
            <div className="mt-1 text-sm text-gray-500">
              {d.packagesSummary ?? `${d.crates.length} package(s)`}
              {d.containerNo ? ` · container ${d.containerNo}` : ""}
              {d.sealNo ? ` · seal ${d.sealNo}` : ""}
              {d.vehicleNo ? ` · vehicle ${d.vehicleNo}` : ""}
              {` · sizes in ${unit}`}
            </div>
          </div>
          <Link href="/office/commercial/dispatch-check" className="rounded-xl border border-gray-300 px-5 py-3 text-base font-medium text-gray-700 transition hover:bg-gray-50">
            Back to the queue
          </Link>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-gray-600">{counts.fit} fit · {counts.unfit} unfit · {counts.pending} still to check</span>
            <span className="font-medium text-gray-900">{counts.total - counts.pending} of {counts.total}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${counts.total ? Math.round(((counts.total - counts.pending) / counts.total) * 100) : 0}%` }} />
          </div>
          <div className="mt-1 text-sm text-gray-400">{countLabel(d.slabs.length, d.pieces.length)}</div>
        </div>

        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">{error}</div>}
        {note && (
          <div className={`mt-3 rounded-xl border px-4 py-3 text-base ${noteWarn ? "border-amber-200 bg-amber-50 text-amber-800" : "border-green-200 bg-green-50 text-green-800"}`}>
            {note}
          </div>
        )}
        {d.verificationNote && !open && (
          <div className={`mt-3 rounded-xl border px-4 py-3 text-base ${d.status === "REJECTED" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-800"}`}>
            {d.verificationNote}
          </div>
        )}
        {late && (
          <div className={`mt-3 rounded-xl border px-4 py-3 text-base ${counts.unfit > 0 || counts.pending > 0 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-gray-200 bg-gray-50 text-gray-600"}`}>
            {counts.unfit > 0
              ? `${counts.unfit} line(s) refused at loading — nothing ships until each slab is swapped for one of the same design and thickness, and each cut-to-size line is recut.`
              : counts.pending > 0
                ? `${counts.pending} line(s) still to check — nothing ships until they are marked fit.`
                : "This list has been checked. A line found unfit while the container is being loaded can still be marked here; the truck does not leave until it is put right."}
          </div>
        )}

        {canMark && counts.pending > 0 && (
          <div className="mt-4">
            <button type="button" className={btnBulk} disabled={busy !== null}
              onClick={() => markBulk({ kind: "all" }, counts.pending)}>
              {busy === "bulk:all" ? "Working…" : `Mark all as correct — ${counts.pending} line(s)`}
            </button>
            <p className="mt-2 text-sm text-gray-500">
              Marks every line nobody has looked at yet. Lines already marked unfit are left exactly as they are.
            </p>
          </div>
        )}

        {open && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-600" htmlFor="verify-note">Note (optional)</label>
              <input id="verify-note" className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} placeholder="Anything Commercial should know" />
            </div>
            <button type="button"
              className={`rounded-xl px-8 py-4 text-lg font-semibold text-white transition disabled:opacity-50 ${counts.unfit > 0 ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}`}
              disabled={busy !== null || counts.pending > 0}
              title={counts.pending > 0 ? `${counts.pending} line(s) still to check` : ""}
              onClick={verify}>
              {busy === "verify" ? "Working…" : counts.unfit > 0 ? `Reject — ${counts.unfit} unfit` : "Verify — all fit"}
            </button>
          </div>
        )}
        {open && counts.pending > 0 && (
          <p className="mt-2 text-sm text-gray-500">Every line has to be marked before the list can be finished.</p>
        )}
      </Card>

      {lines === 0 ? <Empty>This list has nothing on it to check.</Empty> : groups.map((g) => (
        <Card key={g.key || "none"}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-gray-900">
              {groupLabel(g)} · {countLabel(g.slabs.length, g.pieces.length)}
            </h3>
            {canMark && g.fit.pending > 0 && (
              <button type="button" className={btnBulk} disabled={busy !== null}
                onClick={() => markBulk({ kind: "crate", key: g.key }, g.fit.pending)}>
                {busy === `bulk:${g.key}` ? "Working…" : `Mark crate as correct — ${g.fit.pending} line(s)`}
              </button>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {g.slabs.map((s) => (
              <div key={s.id} className={`rounded-xl border p-4 ${s.fit === "UNFIT" ? "border-red-200 bg-red-50/60" : s.fit === "FIT" ? "border-green-200 bg-green-50/40" : "border-gray-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-2xl font-semibold tracking-tight text-gray-900">
                      {s.customerSlabNo ? <>{s.customerSlabNo} <span className="text-base font-normal text-gray-400">(ours {s.slabNumber})</span></> : s.slabNumber}
                    </div>
                    <div className="mt-1 text-base text-gray-700">
                      {s.customerSku || s.design || "—"}{s.thickness ? ` · ${s.thickness}` : ""}{s.grade ? ` · grade ${s.grade}` : ""}
                    </div>
                    <div className="mt-0.5 text-sm text-gray-500">
                      Batch {s.customerBatchNo ?? s.batchNumber ?? s.batchKey ?? "—"}
                      {s.lengthCm && s.widthCm ? ` · ${size(s.lengthCm)} × ${size(s.widthCm)} ${unit}` : ""}
                      {s.sqm != null ? ` · ${s.sqm.toFixed(4)} sqm` : ""}
                    </div>
                    {s.fit === "UNFIT" && s.unfitReason && <div className="mt-1 text-base font-medium text-red-700">{s.unfitReason}</div>}
                    {late && s.fit === "PENDING" && <div className="mt-1 text-sm font-medium text-amber-700">Swapped in — not yet checked</div>}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button type="button" className={s.fit === "FIT" ? btnFitOn : btnFit} disabled={!canMark || busy !== null}
                      onClick={() => mark("slab", s.id, "FIT")}>Fit</button>
                    <button type="button" className={s.fit === "UNFIT" ? btnUnfitOn : btnUnfit} disabled={!canMark || busy !== null}
                      onClick={() => { setSwapping(null); setAsking(asking === rowKey("slab", s.id) ? null : rowKey("slab", s.id)); setFreeText(""); }}>Unfit</button>
                    {maySwap && s.fit === "UNFIT" && (
                      <button type="button" className={btnSwap} disabled={busy !== null}
                        onClick={() => { setAsking(null); setSwapping(swapping === s.id ? null : s.id); }}>Swap</button>
                    )}
                  </div>
                </div>

                {asking === rowKey("slab", s.id) && canMark && (
                  <ReasonPicker id={s.id} busy={busy === rowKey("slab", s.id)} freeText={freeText} setFreeText={setFreeText}
                    onPick={(why) => mark("slab", s.id, "UNFIT", why)} onCancel={() => setAsking(null)} />
                )}

                {swapping === s.id && maySwap && (
                  <SwapSlabPicker plId={plId} slabId={s.id}
                    onCancel={() => setSwapping(null)}
                    onDone={async (msg) => { setSwapping(null); setError(null); say(msg); await load(); }} />
                )}
              </div>
            ))}

            {g.pieces.map((p) => (
              <div key={p.id} className={`rounded-xl border p-4 ${p.fit === "UNFIT" ? "border-red-200 bg-red-50/60" : p.fit === "FIT" ? "border-green-200 bg-green-50/40" : "border-gray-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-2xl font-semibold tracking-tight text-gray-900">
                      {p.pieceNo ? <>Piece {p.pieceNo}</> : "Cut to size"}
                      {p.quantity > 1 && <span className="ml-2 text-base font-normal text-gray-500">× {p.quantity} pcs</span>}
                    </div>
                    <div className="mt-1 text-base text-gray-700">
                      {p.design || "—"}
                      {pieceSize(p, unit) ? ` · ${pieceSize(p, unit)} ${unit}` : ""}
                    </div>
                    <div className="mt-0.5 text-sm text-gray-500">
                      {p.drawingNo ? `Drawing ${p.drawingNo}` : "No drawing number"}
                      {p.room ? ` · ${p.room}` : ""}
                      {p.sqft != null ? ` · ${p.sqft} sqft` : ""}
                      {p.weightKg != null ? ` · ${p.weightKg} kg` : ""}
                    </div>
                    {p.notes && <div className="mt-0.5 text-sm text-gray-500">{p.notes}</div>}
                    {p.fit === "UNFIT" && p.unfitReason && <div className="mt-1 text-base font-medium text-red-700">{p.unfitReason}</div>}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button type="button" className={p.fit === "FIT" ? btnFitOn : btnFit} disabled={!canMark || busy !== null}
                      onClick={() => mark("piece", p.id, "FIT")}>Fit</button>
                    <button type="button" className={p.fit === "UNFIT" ? btnUnfitOn : btnUnfit} disabled={!canMark || busy !== null}
                      onClick={() => { setSwapping(null); setAsking(asking === rowKey("piece", p.id) ? null : rowKey("piece", p.id)); setFreeText(""); }}>Unfit</button>
                  </div>
                </div>

                {asking === rowKey("piece", p.id) && canMark && (
                  <ReasonPicker id={p.id} busy={busy === rowKey("piece", p.id)} freeText={freeText} setFreeText={setFreeText}
                    onPick={(why) => mark("piece", p.id, "UNFIT", why)} onCancel={() => setAsking(null)} />
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** The eight reason buttons and the free-text box, identical for both kinds of
 *  line — the reasons a cut piece is refused are the reasons a slab is refused,
 *  and a second copy of this markup is a second place for them to diverge. */
function ReasonPicker(props: {
  id: string;
  busy: boolean;
  freeText: string;
  setFreeText: (v: string) => void;
  onPick: (why: string) => void;
  onCancel: () => void;
}) {
  const { id, busy, freeText, setFreeText, onPick, onCancel } = props;
  return (
    <div className="mt-4 rounded-xl border border-red-200 bg-white p-4">
      <p className="mb-2 text-base font-medium text-gray-700">What is wrong with it?</p>
      <div className="flex flex-wrap gap-2">
        {UNFIT_REASONS.map((r) => (
          <button key={r} type="button" className="rounded-xl border border-gray-300 px-4 py-3 text-base transition hover:border-red-400 hover:bg-red-50"
            disabled={busy} onClick={() => onPick(r)}>{r}</button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label className="mb-1 block text-sm font-medium text-gray-600" htmlFor={`why-${id}`}>Something else</label>
          <input id={`why-${id}`} className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            value={freeText} onChange={(e) => setFreeText(e.target.value)} />
        </div>
        <button type="button" className={`${btnBig} bg-red-600 text-white hover:bg-red-700`} disabled={busy || !freeText.trim()}
          onClick={() => onPick(freeText.trim())}>Mark unfit</button>
        <button type="button" className={`${btnBig} border border-gray-300 text-gray-700 hover:bg-gray-50`} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
