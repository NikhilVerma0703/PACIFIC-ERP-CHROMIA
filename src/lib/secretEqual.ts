// Constant-time equality for the cron and webhook secrets.
//
// `===` stops at the first differing character, so how long a refusal takes
// leaks how much of the secret a caller already has right. The four routes
// that use this (/api/report/daily-email, /api/telegram/report,
// /api/telegram/webhook, /api/sales/cron/payment-reminders) are the only ones
// middleware.ts leaves reachable without a session, which makes them the one
// place a remote timing oracle could matter.
//
// Both sides are hashed before the compare because timingSafeEqual THROWS on
// buffers of different length, and the length of the configured secret is not
// something to give away either. Equal hashes <=> equal strings, so exactly
// the callers `===` accepted are accepted, and the responses are unchanged.
import { createHash, timingSafeEqual } from "node:crypto";

/** True when `provided` (a header value, possibly absent) equals `expected`. */
export function secretEqual(provided: string | null | undefined, expected: string): boolean {
  if (provided == null) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
