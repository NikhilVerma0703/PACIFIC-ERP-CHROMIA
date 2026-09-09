"use client";
// The design master (answers 13 and 20; round two, answer 15): design / code /
// shade / confirmed / colour / notes, edited in place, plus "Seed from stock"
// to add a row for every design finished goods knows that is not here yet.
//
// Mounted by /office/commercial/design-codes, which passes readOnly for a
// login whose area access is "view". It must NOT be wrapped in a disabled
// <fieldset> instead: that turns off every control inside, the Find box and
// the unconfirmed filter included, and a viewer who may read a 160-row master
// then cannot search it. So the prop disables exactly the controls that WRITE
// — the code and notes inputs, the shade select, the confirmed checkbox, the
// colour dialog's fields, Seed and Add — and leaves reading alone. The colour
// dialog still OPENS read-only (a viewer has to be able to look the L*a*b* up;
// a refused Save says so on the button). The route gates the area regardless;
// this is only the honest screen.
//
// Each cell saves on blur / change, one PUT per field, because the owner's
// code list arrives design by design and a Save-all button on 160 rows would
// lose a whole afternoon's typing to one bad code. The colour is the one
// exception: name, L*, a*, b* and hex are one reading off one sample, so the
// dialog saves them together.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { postJson } from "@/lib/fab/postJson";
import {
  SHADES, guessShade, normaliseDesignName, normaliseHex, labToHex, hexToLab, designCodePatch, LAB_RANGE,
} from "@/lib/commercial/design-rules";
import { ShadeChip } from "@/components/commercial/production/ShadeChip";
import type { DesignCodeDto } from "@/lib/commercial/types";

const btn = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimary = "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const input = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none disabled:bg-gray-50 disabled:text-gray-500";

/**
 * What a save answers with: the master row (DesignCodeDto now carries the
 * colour columns, so there is nothing to widen here) PLUS what the route's
 * recompute did to the production queue. Saving a colour changes an input to
 * the cleaning rule (round two, answer 14), so the route re-derives the
 * planned hours and hands back { recomputed, warnings } the way the reorder
 * route does; only the message of each warning is read here.
 */
interface QueueEcho {
  recomputed?: number;
  warnings?: Array<{ message?: string }>;
}
type SavedRow = DesignCodeDto & QueueEcho;

/** What the recompute did, said in the same line as the save: a colour
 *  corrected on this screen can move cleaning hours on queued requests nobody
 *  on this screen is looking at, and it must not do that silently. */
function queueNote(echo: QueueEcho): string {
  const parts: string[] = [];
  if (echo.recomputed) parts.push(`Cleaning hours re-derived on ${echo.recomputed} queued request(s).`);
  for (const w of echo.warnings ?? []) if (w.message) parts.push(w.message);
  return parts.join(" ");
}

async function putJson(url: string, body: unknown) {
  let res: Response;
  try {
    res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false as const, error: "No connection — the change was not saved.", data: null };
  }
  const r = await readJson<SavedRow>(res);
  return { ok: r.ok, error: r.error, data: r.data };
}

type Draft = { code: string; notes: string };

