"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { currentUser, grantedUser } from "@/lib/rbac";
import { homeFor } from "@/lib/routeCaps.ts";
import { selectContext } from "@/lib/roleContext";
import { clearRoleContextCookie, setRoleContextCookie } from "@/lib/roleContextServer";

export async function logout() {
  // Drop the active-context selector with the session. Not a control — a
  // selector can only ever name a pair the admin granted — but signing back in
  // has to start in the primary job, because that is what login/actions.ts
  // computes its landing page from.
  await clearRoleContextCookie();
  await signOut({ redirectTo: "/login" });
}

/**
 * SWITCH JOB — the server side of the two-option picker in the sidebar.
 *
 * One person, two jobs, one login. This sets which of the pairs an admin
 * granted the session runs as from here on, and lands them on that pair's home
 * page (homeFor, the same function the refusal page and middleware use, so a
 * switch cannot deposit anyone on a screen the next gate refuses).
 *
 * THE VALIDATION IS THE POINT. `context` arrives from a form and is therefore
 * untrusted, so it is never read — it is MATCHED. selectContext() compares it
 * against keys computed from THIS login's own granted pairs and answers null
 * for anything else: a hand-crafted POST naming ADMIN, a pair granted last week
 * and revoked since, or any value at all from a login that holds one job. Null
 * means nothing is written and nothing changes.
 *
 * It is the SAME function the cookie resolver calls (lib/roleContext.ts), so
 * "what may be switched to" and "what a cookie may select" cannot drift apart:
 * one rule, two callers, differing only in what they do with a refusal — this
 * one refuses, the resolver falls back to the primary.
 *
 * grantedUser(), NOT currentUser(): what was GRANTED is the question here, and
 * currentUser() has already had the active pair overlaid onto role/branch — ask
 * it and the job you are standing in looks like your only one.
 */
export async function switchRoleContext(formData: FormData): Promise<void> {
  const me = await grantedUser();
  if (!me) redirect("/login");

  const target = selectContext(me, String(formData.get("context") ?? ""));
  if (!target) {
    // Not granted: write nothing, and put them back on the home of the context
    // they are already in (currentUser = the ACTIVE pair). The honest answer to
    // a request that was never rendered on any screen they were shown.
    const active = await currentUser();
    redirect(homeFor(String(active?.role ?? ""), String((active as { branch?: string } | null)?.branch ?? "")));
  }

  await setRoleContextCookie(target);
  redirect(homeFor(target.role, target.branch));
}
