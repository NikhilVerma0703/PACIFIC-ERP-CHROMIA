"use client";

// One batch, one or two halves, and a button that means something.
//
// The screen shows only what the person signing it needs to look at. Both
// verifiers — the store incharge and the named production verifier — now see
// and sign BOTH halves (owner, 2026-08-18; verification.ts records the
// widening): the weighed quantities and the unit prices. What is still never
// here is a total or a computed sheet — nothing multiplied — and that boundary
// is enforced in the API; this component renders whatever arrives and asks for
// nothing more.
//
// The verifiers also ENTER the batch here now (owner, 2026-08-19): supplier
// splits, prices, doses — on a flat table built for them (SimpleMaterialsEntry,
// with the admin's full materials panel one toggle away), rendered below the
// picker for anyone who can sign. The entry came to them rather than them to
// /office/costing, because that page carries the computed sheet and the whole
// cost base and stays admin-only. And a mark is
// REFUSED until the batch is fully entered — every price resolving, every dose
// set, every split covering the mixer total. The refusal is the API's
// (completeness.ts, checked in the POST); the disabled buttons and the blocker
// list beside them are this screen repeating the API's answer so the verifier
// knows exactly what to finish.
//
// "Verified" is never a bare tick. It carries who signed and when, and it
// lapses on its own when the numbers move underneath it, because a sign-off
// that survives the thing it signed off is worse than no sign-off at all.

