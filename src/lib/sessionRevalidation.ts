import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * ONE User revocation lookup per request.
 *
 * Two code paths make the identical query on every server-rendered navigation:
 * the NextAuth jwt callback (runs inside every `auth()` call) and
 * `currentUser()`'s explicit revalidation in lib/rbac.ts. Measured 2026-08-14:
 * a single page navigation paid 3 sequential User lookups (Shell's auth() →
 * jwt callback, currentUser's auth() → jwt callback again, then currentUser's
 * own check) before any page data started.
 *
 * `cache()` deduplicates the promise within one request render, so both layers
 * still run their check on EVERY request — revocation semantics are unchanged
 * (a bumped sessionVersion or a deactivated account still bites immediately,
 * well inside the documented 30-minute updateAge) — they just share the one
 * row instead of fetching it up to three times.
 *
 * Deliberately returns the RAW promise: the jwt callback treats a failed read
 * as "invalidate" (.catch(() => null)) while currentUser treats it as
 * "column not migrated yet — allow". A cached rejection propagates to both
 * callers, so each keeps exactly its own failure semantics.
 */
export const sessionUserRow = cache(async (uid: string) =>
  prisma.user.findUnique({
    where: { id: uid },
    select: { sessionVersion: true, active: true },
  })
);
