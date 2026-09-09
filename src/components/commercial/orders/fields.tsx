"use client";
// The form primitives the order screens share — the new-order form and the
// workspace's Overview tab edit the SAME header, so the label, the units and
// the party-block layout are written once here rather than twice, where they
// would drift.
//
// Tailwind class strings rather than styled components, as the rest of the
// office screens do (src/components/office/FinanceBills.tsx).
import type { ReactNode } from "react";
import type { Party } from "@/lib/commercial/types";

export const INPUT =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-brand disabled:bg-gray-50 disabled:text-gray-500";
export const BTN_PRIMARY =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50";
export const BTN =
  "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50";
export const BTN_DANGER =
  "rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50";

/** A red banner. Nothing on these screens throws at the user — every failure
 *  from readJson/postJson lands here, beside the control that caused it. */
export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{children}</div>;
}

export function OkNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{children}</div>;
}

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

export function TextField({ label, value, onChange, placeholder, hint, type = "text", disabled = false, className = "" }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; type?: string; disabled?: boolean; className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input type={type} className={INPUT} value={value} placeholder={placeholder} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function AreaField({ label, value, onChange, rows = 3, placeholder, hint, disabled = false, className = "" }: {
  label: string; value: string; onChange: (v: string) => void;
  rows?: number; placeholder?: string; hint?: string; disabled?: boolean; className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <textarea className={INPUT} rows={rows} value={value} placeholder={placeholder} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SelectField({ label, value, onChange, options, hint, disabled = false, className = "" }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>; hint?: string; disabled?: boolean; className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <select className={INPUT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

/** One figure with its name over it — the advance's asked / received / short
 *  trio, and anything else that is a NUMBER rather than a tick (round two,
 *  answer 11: the advance is money, and the screen says how much). */
export function StatBox({ label, value, hint, tone = "plain" }: {
  label: string; value: string; hint?: string; tone?: "plain" | "good" | "warn";
}) {
  const ring = tone === "good" ? "border-green-200 bg-green-50/60" : tone === "warn" ? "border-amber-200 bg-amber-50/60" : "border-gray-200";
  const text = tone === "warn" ? "text-amber-800" : "text-gray-900";
  return (
    <div className={`rounded-lg border px-3 py-2 ${ring}`}>
      <span className="block text-xs uppercase tracking-wide text-gray-400">{label}</span>
      <span className={`block text-sm font-semibold ${text}`}>{value}</span>
      {hint && <span className="mt-0.5 block text-xs text-gray-400">{hint}</span>}
    </div>
  );
}

// ───────────────────────────── party blocks ──────────────────────────────────

export const emptyPartyDraft = (): PartyDraft => ({ name: "", lines: "", country: "", tel: "", email: "", gstin: "", stateCode: "", code: "" });

/** A party while it is being typed: the address is ONE textarea, because that
 *  is how somebody types an address. It becomes `lines[]` on the way out. */
export interface PartyDraft {
  name: string; lines: string; country: string; tel: string; email: string; gstin: string; stateCode: string; code: string;
}

export function partyToDraft(p: Party | null | undefined): PartyDraft {
  if (!p) return emptyPartyDraft();
  return {
    name: p.name ?? "",
    lines: (p.lines ?? []).join("\n"),
    country: p.country ?? "",
    tel: p.tel ?? "",
    email: p.email ?? "",
    gstin: p.gstin ?? "",
    stateCode: p.stateCode ?? "",
    code: p.code ?? "",
  };
}

/** null when the block names nobody and has no address — an empty consignee
 *  block would print on the PI as a consignee. */
export function draftToParty(d: PartyDraft): Party | null {
  const lines = d.lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const name = d.name.trim();
  if (!name && lines.length === 0) return null;
  const orNull = (v: string) => (v.trim() ? v.trim() : null);
  return {
    name, lines,
    country: orNull(d.country), tel: orNull(d.tel), email: orNull(d.email),
    gstin: orNull(d.gstin), stateCode: orNull(d.stateCode), code: orNull(d.code),
  };
}

export function isBlankDraft(d: PartyDraft): boolean {
  return draftToParty(d) === null;
}

export function PartyEditor({ title, hint, value, onChange, disabled = false }: {
  title: string; hint?: string; value: PartyDraft; onChange: (v: PartyDraft) => void; disabled?: boolean;
}) {
  const set = (k: keyof PartyDraft) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {!disabled && !isBlankDraft(value) && (
          <button type="button" className="text-xs font-medium text-gray-400 hover:text-red-600"
            onClick={() => onChange(emptyPartyDraft())}>Clear</button>
        )}
      </div>
      {hint && <p className="mb-3 text-xs text-gray-400">{hint}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Name" value={value.name} onChange={set("name")} disabled={disabled} className="sm:col-span-2" />
        <AreaField label="Address (one line per printed line)" value={value.lines} onChange={set("lines")} rows={3} disabled={disabled} className="sm:col-span-2" />
        <TextField label="Country" value={value.country} onChange={set("country")} disabled={disabled} />
        <TextField label="Telephone" value={value.tel} onChange={set("tel")} disabled={disabled} />
        <TextField label="Email" value={value.email} onChange={set("email")} disabled={disabled} />
        <TextField label="Customer code" value={value.code} onChange={set("code")} hint="e.g. USA-041, printed on the Cust-Inv copies" disabled={disabled} />
        <TextField label="GSTIN" value={value.gstin} onChange={set("gstin")} disabled={disabled} />
        <TextField label="State code" value={value.stateCode} onChange={set("stateCode")} hint="33 is Tamil Nadu — it decides IGST vs CGST+SGST" disabled={disabled} />
      </div>
    </div>
  );
}

// ───────────────────────────── small shared bits ─────────────────────────────

export const KIND_OPTIONS = [
  { value: "EXPORT", label: "Export" },
  { value: "DOMESTIC", label: "Domestic (DTA)" },
];

export const PO_EVIDENCE_OPTIONS = [
  { value: "", label: "— not recorded —" },
  { value: "PO", label: "Customer purchase order" },
  { value: "PI_ACKNOWLEDGED", label: "Our PI, acknowledged by the customer" },
  { value: "EMAIL", label: "Email from the customer" },
];

export const STATUS_TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  DRAFT: "amber", CONFIRMED: "brand", STOCK_CHECKED: "brand", PI_ISSUED: "brand", PACKING: "brand",
  DISPATCH_CHECK: "amber", READY: "green", INVOICED: "green", DISPATCHED: "green", CLOSED: "green", CANCELLED: "red",
};

/** An ISO instant or a YYYY-MM-DD date column → the Indian office's format. */
export function dmy(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN");
}

export function dmyTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN");
}

/** A @db.Date column arrives as an ISO instant; <input type="date"> wants the
 *  first ten characters of it. */
export function dateInputValue(v: string | null | undefined): string {
  if (!v) return "";
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/** Money the way the module keeps it: amounts 3 dp, never re-rounded upward. */
export function money(n: number | null | undefined, currency?: string | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${currency ? `${currency} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}

export function qty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
