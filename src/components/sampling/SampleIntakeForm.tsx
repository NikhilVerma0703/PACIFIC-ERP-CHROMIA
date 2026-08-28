"use client";

// ADD SAMPLE STOCK — the one form, used in three places.
//
// It is shared because the four questions are identical wherever stock is
// added: which colour+finish, which size, how many, off what. What differs is
// only WHO is asking and WHY, and both of those are props:
//
//   /sampling/add-stock                     the incharge, who says why himself
//   /fab/supervisor/slabs  step 1           a slab cut specially for samples
//   /fab/supervisor/slabs  after step 4     the leftovers off a PO slab
//
// The fabrication placements pass a FIXED source and are not offered the
// choice — see lib/sampling/fabIntake.ts for why that is the point rather than
// an omission. The sampling screen has no slab in front of it, so there it IS a
// question and is asked.
//
// ─────────────────────────────────────────────────────────────── THE SIZE ───
// The size control is the interesting one, and it does two things at once: it
// lists every size already in use, and it accepts a brand-new one typed in,
// which then becomes an option for everybody (there are no standard sizes and
// nobody curates the list — see lib/sampling/size.ts).
//
// A TYPED SIZE IS CHECKED HERE BY parseSampleSize, THE SAME FUNCTION THE ROUTE
// RUNS, and its refusal is shown WORD FOR WORD. Not paraphrased, not replaced
// with "invalid size":
//
//   thickness: thickness needs a unit — "2 mm" or "2 cm"
//   length: length and width are inches — "100 mm" would convert to a
//           near-duplicate size
//
// Those sentences are the rule explaining itself, and the person typing has to
// know which half was wrong and why. Checking client-side as well as
// server-side is not a duplicated rule — it is the same function called twice,
// so the button cannot offer what the route will refuse.
//
// EVERYTHING GOES THROUGH postJson / getJson (lib/fab/postJson.ts), never raw
// fetch: they exist because a 403, a 409 and an expired session looked
// identical to the person using the screen.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getJson, postJson } from "@/lib/fab/postJson";
import { FINISHES } from "@/lib/catalogue/colours";
import { parseSampleSize } from "@/lib/sampling/size";
import { INTAKE_SOURCE, type IntakeSource, type SampleIntakeReason } from "@/lib/sampling/fabIntake";

/* -- What the pick-lists are made of -------------------------------------- */

export interface CatalogueFinish { id: string; finish: string }
export interface CatalogueColour { id: string; name: string; position: number; finishes: CatalogueFinish[] }
export interface CatalogueSeries { id: string; name: string; position: number; colours: CatalogueColour[] }
export interface SizeOption { id: string; lengthIn: number; widthIn: number; thicknessMm: number; label: string }

/** The two lists both the sampling screen and the fab controls need. Loaded
 *  once per screen and handed down, so a slab board with eight cards on it does
 *  not fetch the colour chart eight times. */
export function useSamplingPickLists(enabled = true) {
  const [series, setSeries] = useState<CatalogueSeries[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reloadSizes = useCallback(async () => {
    const r = await getJson<SizeOption>("/api/sampling/sizes");
    setSizes(r.data);
    return r.error;
  }, []);

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [cat, siz] = await Promise.all([
        getJson<CatalogueSeries>("/api/sampling/catalogue"),
        getJson<SizeOption>("/api/sampling/sizes"),
      ]);
      if (cancelled) return;
      setSeries(cat.data);
      setSizes(siz.data);
      // Either failure makes the form unusable rather than merely short: a
      // half-loaded colour chart looks like a chart with colours missing.
      setError(cat.error ?? siz.error);
      setLoading(false);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [enabled, loaded]);

  return { series, sizes, loading, error, reloadSizes };
}

/** Every colour name in the chart — what matchColourName is asked about. */
export function colourNamesOf(series: CatalogueSeries[]): string[] {
  return series.flatMap((s) => s.colours.map((c) => c.name));
}

/* -- The form ------------------------------------------------------------- */

const NEW_SIZE = "__new__";

