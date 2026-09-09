"use client";

// TAKE SAMPLES OUT OF A USED SLAB'S OFFCUT.
//
// The owner: "not all the wastage to samples — only wastage taken to samples by
// the sample guy. He should see slab wastage on used slab, then he can click the
// slab and enter the size and quantity, then take from that until it empties."
//
// That is this screen, in that order:
//
//   1. EVERY USED SLAB, with how much offcut is left on it, most first
//   2. CLICK ONE       and the intake form opens bound to that slab — no typing
//                      a slab number from memory, no wrong id
//   3. SIZE + QUANTITY and a live readout: what is left, what this take costs,
//                      what would remain
//   4. AGAIN          the list re-reads after every take, so he can keep going
//                      off the same slab until it says empty
//
// ─────────────────────── WHY THIS IS NOT /sampling/add-stock ────────────────
// That screen says in its own header: "this screen has no slab in front of it."
// Its source is a free-text "slab or bag number", which is right for a residual
// bag or a special cut and wrong for offcut: he cannot see where there is stone
// to take, and a mistyped number means fabrication never learns the stone has
// gone. Both screens stay — they are two different questions. This one starts
// from the slab.
//
// ─────────────────────── ONLY WHAT IS TAKEN IS CREDITED ─────────────────────
// The figure that moves when he takes is sampledAreaSqft, and it moves by the
// area of the pieces he booked — not by the slab's whole wastage. The rest
// stays wastage. That is the distinction the owner is drawing and it is what
// computeSlabLoss already did; what was missing was any way to record the take
// against the right slab, and any check that it fits.
//
// ─────────────────────── THE SCREEN CANNOT OFFER WHAT THE ROUTE REFUSES ─────
// The remaining figure, the fit check and the wording all come from
// lib/sampling/slabOffcut.ts, which /api/sampling/intake calls before it writes.
// One function, so a take this screen shows as fitting cannot be refused for
// not fitting — the failure decideSendToCutting exists to prevent on the
// fabrication side.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SampleIntakeForm, useSamplingPickLists } from "@/components/sampling/SampleIntakeForm";
import { INTAKE_SOURCE } from "@/lib/sampling/fabIntake";
import { decideOffcutTake } from "@/lib/sampling/slabOffcut";

interface OffcutSlab {
  slabId: string;
  slabCode: string;
  colour: string | null;
  thicknessMm: number | null;
  projectCode: string | null;
  slabAreaSqft: number;
  usedAreaSqft: number;
  sampledAreaSqft: number;
  availableSqft: number;
  availablePct: number | null;
  empty: boolean;
  overCommitted: boolean;
  pieceCount: number;
}

/** How the slab's stone is divided, as one bar: order / already sampled / left.
 *  Three colours because they are three different facts, and the whole point of
 *  this screen is that the third is not the sum of the other two. */