const numOrNull = (v: string): number | null => {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

// ───────────────────────────── the colour dialog ─────────────────────────────

interface ColourBody { colourName: string | null; hex: string | null; labL: number | null; labA: number | null; labB: number | null }

/**
 * One design's colour, read off the sample (round two, answer 15).
 *
 * The reading is the L*a*b*; the swatch under it is what those three numbers
 * come to in sRGB. A hex typed into the box OVERRULES that swatch — and, the
 * moment it is a hex, it is turned back into L*a*b* and the three fields are
 * rewritten, because L* is what sequences the production queue (answer 14):
 * a colour fixed by eye must still leave a number behind, or the design
 * quietly drops back to the shade guessed from its name.
 */
function ColourDialog({
  row, readOnly, busy, onClose, onSave,
}: {
  row: DesignCodeDto;
  readOnly: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (body: ColourBody) => void;
}) {
  const [colourName, setColourName] = useState(row.colourName ?? "");
  const [lab, setLab] = useState({ L: str(row.labL), a: str(row.labA), b: str(row.labB) });
  const [hex, setHex] = useState(row.hex ?? "");
  // True while the hex in the box is one somebody typed rather than the one
  // the reading derives. Editing any of L*, a*, b* hands the swatch back to
  // the reading; that is the only way back other than the button.
  const [overruled, setOverruled] = useState(!!row.hex);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const readingOf = (v: { L: string; a: string; b: string }) => {
    const L = numOrNull(v.L), a = numOrNull(v.a), b = numOrNull(v.b);
    return L === null || a === null || b === null ? null : { L, a, b };
  };
  const reading = readingOf(lab);
  const derived = reading ? labToHex(reading.L, reading.a, reading.b) : null;
  const typed = normaliseHex(hex);
  // Half-typed or mistyped: the box holds something that is not a hex. That is
  // a REFUSAL, not a fallback — falling back to the derived hex saved a colour
  // the box was not showing, which is the one thing a swatch screen may never
  // do. Empty is not mistyped: an empty box means "no hex of my own", and the
  // reading's own swatch stands.
  const hexInvalid = hex.trim() !== "" && typed === null;
  const swatch = hexInvalid ? null : (overruled ? typed : null) ?? derived ?? typed;

  /** A hex typed by hand wins, and back-fills the reading so the sequencing
   *  still has an L* (answer 15). */
  function typeHex(v: string) {
    setHex(v);
    setOverruled(true);
    const back = hexToLab(v);
    if (back) setLab({ L: String(back.L), a: String(back.a), b: String(back.b) });
  }

  /** Editing the reading re-derives the swatch, and the box follows it — a
   *  stale typed hex left sitting in the box beside a different swatch is how
   *  the wrong colour gets saved. */
  function typeLab(field: "L" | "a" | "b", v: string) {
    const next = { ...lab, [field]: v };
    setLab(next);
    setOverruled(false);
    const r = readingOf(next);
    setHex(r ? labToHex(r.L, r.a, r.b) : "");
  }

  function useDerived() {
    setOverruled(false);
    setHex(derived ?? "");
  }

  const body: ColourBody = {
    colourName: colourName.trim() ? colourName.trim() : null,
    hex: swatch,
    labL: numOrNull(lab.L), labA: numOrNull(lab.a), labB: numOrNull(lab.b),
  };
  // The very rule the route runs (design-rules.designCodePatch), so a refusal
  // is worded the same on both sides of the wire and nothing is sent that the
  // server would only bounce. The RAW box goes into the check when it holds a
  // non-hex, so the message is the route's own "The hex must read like
  // #F2EFE9" rather than a second wording invented here — and the Save below,
  // which is disabled on `invalid`, refuses with the reason showing.
  const check = designCodePatch({ ...body, ...(hexInvalid ? { hex } : {}) });
  const invalid = check.ok ? null : check.reason;
  const empty = !body.colourName && !body.hex && body.labL === null && body.labA === null && body.labB === null;

  const labField = (field: "L" | "a" | "b", range: readonly [number, number]) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{field}*</span>
      <input
        className={`${input} w-24`} type="number" step="0.01" min={range[0]} max={range[1]} value={lab[field]} disabled={readOnly}
        onChange={(e) => typeLab(field, e.target.value)}
      />
      <span className="text-[10px] text-gray-400">{range[0]} to {range[1]}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true"
      aria-label={`Colour for ${row.design}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{row.design}</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              The reading off the sample. L* decides how long the plant cleans between this design and the one before it.
            </p>
          </div>
          <button type="button" className={`${btn} ml-auto`} onClick={onClose}>Close</button>
        </div>

        {readOnly && (
          <p className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Read-only for this login — the colour is the Commercial Manager&apos;s or an admin&apos;s to set.
          </p>
        )}

        <div className="mt-4 flex gap-4">
          <div className="flex flex-col items-center gap-1">
            <div
              className="h-24 w-24 rounded-xl border border-gray-300"
              style={{ backgroundColor: swatch ?? "transparent", backgroundImage: swatch ? undefined : "repeating-linear-gradient(45deg,#f3f4f6 0 6px,#fff 6px 12px)" }}
              aria-label={swatch ? `Swatch ${swatch}` : "No colour yet"}
            />
            <span className="font-mono text-xs text-gray-500">{swatch ?? "—"}</span>
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Colour name</span>
              <input className={`${input} w-full`} value={colourName} placeholder="Alabaster Noir" disabled={readOnly}
                onChange={(e) => setColourName(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              {labField("L", LAB_RANGE.L)}
              {labField("a", LAB_RANGE.a)}
              {labField("b", LAB_RANGE.b)}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Hex (overrules the reading)</span>
            <input className={`${input} w-40 font-mono uppercase ${hexInvalid ? "border-red-400" : ""}`} value={hex}
              placeholder={derived ?? "#F2EFE9"} disabled={readOnly} aria-invalid={hexInvalid || undefined}
              onChange={(e) => typeHex(e.target.value)} />
          </label>
          {derived && (
            <button type="button" className={btn} disabled={readOnly || (!overruled && (typed ?? "") === derived)} onClick={useDerived}
              title={`Go back to the hex the L*a*b* derives: ${derived}`}>
              Use {derived}
            </button>
          )}
          <span className="pb-2 text-xs text-gray-400">
            {overruled && typed && derived && typed !== derived
              ? `Typed by hand — the reading says ${derived}. The typed hex is what decides.`
              : "Type a hex and the L*a*b* is worked back from it."}
          </span>
        </div>

        {invalid && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{invalid}</div>}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <button
            type="button" className={btnPrimary}
            disabled={readOnly || busy || !!invalid}
            title={readOnly ? "Read-only for this login" : invalid ?? "Save the colour"}
            onClick={() => onSave(body)}
          >{busy ? "Saving…" : "Save colour"}</button>
          <button
            type="button" className={btn}
            disabled={readOnly || busy || empty}
            title={readOnly ? "Read-only for this login" : "Clear the colour — the design goes back to its shade label"}
            onClick={() => onSave({ colourName: null, hex: null, labL: null, labA: null, labB: null })}
          >Clear colour</button>
          <span className="ml-auto text-xs text-gray-400">
            {reading ? `L* ${reading.L} · a* ${reading.a} · b* ${reading.b}` : "L*, a* and b* together derive the swatch"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────── the master ────────────────────────────────

export default function DesignCodesEditor({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [rows, setRows] = useState<DesignCodeDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  const [onlyNoColour, setOnlyNoColour] = useState(false);
  const [newDesign, setNewDesign] = useState("");
  const [colourFor, setColourFor] = useState<string | null>(null);

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

  /** True when the row came back saved — the colour dialog stays open on a
   *  refusal, so the reading the owner just typed is still on the screen. */
  async function save(design: string, body: Record<string, unknown>, said: string): Promise<boolean> {
    setBusy(design); setError(null); setNote(null);
    const r = await putJson(`/api/office/commercial/design-codes/${encodeURIComponent(design)}`, body);
    setBusy(null);
    if (!r.ok || !r.data) { setError(r.error ?? "Could not save"); void load(); return false; }
    // The queue echo rides beside the row and is not part of it; strip it, so
    // nothing but the master row ever goes into `rows`.
    const { recomputed, warnings, ...row } = r.data;
    setRows((rs) => {
      const i = rs.findIndex((x) => x.design === row.design);
      const next = i === -1 ? [...rs, row] : rs.map((x) => (x.design === row.design ? row : x));
      return next.sort((a, b) => a.design.localeCompare(b.design));
    });
    setDrafts((m) => ({ ...m, [row.design]: { code: row.code ?? "", notes: row.notes ?? "" } }));
    const queue = queueNote({ recomputed, warnings });
    setNote(queue ? `${said} ${queue}` : said);
    return true;
  }

  async function seed() {
    setBusy("seed"); setError(null); setNote(null);
    const r = await postJson("/api/office/commercial/design-codes/seed", {});
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Could not seed"); return; }
    take((r.data?.items ?? []) as DesignCodeDto[]);
    const n = Number(r.data?.inserted ?? 0);
    setNote(n ? `${n} design(s) added from stock, shade guessed and unconfirmed, colour left empty: ${(r.data?.designs as string[] ?? []).slice(0, 8).join(", ")}${n > 8 ? "…" : ""}` : "Every design in stock already has a row.");
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
      && (!onlyNoColour || (!r.hex && r.labL === null))
      && (!needle
        || r.design.toLowerCase().includes(needle)
        || (r.code ?? "").toLowerCase().includes(needle)
        || (r.colourName ?? "").toLowerCase().includes(needle)));
  }, [rows, q, onlyUnconfirmed, onlyNoColour]);

  const unconfirmed = rows.filter((r) => !r.shadeConfirmed).length;
  const uncoded = rows.filter((r) => !r.code).length;
  const uncoloured = rows.filter((r) => !r.hex && r.labL === null).length;
  const dialogRow = colourFor ? rows.find((r) => r.design === colourFor) ?? null : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Find</span>
          <input className={`${input} w-56`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Design, code or colour" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
          <input type="checkbox" className="h-4 w-4" checked={onlyUnconfirmed} onChange={(e) => setOnlyUnconfirmed(e.target.checked)} />
          Unconfirmed shades only
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
          <input type="checkbox" className="h-4 w-4" checked={onlyNoColour} onChange={(e) => setOnlyNoColour(e.target.checked)} />
          No colour yet
        </label>
        <span className="pb-2 text-xs text-gray-500">
          {rows.length} design(s) · {unconfirmed} shade(s) unconfirmed · {uncoded} without a code · {uncoloured} without a colour
        </span>
        <button type="button" className={`${btnPrimary} ml-auto`} disabled={readOnly || busy === "seed"} onClick={() => void seed()}
          title={readOnly ? "Codes, shades and colours are changed by the Commercial Manager or an admin" : "Add a row for every finished-goods design not here yet"}>
          {busy === "seed" ? "Seeding…" : "Seed from stock"}
        </button>
      </div>

      {/* No read-only banner here: the page already prints one above this
          editor, and two identical notices stacked read as a bug. */}
      {error &&<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {note && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{note}</div>}

      {loading && !rows.length ? (
        <Empty>Loading the design master…</Empty>
      ) : rows.length === 0 ? (
        <Empty>No designs yet. Seed from stock to start with every design finished goods knows, or add one below.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-2 py-2 text-left">Design</th>
                <th className="px-2 py-2 text-left">Code</th>
                <th className="px-2 py-2 text-left">Shade</th>
                <th className="px-2 py-2 text-left">Confirmed</th>
                <th className="px-2 py-2 text-left">Colour</th>
                <th className="px-2 py-2 text-left">Notes</th>
                <th className="px-2 py-2 text-left">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((r) => {
                const d = drafts[r.design] ?? { code: r.code ?? "", notes: r.notes ?? "" };
                const saving = busy === r.design;
                const swatch = normaliseHex(r.hex);
                return (
                  <tr key={r.design} className={saving ? "opacity-60" : ""}>
                    <td className="px-2 py-1.5 font-medium text-gray-900">
                      {r.design}
                      <div className="mt-0.5">
                        <ShadeChip shade={r.shade} confirmed={r.shadeConfirmed} hex={r.hex} colourName={r.colourName} labL={r.labL} />
                      </div>
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
                    {/* The dialog OPENS for a viewer too — reading the L*a*b*
                        off a design is the whole point of the screen for a
                        login that may not change it; the Save inside is what
                        refuses, and says why. */}
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        className="flex items-center gap-2 rounded-lg border border-gray-300 px-2 py-1 text-left text-xs transition hover:border-brand"
                        onClick={() => setColourFor(r.design)}
                        title={readOnly ? "Look at the colour on file (read-only for this login)" : "Set the colour read off the sample"}
                      >
                        <span
                          className="inline-block h-5 w-5 shrink-0 rounded border border-gray-300"
                          style={{ backgroundColor: swatch ?? "transparent", backgroundImage: swatch ? undefined : "repeating-linear-gradient(45deg,#f3f4f6 0 4px,#fff 4px 8px)" }}
                          aria-hidden
                        />
                        <span className="flex flex-col">
                          <span className="font-medium text-gray-800">{r.colourName ?? (swatch ? swatch : "No colour")}</span>
                          <span className="font-mono text-[10px] text-gray-400">
                            {r.labL === null ? (swatch ?? "set it") : `L* ${Number(Number(r.labL).toFixed(1))}`}
                          </span>
                        </span>
                      </button>
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
                <tr><td colSpan={7} className="px-2 py-6 text-center text-sm text-gray-500">Nothing matches.</td></tr>
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
        <span className="pb-2 text-xs text-gray-400">A design added here gets a guessed shade, unconfirmed and with no colour, like a seeded one.</span>
      </div>

      {dialogRow && (
        <ColourDialog
          key={dialogRow.design}
          row={dialogRow}
          readOnly={readOnly}
          busy={busy === dialogRow.design}
          onClose={() => setColourFor(null)}
          onSave={(body) => {
            const said = body.hex || body.colourName
              ? `${dialogRow.design}: colour saved${body.hex ? ` (${body.hex})` : ""}.`
              : `${dialogRow.design}: colour cleared — the queue reads its shade label again.`;
            void save(dialogRow.design, body as unknown as Record<string, unknown>, said).then((ok) => { if (ok) setColourFor(null); });
          }}
        />
      )}
    </div>
  );
}