export function SampleIntakeForm({
  series, sizes, pickListError, reloadSizes,
  source, reason, sourceRef, sourceQcId, sourceSlabId, sourceRefLabel, lockSourceRef,
  colourHint, thicknessHint,
  onSaved, compact,
}: {
  series: CatalogueSeries[];
  sizes: SizeOption[];
  pickListError: string | null;
  reloadSizes: () => Promise<string | null>;
  /** Fixed by the caller when the PLACE decides why (the two fab controls);
   *  omitted on the sampling screen, where it becomes a question. */
  source?: IntakeSource;
  reason?: SampleIntakeReason;
  /** The slab or bag number these came off — what a person reads. */
  sourceRef?: string;
  /** polish_qc.id of that slab, when it has one. The number above is the
   *  readable answer; this is the one that survives a re-typed number and is
   *  what "every sample cut off this slab" joins on. Server-verified. */
  sourceQcId?: string | null;
  /** fab_slab.id of the card this came off. What fabrication's loss and
   *  capacity sums are grouped by — see computeSlabLoss.sampledAreaSqft. */
  sourceSlabId?: string | null;
  sourceRefLabel?: string;
  /** True where the reference is a fact rather than a field — the slab number
   *  on the card this control is sitting inside. */
  lockSourceRef?: boolean;
  /** A colour name to preselect, if the chart holds exactly one of that name. */
  colourHint?: string | null;
  /** A thickness to pre-fill, WITH ITS UNIT ("20 mm"). A bare number is refused
   *  by parseThicknessMm, so a unitless prefill would look complete and fail. */
  thicknessHint?: string;
  onSaved?: (message: string) => void;
  compact?: boolean;
}) {
  const askSource = !source;
  const [chosenSource, setChosenSource] = useState<IntakeSource>(source ?? INTAKE_SOURCE.SPECIAL_CUT);
  const effectiveSource = source ?? chosenSource;

  const [colourName, setColourName] = useState("");
  /** One of FINISHES, by NAME. Not a product_colour_finish id: the row may
   *  not exist yet, and the route creates it on first use. */
  const [finish, setFinish] = useState("");
  const [sizeChoice, setSizeChoice] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [thickness, setThickness] = useState(thicknessHint ?? "");
  const [quantity, setQuantity] = useState("");
  const [ref, setRef] = useState(sourceRef ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A slab's number and thickness arrive with the card and can change when the
  // board reloads; the typed fields are never touched.
  useEffect(() => { setRef(sourceRef ?? ""); }, [sourceRef]);
  useEffect(() => { if (thicknessHint) setThickness((t) => t || thicknessHint); }, [thicknessHint]);
  useEffect(() => { if (colourHint) setColourName((c) => c || colourHint); }, [colourHint]);

  const colours = useMemo(
    () => series.flatMap((s) => s.colours.map((c) => ({ ...c, seriesName: s.name }))),
    [series],
  );
  const colour = colours.find((c) => c.name === colourName) ?? null;

  // Finish is a CHILD ROW, not a column: stock is counted against colour+finish,
  // never the colour, because "50 Cappuccino 4x4" is not a stock figure until
  // you know the finish. A colour with one finish still resolves to that row —
  // it is preselected rather than hidden, so what is being counted stays on
  // screen.
  // ALL FOUR FINISHES, ON EVERY COLOUR.
  //
  // The owner: "I need the finish type of all — polished, suede, matte,
  // leathered." Stock is still counted against colour+finish, never the colour,
  // because "50 Cappuccino 4x4" is not a stock figure until you know the finish.
  // What changed is WHICH finishes are offered: this used to list the colour's
  // existing product_colour_finish ROWS, and the chart only ever printed the
  // variants somebody had photographed — three of 132 lines. So Carrara Royale
  // offered "Polished" and nothing else, and a suede sample could not be
  // recorded at all.
  //
  // A sample can be cut in any finish on request, so all four are always
  // offered and the route creates the row the first time one is used. The
  // colour's EXISTING finishes are marked, so it stays visible which are already
  // on the shelf and which this would be the first of.
  const existingFinishes = useMemo(
    () => new Set((colour?.finishes ?? []).map((f) => f.finish)),
    [colour],
  );
  useEffect(() => {
    if (!colour) { setFinish(""); return; }
    // Keep what is chosen if it is still a finish; otherwise fall to the one
    // finish this colour already has, or to nothing.
    setFinish((cur) => {
      if ((FINISHES as readonly string[]).includes(cur)) return cur;
      const has = colour.finishes.map((f) => f.finish);
      return has.length === 1 ? has[0] : "";
    });
  }, [colour]);

  const typing = sizeChoice === NEW_SIZE || (sizes.length === 0 && sizeChoice === "");
  const typed = typing ? parseSampleSize({ length, width, thickness }) : null;
  // Only once all three fields have something in them: complaining "length:
  // missing" at somebody who has not reached the length box yet is noise.
  const typedTouched = typing && [length, width, thickness].some((v) => v.trim() !== "");
  const sizeRefusal = typed && !typed.ok && typedTouched ? typed.reason : null;

  const wanted = Number(quantity);
  const qtyOk = Number.isInteger(wanted) && wanted > 0;
  const sizeOk = typing ? !!typed?.ok : sizeChoice !== "";
  const ready = !!colour && !!finish && sizeOk && qtyOk && !busy;

  async function save() {
    if (!ready) return;
    setBusy(true); setError(null); setNotice(null);
    const res = await postJson("/api/sampling/intake", {
      // The COLOUR and the FINISH WORD, not a colour+finish row id — the row is
      // created by the route when this pairing is used for the first time.
      colourId: colour?.id,
      finish,
      source: effectiveSource,
      quantity: wanted,
      sourceRef: ref.trim() || null,
      // Sent alongside the readable number, never instead of it. The route
      // verifies the id against polish_qc and refuses one that joins to
      // nothing — an unchecked link is worse than none, because it looks
      // traceable.
      sourceQcId: sourceQcId ?? null,
      sourceSlabId: sourceSlabId ?? null,
      note: note.trim() || null,
      ...(typing ? { length, width, thickness } : { sizeId: sizeChoice }),
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }

    const d = res.data ?? {};
    // "It is now an option for everyone" is the consequence of typing a new
    // size, and the person who typed it is the only one who can still catch a
    // typo. So it is said, every time, rather than being left implicit.
    const madeSize = d.sizeCreated
      ? ` ${d.sizeLabel} is a new size and is now in the list for everyone.`
      : "";
    const message = `Added ${d.quantity} × ${d.item} ${d.sizeLabel}${d.sourceRef ? ` off ${d.sourceRef}` : ""} — ${d.onHand} now in stock.${madeSize}`;
    setNotice(message);
    onSaved?.(message);

    // Keep the colour, the size and the reference: adding four sizes of one
    // colour off one slab is the normal case, and re-picking all three each
    // time is the friction that gets a form abandoned.
    setQuantity("");
    setNote("");
    if (d.sizeCreated && d.sizeId) {
      const e = await reloadSizes();
      if (!e) { setSizeChoice(d.sizeId); setLength(""); setWidth(""); }
    }
  }

  const pad = compact ? "px-3 py-2" : "px-3 py-2";
  const field = `w-full border border-gray-300 rounded-lg ${pad} text-xs bg-white disabled:opacity-50`;
  const label = "block text-[11px] font-medium text-gray-500 mb-1";

  return (
    <div className="space-y-3">
      {pickListError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>The colour chart may be incomplete.</b> {pickListError} A colour missing from the list
          below does not mean it is missing from the chart.
        </div>
      )}

      {askSource && (
        <div>
          <span className={label}>What are these pieces?</span>
          <div className="flex gap-2 flex-wrap">
            {([
              ["SPECIAL_CUT", "Cut for samples"],
              ["OFFCUT", "Offcut from a fabrication job"],
            ] as const).map(([r, text]) => (
              <label key={r}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  chosenSource === INTAKE_SOURCE[r]
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}>
                <input
                  type="radio" name="sample-source" className="sr-only"
                  checked={chosenSource === INTAKE_SOURCE[r]}
                  onChange={() => setChosenSource(INTAKE_SOURCE[r])}
                />
                {text}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="si-colour">Colour</label>
          <select id="si-colour" className={field} value={colourName} disabled={busy}
            onChange={(e) => setColourName(e.target.value)}>
            <option value="">Choose a colour…</option>
            {series.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {s.colours.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="si-finish">Finish</label>
          <select id="si-finish" className={field} value={finish} disabled={busy || !colour}
            onChange={(e) => setFinish(e.target.value)}>
            <option value="">{colour ? "Choose a finish…" : "Pick a colour first"}</option>
            {FINISHES.map((f) => (
              <option key={f} value={f}>
                {f}{existingFinishes.has(f) ? "" : " — new for this colour"}
              </option>
            ))}
          </select>
          {finish && !existingFinishes.has(finish) && (
            <p className="mt-1 text-[11px] text-amber-700">
              First time {colour?.name} has been cut {finish.toLowerCase()} — saving makes it an
              option for everyone.
            </p>
          )}
        </div>
      </div>

      <div>
        <label className={label} htmlFor="si-size">Size</label>
        <select id="si-size" className={field} value={sizeChoice} disabled={busy}
          onChange={(e) => setSizeChoice(e.target.value)}>
          <option value="">{sizes.length ? "Choose a size…" : "No sizes yet — type the first one"}</option>
          {sizes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          <option value={NEW_SIZE}>+ Type a new size…</option>
        </select>
        {typing && (
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <label className={label} htmlFor="si-length">Length (inches)</label>
                <input id="si-length" className={field} value={length} disabled={busy}
                  onChange={(e) => setLength(e.target.value)} placeholder="6" inputMode="decimal" />
              </div>
              <div>
                <label className={label} htmlFor="si-width">Width (inches)</label>
                <input id="si-width" className={field} value={width} disabled={busy}
                  onChange={(e) => setWidth(e.target.value)} placeholder="4" inputMode="decimal" />
              </div>
              <div>
                <label className={label} htmlFor="si-thickness">Thickness (with unit)</label>
                <input id="si-thickness" className={field} value={thickness} disabled={busy}
                  onChange={(e) => setThickness(e.target.value)} placeholder="20 mm" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              Length and width are inches; 4 × 6 and 6 × 4 are the same size. Thickness needs its
              unit — <b>20 mm</b> or <b>2 cm</b> — because &ldquo;2&rdquo; on its own could be either.
              A new size is saved once and becomes an option for everyone.
            </p>
            {/* The refusal, exactly as lib/sampling/size.ts words it. */}
            {sizeRefusal && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                {sizeRefusal}
              </p>
            )}
            {typed?.ok && (
              <p className="mt-2 text-[11px] font-medium text-green-700">
                Reads as {typed.size.lengthIn} × {typed.size.widthIn} in · {typed.size.thicknessMm} mm
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="si-qty">Pieces</label>
          <input id="si-qty" type="number" min={1} className={field} value={quantity} disabled={busy}
            onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="si-ref">{sourceRefLabel ?? "Slab or bag number"}</label>
          <input id="si-ref" className={field} value={ref} disabled={busy || lockSourceRef}
            onChange={(e) => setRef(e.target.value)}
            placeholder={lockSourceRef ? "" : "the number written on the pieces"} />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="si-note">Note (optional)</label>
        <input id="si-note" className={field} value={note} disabled={busy}
          onChange={(e) => setNote(e.target.value)} />
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
          <span><b>Not saved.</b> {error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss"
            className="shrink-0 font-bold text-red-400 hover:text-red-700">✕</button>
        </div>
      )}
      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"
            className="shrink-0 font-bold text-green-400 hover:text-green-700">✕</button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={!ready}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 transition">
          {busy ? "Saving…" : "Add to sample stock"}
        </button>
        {!(colour && finish) && <span className="text-[11px] text-gray-400">Pick a colour and finish</span>}
        {colour && finish && !sizeOk && <span className="text-[11px] text-gray-400">Pick or type a size</span>}
        {colour && finish && sizeOk && !qtyOk && (
          <span className="text-[11px] text-gray-400">How many pieces?</span>
        )}
      </div>
    </div>
  );
}
