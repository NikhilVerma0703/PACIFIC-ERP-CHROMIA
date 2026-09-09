// Clients — the PURE rules behind /api/office/commercial/clients.
//
// A Commercial client is a row of the shared sales_clients master plus a
// commercial_client_ext row carrying what a tax invoice and the export
// workbook need (GSTIN, PAN, state code, customer code, printed address
// blocks). Both are written from one form, so one body is parsed here into
// the two Prisma payloads, and the checks that decide what is accepted — a
// GSTIN that is not a GSTIN, a PAN that is not a PAN, a name already on the
// master — live here where node --test can run them.
//
// Imports only ./tax.ts, itself import-free (the GSTIN shape and the state
// code are that module's business, and the invoice builder reads the same
// rule). Tested in tests/commercialClients.test.ts.
import { looksLikeGstin, stateCodeFromGstin } from "./tax.ts";

/** A printed party block — the same shape as lib/commercial/types.ts Party,
 *  restated so this module stays import-light. */
export interface PartyBlock {
  name: string;
  lines: string[];
  country?: string | null;
  tel?: string | null;
  email?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  code?: string | null;
}

/** sales_clients columns the form may set. `isActive` is patch-only. */
export const CLIENT_FIELDS = [
  "name", "email", "phone", "address", "city", "country", "contactPerson",
  "defaultCurrency", "defaultPaymentTerms", "defaultDeliveryTerms", "defaultPortOfDischarge",
] as const;

/** commercial_client_ext scalar columns the form may set. */
export const CLIENT_EXT_FIELDS = [
  "customerCode", "gstin", "pan", "stateCode", "defaultIncoterm", "defaultCurrency", "notes",
] as const;

/** commercial_client_ext JSON columns (Party blocks). */
export const CLIENT_EXT_PARTY_FIELDS = ["billingAddress", "shippingAddress", "notifyParty"] as const;

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
};

const has = (body: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(body, key);

/** Address lines from a textarea or an array: blank lines dropped, each trimmed. */
export function splitLines(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  const raw = Array.isArray(v) ? v.map((x) => String(x ?? "")) : String(v).split(/\r?\n/);
  return raw.map((x) => x.trim()).filter(Boolean);
}

/**
 * A Party block from whatever the form sent: an object, a pasted string
 * (first line the name, the rest the address), or nothing. An empty block —
 * no name and no lines — is null, so a blank form stores NULL rather than
 * `{ name: "", lines: [] }`, and the PI builder's `?? fallback` works.
 */
export function normalizeParty(v: unknown): PartyBlock | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") {
    const lines = splitLines(v);
    if (!lines.length) return null;
    return { name: lines[0], lines: lines.slice(1) };
  }
  if (typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = s(o.name) ?? "";
  const lines = splitLines(o.lines);
  const gstin = s(o.gstin)?.toUpperCase() ?? null;
  const stateCode = s(o.stateCode) ?? (looksLikeGstin(gstin) ? stateCodeFromGstin(gstin) : null);
  if (!name && !lines.length) return null;
  return {
    name,
    lines,
    country: s(o.country),
    tel: s(o.tel),
    email: s(o.email),
    gstin,
    stateCode,
    code: s(o.code),
  };
}

/** cc e-mails from an array or a comma / semicolon / newline separated string. */
export function parseCcEmails(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map((x) => String(x ?? "")) : String(v ?? "").split(/[,;\n]/);
  const out: string[] = [];
  for (const x of raw) {
    const e = x.trim();
    if (e && !out.some((y) => y.toLowerCase() === e.toLowerCase())) out.push(e);
  }
  return out;
}

export type ClientParse =
  | { ok: true; client: Record<string, unknown>; ext: Record<string, unknown>; extTouched: boolean }
  | { ok: false; status: number; error: string };

/**
 * One body → the sales_clients payload and the commercial_client_ext payload.
 *
 * create: `name` required, `country` defaults to "" (the column is NOT NULL),
 *         every other field null when absent.
 * patch:  only the keys present in the body are written, so a partial PATCH
 *         cannot blank the fields it did not mention. `isActive` accepted.
 *
 * GSTIN is upper-cased and must look like one (looksLikeGstin); the state
 * code is derived from it when the form left the code blank. PAN is
 * upper-cased and must be 5 letters, 4 digits, 1 letter.
 */
