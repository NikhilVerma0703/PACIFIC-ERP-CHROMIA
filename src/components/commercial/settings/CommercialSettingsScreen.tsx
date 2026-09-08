"use client";
// Commercial module settings — one form over the whole settings shape.
//
// HOW IT WORKS. The screen holds a DRAFT of the merged settings (defaults with
// the stored overrides laid over them) and edits it by dotted path. Save posts
// the WHOLE draft as `overrides`; the route whitelists it against the default
// shape, coerces the strings a form sends, and stores only the leaves that
// really differ — so a field left alone keeps following the shipped default
// when that default moves, and no section can be dropped by a partial save.
//
// Every field carries its default: a changed field says what it was and offers
// a reset, because "what did this used to be" is the first question anyone
// asks of a document that has started printing something odd.
//
// The counters are NOT part of that save. They are rows in commercial_sequence
// — the next number each document kind will take — and each is set on its own
// through PATCH …/settings/sequences, which refuses a decrease without an
// explicit confirmation.
//
// WHO SEES WHAT. Nobody but an admin: the page gates "admin" and this screen is
// the form and nothing else. The design-code master used to ride along here so
// the Commercial Manager could reach it without the counters — it has its own
// screen for that now (/office/commercial/design-codes, round two answer 15),
// which is why this screen no longer takes an `actions` prop to decide what to
// draw.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Empty, Badge } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { patchJson } from "@/lib/fab/postJson";
import { NUMBERING_KINDS, type CommercialSettings, type NumberingKind } from "@/lib/commercial/settings-defaults";
import {
  diffFromDefaults, getAt, setAt, previewCounters, NUMBERING_LABELS,
  type CounterPreview, type SettingsIssue,
} from "@/lib/commercial/settings-rules";

// ───────────────────────────── shapes ────────────────────────────────────────
interface SequenceRow { key: string; nextValue: number; updatedAt: string }
type Draft = Record<string, unknown>;

interface SettingsView {
  merged: CommercialSettings;
  overrides: Record<string, unknown>;
  defaults: CommercialSettings;
  changed: string[];
  sequences: SequenceRow[];
  previews: Record<NumberingKind, CounterPreview>;
  warnings?: SettingsIssue[];
  errors?: SettingsIssue[];
  savedAt?: string;
}

interface SequencesReply { items: SequenceRow[]; total: number; page: number; limit: number; previews: Record<NumberingKind, CounterPreview> }

const API = "/api/office/commercial/settings";

// ───────────────────────────── class strings ─────────────────────────────────
const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const inpBad = "w-full rounded-lg border border-red-400 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200";
const lbl = "block text-xs font-medium text-gray-600";
const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const btnSmall = "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

