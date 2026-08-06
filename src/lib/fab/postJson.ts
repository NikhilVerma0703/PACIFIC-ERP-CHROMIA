// Client-side POST helper for the fabrication station screens.
//
// WHY THIS EXISTS. Every station page called `await fetch(...)` and threw the
// Response away — no res.ok, no catch. So a 403 (session expired), a 409 (someone
// else already took the slab) and a 500 all looked identical to the operator:
// the button un-greys, the queue refreshes, and the piece is still sitting
// there. The natural response is to click it again, which is how a double
// submit gets sent by someone who is not being careless.
//
// It never throws. A station screen is used at a machine by someone with gloves
// on, and an unhandled rejection there shows nothing at all — the caller gets a
// message it can put on screen instead.

export interface PostResult {
  ok: boolean;
  status: number;
  /** Operator-readable. Null only when ok. */
  error: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export async function postJson(url: string, body: unknown): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Offline, or the tablet dropped the shop-floor wifi mid-cut. Say so plainly
    // rather than leaving the screen looking like nothing happened.
    return { ok: false, status: 0, error: "No connection — the change was not saved. Try again.", data: null };
  }

  // A body is not guaranteed: 500s from the framework come back as HTML.
  const data = await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: res.status, error: null, data };

  const message =
    data?.error ??
    (res.status === 401 ? "Your session has ended — sign in again."
      : res.status === 403 ? "You do not have permission to do that."
      : res.status === 409 ? "Someone else changed this first — refresh and look again."
      : `Could not save (error ${res.status}).`);
  return { ok: false, status: res.status, error: String(message), data };
}

/** GET helper with the same contract, for the queue loads. Returns [] rather
 *  than null on failure so a caller can render an empty list — but the error is
 *  still reported, because "the queue is empty" and "the queue failed to load"
 *  must not look the same on a screen someone works from. */
export async function getJson<T>(url: string): Promise<{ ok: boolean; error: string | null; data: T[] }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `Could not load (error ${res.status}).`, data: [] };
    const j = await res.json();
    return { ok: true, error: null, data: Array.isArray(j) ? j : [] };
  } catch {
    return { ok: false, error: "No connection — this list may be out of date.", data: [] };
  }
}