function OffcutBar({ s }: { s: OffcutSlab }) {
  if (s.slabAreaSqft <= 0) {
    return <span className="text-[11px] text-slate-400">no size recorded</span>;
  }
  const pct = (n: number) => Math.max(0, Math.min(100, (n / s.slabAreaSqft) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100 flex">
        <div className="h-full bg-slate-400" style={{ width: `${pct(s.usedAreaSqft)}%` }}
             title={`${s.usedAreaSqft} sqft on the purchase order`} />
        <div className="h-full bg-violet-500" style={{ width: `${pct(s.sampledAreaSqft)}%` }}
             title={`${s.sampledAreaSqft} sqft already taken as samples`} />
        <div className="h-full bg-emerald-400" style={{ width: `${pct(s.availableSqft)}%` }}
             title={`${s.availableSqft} sqft of offcut left`} />
      </div>
      <span className={`text-xs font-bold tabular-nums ${s.empty ? "text-slate-400" : "text-emerald-700"}`}>
        {s.availableSqft} <span className="font-normal text-slate-400">sqft</span>
      </span>
    </div>
  );
}

export default function SamplingOffcutsPage() {
  const { series, sizes, loading: listsLoading, error: listsError, reloadSizes } = useSamplingPickLists();

  const [slabs, setSlabs] = useState<OffcutSlab[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  /** What he has typed into the open form, mirrored here so the readout can
   *  price the take BEFORE he presses save. Display only — the form owns the
   *  real values and the route re-checks them. */
  const [draft, setDraft] = useState<{ lengthIn: string; widthIn: string; qty: string }>(
    { lengthIn: "", widthIn: "", qty: "" },
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sampling/slab-offcuts");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(String(data?.error ?? "Could not read the slab list."));
      } else {
        setSlabs(Array.isArray(data?.slabs) ? data.slabs : []);
        setLoadError(null);
      }
    } catch {
      setLoadError("Could not reach the server.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const open = useMemo(() => slabs.find((s) => s.slabId === openId) ?? null, [slabs, openId]);

  // THE READOUT, from the same function the route decides with.
  const verdict = useMemo(() => {
    if (!open) return null;
    const take = [{
      lengthIn: Number(draft.lengthIn) || 0,
      widthIn: Number(draft.widthIn) || 0,
      quantity: Number(draft.qty) || 0,
    }];
    return decideOffcutTake(
      {
        slabAreaSqft: open.slabAreaSqft,
        usedAreaSqft: open.usedAreaSqft,
        sampledAreaSqft: open.sampledAreaSqft,
      },
      take,
    );
  }, [open, draft]);

  const withOffcut = slabs.filter((s) => !s.empty).length;

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Take Samples from Offcut</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Used slabs and how much stone is left on each. Click a slab, enter the size and
            quantity, and keep taking until it is empty.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/sampling/add-stock"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition hover:border-gray-300">
            Add stock (no slab)
          </Link>
          <Link href="/sampling"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition hover:border-gray-300">
            Inventory
          </Link>
        </div>
      </div>

      {/* WHAT THE GREEN BAND MEANS, said once. The whole screen turns on the
          difference between "wastage" and "wastage taken to samples". */}
      <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        <span className="inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" /> on the purchase
        order &middot;{" "}
        <span className="inline-block h-2 w-2 rounded-full bg-violet-500 align-middle" /> already taken as
        samples &middot;{" "}
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" /> offcut still
        available. Only what you actually take is credited as sampled — the rest stays wastage.
      </p>

      {loadError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{loadError}</p>
      )}
      {listsError && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{listsError}</p>
      )}

      {added.length > 0 && (
        // A SESSION LIST, the same idea as /sampling/add-stock: taking is done
        // in a batch and the only way to know the fifth one landed is to see
        // the first four still on screen.
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Taken just now</div>
          <ul className="mt-1 space-y-0.5">
            {added.map((a, i) => (
              <li key={i} className="text-xs text-emerald-900">{a}</li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
          Reading the slabs…
        </div>
      ) : slabs.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
          No used slabs yet. A slab appears here once pieces have been put on it.
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-400">
            {withOffcut} of {slabs.length} slab{slabs.length === 1 ? "" : "s"} still {withOffcut === 1 ? "has" : "have"} offcut
          </p>
          <div className="space-y-2">
            {slabs.map((s) => {
              const isOpen = s.slabId === openId;
              const takeable = !s.empty && !s.overCommitted && s.slabAreaSqft > 0;
              return (
                <div key={s.slabId}
                     className={`overflow-hidden rounded-xl border bg-white ${
                       isOpen ? "border-indigo-300" : "border-slate-200"}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(isOpen ? null : s.slabId);
                      setDraft({ lengthIn: "", widthIn: "", qty: "" });
                    }}
                    // AN EMPTY SLAB IS STILL CLICKABLE — it opens and says why
                    // there is nothing to take. A dead button tells him nothing.
                    className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                    aria-expanded={isOpen}
                  >
                    <span className={`text-xs text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                    <span className="font-mono font-bold text-slate-900">{s.slabCode}</span>
                    <span className="text-xs text-slate-500">{s.colour ?? "—"}</span>
                    {s.thicknessMm != null && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                        {s.thicknessMm} mm
                      </span>
                    )}
                    {s.projectCode && (
                      <span className="font-mono text-[10px] text-slate-400">{s.projectCode}</span>
                    )}
                    <span className="text-[11px] text-slate-400">{s.pieceCount} pcs cut</span>
                    {s.overCommitted && (
                      <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                        over-allocated
                      </span>
                    )}
                    {s.empty && !s.overCommitted && (
                      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                        empty
                      </span>
                    )}
                    <span className="ml-auto"><OffcutBar s={s} /></span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                      {/* THE NUMBERS, SPELLED OUT. He is about to remove stone
                          from somebody else's slab; the arithmetic should be
                          checkable without opening another screen. */}
                      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                          { k: "Slab", v: `${s.slabAreaSqft} sqft`, c: "text-slate-700" },
                          { k: "On the order", v: `${s.usedAreaSqft} sqft`, c: "text-slate-700" },
                          { k: "Already sampled", v: `${s.sampledAreaSqft} sqft`, c: "text-violet-700" },
                          { k: "Offcut left", v: `${s.availableSqft} sqft`, c: "text-emerald-700" },
                        ].map((t) => (
                          <div key={t.k} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-slate-400">{t.k}</div>
                            <div className={`mt-0.5 text-sm font-bold tabular-nums ${t.c}`}>{t.v}</div>
                          </div>
                        ))}
                      </div>

                      {!takeable ? (
                        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {/* The refusal in the module's own words, so it reads
                              the same here as it would from the route. */}
                          {decideOffcutTake(
                            { slabAreaSqft: s.slabAreaSqft, usedAreaSqft: s.usedAreaSqft, sampledAreaSqft: s.sampledAreaSqft },
                            [{ lengthIn: 12, widthIn: 12, quantity: 1 }],
                          ).error}
                        </p>
                      ) : (
                        <>
                          {/* THE LIVE READOUT — before he saves, not after. */}
                          {verdict && verdict.takeSqft > 0 && (
                            <p className={`mb-2 rounded-lg border px-3 py-2 text-xs ${
                              verdict.ok
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-red-200 bg-red-50 text-red-700"}`}>
                              {verdict.ok ? (
                                <>
                                  This take is <strong className="tabular-nums">{verdict.takeSqft} sqft</strong> —{" "}
                                  <strong className="tabular-nums">{verdict.remainingAfterSqft} sqft</strong> would be
                                  left on {s.slabCode}
                                  {verdict.remainingAfterSqft === 0 && " (this empties it)"}.
                                </>
                              ) : verdict.error}
                            </p>
                          )}

                          <SampleIntakeForm
                            series={series}
                            sizes={sizes}
                            pickListError={listsError}
                            reloadSizes={reloadSizes}
                            // THE PLACE DECIDES WHY. He is standing at a used
                            // slab, so this is offcut — not a special cut, and
                            // not a question worth asking again.
                            source={INTAKE_SOURCE.OFFCUT}
                            reason="OFFCUT"
                            sourceSlabId={s.slabId}
                            sourceRef={s.slabCode}
                            lockSourceRef
                            colourHint={s.colour}
                            // WITH ITS UNIT. parseThicknessMm refuses a bare
                            // number, so a unitless prefill would look complete
                            // and then fail.
                            thicknessHint={s.thicknessMm != null ? `${s.thicknessMm} mm` : undefined}
                            compact
                            // MIRRORED SO THE READOUT IS LIVE. The form owns
                            // the boxes; this only watches them, and the route
                            // re-checks whatever is actually submitted.
                            onDraftChange={(d) => setDraft({
                              lengthIn: d.length, widthIn: d.width, qty: d.quantity,
                            })}
                            onSaved={(message) => {
                              setAdded((prev) => [`${s.slabCode} · ${message}`, ...prev].slice(0, 12));
                              setDraft({ lengthIn: "", widthIn: "", qty: "" });
                              // RE-READ, so the offcut figure on screen is the
                              // server's after every take. "Until it empties"
                              // only works if the remaining number is true.
                              void load();
                            }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {listsLoading && (
        <p className="mt-3 text-xs text-slate-400">Loading the colour chart and sizes…</p>
      )}
    </div>
  );
}