export function parseClientBody(input: unknown, mode: "create" | "patch"): ClientParse {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const client: Record<string, unknown> = {};
  const ext: Record<string, unknown> = {};
  let extTouched = false;

  for (const k of CLIENT_FIELDS) {
    if (mode === "create" || has(body, k)) client[k] = s(body[k]);
  }
  if (mode === "create") {
    if (!client.name) return { ok: false, status: 400, error: "Name is required." };
    client.country = client.country ?? "";
  } else {
    if (has(body, "name") && !client.name) return { ok: false, status: 400, error: "Name cannot be blank." };
    if (has(body, "country") && client.country === null) client.country = "";
    if (has(body, "isActive")) client.isActive = Boolean(body.isActive);
  }
  if (mode === "create" || has(body, "ccEmails")) client.ccEmails = parseCcEmails(body.ccEmails);

  for (const k of CLIENT_EXT_FIELDS) {
    if (mode === "create" || has(body, k)) { ext[k] = s(body[k]); extTouched = extTouched || has(body, k); }
  }
  for (const k of CLIENT_EXT_PARTY_FIELDS) {
    if (mode === "create" || has(body, k)) { ext[k] = normalizeParty(body[k]); extTouched = extTouched || has(body, k); }
  }

  // Read each field into a local before writing it back: assigning to a
  // property of a Record<string, unknown> resets TypeScript's narrowing to
  // `unknown`, so `ext.gstin = ext.gstin.toUpperCase()` followed by
  // `looksLikeGstin(ext.gstin)` does not compile.
  const rawGstin = ext.gstin;
  if (typeof rawGstin === "string") {
    const gstin = rawGstin.toUpperCase();
    if (!looksLikeGstin(gstin)) {
      return { ok: false, status: 400, error: `"${gstin}" does not look like a GSTIN (15 characters: 2-digit state code, the 10-character PAN, an entity digit, Z, a check character).` };
    }
    ext.gstin = gstin;
    if (!ext.stateCode) ext.stateCode = stateCodeFromGstin(gstin);
  }
  const rawPan = ext.pan;
  if (typeof rawPan === "string") {
    const pan = rawPan.toUpperCase();
    if (!PAN_RE.test(pan)) {
      return { ok: false, status: 400, error: `"${pan}" does not look like a PAN (5 letters, 4 digits, 1 letter).` };
    }
    ext.pan = pan;
  }
  const rawState = ext.stateCode;
  if (typeof rawState === "string") {
    const code = rawState.trim();
    if (!/^\d{2}$/.test(code)) return { ok: false, status: 400, error: `State code "${code}" must be the two-digit GST state code (Tamil Nadu is 33).` };
    ext.stateCode = code;
  }
  const rawCode = ext.customerCode;
  if (typeof rawCode === "string") ext.customerCode = rawCode.toUpperCase();

  return { ok: true, client, ext, extTouched };
}

/** Names compare trimmed, case-insensitively, with runs of whitespace collapsed. */
export function nameKey(name: unknown): string {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The duplicate-name warning. A match is returned as text for the response
 * (`{ ...row, warning }`), never as a refusal: two legal entities can share a
 * trading name, and the person creating the row is the one who knows.
 */
export function duplicateNameWarning(name: unknown, existing: Array<{ id?: string | null; name: string }>, selfId?: string | null): string | null {
  const key = nameKey(name);
  if (!key) return null;
  const hit = existing.find((c) => (!selfId || c.id !== selfId) && nameKey(c.name) === key);
  return hit ? `A client named ${hit.name} already exists` : null;
}

/** The Prisma `where` for the list: active only unless `all`, `q` on name,
 *  e-mail or customer code, case-insensitively. */
export function clientListWhere(opts: { q?: string | null; all?: boolean }): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (!opts.all) where.isActive = true;
  const q = s(opts.q);
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { commercialExt: { is: { customerCode: { contains: q, mode: "insensitive" } } } },
    ];
  }
  return where;
}

/** `?all=1`, `?all=true`, `?all=yes` mean everything; anything else means active only. */
export function wantsAll(v: unknown): boolean {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "all";
}

/** ?page=&limit= → skip/take. Defaults 1 / 50; limit clamped to 1..200. */
export function pageParams(v: { page?: unknown; limit?: unknown }, defaults = { limit: 50, max: 200 }): { page: number; limit: number; skip: number; take: number } {
  const p = Math.floor(Number(v.page));
  const l = Math.floor(Number(v.limit));
  const page = Number.isFinite(p) && p >= 1 ? p : 1;
  const limit = Number.isFinite(l) && l >= 1 ? Math.min(l, defaults.max) : defaults.limit;
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

/** A Party block printed from the master when the client has no address
 *  blocks on file — what an order's bill-to defaults to. */
export function partyFromClient(client: {
  name: string; address?: string | null; city?: string | null; country?: string | null; phone?: string | null; email?: string | null;
}, ext?: { gstin?: string | null; stateCode?: string | null; customerCode?: string | null } | null): PartyBlock {
  const lines = splitLines(client.address);
  const tail = [s(client.city), s(client.country)].filter(Boolean).join(", ");
  if (tail) lines.push(tail);
  return {
    name: client.name,
    lines,
    country: s(client.country),
    tel: s(client.phone),
    email: s(client.email),
    gstin: s(ext?.gstin),
    stateCode: s(ext?.stateCode),
    code: s(ext?.customerCode),
  };
}
