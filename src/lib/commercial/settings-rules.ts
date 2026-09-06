// The settings screen's rules — PURE, node --test importable (tests/
// commercialSettings.test.ts). Imports only the other pure halves of this
// module: the defaults and their merge, the numbering formatter, the GSTIN
// shape check. No Prisma, no Next, no React.
//
// WHAT IS DECIDED HERE
//   validateOverrides   the ONE gate a settings write passes through: a
//                       whitelist walk over the DEFAULT_SETTINGS shape that
//                       coerces "5" to 5, drops keys the defaults do not know,
//                       and refuses values a document could not be printed
//                       from (a hold of 0 days, a template without {seq}, a
//                       phone number in the GSTIN box, a 140% tax rate).
//   pruneDefaults       what actually gets stored: the strict differences from
//                       the defaults, so a value typed equal to its default
//                       keeps following the default when the default moves.
//   diffFromDefaults    which paths a merged view has changed — the screen's
//                       "differs from default" markers.
//   sequenceChange      may this counter be set to that value: lower than the
//                       current next value is refused without force, because
//                       a lowered counter hands out numbers already printed.
//   previewCounters     the number every kind would issue today for a given
//                       settings + counters view (what peekNext does, without
//                       the database, so the PUT handler can answer from the
//                       settings it just wrote rather than a per-request cache).
//
// Paths are dotted ("company.gstin", "numbering.order.template"); arrays are
// leaves (an address is edited as a block).
import { DEFAULT_SETTINGS, mergeSettings, NUMBERING_KINDS, type CommercialSettings, type NumberingKind } from "./settings-defaults.ts";
import { documentNumber, sequenceKey } from "./numbering.ts";
import { looksLikeGstin } from "./tax.ts";

export interface SettingsIssue { path: string; message: string }

export interface OverridesValidation {
  ok: boolean;
  errors: SettingsIssue[];
  /** Worth a look but not a refusal (CGST + SGST not equal to IGST). */
  warnings: SettingsIssue[];
  /** Whitelisted, coerced overrides — every provided, valid leaf; invalid leaves are left out. */
  cleaned: Record<string, unknown>;
  /** Paths the defaults do not know, ignored. */
  dropped: string[];
}

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);
const join = (path: string, k: string): string => (path ? `${path}.${k}` : k);

export const NUMBERING_LABELS: Record<NumberingKind, string> = {
  order: "Internal sales order / PI",
  enquiry: "Enquiry",
  exportInvoice: "Export invoice",
  dtaInvoice: "DTA invoice",
  challan: "Delivery challan",
  packingList: "Packing list",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const SWIFT = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const STATE_CODE = /^\d{2}$/;
const SEQ_PLACEHOLDER = /\{seq(?::\d+)?\}/;
const SEQUENCE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/;

/** Codes that are upper case by definition; a lower-case paste is corrected, not refused. */
function isUpperCasePath(path: string): boolean {
  return path === "company.gstin" || path === "company.pan" || path === "company.iec" || path === "company.tan"
    || /^banks\.\w+\.(ifsc|swift|routingSwift)$/.test(path);
}

// ───────────────────────────── coercion ──────────────────────────────────────
function coerceNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim().replace(/,/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === 0 || v === "0" || v === "false" || v === "off" || v === "no" || v === "") return false;
  return null;
}

function coerceString(v: unknown): string | null {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** A list of lines: an array of strings, or one string split on newlines.
 *  Blank lines go; commas stay (addresses have them). */
function coerceLines(v: unknown): string[] | null {
  const raw: unknown[] | null = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\r?\n/) : null;
  if (!raw) return null;
  const out: string[] = [];
  for (const x of raw) {
    const s = coerceString(x);
    if (s === null) return null;
    if (s) out.push(s);
  }
  return out;
}

// ───────────────────────────── per-field rules ───────────────────────────────
function wholeIn(n: number, lo: number, hi: number, what: string): string | null {
  if (!Number.isInteger(n)) return `${what} must be a whole number`;
  if (n < lo || n > hi) return `${what} must be between ${lo} and ${hi}`;
  return null;
}

function numberIn(n: number, lo: number, hi: number, what: string): string | null {
  if (n < lo || n > hi) return `${what} must be between ${lo} and ${hi}`;
  return null;
}