// ───────────────────────────── labels ────────────────────────────────────────
const LABELS: Record<string, string> = {
  holdDays: "Stock hold (days)",
  piValidityDays: "Proforma validity (days)",
  measurementUnitDefault: "Packing list unit",
  "planning.cleaningHoursDefault": "Cleaning between runs (hours)",
  "planning.cleaningHoursAbrupt": "Cleaning after dark → light (hours)",
  "dispatch.advancePctDomestic": "Advance before dispatch — domestic (%)",
  "dispatch.advancePctExport": "Advance before dispatch — export (%)",
  "company.legalName": "Legal name (proforma / export)",
  "company.shortName": "Short name (DTA invoice / challan)",
  "company.addressLines": "Address — one line per line",
  "company.gstin": "GSTIN",
  "company.alternateGstins": "Other GSTINs — one per line, \"Label | GSTIN\"",
  "company.pan": "PAN",
  "company.iec": "IEC",
  "company.tan": "TAN",
  "company.stateCode": "GST state code",
  "company.districtCode": "District code",
  "company.rbiCode": "RBI code",
  "company.locationCode": "Location code",
  "company.customsOffice": "Jurisdictional customs office",
  "company.commissionerate": "Commissionerate",
  "company.division": "Division",
  "company.range": "Range",
  "company.lutText": "LUT text (export invoice / packing list)",
  "company.hsnQuartz": "HSN — quartz slabs",
  "company.hsnStand": "HSN — display stands",
  "company.email": "Email",
  "company.phone": "Phone",
  "defaults.portOfLoading": "Port of loading",
  "defaults.preCarriageBy": "Pre-carriage by",
  "defaults.countryOfOrigin": "Country of origin",
  "defaults.exportPaymentTerms": "Export payment terms",
  "defaults.domesticDeliveryTerms": "Domestic delivery terms",
  "defaults.domesticPaymentTerms": "Domestic payment terms",
  "defaults.unitExport": "Unit — export documents",
  "defaults.unitDomestic": "Unit — domestic documents",
  "texts.piDeclaration": "Proforma declaration",
  "texts.dtaDeclaration": "DTA invoice declaration",
  "texts.noReturn": "Goods once sold",
  "texts.eoe": "Errors and omissions",
  "texts.challanNote": "Challan note",
  "texts.challanApprox": "Challan approximate-value note",
  "tax.igstRate": "IGST rate (%)",
  "tax.cgstRate": "CGST rate (%)",
  "tax.sgstRate": "SGST rate (%)",
  "tax.supplierStateCode": "Supplier state code",
  "tax.alwaysIgst": "Domestic is always IGST",
  "notify.telegram": "Send shortages to Telegram",
  "notify.mail": "Send shortages by email",
  "notify.telegramPrivate": "Telegram to a private chat",
  "notify.mailFromCommercialLogin": "Mail from the Commercial login",
  "notify.mailTo": "Email recipients — one per line",
};

const BANK_LABELS: Record<string, string> = {
  name: "Bank", branch: "Branch", address: "Bank address", accountNo: "Account number",
  ifsc: "IFSC", swift: "SWIFT", adCode: "AD code", routingBank: "Routing (intermediary) bank", routingSwift: "Routing SWIFT",
};

const COMPANY_ORDER = [
  "legalName", "shortName", "addressLines", "email", "phone", "gstin", "alternateGstins", "pan", "iec", "tan",
  "stateCode", "districtCode", "rbiCode", "locationCode", "hsnQuartz", "hsnStand",
  "commissionerate", "division", "range", "customsOffice", "lutText",
];
const BANK_ORDER = ["name", "branch", "address", "accountNo", "ifsc", "swift", "adCode", "routingBank", "routingSwift"];
const TERMS_ORDER = ["portOfLoading", "preCarriageBy", "countryOfOrigin", "exportPaymentTerms", "domesticPaymentTerms", "domesticDeliveryTerms", "unitExport", "unitDomestic"];
const TEXTS_ORDER = ["piDeclaration", "dtaDeclaration", "noReturn", "eoe", "challanNote", "challanApprox"];
const TAX_ORDER = ["alwaysIgst", "igstRate", "cgstRate", "sgstRate", "supplierStateCode"];

/** The hint under a field, where the label alone would leave a question. */
const HINTS: Record<string, string> = {
  "company.alternateGstins": "Offered in the GSTIN dropdown on export documents beside the company GSTIN above, which stays the default (answer 21). One registration per line as \"Label | GSTIN\"; a bare GSTIN is labelled by itself.",
  "tax.alwaysIgst": "answer 22: domestic is always IGST. The buyer's state is not consulted; CGST + SGST is only used when this is off.",
  "notify.telegramPrivate": "On: the message goes to the private chat in TELEGRAM_COMMERCIAL_CHAT_ID (one person, answer 13). Off: the plant group.",
  "notify.mailFromCommercialLogin": "On: sent from the Commercial login's own SMTP when it has one, so the mail carries that person's address (answer 13). Off: the global SMTP.",
};

