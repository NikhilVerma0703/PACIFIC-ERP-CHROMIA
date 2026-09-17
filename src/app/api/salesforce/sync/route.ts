// GET /api/salesforce/sync — push ERP stock into Salesforce.
//
// TWO WAYS IN, and both are deliberate:
//
//   · `x-cron-secret` / `Authorization: Bearer <CRON_SECRET>` — how Vercel's
//     cron will call it, gated exactly like /api/report/slab-intake-digest.
//     Without CRON_SECRET set this path refuses everything rather than falling
//     open, which is the lesson that route already paid for.
//   · AN ADMIN SESSION — so the owner can open the dry run in a browser and
//     read the summary without a terminal or a secret. The first thing anyone
//     does with this route is look at what it WOULD do, and making that require
//     curl and a credential is how it does not get looked at.
//
// ?dry=1 READS EVERYTHING AND WRITES NOTHING. It runs the same code path a real
// run does — the same queries, the same rules, the same diff — and returns
// before the first write. Both the owner and Pacific's Salesforce administrator
// asked to read the summary before anything goes out, and a rehearsal that
// takes a different path is not a rehearsal.
//
// WRITES ALSO REQUIRE SF_ENABLED. Deploying this file changes nothing on its
// own: without that variable a non-dry call refuses rather than writing. So the
// order is deploy, read the dry summary, then enable — and each step is
// reversible by the one before it.
import { NextResponse } from "next/server";
import { secretEqual } from "@/lib/secretEqual";
import { commercialGate } from "@/lib/commercial/access";
import { syncStock } from "@/lib/salesforce/stock";
import { missingConfig, readConfig, whoAmI, SfError } from "@/lib/salesforce/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function bySecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (secretEqual(req.headers.get("x-cron-secret"), secret)) return true;
  return secretEqual(req.headers.get("authorization"), `Bearer ${secret}`);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const phase = url.searchParams.get("phase") ?? "stock";

  // An admin session is accepted for a READ; a write still wants the cron
  // secret or SF_ENABLED, so a logged-in admin cannot start a push by
  // mistyping a URL.
  let allowed = bySecret(req);
  let asAdmin = false;
  if (!allowed) {
    const g = await commercialGate("admin", "settings");
    allowed = g.ok;
    asAdmin = g.ok;
  }
  if (!allowed) {
    return NextResponse.json(
      { error: process.env.CRON_SECRET ? "Not authorized" : "CRON_SECRET is not configured" },
      { status: 401 },
    );
  }

  const missing = missingConfig();
  if (missing.length) {
    return NextResponse.json(
      { ok: false, reason: `Salesforce is not configured. Missing: ${missing.join(", ")}` },
      { status: 200 },
    );
  }

  // The cheapest possible proof the credentials work, before anything else
  // runs: who does this token belong to?
  if (phase === "whoami") {
    try {
      const who = await whoAmI(readConfig()!);
      return NextResponse.json({ ok: true, ...who });
    } catch (e) {
      const err = e as SfError;
      return NextResponse.json({ ok: false, error: err.message, status: err.status ?? 500 }, { status: 200 });
    }
  }

  if (phase !== "stock") {
    return NextResponse.json({ ok: false, reason: `Unknown phase "${phase}". Only "stock" and "whoami" exist yet.` }, { status: 400 });
  }

  // A WRITE NEEDS SF_ENABLED, whoever is asking. An admin reading the dry
  // summary is the expected use; an admin accidentally writing is not.
  if (!dry && process.env.SF_ENABLED !== "1") {
    return NextResponse.json(
      { ok: false, reason: "SF_ENABLED is not set, so nothing is written. Add ?dry=1 to read what a run would do." },
      { status: 200 },
    );
  }
  if (!dry && asAdmin && !bySecret(req)) {
    return NextResponse.json(
      { ok: false, reason: "A live push runs from the cron, not from a browser. Use ?dry=1 to read what it would do." },
      { status: 200 },
    );
  }

  try {
    const summary = await syncStock({ dry, asOf: new Date().toISOString() });
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const err = e as Error;
    // 500 so a failed cron run shows red in Vercel's log rather than being
    // recorded as a success that did nothing.
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