/** The rule for one leaf, after coercion. Null when the value is fine. */
export function leafIssue(path: string, v: string | number | boolean | string[]): string | null {
  switch (path) {
    case "holdDays": return wholeIn(v as number, 1, 60, "Hold days");
    case "piValidityDays": return wholeIn(v as number, 1, 365, "PI validity");
    case "tax.igstRate": return numberIn(v as number, 0, 100, "IGST rate");
    case "tax.cgstRate": return numberIn(v as number, 0, 100, "CGST rate");
    case "tax.sgstRate": return numberIn(v as number, 0, 100, "SGST rate");
    case "tax.supplierStateCode":
    case "company.stateCode": return STATE_CODE.test(v as string) ? null : "A GST state code is two digits, e.g. 33";
    case "company.gstin": return looksLikeGstin(v as string) ? null : "Does not look like a GSTIN (15 characters, e.g. 33AALCP2750N1Z3)";
    case "company.pan": return !v || PAN.test(v as string) ? null : "Does not look like a PAN (5 letters, 4 digits, 1 letter)";
    case "company.legalName": return (v as string) ? null : "The legal name prints on every document";
    case "company.shortName": return (v as string) ? null : "The short name prints on the DTA invoice and the challan";
    case "company.addressLines": return (v as string[]).length ? null : "At least one address line";
    case "company.email": return !v || EMAIL.test(v as string) ? null : "Not an email address";
    case "company.hsnQuartz":
    case "company.hsnStand": return /^\d{4,8}$/.test(v as string) ? null : "An HSN code is 4 to 8 digits";
    case "notify.mailTo": {
      const bad = (v as string[]).filter((x) => !EMAIL.test(x));
      return bad.length ? `Not email addresses: ${bad.join(", ")}` : null;
    }
    default: break;
  }
  if (/^numbering\.\w+\.template$/.test(path)) {
    const s = v as string;
    if (!s) return "Template is required";
    if (!SEQ_PLACEHOLDER.test(s)) return "Template must contain {seq} (or {seq:N} for N-digit zero padding)";
    return null;
  }
  if (/^numbering\.\w+\.key$/.test(path)) {
    const s = v as string;
    if (!s) return "Counter key is required";
    if (s.includes(":")) return "Counter key cannot contain ':' — it separates the financial year in per-FY keys";
    if (/\s/.test(s)) return "Counter key cannot contain spaces";
    return null;
  }
  if (/^banks\.\w+\.(name|accountNo)$/.test(path)) return (v as string) ? null : "Required — it prints on the invoice";
  if (/^banks\.\w+\.ifsc$/.test(path)) return !v || IFSC.test(v as string) ? null : "Does not look like an IFSC (4 letters, 0, 6 characters)";
  if (/^banks\.\w+\.(swift|routingSwift)$/.test(path)) return !v || SWIFT.test(v as string) ? null : "Does not look like a SWIFT code (8 or 11 characters)";
  return null;
}

/** Checks that need more than one field, run on the merged result. Only an
 *  override can trip them (the defaults pass), so an error always points at
 *  something the caller sent. */
function crossIssues(merged: CommercialSettings, errors: SettingsIssue[], warnings: SettingsIssue[]): void {
  if (merged.notify.mail && merged.notify.mailTo.length === 0) {
    errors.push({ path: "notify.mailTo", message: "Mail is switched on but there is nobody to send to — add a recipient or switch it off" });
  }
  const byKey = new Map<string, NumberingKind[]>();
  for (const k of NUMBERING_KINDS) {
    const key = merged.numbering[k].key;
    byKey.set(key, [...(byKey.get(key) ?? []), k]);
  }
  for (const [key, kinds] of byKey) {
    if (kinds.length < 2) continue;
    for (const k of kinds) {
      const others = kinds.filter((x) => x !== k).map((x) => NUMBERING_LABELS[x]).join(", ");
      errors.push({ path: `numbering.${k}.key`, message: `Counter key "${key}" is also used by ${others} — two document kinds would share one counter` });
    }
  }
  const half = Math.round((merged.tax.cgstRate + merged.tax.sgstRate) * 100) / 100;
  if (half !== merged.tax.igstRate) {
    warnings.push({ path: "tax.cgstRate", message: `CGST + SGST (${half}%) does not equal IGST (${merged.tax.igstRate}%) — an intra-state and an inter-state invoice would carry different tax` });
  }
}

// ───────────────────────────── the walk ──────────────────────────────────────
interface WalkOut { errors: SettingsIssue[]; dropped: string[] }

