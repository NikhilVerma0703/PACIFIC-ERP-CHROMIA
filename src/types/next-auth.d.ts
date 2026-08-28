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

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      station?: string | null;
      branch?: string | null;
      altRole?: string | null;
      altBranch?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    station?: string | null;
    branch?: string | null;
    altRole?: string | null;
    altBranch?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    role: Role;
    station?: string | null;
    branch?: string | null;
    altRole?: string | null;
    altBranch?: string | null;
  }
}
