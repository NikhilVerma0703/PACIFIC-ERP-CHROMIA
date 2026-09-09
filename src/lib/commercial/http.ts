// Route-handler helpers shared by every /api/office/commercial/* handler.
//
//   const g = await commercialGate("write"); if (!g.ok) return deny(g);
//   const body = await readBody<{ name: string }>(req);
//   return json(plain(row));
//
// plain() matters: Prisma returns NUMERIC columns as Decimal objects and
// DATE/TIMESTAMP as Date; JSON.stringify would emit Decimal as a string and
// Date as ISO, and the client would then do arithmetic on "784.8867". plain()
// turns Decimal into number and leaves Date as ISO, recursively, so every
// handler returns the same shapes and every screen can Number() nothing.
import { NextResponse } from "next/server";
import type { CommercialGate } from "./access";

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function deny(g: CommercialGate): NextResponse {
  return json({ error: g.status === 401 ? "Please sign in." : "Not available for this login." }, g.status);
}

export function bad(message: string, status = 400): NextResponse {
  return json({ error: message }, status);
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Throw from any depth; catch once in the handler with `handle`. */
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

/** Tolerant body read: an empty or non-JSON body is {} rather than a 500. */
export async function readBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    if (!text.trim()) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

/** Run a handler body; HttpError → its status, anything else → 500 with the
 *  message logged and returned (this is an internal tool; the message helps). */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    const msg = (e as Error)?.message ?? String(e);
    console.error("[commercial]", msg);
    return json({ error: msg }, 500);
  }
}

function isDecimalLike(v: unknown): v is { toNumber(): number } {
  return typeof v === "object" && v !== null && typeof (v as { toNumber?: unknown }).toNumber === "function"
    && typeof (v as { toFixed?: unknown }).toFixed === "function";
}

/** Decimal → number, Date → ISO string, bigint → number, recursively. */
export function plain<T = unknown>(v: unknown): T {
  if (v === null || v === undefined) return v as T;
  if (isDecimalLike(v)) return v.toNumber() as T;
  if (typeof v === "bigint") return Number(v) as T;
  if (v instanceof Date) return v.toISOString() as T;
  if (Array.isArray(v)) return v.map((x) => plain(x)) as T;
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = plain(x);
    return out as T;
  }
  return v as T;
}

/** Parse a number from a form/JSON field; null when absent or not a number. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Parse an integer the same way. */
export function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

/** Trim a string field; null when blank. */
export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** A YYYY-MM-DD or ISO string → Date at UTC midnight; null when not a date. */
export function dateOnly(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Route params in Next 15 are a promise. */
export async function paramId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!id) fail(400, "Missing id");
  return id;
}
