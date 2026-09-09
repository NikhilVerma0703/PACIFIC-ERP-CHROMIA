"use server";
import { AuthError } from "next-auth";
import { signIn, LoginThrottled } from "@/auth";
import { isCommercialRole } from "@/lib/roles";
import { commercialHomeFor } from "@/lib/commercial/access-rules";
import { prisma } from "@/lib/prisma";

export async function authenticate(
  _prevState: string | undefined,
  formData: FormData
): Promise<string | undefined> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  let redirectTo = "/";
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { role: true, branch: true } });
    if (user && String(user.branch) === "FABRICATION") {
      const role = String(user.role);
      // Fabrication staff land in their part of the fab module (admins use the main shell)
      redirectTo =
        role === "ADMIN"        ? "/" :
        role === "LINE_MANAGER" ? "/fab/manager" :
        role === "INCHARGE"     ? "/fab/supervisor/slabs" :
                                  "/fab/cutting";   // OPERATOR -> straight to work
      // OPERATOR used to land on /fab/session because a machine had to be picked
      // before any queue was reachable. One operator login now covers all five
      // stations, so they land on the first queue; /fab/session is still there
      // (sidebar: "Select Machine") for shift + machine attribution.
    } else if (user) {
      // Commercial's home is Finished Goods. Sending them to "/" only for middleware to
      // bounce it to /inventory means the router never initiated that hop, so the client
      // still reports "/" as the path — which is what highlighted the wrong nav tab on
      // the Finished Goods page. Land them on the real route in the first place.
      // Since 2026-09-06 the Commercial module (/office/commercial) is their
      // start page, and Finished Goods is one row in its nav.
      //
      // WHICH page of it is the area table's answer, not a constant (round two,
      // answer 6: "their landing page is that tab"). A login with no overview —
      // bay 5 today, and any future desk given one screen — lands on the one
      // screen it has instead of on an overview it would be bounced off.
      //
      // WHY THIS ARM IS NARROWER THAN THE MODULE'S ADMISSION TEST. The dispatch
      // team signs in as STORE or LINE_MANAGER (answer 6: no new role), so the
      // module admits them — but those logins are only partly this module's.
      // The store incharge's own home is /live and a shop-floor line manager's
      // is "/", each with a department behind it, and this arm cannot tell the
      // person in bay 5 from the store incharge upstairs: they hold the same
      // role. Answer 6 gave bay 5 a TAB, not a new front door. So only a
      // Commercial role is landed by the area table; the dispatch team keeps
      // the home routeCaps.homeFor gives it, with Dispatch Check in its
      // sidebar, and commercialHomeFor still catches them if they open the
      // module overview they cannot read.
      const who = { role: String(user.role), branch: String(user.branch) };
      if (isCommercialRole(who.role)) {
        redirectTo = commercialHomeFor(who);
      }
    }
  } catch { /* non-critical */ }
  try {
    await signIn("credentials", {
      email:     formData.get("email"),
      password:  formData.get("password"),
      branch:    formData.get("branch") || undefined,
      redirectTo,
    });
  } catch (error) {
    // THE LOCKOUT MESSAGE IS READ HERE OR NOWHERE.
    //
    // This is the only signIn() call site in the app, so `if (error instanceof
    // AuthError)` on its own WAS the throttled-login defect, still intact after
    // it was "fixed": LoginThrottled extends CredentialsSignin extends
    // AuthError, so it landed in the generic branch below and its userMessage —
    // together with the Postgres countdown in auth.ts that computes the
    // minutes — was unreachable code. Anyone typing the RIGHT password during
    // the 15-minute lock was still told their password was wrong, still phoned
    // for a reset, and the reset (resetPasswordRecord bumps sessionVersion)
    // still signed their phone and tablet out.
    //
    // Not hypothetical: login_attempt is live and counting — 7 keys on the
    // production database, three of them written today, high-water mark n=4 of
    // the FAILS_MAX=10 that locks (measured 2026-09-03). One shift of somebody
    // fat-fingering a password reaches the lock.
    //
    // ORDER IS LOAD-BEARING: the subclass must be tested before AuthError, or
    // the base-class branch swallows it again and this comment is a lie.
    //
    // THE WORDING IS ABOUT THE ATTEMPTS, NEVER THE ACCOUNT, and must stay that
    // way. The throttle key is email+IP and authorize() records a failure for an
    // unknown or deactivated address exactly as it does for a real one, so
    // "too many failed attempts" tells the person only what they themselves
    // just did at this keyboard. "Too many attempts for this account" would
    // turn the lock into an address-exists oracle — do not name the account,
    // the branch, or whether the password was right.
    if (error instanceof LoginThrottled) return error.userMessage;
    if (error instanceof AuthError)
      return "Invalid email or password — or this login belongs to the other branch.";
    // A successful sign-in leaves through redirect()'s NEXT_REDIRECT throw,
    // which is not an AuthError and must keep travelling.
    throw error;
  }
}