/** Known keys in a sensible order, then anything the defaults gained since —
 *  nothing in the shape can go un-editable just because this list is stale. */
function orderedKeys(obj: unknown, order: string[]): string[] {
  const keys = obj && typeof obj === "object" ? Object.keys(obj as Record<string, unknown>) : [];
  const known = order.filter((k) => keys.includes(k));
  return [...known, ...keys.filter((k) => !known.includes(k))];
}

function humanise(path: string): string {
  const last = path.split(".").pop() ?? path;
  const spaced = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const labelFor = (path: string): string => LABELS[path] ?? (/^banks\./.test(path) ? BANK_LABELS[path.split(".")[2]] ?? humanise(path) : humanise(path));

type FieldKind = "text" | "area" | "lines" | "number" | "switch" | "select";
interface SelectOption { value: string; label: string }
const UNIT_OPTIONS: SelectOption[] = [{ value: "cm", label: "Centimetres (cm)" }, { value: "in", label: "Inches (in)" }];

function kindFor(path: string, def: unknown): FieldKind {
  if (Array.isArray(def)) return "lines";
  if (typeof def === "boolean") return "switch";
  if (typeof def === "number") return "number";
  if (path.startsWith("texts.") || /(customsOffice|commissionerate|lutText)$/.test(path) || /^banks\.\w+\.(address|routingBank)$/.test(path)) return "area";
  return "text";
}

const showDefault = (v: unknown): string => {
  if (Array.isArray(v)) return v.join(" / ") || "(empty)";
  if (typeof v === "boolean") return v ? "on" : "off";
  const s = String(v ?? "");
  if (!s) return "(empty)";
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const errorMap = (list: SettingsIssue[] | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const e of list ?? []) if (!out[e.path]) out[e.path] = e.message;
  return out;
};

// ───────────────────────────── the screen ────────────────────────────────────
export function CommercialSettingsScreen() {
  // The form's fixed save bar sits over the foot of the page, so the wrapper
  // keeps the bottom padding that stops it covering the last field.
  return (
    <div className="flex flex-col gap-6 pb-28">
      <SettingsForm />
    </div>
  );
}

/** The settings form proper — "admin" only; its API refuses anyone else.
 *  It renders nothing but itself: whatever else the page shows sits beside it
 *  in CommercialSettingsScreen, so this form's loading and error states gate
 *  only the form. */
function SettingsForm() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<SettingsIssue[]>([]);
  const [warnings, setWarnings] = useState<SettingsIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [counterInput, setCounterInput] = useState<Record<string, string>>({});
  const [counterMsg, setCounterMsg] = useState<Record<string, { text: string; ok: boolean; force: boolean }>>({});
  const [counterBusy, setCounterBusy] = useState<string | null>(null);

  const apply = useCallback((data: SettingsView) => {
    setView(data);
    setDraft(clone(data.merged) as unknown as Draft);
    setCounterInput({});
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await fetch(API, { cache: "no-store" }).catch(() => null);
    if (!r) { setLoadError("No connection — the settings could not be loaded."); return; }
    const res = await readJson<SettingsView>(r);
    if (!res.ok || !res.data) { setLoadError(res.error ?? "Could not load the settings"); return; }
    apply(res.data);
    setWarnings(res.data.warnings ?? []);
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  const defaults = view?.defaults ?? null;

  const changedSet = useMemo(() => {
    if (!draft || !defaults) return new Set<string>();
    return new Set(diffFromDefaults(draft, defaults, true));
  }, [draft, defaults]);

  const draftPreviews = useMemo(() => {
    if (!draft || !view) return null;
    try {
      return previewCounters(draft as unknown as CommercialSettings, view.sequences, new Date());
    } catch {
      return view.previews;
    }
  }, [draft, view]);

  const setField = useCallback((path: string, value: unknown) => {
    setDraft((d) => (d ? setAt(d, path, value) : d));
    setErrors((e) => (path in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== path)) : e));
    setSavedAt(null);
  }, []);

  const resetField = useCallback((path: string) => {
    if (!defaults) return;
    setField(path, clone(getAt(defaults, path)));
  }, [defaults, setField]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true); setSaveError(null); setSavedAt(null);
    const r = await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrides: draft }),
    }).catch(() => null);
    setSaving(false);
    if (!r) { setSaveError("No connection — nothing was saved."); return; }
    const res = await readJson<SettingsView>(r);
    if (!res.ok) {
      setSaveError(res.error ?? "Could not save the settings");
      setIssues(res.data?.errors ?? []);
      setErrors(errorMap(res.data?.errors));
      setWarnings(res.data?.warnings ?? []);
      return;
    }
    if (!res.data) { setSaveError("The server answered with nothing."); return; }
    apply(res.data);
    setErrors({}); setIssues([]);
    setWarnings(res.data.warnings ?? []);
    setSavedAt(res.data.savedAt ?? new Date().toISOString());
  }, [draft, apply]);

  const nextOf = useCallback((key: string): number => view?.sequences.find((s) => s.key === key)?.nextValue ?? 1, [view]);

  const setCounter = useCallback(async (key: string, force: boolean) => {
    const typed = counterInput[key];
    setCounterBusy(key);
    const res = await patchJson(`${API}/sequences`, { key, nextValue: typed ?? String(nextOf(key)), force });
    setCounterBusy(null);
    if (!res.ok) {
      setCounterMsg((m) => ({ ...m, [key]: { text: res.error ?? "Could not set the counter", ok: false, force: res.status === 409 } }));
      return;
    }
    const data = res.data as { sequences: SequenceRow[]; previews: Record<NumberingKind, CounterPreview>; sequence: SequenceRow };
    setView((v) => (v ? { ...v, sequences: data.sequences, previews: data.previews } : v));
    setCounterInput((c) => ({ ...c, [key]: String(data.sequence.nextValue) }));
    setCounterMsg((m) => ({ ...m, [key]: { text: `Next number is now ${data.sequence.nextValue}.`, ok: true, force: false } }));
  }, [counterInput, nextOf]);

  const refreshCounters = useCallback(async () => {
    const r = await fetch(`${API}/sequences?limit=200`, { cache: "no-store" }).catch(() => null);
    if (!r) return;
    const res = await readJson<SequencesReply>(r);
    if (res.ok && res.data) setView((v) => (v ? { ...v, sequences: res.data!.items, previews: res.data!.previews } : v));
  }, []);

  // ── one field ──────────────────────────────────────────────────────────────
  const field = (path: string, opts: { label?: string; hint?: string; kind?: FieldKind; rows?: number; options?: SelectOption[] } = {}) => {
    if (!draft || !defaults) return null;
    const def = getAt(defaults, path);
    const value = getAt(draft, path);
    const kind = opts.kind ?? kindFor(path, def);
    const label = opts.label ?? labelFor(path);
    const hint = opts.hint ?? HINTS[path];
    const error = errors[path];
    const changed = changedSet.has(path);
    const cls = error ? inpBad : inp;

    const control = kind === "switch" ? (
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => setField(path, e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand/30" />
        <span className="text-gray-700">{Boolean(value) ? "On" : "Off"}</span>
      </label>
    ) : kind === "select" ? (
      <select id={path} className={cls} value={String(value ?? "")} onChange={(e) => setField(path, e.target.value)}>
        {(opts.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) : kind === "lines" ? (
      <textarea id={path} rows={opts.rows ?? Math.max(2, (Array.isArray(value) ? value.length : 1) + 1)} className={cls}
        value={Array.isArray(value) ? value.join("\n") : String(value ?? "")}
        onChange={(e) => setField(path, e.target.value.split(/\r?\n/))} />
    ) : kind === "area" ? (
      <textarea id={path} rows={opts.rows ?? 3} className={cls} value={String(value ?? "")} onChange={(e) => setField(path, e.target.value)} />
    ) : kind === "number" ? (
      <input id={path} type="number" step="any" className={cls} value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => setField(path, e.target.value)} />
    ) : (
      <input id={path} type="text" className={cls} value={String(value ?? "")} onChange={(e) => setField(path, e.target.value)} />
    );

    return (
      <div key={path} className="min-w-0">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <label htmlFor={path} className={lbl}>
            {label}
            {changed && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle" title="Differs from the default" />}
          </label>
          {changed && (
            <button type="button" onClick={() => resetField(path)} className="shrink-0 text-[11px] font-medium text-gray-400 transition hover:text-brand">
              Reset
            </button>
          )}
        </div>
        {control}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        {!error && hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
        {!error && changed && <p className="mt-1 text-xs text-gray-400">Default: {showDefault(def)}</p>}
      </div>
    );
  };

  const section = (title: string, blurb: string, body: React.ReactNode) => (
    <Card>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="mt-0.5 text-xs text-gray-500">{blurb}</p>
      </div>
      {body}
    </Card>
  );

  // ── counter control, shared by the numbering cards and the counter table ───
  const counterControl = (key: string, compact = false) => {
    const msg = counterMsg[key];
    // The same counter appears twice (its numbering card and the counter
    // table); the id has to differ or the second label points at the first box.
    const id = `ctr-${compact ? "all" : "kind"}-${key}`;
    return (
      <div className={compact ? "" : "mt-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3"}>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={id} className={lbl}>Next number</label>
            <input id={id} type="number" min={1} step={1} className={`${inp} w-32`}
              value={counterInput[key] ?? String(nextOf(key))}
              onChange={(e) => { const v = e.target.value; setCounterInput((c) => ({ ...c, [key]: v })); setCounterMsg((m) => ({ ...m, [key]: { text: "", ok: true, force: false } })); }} />
          </div>
          <button type="button" className={btnSmall} disabled={counterBusy === key} onClick={() => void setCounter(key, false)}>
            {counterBusy === key ? "Setting…" : "Set"}
          </button>
          <span className="text-xs text-gray-400">counter <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px] text-gray-600">{key}</code></span>
        </div>
        {msg && msg.text && (
          <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            {msg.text}
            {msg.force && (
              <button type="button" className="ml-2 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                disabled={counterBusy === key} onClick={() => void setCounter(key, true)}>
                Set it anyway
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── render ─────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>
        <div><button type="button" className={btnGhost} onClick={() => void load()}>Try again</button></div>
      </div>
    );
  }
  if (!view || !draft || !defaults || !draftPreviews) return <Empty>Loading…</Empty>;

  const banks = orderedKeys(defaults.banks, ["export", "domestic"]);

  return (
    <div className="flex flex-col gap-6">
      {/* what is not shipped-default */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={view.changed.length ? "amber" : "green"}>
          {view.changed.length ? `${view.changed.length} saved override${view.changed.length === 1 ? "" : "s"}` : "All at shipped defaults"}
        </Badge>
        {changedSet.size > 0 && <span className="text-xs text-gray-500">{changedSet.size} field{changedSet.size === 1 ? "" : "s"} differ from the default on this screen</span>}
        {savedAt && <span className="text-xs text-green-700">Saved {new Date(savedAt).toLocaleTimeString("en-IN")}</span>}
      </div>

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {warnings.map((w) => <div key={w.path}><span className="font-medium">{labelFor(w.path)}:</span> {w.message}</div>)}
        </div>
      )}
      {saveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="font-medium">{saveError}</div>
          {issues.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
              {issues.map((e) => <li key={`${e.path}:${e.message}`}><span className="font-medium">{labelFor(e.path)}</span> — {e.message}</li>)}
            </ul>
          )}
        </div>
      )}

      {section("Holds and validity", "How long a stock hold lasts, and whether a proforma ever stops being valid.", (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field("holdDays", { hint: "1 to 60 days. Slabs are reserved for this long against the order number; on expiry the order returns to the stock check (answer 11)." })}
          {field("piValidityDays", { hint: "0 = valid forever (the default). Up to 365 days, stamped as 'valid until' when a proforma is issued." })}
        </div>
      ))}

      {section("Packing and planning", "The unit a new packing list prints in (answer 17), and the cleaning the plant needs between production runs (answer 13).", (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field("measurementUnitDefault", { kind: "select", options: UNIT_OPTIONS, hint: "Each packing list can be switched to the other unit on its own screen; the finished-goods record stays in inches." })}
          {field("planning.cleaningHoursDefault", { hint: "Between any two consecutive runs in the queue." })}
          {field("planning.cleaningHoursAbrupt", { hint: "When the run before is dark and this one is light — the abrupt change the owner named." })}
        </div>
      ))}

      {/* Round two, answer 11: the advance is a percentage, and these two are
          the percentages every new order starts from. They shipped at 100 and
          30 and there was nowhere to change them — which made the shipped
          figures the only figures. */}
      {section("Dispatch", "How much of an order must be received before the truck leaves (answer 11). An order may carry its own percentage; these are what a blank one falls back to.", (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field("dispatch.advancePctDomestic", { hint: "0 to 100. Applied to the order total (Σ of the priced lines) — the money must be in, in the order's own currency, before dispatch is allowed." })}
          {field("dispatch.advancePctExport", { hint: "0 to 100. The export default the owner named — the balance follows on CAD or LC terms." })}
        </div>
      ))}

      {section("Document numbering", "The format and the counter behind every number the module issues. A number can still be overridden by hand on the document itself.", (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Every series starts at N1 by design (answers 4 and 8): the N marks a number this ERP issued, and nothing is aligned with Tally.
            A counter is only set by hand to skip numbers, never to continue an old series.
          </div>
          {NUMBERING_KINDS.map((kind) => {
            const base = `numbering.${kind}`;
            const savedKey = view.previews[kind].key;
            const draftKey = draftPreviews[kind].key;
            return (
              <div key={kind} className="rounded-xl border border-gray-200 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-gray-900">{NUMBERING_LABELS[kind]}</h3>
                  <div className="text-sm">
                    <span className="text-xs text-gray-400">next today </span>
                    <code className="rounded bg-brand/10 px-2 py-1 font-semibold text-brand">{draftPreviews[kind].preview}</code>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {field(`${base}.key`, { label: "Counter key" })}
                  {field(`${base}.template`, { label: "Template", hint: "{fy} → 26-27 · {yy} → 26 · {seq} → counter, {seq:5} zero-padded to 5" })}
                  {field(`${base}.perFy`, { label: "Restart each financial year" })}
                </div>
                {counterControl(savedKey)}
                {draftKey !== savedKey && (
                  <p className="mt-2 text-xs text-amber-700">
                    Saving moves this kind to counter <code className="rounded bg-amber-50 px-1">{draftKey}</code>, which starts at 1 — set it before issuing.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {section("Company master", "The exporter block on every document: names, address, registrations and the customs jurisdiction.", (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orderedKeys(defaults.company, COMPANY_ORDER).map((k) => field(`company.${k}`, k === "addressLines" ? { rows: 4 } : {}))}
        </div>
      ))}

      {section("Banks", "The export bank prints on the proforma, the export invoice and the challan; the domestic bank prints on the DTA invoice.", (
        <div className="grid gap-6 lg:grid-cols-2">
          {banks.map((side) => (
            <div key={side} className="rounded-xl border border-gray-200 p-4">
              <h3 className="mb-3 text-sm font-medium text-gray-900">{side === "export" ? "Export bank" : side === "domestic" ? "Domestic bank" : humanise(side)}</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {orderedKeys((defaults.banks as unknown as Record<string, unknown>)[side], BANK_ORDER).map((k) => field(`banks.${side}.${k}`))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {section("Default terms", "What a new order, proforma or invoice starts with. Each document keeps its own copy once created.", (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {orderedKeys(defaults.defaults, TERMS_ORDER).map((k) => field(`defaults.${k}`))}
        </div>
      ))}

      {section("Printed texts", "The declarations and notes at the foot of the documents.", (
        <div className="grid gap-4 lg:grid-cols-2">
          {orderedKeys(defaults.texts, TEXTS_ORDER).map((k) => field(`texts.${k}`))}
        </div>
      ))}

      {section("Tax", "IGST on every domestic invoice (answer 22) and nothing on an export under LUT. The CGST + SGST rates stay for the day the switch is turned off.", (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {orderedKeys(defaults.tax, TAX_ORDER).map((k) => field(`tax.${k}`))}
        </div>
      ))}

      {section("Notifications", "Where a stock shortage is announced besides the Production Planning page (answer 13). A channel whose credentials are not configured is skipped silently and the request records that it went to the planning page only.", (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {field("notify.telegram")}
          {field("notify.telegramPrivate")}
          {field("notify.mail")}
          {field("notify.mailFromCommercialLogin")}
          {field("notify.mailTo", { rows: 3 })}
        </div>
      ))}

      {section("All counters", "What each document kind would take today, then every row in the counter table, including the financial years that have rolled past. Setting one only changes the next number it hands out.", (
        <div className="flex flex-col gap-3">
          {/* Every kind, whether or not its counter has a row yet: a kind that
              has never issued (the PI, until the first one) would otherwise be
              missing from the table that is read to find it. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-3 font-medium">Document</th>
                  <th className="py-2 pr-3 font-medium">Counter</th>
                  <th className="py-2 pr-3 font-medium">Next</th>
                  <th className="py-2 font-medium">Would issue today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {NUMBERING_KINDS.map((kind) => (
                  <tr key={kind}>
                    <td className="py-2 pr-3 text-gray-700">{NUMBERING_LABELS[kind]}</td>
                    <td className="py-2 pr-3"><code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{draftPreviews[kind].key}</code></td>
                    <td className="py-2 pr-3 font-medium text-gray-900">{draftPreviews[kind].next}</td>
                    <td className="py-2"><code className="rounded bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">{draftPreviews[kind].preview}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.sequences.length === 0 ? (
            <Empty>No counter has been set or used yet — every kind starts at 1.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="py-2 pr-3 font-medium">Counter</th>
                    <th className="py-2 pr-3 font-medium">Next</th>
                    <th className="py-2 pr-3 font-medium">Last changed</th>
                    <th className="py-2 font-medium">Set</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {view.sequences.map((s) => (
                    <tr key={s.key} className="align-top">
                      <td className="py-2 pr-3"><code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{s.key}</code></td>
                      <td className="py-2 pr-3 font-medium text-gray-900">{s.nextValue}</td>
                      <td className="py-2 pr-3 text-xs text-gray-500">{new Date(s.updatedAt).toLocaleString("en-IN")}</td>
                      <td className="py-2">{counterControl(s.key, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div><button type="button" className={btnSmall} onClick={() => void refreshCounters()}>Refresh counters</button></div>
        </div>
      ))}

      {/* the save bar stays in reach of a long form */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-3">
          <span className="mr-auto text-xs text-gray-500">
            {changedSet.size === 0 ? "Everything on this screen matches the shipped defaults." : `${changedSet.size} field${changedSet.size === 1 ? "" : "s"} differ from the default. Only those are stored.`}
          </span>
          <button type="button" className={btnGhost} disabled={saving} onClick={() => { apply(view); setErrors({}); setIssues([]); setSaveError(null); }}>
            Discard changes
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
