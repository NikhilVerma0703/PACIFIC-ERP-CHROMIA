// One HTTP fact that every fetch in this app has to know, kept where anything
// can import it.
//
// It started life inside lib/fab/postJson.ts, which is the wrong home: the
// finance screens hit the same trap and importing lib/fab/* from an office
// component is a dependency that means nothing. postJson re-exports this so its
// existing callers are unaffected.

/**
 * True unless the response carries a body that is definitely not JSON.
 *
 * THE TRAP THIS EXISTS FOR. middleware.ts redirects every unauthenticated
 * request — including /api/* — to /login, and fetch follows redirects by
 * default. So an expired session does not produce 401: the browser gets
 * 200 OK and the login page's HTML. `res.ok` is true, a JSON parse yields
 * null, and a caller that only checks `res.ok` reports success for work the
 * server never saw — a confirmed bill that was never confirmed, a
 * transcription thrown away, "released — 0 piece(s) created".
 *
 * An empty 204/205 has no content-type and counts as fine; anything that
 * declares a non-JSON type does not. A response making no claim is left to the
 * JSON parse to judge.
 */
export function isJsonBody(res: Pick<Response, "status" | "headers">): boolean {
  if (res.status === 204 || res.status === 205) return true;
  const ctype = res.headers.get("content-type");
  if (!ctype) return true; // no claim made — leave it to the JSON parse
  return ctype.includes("json");
}
