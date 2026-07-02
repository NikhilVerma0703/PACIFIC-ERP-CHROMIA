"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Toast } from "./Toast";
import { createRow } from "@/app/tables/actions";
import { getRecordDefaults, searchRmBags } from "@/app/entry/record/actions";
import type { FieldMeta } from "@/lib/tables";
import { OPERATOR_FIELDS } from "@/lib/operatorFields";
import { isCurated, OTHER_SENTINEL, tankLabel } from "@/lib/categoricalFields";
import { secondsToHHMM } from "@/lib/time";
import type { SiloFormInfo, RmBagOption } from "@/lib/silo";

const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const normSize = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

function localNow(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function BagCard({ b, onPick, selected, onClear }: { b: RmBagOption; onPick?: () => void; selected?: boolean; onClear?: () => void }) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900">INV: {b.invNo ?? "—"} <span className="text-gray-400">;</span> Bag: {b.bagNo ?? "—"}</div>
        <div className="shrink-0 text-xs font-medium text-brand">{b.weight != null ? `${b.weight} kg` : "—"}</div>
      </div>
      <div className="mt-0.5 text-xs text-gray-600">
        {[b.size, b.grade, b.type].filter(Boolean).join(" · ") || "—"}
      </div>
      {b.supplier && <div className="text-[11px] text-gray-500">Supplier: {b.supplier}</div>}
    </>
  );
  if (selected) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-brand/40 bg-brand/[0.04] px-3 py-2">
        <div className="min-w-0">{body}</div>
        <button type="button" onClick={onClear} className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50">Change</button>
      </div>
    );
  }
  return (
    <button type="button" onClick={onPick} className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-brand/40 hover:bg-brand/[0.03]">
      {body}
    </button>
  );
}

function SiloInfo({ s, addKg }: { s: SiloFormInfo; addKg?: number | null }) {
  const mat = [s.size, s.grade, s.type].filter(Boolean).join(" · ");
  const showProj = typeof addKg === "number" && addKg > 0;
  return (
    <div className="mt-2 rounded-lg border border-brand/15 bg-brand/[0.03] px-3 py-2 text-xs text-gray-600">
      <div className="font-medium text-gray-800">{mat || "No material info"}</div>
      {s.supplier && <div>Supplier: {s.supplier}</div>}
      <div>Now: {Math.round(s.remaining)} kg · {s.bags} bag{s.bags === 1 ? "" : "s"}</div>
      {(s.deficitKg ?? 0) > 0 && <div className="mt-0.5 font-medium text-red-600">⚠ {s.deficitKg} kg unbacked demand — fully emptying writes this off</div>}
      {showProj && <div className="mt-0.5 font-medium text-brand">After adding: {Math.round(s.remaining + addKg)} kg · {s.bags + 1} bags</div>}
    </div>
  );
}


// Module-scope field component: stable identity across renders so uncontrolled
// inputs are NOT remounted (typed values survive bag search / pick / sku state updates).
function RecordField({ f, def, badge, opts, operatorName }: { f: FieldMeta; def: string; badge: string | null; opts?: string[]; operatorName?: string | null }) {
  const [typeNew, setTypeNew] = useState(false); // curated fields: "+ Add new…" escape
  if (OPERATOR_FIELDS.has(f.prismaField) && operatorName) {
    return (
      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">{f.airtableName}<span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">you</span></span>
        <input name={f.prismaField} defaultValue={operatorName} readOnly className={inputCls + " bg-brand/[0.04] text-gray-700"} />
      </label>
    );
  }
  let input;
  const selectable = (f.airtableType === "singleSelect" || isCurated(f.prismaField)) && opts?.length;
  if (selectable && typeNew) {
    input = (
      <div className="flex gap-1.5">
        <input name={f.prismaField} autoFocus placeholder="type the new value…" className={inputCls} />
        <button type="button" onClick={() => setTypeNew(false)} className="shrink-0 rounded-lg border border-gray-300 px-2 text-xs text-gray-500 hover:bg-gray-50">list</button>
      </div>
    );
  } else if (selectable) {
    const extra = def && !opts!.includes(def) ? [def] : [];
    input = (
      <select name={f.prismaField} defaultValue={def} onChange={(e) => { if (e.target.value === OTHER_SENTINEL) setTypeNew(true); }} className={inputCls}>
        <option value="">—</option>
        {[...extra, ...opts!].map((o) => <option key={o} value={o}>{o}</option>)}
        {isCurated(f.prismaField) && <option value={OTHER_SENTINEL}>+ Add new…</option>}
      </select>
    );
  } else if (f.airtableType === "multipleSelects" && opts?.length) {
    const arr = def ? def.split(",").map((x) => x.trim()) : [];
    input = <div className="flex flex-wrap gap-1.5 rounded-lg border border-gray-200 p-2">{opts.map((o) => <label key={o} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs"><input type="checkbox" name={f.prismaField} value={o} defaultChecked={arr.includes(o)} className="h-3.5 w-3.5" />{o}</label>)}</div>;
  } else if (f.airtableType === "duration") {
    input = <input name={f.prismaField} type="time" defaultValue={def ? secondsToHHMM(Number(def)) : ""} className={inputCls} />;
  } else if (f.kind === "bool") {
    input = <input name={f.prismaField} type="checkbox" defaultChecked={def === "true"} className="h-4 w-4 rounded border-gray-300 text-brand" />;
  } else {
    const type = f.kind === "number" || f.kind === "int" ? "number" : f.kind === "date" ? "datetime-local" : "text";
    input = <input name={f.prismaField} type={type} step={type === "number" ? "any" : undefined} inputMode={f.kind === "int" ? "numeric" : f.kind === "number" ? "decimal" : undefined} defaultValue={def} className={inputCls} />;
  }
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">{f.airtableName}{badge && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">{badge}</span>}</span>
      {input}
    </label>
  );
}

