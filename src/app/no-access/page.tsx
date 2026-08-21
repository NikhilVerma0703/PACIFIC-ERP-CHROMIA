import type { Metadata } from "next";
import Link from "next/link";

import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { currentUser } from "@/lib/rbac";
import { homeFor } from "@/lib/routeCaps.ts";

import { GoBack } from "./go-back";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "No access | Pacific ERP" };

/**
 * "You cannot open that."
 *
 * Every capped role used to be bounced silently to its home page. That is the
 * worst possible answer to a click: the page you asked for does not appear, no
 * reason is given, and the address bar quietly says something else — which
 * reads as a broken link, so people click it again and then ask whether the ERP
 * is down.
 *
 * Saying so costs nothing and leaks nothing. The path is echoed back because
 * the person already typed or clicked it, and knowing WHICH link was refused is
 * the difference between "I need access to the costing screen" and "the ERP
 * keeps throwing me out".
 */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.from) ? sp.from[0] : sp.from;

  // Only ever a path on this site. `from` arrives in a URL a user can edit, so
  // rendering it unchecked would put an attacker's text — or an off-site link —
  // on a trusted page. Anything that is not a plain absolute path is dropped.
  // It is never used as an href either way; it is displayed as text.
  const from = raw && /^\/[A-Za-z0-9/_\-.]*$/.test(raw) && !raw.startsWith("//")
    ? raw
    : null;

  const user = await currentUser();
  const role = String((user as { role?: string } | null)?.role ?? "");
  const branch = String((user as { branch?: string } | null)?.branch ?? "");

  const body = (
    <Card>
      <h1 className="text-xl font-semibold tracking-tight text-gray-900">
        {user ? "You do not have access to that page" : "You need to sign in"}
      </h1>

      <p className="mt-2 text-sm text-gray-600">
        {user ? (
          <>
            {from ? (
              <>
                Your login is not allowed to open{" "}
                <span className="font-mono text-gray-900">{from}</span>.
              </>
            ) : (
              <>Your login is not allowed to open that page.</>
            )}{" "}
            Nothing went wrong and nothing was lost — the page simply is not part of what this
            account can see.
          </>
        ) : (
          <>You are not signed in, so there is nothing to show here.</>
        )}
      </p>

      {user && (
        <p className="mt-2 text-sm text-gray-500">
          If you need it, ask an administrator to add it to your access. Tell them the address
          above; it is the fastest way for them to find the right setting.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <GoBack fallback={user ? homeFor(role, branch) : "/login"} />
        <Link
          href={user ? homeFor(role, branch) : "/login"}
          className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          {user ? "Go to my start page" : "Sign in"}
        </Link>
      </div>
    </Card>
  );

  // NO Shell WITHOUT A SESSION.
  //
  // This page is public in both gates — it has to be, or a cap could refuse the
  // very page it redirects refusals to. But Shell renders the sidebar from
  // `branch ?? "SHOP_FLOOR"` and `role ?? ""`, which for a signed-out visitor
  // evaluates to the FULL production nav — Batch Lookup, CEO Report, Tables,
  // Data Entry — plus a Sign out button, to somebody with no session at all.
  // Fixed here rather than in Shell because Shell is on every page in the app
  // and this is the only one that is both public and wrapped in it.
  if (!user) {
    return (
      <main className="min-h-screen bg-gray-50 px-4 py-16">
        <div className="mx-auto max-w-xl">{body}</div>
      </main>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-xl py-10">{body}</div>
    </Shell>
  );
}
