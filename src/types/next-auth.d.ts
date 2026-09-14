import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

// altRole / altBranch — the SECOND role+branch pair an admin granted this
// login, NULL for everybody who holds one job. Typed as plain strings rather
// than the Role/Branch enums for the reason lib/roles.ts gives about its rank
// table: this compiles before `prisma generate` refreshes the client, and
// lib/roleContext.ts (which both edge gates import) deliberately holds no enum
// list. They ride in the JWT because middleware and auth.config.ts have nothing
// else to read: both are Prisma-free, and a gate that could not see the granted
// pairs could not agree with currentUser() about which one is active.
//
// fgView — users.fg_view, "may LOOK at finished goods, whatever branch this
// login is on, and may change nothing in it" (the owner, 2026-09-14; the
// argument is scripts/0083-fg-view-grant.sql). It rides in the JWT for exactly
// the reason the pair above does, and it is OPTIONAL here because a token
// minted before the claim existed does not carry it. Absent is not a grant:
// every reader tests `=== true` — the two jwt callbacks, the session callback,
// and hasFgView() in lib/inventory/accessRules.ts, which is what the route
// gates and both edge gates actually ask.

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      station?: string | null;
      branch?: string | null;
      altRole?: string | null;
      altBranch?: string | null;
      fgView?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    /** next-auth's own `User` in this version declares no id, so `user.id` in
     *  the two jwt callbacks did not compile once those parameters were given
     *  real types. It is not an invention: authorize() in auth.ts returns the
     *  row's id as the first field, and Session["user"] above already promises
     *  the same string. Declaring it lines the two halves up. */
    id: string;
    role: Role;
    station?: string | null;
    branch?: string | null;
    altRole?: string | null;
    altBranch?: string | null;
    fgView?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    /** SESSION VERSION. fabSignOut bumps users.session_version, and the jwt
     *  callback in auth.ts rejects any token holding an older one — that is how
     *  "sign out everywhere" works. It has always ridden in the token; this
     *  declaration was simply missing, which was invisible while the callback
     *  parameters were implicitly `any`. */
    sv?: number;
    role: Role;
    station?: string | null;
    branch?: string | null;
    altRole?: string | null;
    altBranch?: string | null;
    fgView?: boolean;
  }
}