export function SmartRecordForm({ model, tableName, fields, options = {}, operatorName, cfg, silos = [], rmBags = [], hideFields = [], storageTanks = [] }: {
  model: string; tableName: string; fields: FieldMeta[];
  options?: Record<string, string[]>; operatorName?: string | null;
  cfg: SmartRecordClientConfig; silos?: SiloFormInfo[]; rmBags?: RmBagOption[]; hideFields?: string[]; storageTanks?: string[];
}) {
  const [msg, action, pending] = useActionState(createRow, undefined);
  const [key, setKey] = useState("");
  const [defaults, setDefaults] = useState<{ values: Record<string, unknown>; increments: Record<string, number> } | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [bagId, setBagId] = useState("");
  const [weight, setWeight] = useState("");
  const [bagSearch, setBagSearch] = useState("");
  const [bagShow, setBagShow] = useState(60);
  const [serverBags, setServerBags] = useState<RmBagOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickedBag, setPickedBag] = useState<RmBagOption | null>(null);
  const [sku, setSku] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  // After a successful save: toast + re-pull defaults so counters (silo
  // increment, bag no, resin id…) advance automatically for the next record.
  useEffect(() => {
    if (pending || msg !== "ok") return;
    setSavedCount((c) => c + 1);
    // the picked RM bag was just consumed — clear the picker for the next dump
    setBagId(""); setWeight(""); setBagSearch(""); setPickedBag(null); setServerBags([]);
    void loadDefaults(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, msg]);

  // Server-side bag search — any accepted bag is findable, not just the preloaded set.
  useEffect(() => {
    const term = bagSearch.trim();
    if (!term) { setServerBags([]); setSearching(false); return; }
    setSearching(true);
    let active = true;
    const t = setTimeout(async () => {
      try {
        const res = await searchRmBags(term);
        if (active) setServerBags(res);
      } finally {
        if (active) setSearching(false);
      }
    }, 300);
    return () => { active = false; clearTimeout(t); };
  }, [bagSearch]);

  const isFilling = model === "Silo";
  const isResinPrep = model === "DailyResinTank";
  const bag = isFilling && bagId ? pickedBag : null;
  const hidden = new Set(hideFields);
  // For silo filling, weight + inv/bag are driven by the chosen RM bag, so pull them out of the generic grid.
  const editable = fields.filter((f) => f.editable && f.prismaField !== cfg.keyField && !hidden.has(f.prismaField) && !(isFilling && (f.prismaField === "weight" || f.prismaField === "invNoBagNo" || f.prismaField === "sku")));

  async function loadDefaults(k: string) {
    if (cfg.keyField && !k.trim()) return;
    setLoading(true);
    const r = await getRecordDefaults(model, k);
    if (!r) { setLoading(false); return; } // no access to this form
    setDefaults(r); setVersion((v) => v + 1); setLoading(false);
  }

  function pickBag(b: RmBagOption) {
    setBagId(b.id);
    setPickedBag(b);
    setWeight(b.weight != null ? String(b.weight) : "");
  }

  const siloInfo = cfg.silo ? silos.find((s) => s.siloNo === key) : undefined;
  const grit = silos.filter((s) => s.kind === "grit");
  const filler = silos.filter((s) => s.kind === "filler");
  const other = silos.filter((s) => s.kind === "other");
  // RM bags matching the chosen silo's material (fall back to all if none match)
  const matchBySize = isFilling && siloInfo?.size ? rmBags.filter((b) => normSize(b.size) === normSize(siloInfo.size)) : [];
  const bagChoices = matchBySize.length ? matchBySize : rmBags;

  const bagQuery = bagSearch.trim().toLowerCase();
  const filteredBags = bagQuery ? serverBags : bagChoices;

  function dv(f: FieldMeta): string {
    if (cfg.incrementFields.includes(f.prismaField)) {
      const nn = defaults?.increments?.[f.prismaField];
      return nn == null ? "" : String(nn);
    }
    if (cfg.nowFields.includes(f.prismaField) && f.kind === "date") return localNow();
    const v = defaults?.values?.[f.prismaField];
    if (v == null) return "";
    return Array.isArray(v) ? v.join(", ") : String(v);
  }

  function badge(f: FieldMeta): string | null {
    if (cfg.incrementFields.includes(f.prismaField)) return defaults ? "auto · last + 1" : "auto";
    if (cfg.nowFields.includes(f.prismaField)) return "now";
    if (defaults?.values?.[f.prismaField] != null) return "from last";
    return null;
  }

  function clearForm() {
    setKey(""); setDefaults(null); setVersion((v) => v + 1); setBagId(""); setWeight(""); setBagSearch(""); setBagShow(60); setSku("");
  }

  return (
    <form action={action} autoComplete="off">
      <Toast trigger={savedCount} text="Saved — enter the next record" />
      <input type="hidden" name="__model" value={model} />
      {isFilling && bag && <input type="hidden" name="__rmBagId" value={bag.id} />}
      {isFilling && <input type="hidden" name="invNoBagNo" value={bag?.invBag ?? ""} />}

      {!cfg.keyField && (
        <div className="mb-3 flex justify-end">
          <button type="button" onClick={clearForm} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50">Clear form</button>
        </div>
      )}
      {cfg.keyField && (
        <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">{cfg.keyLabel}</div>
            <button type="button" onClick={clearForm} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50">Clear form</button>
          </div>
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
            <div className="block sm:col-span-1">
              <span className="mb-1 block text-xs font-medium text-gray-600">{cfg.keyLabel}</span>
              {cfg.silo ? (
                <select name={cfg.keyField} value={key} required onChange={(e) => { setKey(e.target.value); loadDefaults(e.target.value); setSku(silos.find((x) => x.siloNo === e.target.value)?.sku ?? ""); }} className={inputCls}>
                  <option value="">—</option>
                  {grit.length > 0 && <optgroup label="Grit silos">{grit.map((s) => <option key={s.siloNo} value={s.siloNo}>{s.siloNo}</option>)}</optgroup>}
                  {filler.length > 0 && <optgroup label="Filler silos">{filler.map((s) => <option key={s.siloNo} value={s.siloNo}>{s.siloNo}</option>)}</optgroup>}
                  {other.length > 0 && <optgroup label="Other">{other.map((s) => <option key={s.siloNo} value={s.siloNo}>{s.siloNo}</option>)}</optgroup>}
                </select>
              ) : options[cfg.keyField]?.length ? (
                <select name={cfg.keyField} value={key} required onChange={(e) => { setKey(e.target.value); loadDefaults(e.target.value); }} className={inputCls}>
                  <option value="">—</option>
                  {options[cfg.keyField].map((o) => <option key={o} value={o}>{isResinPrep ? tankLabel(o) : o}</option>)}
                </select>
              ) : (
                <input name={cfg.keyField} value={key} required onChange={(e) => setKey(e.target.value)} onBlur={() => loadDefaults(key)} className={inputCls} />
              )}
              <span className="mt-1 block text-[11px] text-gray-400">{loading ? "Loading…" : cfg.keyHint}</span>
              {siloInfo && <SiloInfo s={siloInfo} addKg={isFilling && weight ? Number(weight) : null} />}
            </div>
          </div>
        </div>
      )}

      <div key={`fields-${version}`} className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Details {defaults ? "· prefilled — edit what changed" : ""}</div>
        {isResinPrep && (
          <div className="mb-4 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">Resin from storage tank<span className="text-red-500"> *</span><span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">deducted &amp; linked</span></span>
              <select name="__storageTank" required className={inputCls} defaultValue="">
                <option value="">—</option>
                {storageTanks.map((t) => <option key={t} value={t}>{tankLabel(t)}</option>)}
              </select>
              <span className="mt-1 block text-[11px] text-gray-400">The kg in &quot;Quantity&quot; are drawn from this tank (FIFO) and linked to the prep.</span>
            </label>
          </div>
        )}
        {isFilling && (
          <div className="mb-4">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">RM bag <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">from inventory</span></span>
            {bag ? (
              <BagCard b={bag} selected onClear={() => { setBagId(""); setWeight(""); setPickedBag(null); }} />
            ) : (
              <>
                <input
                  value={bagSearch}
                  onChange={(e) => { setBagSearch(e.target.value); setBagShow(60); }}
                  placeholder={`Search all bags — e.g. "A&A", "013/26-27" or "11"`}
                  className={inputCls}
                />
                <div className="mt-1 mb-2 text-[11px] text-gray-400">
                  {bagQuery ? (searching ? "Searching…" : `${filteredBags.length} match${filteredBags.length >= 100 ? "+ — refine to narrow" : ""}`) : matchBySize.length ? `${matchBySize.length} bag(s) matching this silo's material — type to search all stock` : `${rmBags.length} recent accepted bag(s) — type to search all stock`}
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50/50 p-2">
                  {filteredBags.length === 0 && <div className="px-2 py-6 text-center text-sm text-gray-400">{searching ? "Searching…" : "No matching bags."}</div>}
                  {filteredBags.slice(0, bagShow).map((b) => <BagCard key={b.id} b={b} onPick={() => pickBag(b)} />)}
                  {filteredBags.length > bagShow && (
                    <button type="button" onClick={() => setBagShow((n) => n + 60)} className="block w-full rounded-lg border border-brand/30 bg-brand/[0.04] px-3 py-2 text-center text-xs font-medium text-brand transition hover:bg-brand/10">
                      Showing {bagShow} of {filteredBags.length} — click to see more
                    </button>
                  )}
                </div>
              </>
            )}
            <div className="mt-3 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">Weight (kg){bag && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">from bag</span>}</span>
                <input name="weight" type="number" step="any" value={weight} readOnly className={inputCls + " bg-brand/[0.04] text-gray-700"} />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">SKU{sku && siloInfo?.sku ? <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">from silo</span> : null}</span>
                <select name="sku" value={sku} onChange={(e) => setSku(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {[...new Set([sku, ...(options.sku ?? [])].filter(Boolean))].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {editable.map((f) => <RecordField key={`${f.prismaField}-${version}`} f={f} def={dv(f)} badge={badge(f)} opts={options[f.prismaField]} operatorName={operatorName} />)}
        </div>
      </div>

      <div className="sticky bottom-0 -mx-5 mt-6 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/85 px-5 py-3 backdrop-blur">
        <div className="text-sm">{msg === "ok" ? <span className="text-green-600">Saved &#10003; — enter the next record</span> : msg ? <span className="text-red-600">{msg}</span> : isFilling && !bag ? <span className="text-amber-600">Pick an RM bag to enable saving</span> : <span className="text-gray-400">{tableName} · smart entry</span>}</div>
        <button disabled={pending || (isFilling && !bag)} onClick={(e) => { if (model === "Mis") { const f = (e.currentTarget as HTMLButtonElement).form; if (f) { const fd = new FormData(f); const sum = ["processDelayDurationMinutes","cleaningDelayDurationMinutes","breakdownDelayDurationMechanicalOrElectricalMinutes","poweroutDelayDurationMinutes"].reduce((a, k) => a + (Number(fd.get(k) || 0) || 0), 0); if (sum > 60) { e.preventDefault(); window.alert(`Total delay for this hour is ${Math.round(sum)} min \u2014 an hour can have at most 60 minutes of downtime. Reduce the delay entries before saving.`); } } return; } if (model !== "SiloEmptyingLog" || !siloInfo) return; const form = (e.currentTarget as HTMLButtonElement).form; const w = form ? Number(new FormData(form).get("bagWeight") || 0) : 0; const demand = siloInfo.deficitKg ?? 0; if (w > 0 && w >= siloInfo.remaining - 1e-6 && demand > 0) { if (!window.confirm(`Silo ${key} will be EMPTIED (${Math.round(siloInfo.remaining)} kg) and its ${demand} kg of unbacked demand WRITTEN OFF so it starts fresh.\n\nThis cannot be undone. Continue?`)) e.preventDefault(); } }} className="min-h-[44px] rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60">{pending ? "Saving…" : "Save record"}</button>
      </div>
    </form>
  );
}

export interface SmartRecordClientConfig {
  keyField?: string;
  keyLabel?: string;
  keyHint?: string;
  silo?: boolean;
  cloneFields: string[];
  incrementFields: string[];
  nowFields: string[];
}