function walk(base: unknown, over: unknown, path: string, out: WalkOut): unknown {
  if (over === null || over === undefined) return undefined;      // "no override here"
  if (isPlain(base)) {
    if (!isPlain(over)) { out.errors.push({ path: path || "(root)", message: "Expected a group of settings" }); return undefined; }
    const cleaned: Plain = {};
    for (const k of Object.keys(over)) {
      const p = join(path, k);
      if (!(k in base)) { out.dropped.push(p); continue; }
      const c = walk(base[k], over[k], p, out);
      if (c !== undefined) cleaned[k] = c;
    }
    return cleaned;
  }
  if (Array.isArray(base)) {
    const lines = coerceLines(over);
    if (lines === null) { out.errors.push({ path, message: "Expected a list of lines" }); return undefined; }
    const issue = leafIssue(path, lines);
    if (issue) { out.errors.push({ path, message: issue }); return undefined; }
    return lines;
  }
  if (typeof base === "number") {
    const n = coerceNumber(over);
    if (n === null) { out.errors.push({ path, message: "Must be a number" }); return undefined; }
    const issue = leafIssue(path, n);
    if (issue) { out.errors.push({ path, message: issue }); return undefined; }
    return n;
  }
  if (typeof base === "boolean") {
    const b = coerceBoolean(over);
    if (b === null) { out.errors.push({ path, message: "Must be on or off" }); return undefined; }
    return b;
  }
  if (typeof base === "string") {
    let s = coerceString(over);
    if (s === null) { out.errors.push({ path, message: "Must be text" }); return undefined; }
    if (isUpperCasePath(path)) s = s.toUpperCase();
    const issue = leafIssue(path, s);
    if (issue) { out.errors.push({ path, message: issue }); return undefined; }
    return s;
  }
  return undefined;
}

/** The gate. `cleaned` is safe to hand to mergeSettings whether or not `ok`;
 *  the route refuses the write when it is not ok so nothing half-valid lands. */
export function validateOverrides(overrides: unknown, base: CommercialSettings = DEFAULT_SETTINGS): OverridesValidation {
  const out: WalkOut = { errors: [], dropped: [] };
  const warnings: SettingsIssue[] = [];
  const cleaned = (walk(base, overrides ?? {}, "", out) as Plain | undefined) ?? {};
  if (out.errors.length === 0 || isPlain(overrides)) crossIssues(mergeSettings(base, cleaned), out.errors, warnings);
  return { ok: out.errors.length === 0, errors: out.errors, warnings, cleaned, dropped: out.dropped };
}

/** Strip everything equal to its default, then any section left empty. What
 *  remains is the override object to store. */
export function pruneDefaults(cleaned: Record<string, unknown>, base: unknown = DEFAULT_SETTINGS): Record<string, unknown> {
  const prune = (b: unknown, c: unknown): unknown => {
    if (isPlain(b) && isPlain(c)) {
      const out: Plain = {};
      for (const k of Object.keys(c)) {
        if (!(k in b)) continue;
        const v = prune(b[k], c[k]);
        if (v !== undefined) out[k] = v;
      }
      return Object.keys(out).length ? out : undefined;
    }
    if (Array.isArray(b)) return Array.isArray(c) && JSON.stringify(b) === JSON.stringify(c) ? undefined : c;
    return b === c ? undefined : c;
  };
  return (prune(base, cleaned) as Plain | undefined) ?? {};
}

/** Every leaf path of a settings shape, in declaration order. */
export function leafPaths(base: unknown = DEFAULT_SETTINGS, path = ""): string[] {
  if (!isPlain(base)) return path ? [path] : [];
  const out: string[] = [];
  for (const k of Object.keys(base)) out.push(...leafPaths(base[k], join(path, k)));
  return out;
}

/** A list of lines as the walk would store it: trimmed, blanks gone. Used by
 *  the loose comparison so a textarea the user has just pressed Enter in does
 *  not read as "differs from default". */
function normLines(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean);
}

/** Paths where a view differs from the defaults. A missing value is "not
 *  overridden", never a difference.
 *
 *  `loose` is the screen's comparison rather than the stored one: a form holds
 *  what was typed, so holdDays is the STRING "5" while the default is the
 *  NUMBER 5, and a strict compare would mark every number the admin has
 *  touched as changed even when nothing is. The route uses the strict form on
 *  the saved (coerced) view; the screen uses the loose one on its draft. */
