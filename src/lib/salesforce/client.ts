// TALKING TO SALESFORCE — the I/O half, and the only file here that makes a
// network call. Every DECISION lives in stock-rules.ts and limits.ts, which are
// pure and tested; this fetches, posts, and refuses.
//
// NO npm DEPENDENCY. The client-credentials flow is a form POST and a bearer
// header; jsforce would be a large dependency for that, and the JWT fallback
// the design describes is signable with node:crypto if it is ever needed.
//
// CREDENTIALS COME FROM THE ENVIRONMENT AND ARE NEVER LOGGED. Nothing here
// prints, returns or stores SF_CLIENT_SECRET, and the token is held only in
// module memory for the life of a warm lambda.
// `.ts` ON THE SPECIFIER, as stock-rules.ts already does for ../thickness.ts:
// node's ESM resolver does not guess extensions, and `npm test` runs through it.
import { forbiddenPath, mayWrite, WRITABLE_OBJECTS } from "./limits.ts";

/** The API version every path is built from. One place, so a bump is one edit. */
export const SF_API_VERSION = "v62.0";

export interface SfConfig {
  loginUrl: string;
  clientId: string;
  clientSecret: string;
}

/**
 * THE MY DOMAIN URL, NOT login.salesforce.com. The administrator was explicit
 * (2026-09-16): the client-credentials flow must go to the org's own domain,
 * `https://computing-saas-1373.my.salesforce.com`. A token request to the
 * generic login host fails for this grant type.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): SfConfig | null {
  const loginUrl = String(env.SF_LOGIN_URL ?? "").trim().replace(/\/+$/, "");
  const clientId = String(env.SF_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.SF_CLIENT_SECRET ?? "").trim();
  if (!loginUrl || !clientId || !clientSecret) return null;
  return { loginUrl, clientId, clientSecret };
}

/** Which of the three is missing — for an operator-readable refusal that never
 *  reveals a value. */
export function missingConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  return (["SF_LOGIN_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"] as const)
    .filter((k) => !String(env[k] ?? "").trim());
}

interface Token {
  access: string;
  instance: string;
  /** Epoch millis after which we re-ask rather than risk a 401 mid-run. */
  until: number;
}

let cached: Token | null = null;

/** Salesforce access tokens last a good while; we hold one for 20 minutes and
 *  then ask again, which is shorter than any run and cheaper than a retry. */
const TOKEN_TTL_MS = 20 * 60 * 1000;

export function forgetToken(): void {
  cached = null;
}

export interface SfLimits {
  used: number | null;
  total: number | null;
}

let lastLimits: SfLimits = { used: null, total: null };
export function limitsSeen(): SfLimits {
  return { ...lastLimits };
}

/** `Sforce-Limit-Info: api-usage=3700/160000` — read off every response so the
 *  admin page can show it and the run can stand down if the ORG is nearly out. */
function noteLimits(res: Response): void {
  const raw = res.headers.get("sforce-limit-info");
  const m = /api-usage=(\d+)\/(\d+)/i.exec(raw ?? "");
  if (m) lastLimits = { used: Number(m[1]), total: Number(m[2]) };
}

export class SfError extends Error {
  readonly status: number;
  readonly body?: string;
  // ASSIGNED IN THE BODY, NOT AS CONSTRUCTOR PARAMETER PROPERTIES. Parameter
  // properties are the one piece of TypeScript that node's --experimental-strip-types
  // cannot erase, and that flag is how `npm test` runs. Written the short way, this
  // single line made the whole module unloadable by the test runner, so nothing in
  // client.ts could ever be unit-tested — a silent ceiling, since no test failed.
  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = "SfError";
    this.status = status;
    this.body = body;
  }
}

/**
 * A bearer token by the client-credentials grant, cached in module memory.
 *
 * The secret is sent in the body as the flow requires and appears nowhere else:
 * not in the returned object, not in an error message, not in a log line. A
 * failure reports the STATUS and Salesforce's error code, never the request.
 */
export async function getToken(cfg: SfConfig, now = Date.now()): Promise<Token> {
  if (cached && cached.until > now) return cached;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(`${cfg.loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  noteLimits(res);
  const text = await res.text();
  if (!res.ok) {
    // Salesforce answers {"error":"invalid_client","error_description":"..."}.
    // The description is safe to surface; the request is not.
    let detail = "";
    try {
      const j = JSON.parse(text) as { error?: string; error_description?: string };
      detail = [j.error, j.error_description].filter(Boolean).join(": ");
    } catch { detail = text.slice(0, 200); }
    throw new SfError(`Salesforce refused the token request (${res.status}). ${detail}`, res.status);
  }
  const json = JSON.parse(text) as { access_token?: string; instance_url?: string };
  if (!json.access_token || !json.instance_url) {
    throw new SfError("Salesforce returned a token response with no token in it.", 502);
  }
  cached = { access: json.access_token, instance: json.instance_url.replace(/\/+$/, ""), until: now + TOKEN_TTL_MS };
  return cached;
}

/**
 * One authenticated call.
 *
 * REFUSES A FORBIDDEN PATH BEFORE IT IS SENT. limits.forbiddenPath names
 * /process/approvals, through which approve, reject, submit AND RECALL all go —
 * and the recall is the one the administrator's own trigger cannot see, because
 * it leaves Approval_Status__c untouched. This is the last place to stop it, so
 * it is stopped here rather than trusted not to be written.
 */
async function call(cfg: SfConfig, path: string, init: RequestInit = {}): Promise<Response> {
  if (forbiddenPath(path)) {
    throw new SfError(`Refused: ${path} is not a path this integration may call.`, 403);
  }
  const token = await getToken(cfg);
  const res = await fetch(`${token.instance}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token.access}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  noteLimits(res);
  // A 401 on a cached token means it was revoked or expired early; drop it so
  // the next call re-asks rather than failing the whole run.
  if (res.status === 401) forgetToken();
  return res;
}