import { useCallback, useEffect, useState } from "react";
import { Card, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { SimpleMaterialsEntry } from "@/components/office/SimpleMaterialsEntry";
import { SignoffCard } from "@/components/office/SignoffCard";

const API = "/api/office/batch-verify";

const td = "px-3 py-1.5";

const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

type Side = "WEIGHTS" | "COSTS";

interface BatchRow {
  batchKey: string; batch: string; design: string; slabs: number; cycles: number;
  firstPress: string | null; lastPress: string | null;
}
/** One person's mark. A side's marks are a LIST now — both verifiers can hold
 *  one each — and an empty list is "not verified". */
interface Mark { status: "verified" | "stale"; by: string; at: string }

interface Weights {
  resinKg: number; resinCycles: number;
  resinByTank: Array<{ tank: string; cycles: number; kg: number }>;
  gritCharges: Array<{ silo: string; band: string; kg: number }>;
  gritUnresolvedKg: number; fillerKg: number; mixerCharges: number;
  firstPress: string | null; lastPress: string | null;
}
interface Prices {
  onDate: string;
  resinBySupplier: Record<string, number>;
  missing: string[];
  items: Array<{
    item: string; label: string; unit: string; cardRate: number | null;
    batchLines: Array<{ seq: number; rate: number; description: string }>;
  }>;
}
interface Detail {
  batchKey: string; batch: string; design: string;
  can: Side[]; sign: Side[];
  /** The signed-in name — how the screen tells your mark from the other verifier's. */
  me?: string;
  verification: Record<Side, Mark[]>;
  /** What still has to be entered before the API will accept a mark — the
   *  same answer the POST enforces, shipped so the buttons can say why. */
  completeness?: { ok: boolean; blockers: string[] };
  weights?: Weights;
  prices?: Prices;
}


export function BatchVerifyPanel({ can, sign }: { can: Side[]; sign: Side[] }) {
  const [batches, setBatches] = useState<BatchRow[] | null>(null);
  const [picked, setPicked] = useState<string>("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  // Bumped on every materials save so the sign-off card re-reads its blockers
  // and marks — a save can lapse a mark and always moves the completeness
  // answer its buttons obey.
  const [signoffVersion, setSignoffVersion] = useState(0);

  useEffect(() => {
    void (async () => {
      const r = await fetch(API, { cache: "no-store" });
      const res = await readJson<{ batches: BatchRow[] }>(r);
      if (res.ok && res.data) setBatches(res.data.batches);
      else setNote({ text: res.error ?? `Could not load batches (${res.status})`, ok: false });
    })();
  }, []);

  const load = useCallback(async (batchKey: string) => {
    if (!batchKey) { setDetail(null); return; }
    const r = await fetch(`${API}?batchKey=${encodeURIComponent(batchKey)}`, { cache: "no-store" });
    const res = await readJson<Detail>(r);
    if (res.ok && res.data) setDetail(res.data);
    else { setDetail(null); setNote({ text: res.error ?? `Could not load (${res.status})`, ok: false }); }
  }, []);

  useEffect(() => { void load(picked); }, [picked, load]);

  if (!batches) {
    return <Card><Empty>Loading the batches…</Empty></Card>;
  }

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Batch</h2>
        <select
          value={picked} onChange={(e) => { setPicked(e.target.value); setNote(null); }}
          className="w-full max-w-xl rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">Pick a batch…</option>
          {batches.map((b) => (
            <option key={b.batchKey} value={b.batchKey}>
              {b.batch} · {b.design} · {b.slabs} slabs · {b.lastPress ?? "no press date"}
            </option>
          ))}
        </select>
        {batches.length === 0 && (
          <p className="mt-2 text-sm text-gray-500">No batches with mixer records in the last 45 days.</p>
        )}
      </Card>

      {/* The same sign-off card the admin has on Batch costing, in the same
          place: state, blockers and the buttons for whoever may sign. */}
      {detail && <SignoffCard batchKey={detail.batchKey} version={signoffVersion} onChanged={() => void load(picked)} />}

      {note && (
        <div className={`rounded-xl border px-4 py-2.5 text-sm ${
          note.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
        }`}>
          {note.text}
        </div>
      )}

      {/* The verifiers' flat table — one row per material the mixer used,
          supplier and price beside the mixer's figure — talking to the same
          batch-rates and grit-assignment APIs the admin's panel does (which
          admit the two verifiers; the routes are the gate). The admin's own
          materials panel is still reachable from the table's "Open the full
          panel" toggle, unchanged, for anything the table does not cover. The
          verifiers had been handed that panel directly and reported it "not
          very intuitive to understand and put weights / percentages and costs".

          GATED ON sign, NOT can, and that is load-bearing: it is what decides
          who can TYPE a price here, not merely read one. Admin used to fail
          this test - signableSides returned [] for ADMIN - so an admin opening
          this page saw neither the pricing panel nor the grit panel below and
          had no way to tell why. Admin signs as of 2026-08-21, so both appear.

          Saving re-reads the detail below, because an edit can lapse a mark and
          always moves the completeness answer the buttons obey. */}
      {detail && sign.length > 0 && (
        <SimpleMaterialsEntry
          key={detail.batchKey}
          batchKey={detail.batchKey}
          batchLabel={detail.batch}
          onSaved={() => { setSignoffVersion((v) => v + 1); void load(picked); }}
        />
      )}

      {/* The silo-by-silo grit panel that stood here is GONE. Its rows now live
          inside the materials panel above, in the slot the size-band cards used
          to occupy, carrying the price alongside the size, type and supplier.
          Two screens described the same tonnage two different ways - once by
          band, once by silo - and nothing made them agree. See GritSiloRows. */}

      {detail && can.includes("WEIGHTS") && detail.weights && (
        <Card>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">What the mixer weighed</h2>
          <p className="mb-3 mt-0.5 text-xs text-gray-400">The consumption recorded against this batch — the half you mark as Consumption above.</p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 p-3">
              <p className="text-xs text-gray-500">Resin</p>
              <p className="text-lg font-medium text-gray-900">{num.format(detail.weights.resinKg)} kg</p>
              <p className="text-xs text-gray-400">{detail.weights.resinCycles} cycles</p>
            </div>
            <div className="rounded-xl border border-gray-200 p-3">
              <p className="text-xs text-gray-500">Filler 400#</p>
              <p className="text-lg font-medium text-gray-900">{num.format(detail.weights.fillerKg / 1000)} t</p>
              <p className="text-xs text-gray-400">{num.format(detail.weights.fillerKg)} kg</p>
            </div>
            <div className="rounded-xl border border-gray-200 p-3">
              <p className="text-xs text-gray-500">Mixer charges</p>
              <p className="text-lg font-medium text-gray-900">{detail.weights.mixerCharges}</p>
            </div>
          </div>

          {detail.weights.resinByTank.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-medium text-gray-500">Resin per daily tank</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className={td}>Tank</th><th className={td}>Cycles</th><th className={`${td} text-right`}>kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.weights.resinByTank.map((t) => (
                      <tr key={t.tank} className="border-t border-gray-100">
                        <td className={td}>{t.tank}</td>
                        <td className={td}>{t.cycles}</td>
                        <td className={`${td} text-right`}>{num.format(t.kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-4">
            <p className="mb-1 text-xs font-medium text-gray-500">Grit per silo</p>
            {detail.weights.gritCharges.length === 0 ? (
              <p className="text-sm text-gray-500">No silo-linked grit on this batch.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className={td}>Silo</th><th className={td}>Band</th><th className={`${td} text-right`}>kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.weights.gritCharges.map((g, i) => (
                      <tr key={`${g.silo}-${g.band}-${i}`} className="border-t border-gray-100">
                        <td className={td}>{g.silo}</td>
                        <td className={td}>{g.band}</td>
                        <td className={`${td} text-right`}>{num.format(g.kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {detail.weights.gritUnresolvedKg > 0 && (
              // Reported rather than dropped: grit whose bags yield no SIZE BAND.
              // Not "no silo" - it has one, and on the silo path it is priced there
              // is still grit the batch consumed, and hiding it would make the
              // silo table quietly disagree with the tonnage.
              <p className="mt-2 text-xs text-amber-700">
                {num.format(detail.weights.gritUnresolvedKg)} kg has no size band on its bag records.
              </p>
            )}
          </div>

        </Card>
      )}

      {detail && can.includes("COSTS") && detail.prices && (
        <Card>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Rates used for this batch</h2>
          <p className="mb-3 mt-0.5 text-xs text-gray-400">
            Card rates as they stood on {detail.prices.onDate}, the batch&rsquo;s own run date — the half you mark as Prices above.
          </p>

          {Object.keys(detail.prices.resinBySupplier).length > 0 && (
            <div className="mb-4">
              <p className="mb-1 text-xs font-medium text-gray-500">Resin, per supplier</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(detail.prices.resinBySupplier).map(([s, r]) => (
                  <span key={s} className="rounded-lg border border-gray-200 px-2.5 py-1 text-sm">
                    {s} <span className="font-medium">₹{money.format(r)}</span>
                    <span className="text-xs text-gray-400"> per kg</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className={td}>Item</th>
                  <th className={`${td} text-right`}>Card rate</th>
                  <th className={td}>Set on this batch</th>
                </tr>
              </thead>
              <tbody>
                {detail.prices.items.map((it) => (
                  <tr key={it.item} className="border-t border-gray-100 align-top">
                    <td className={td}>{it.label}</td>
                    <td className={`${td} text-right`}>
                      {it.cardRate == null ? (
                        <span className="text-amber-700">not on the card</span>
                      ) : (
                        <>₹{money.format(it.cardRate)}<span className="text-xs text-gray-400"> /{it.unit}</span></>
                      )}
                    </td>
                    <td className={td}>
                      {it.batchLines.length === 0 ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {it.batchLines.map((l) => (
                            <li key={l.seq}>
                              ₹{money.format(l.rate)}
                              <span className="text-xs text-gray-400"> /{it.unit}</span>
                              {l.description && <span className="text-xs text-gray-500"> · {l.description}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {detail.prices.missing.length > 0 && (
            <p className="mt-3 text-xs text-amber-700">
              {detail.prices.missing.length} catalogue item
              {detail.prices.missing.length === 1 ? " has" : "s have"} no rate at or before this
              batch&rsquo;s run date. Anything the batch consumed will be reported unpriced.
            </p>
          )}

        </Card>
      )}

      {detail && can.length === 2 && sign.length === 0 && (
        <Card>
          <p className="text-sm text-gray-500">
            You can read both halves and sign neither. A verification is one named person saying
            they checked it — each of the two verifiers marks both the consumption and the prices.
          </p>
        </Card>
      )}
    </div>
  );
}