export function diffFromDefaults(merged: unknown, base: unknown = DEFAULT_SETTINGS, loose = false): string[] {
  const out: string[] = [];
  const cmp = (b: unknown, m: unknown, path: string): void => {
    if (m === undefined) return;
    if (isPlain(b)) {
      if (!isPlain(m)) return;
      for (const k of Object.keys(b)) cmp(b[k], m[k], join(path, k));
      return;
    }
    if (Array.isArray(b)) {
      const same = loose
        ? JSON.stringify(normLines(b)) === JSON.stringify(normLines(m))
        : JSON.stringify(b) === JSON.stringify(m);
      if (!same) out.push(path);
      return;
    }
    if (loose) {
      if (typeof b === "boolean" ? b !== (coerceBoolean(m) ?? m) : String(b) !== String(m ?? "")) out.push(path);
      return;
    }
    if (b !== m) out.push(path);
  };
  cmp(base, merged, "");
  return out;
}

/** Read a dotted path. */
export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (!isPlain(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Write a dotted path without mutating: every object along the way is copied. */
export function setAt<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const put = (node: unknown, i: number): unknown => {
    const src = isPlain(node) ? node : {};
    if (i === keys.length - 1) return { ...src, [keys[i]]: value };
    return { ...src, [keys[i]]: put(src[keys[i]], i + 1) };
  };
  return put(obj, 0) as T;
}

// ───────────────────────────── counters ──────────────────────────────────────
export type SequenceChange =
  | { ok: true; key: string; value: number }
  | { ok: false; status: 400 | 409; message: string };

/** May counter `key` be set to `nextValue`, given its current next value?
 *  Lowering a counter re-issues numbers already printed on documents, so it
 *  takes `force`. Raising, or setting a counter that does not exist yet, is
 *  the normal case: aligning with Tally's next number. */
export function sequenceChange(input: { key: unknown; nextValue: unknown; current: number | null; force?: unknown }): SequenceChange {
  const key = coerceString(input.key);
  if (!key) return { ok: false, status: 400, message: "Counter key is required" };
  // ':' is legal HERE and nowhere else: a per-FY counter is stored as
  // "<key>:<fy>" (sequenceKey), so the row this sets may carry one even though
  // the key typed in settings may not. The shape check keeps a stray paste
  // from creating a permanent junk row in commercial_sequence.
  if (!SEQUENCE_KEY.test(key)) {
    return { ok: false, status: 400, message: `"${key}" is not a counter key — letters, digits and . _ - : + only, up to 64 characters` };
  }
  const n = coerceNumber(input.nextValue);
  if (n === null || !Number.isInteger(n)) return { ok: false, status: 400, message: "Next value must be a whole number" };
  if (n < 1) return { ok: false, status: 400, message: "Next value must be 1 or more" };
  const force = coerceBoolean(input.force) === true;
  if (input.current !== null && n < input.current && !force) {
    return {
      ok: false, status: 409,
      message: `Counter ${key} is at ${input.current}; setting it to ${n} would reuse numbers already issued. Confirm to set it anyway.`,
    };
  }
  return { ok: true, key, value: n };
}

/** ?page=&limit= for the counter list. Page 1 and 50 a page when unasked;
 *  anything unreadable falls back rather than throwing a list away. */
export function pageArgs(pageRaw: unknown, limitRaw: unknown, defaultLimit = 50, maxLimit = 200): { page: number; limit: number; skip: number; take: number } {
  const p = coerceNumber(pageRaw);
  const l = coerceNumber(limitRaw);
  const page = p !== null && Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1;
  const limit = l !== null && Number.isFinite(l) && l >= 1 ? Math.min(Math.floor(l), maxLimit) : defaultLimit;
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export interface CounterPreview { key: string; next: number; preview: string }

/** What each kind would issue on `at`, from a settings view and the counter
 *  rows. A counter with no row is at 1 — the state the module ships in. */
export function previewCounters(
  settings: CommercialSettings,
  sequences: ReadonlyArray<{ key: string; nextValue: number }>,
  at: Date = new Date(),
): Record<NumberingKind, CounterPreview> {
  const byKey = new Map(sequences.map((s) => [s.key, Number(s.nextValue)]));
  const out = {} as Record<NumberingKind, CounterPreview>;
  for (const kind of NUMBERING_KINDS) {
    const spec = settings.numbering[kind];
    const key = sequenceKey(spec, at);
    const next = byKey.get(key) ?? 1;
    out[kind] = { key, next, preview: documentNumber(spec, at, next) };
  }
  return out;
}
