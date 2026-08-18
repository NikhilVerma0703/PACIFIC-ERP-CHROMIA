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

// Moved to lib/httpJson so the finance screens can use it too — importing
// lib/fab/* from an office component is a dependency that means nothing.
// Imported AND re-exported: a bare `export { x } from` does not bring the name
// into this module's scope, and postJson/getJson below both call it.
//
// RELATIVE, not the "@/" alias: tests/fabPostJson.test.ts loads this file
// directly under `node --test`, which has no idea what "@/" means. Anything
// reachable from a test has to import by path.
import { isJsonBody } from "../httpJson.ts";
export { isJsonBody };

/** Offline, or the tablet dropped the shop-floor wifi mid-cut. Say so plainly
 *  rather than leaving the screen looking like nothing happened. */
const NO_CONNECTION: PostResult = {
  ok: false, status: 0, error: "No connection — the change was not saved. Try again.", data: null,
};

export async function postJson(url: string, body: unknown): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NO_CONNECTION;
  }
  return readReply(res);
}

/**
 * The same contract for a multipart upload — a PDF or a workbook, where the
 * body cannot be JSON.
 *
 * Content-Type is NOT set: the browser has to write it itself so the multipart
 * boundary matches the body it generated. Setting it by hand is the classic way
 * to make every upload arrive as an unparseable blob.
 */
export async function postForm(url: string, form: FormData): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form });
  } catch {
    return NO_CONNECTION;
  }
  return readReply(res);
}

/**
 * The same contract for a DELETE — taking a piece row off a slab, an empty slab
 * off the board.
 *
 * It exists because the screens that needed one hand-rolled `fetch` with half
 * of this logic each: res.ok checked, the expired-session trap not. A DELETE
 * that reaches the login page comes back 200 with an HTML body, and the board
 * then paints the row as removed while it is still there. The id goes in the
 * query string, which is what the fab routes read, so there is no body.
 */
export async function deleteJson(url: string): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(url, { method: "DELETE" });
  } catch {
    return NO_CONNECTION;
  }
  return readReply(res);
}

/**
 * PATCH with a JSON body — changing a quantity that is already there, as
 * opposed to creating one.
 */
export async function patchJson(url: string, body: unknown): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NO_CONNECTION;
  }
  return readReply(res);
}

/** Everything these helpers do once the response is in hand. Shared so an upload
 *  screen cannot report an expired session differently from a station screen. */
async function readReply(res: Response): Promise<PostResult> {
  // A body is not guaranteed: 500s from the framework come back as HTML.
  const data = await res.json().catch(() => null);

  // An expired session does NOT reach the route. middleware.ts:36-40 redirects
  // every unauthenticated request — including /api/* — to /login, and fetch
  // follows redirects by default, so the browser gets 200 + the login page's
  // HTML. Without this check `res.ok` is true, `data` is null, and the caller
  // paints a success banner for work that never happened ("released — 0
  // piece(s) created"). A 204 has no content-type and is untouched by this.
  if (res.ok && !isJsonBody(res)) {
    return {
      ok: false,
      status: 401,
      error: "Your session has ended — sign in again in another tab, then retry. Nothing was saved.",
      data: null,
    };
  }

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
    // Same expired-session trap as postJson: the login page arrives as a 200.
    if (!isJsonBody(res)) {
      return { ok: false, error: "Your session has ended — sign in again to see this.", data: [] };
    }
    const j = await res.json();
    return { ok: true, error: null, data: Array.isArray(j) ? j : [] };
  } catch {
    return { ok: false, error: "No connection — this list may be out of date.", data: [] };
  }
}