/** SOQL, following nextRecordsUrl to the end. */
export async function soql<T>(cfg: SfConfig, query: string, cap = 10_000): Promise<T[]> {
  const out: T[] = [];
  let path = `/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(query)}`;
  for (;;) {
    const res = await call(cfg, path);
    const text = await res.text();
    if (!res.ok) throw new SfError(`SOQL failed (${res.status}): ${text.slice(0, 300)}`, res.status, text);
    const page = JSON.parse(text) as { records?: T[]; done?: boolean; nextRecordsUrl?: string };
    out.push(...(page.records ?? []));
    if (page.done !== false || !page.nextRecordsUrl || out.length >= cap) break;
    path = page.nextRecordsUrl;
  }
  return out;
}

export interface CompositeResult {
  id?: string;
  success: boolean;
  errors?: Array<{ statusCode?: string; message?: string; fields?: string[] }>;
}

/**
 * A composite update or upsert, 200 records per call.
 *
 * allOrNone FALSE, deliberately: one bad row must not discard 199 good ones,
 * and the per-record results tell us exactly which failed and why — which is
 * what the mirror needs so a failure is retried next run rather than forgotten.
 *
 * REFUSES AN OBJECT OUTSIDE THE ALLOWLIST. The integration user's profile can
 * write 27 field-service objects it has no business touching; limits.mayWrite
 * is asked here, at the last moment, as well as wherever the payload was built.
 */
export async function compositePatch(
  cfg: SfConfig,
  sobject: string,
  records: Array<Record<string, unknown>>,
  externalIdField?: string,
): Promise<CompositeResult[]> {
  if (!mayWrite(sobject)) {
    throw new SfError(
      `Refused: the ERP may not write ${sobject}. It writes ${WRITABLE_OBJECTS.join(", ")} and nothing else.`,
      403,
    );
  }
  const results: CompositeResult[] = [];
  for (let i = 0; i < records.length; i += 200) {
    const chunk = records.slice(i, i + 200);
    const path = externalIdField
      ? `/services/data/${SF_API_VERSION}/composite/sobjects/${sobject}/${externalIdField}`
      : `/services/data/${SF_API_VERSION}/composite/sobjects`;
    const body = externalIdField
      ? { allOrNone: false, records: chunk.map((r) => ({ attributes: { type: sobject }, ...r })) }
      : { allOrNone: false, records: chunk.map((r) => ({ attributes: { type: sobject }, ...r })) };
    const res = await call(cfg, path, { method: "PATCH", body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new SfError(`Composite PATCH on ${sobject} failed (${res.status}): ${text.slice(0, 300)}`, res.status, text);
    results.push(...(JSON.parse(text) as CompositeResult[]));
  }
  return results;
}

/** A single record create — used only for Integration_Log__c. */
export async function createRecord(
  cfg: SfConfig,
  sobject: string,
  record: Record<string, unknown>,
): Promise<CompositeResult> {
  if (!mayWrite(sobject)) {
    throw new SfError(`Refused: the ERP may not write ${sobject}.`, 403);
  }
  const res = await call(cfg, `/services/data/${SF_API_VERSION}/sobjects/${sobject}`, {
    method: "POST",
    body: JSON.stringify(record),
  });
  const text = await res.text();
  if (!res.ok) return { success: false, errors: [{ message: text.slice(0, 300) }] };
  return { ...(JSON.parse(text) as CompositeResult), success: true };
}

/** Who the token belongs to — the cheapest possible proof the wiring works. */
export async function whoAmI(cfg: SfConfig): Promise<{ name: string; username: string; orgId: string }> {
  const res = await call(cfg, `/services/oauth2/userinfo`);
  const text = await res.text();
  if (!res.ok) throw new SfError(`userinfo failed (${res.status}): ${text.slice(0, 200)}`, res.status, text);
  const j = JSON.parse(text) as { name?: string; preferred_username?: string; organization_id?: string };
  return { name: j.name ?? "", username: j.preferred_username ?? "", orgId: j.organization_id ?? "" };
}
