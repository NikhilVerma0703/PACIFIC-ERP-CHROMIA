import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// Server-side proxy to the Python finance engine (automation/ in this repo,
// running on the office machine next to Tally). The API key lives here and in
// the engine's config.yaml only — it must never reach browser JavaScript, so
// the ERP UI talks to these routes and never to the engine directly.
const BASE = (process.env.FINANCE_ENGINE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const KEY = process.env.FINANCE_ENGINE_KEY ?? "";

// Only the engine's documented resource roots — this is not an open relay to
// its built-in Jinja UI, /docs, or anything else that may exist on that host.
const ALLOWED = new Set(["people", "bills", "batches", "ledgers", "export", "exports"]);

/** FINANCE / ACCOUNTS in the Office branch, or an admin. Returns the audit
 * username for X-User, or null. Middleware enforces the same rule earlier —
 * this is defense in depth, matching how other office APIs gate themselves. */
async function gate(): Promise<string | null> {
  const u = await currentUser();
  if (!u) return null;
  const role = (u as { role?: string }).role ?? "";
  const branch = ((u as { branch?: string }).branch as string | undefined) ?? "SHOP_FLOOR";
  const ok = role === "ADMIN" || (branch === "OFFICE" && (role === "FINANCE" || role === "ACCOUNTS"));
  if (!ok) return null;
  return String(u.name || u.email || "erp-user");
}

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const user = await gate();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { path } = await params;
  if (!path?.length || !ALLOWED.has(path[0])) {
    return NextResponse.json({ error: "Unknown engine route" }, { status: 404 });
  }
  // Every segment, not just the first. encodeURIComponent leaves ".." intact and
  // fetch resolves it, so "bills/../../admin" would otherwise escape /api/v1/ and
  // reach the engine's unauthenticated Jinja routes.
  if (!path.every((s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== "." && s !== "..")) {
    return NextResponse.json({ error: "Unknown engine route" }, { status: 404 });
  }

  const url = `${BASE}/api/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers: Record<string, string> = { "X-API-Key": KEY, "X-User": user };

  let body: BodyInit | undefined;
  if (req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      body = await req.formData(); // re-encoded with a fresh boundary by fetch
    } else {
      body = await req.text();
      headers["Content-Type"] = "application/json";
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: req.method, headers, body, cache: "no-store" });
  } catch {
    return NextResponse.json(
      { error: "The finance engine is not reachable. Check that it is running and FINANCE_ENGINE_URL points at it." },
      { status: 502 },
    );
  }

  // Stream the engine's response through untouched — JSON, bill images and the
  // Tally XML download all pass this way.
  const out = new Headers();
  for (const h of ["content-type", "content-disposition"] as const) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST };
