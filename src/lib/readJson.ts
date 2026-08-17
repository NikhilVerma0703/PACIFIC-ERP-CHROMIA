// Reading a JSON response without the parser eating the real error.
//
// THE BUG THIS EXISTS TO STOP, which was live on the costing screen:
//
//     const d = await r.json();
//     if (!r.ok) throw new Error(d?.error ?? `Failed (${r.status})`);
//
// The parse happens FIRST. When a route crashes or times out, the body is empty
// — a serverless 500 or a 504 gateway timeout carries no JSON — so `r.json()`
// throws "Unexpected end of JSON input" and the line that would have said
// "Failed (500)" is never reached. The user is shown a parser error about a
// response they never asked to parse, and nobody can tell from it whether the
// server crashed, timed out, or signed them out.
//
// So: read the body as TEXT, then decide. The status is always reported,
// because the status is the part that tells someone what to do next.
//
// The decision is pure and lives in `interpretResponse` so it can be tested
// without a server; `readJson` is the thin async wrapper components call.

export interface ResponseReading<T> {
  ok: boolean;
  status: number;
  /** Parsed body, or null when there was nothing usable. */
  data: T | null;
  /** What to show a human. Null only when ok with a parsed body. */
  error: string | null;
}

/** Extra sentence for the statuses whose cause is worth naming. */
function hintFor(status: number): string {
  if (status === 504 || status === 408) {
    return " The request took too long — the server gave up before answering.";
  }
  if (status === 502 || status === 503) return " The server is not answering right now.";
  if (status >= 500) return " Something failed on the server, not in the browser.";
  if (status === 401 || status === 403) return " You may have been signed out.";
  if (status === 404) return " That address does not exist on the server.";
  return "";
}

/**
 * Decide what a response means from its status and raw body text.
 *
 * `text` is what came back, exactly. An empty string is the case that matters:
 * it is what a crashed or timed-out function returns, and it is not the same
 * as `{}`.
 */
export function interpretResponse<T = unknown>(
  status: number,
  ok: boolean,
  text: string,
): ResponseReading<T> {
  const body = (text ?? "").trim();

  if (!body) {
    return {
      ok: false, status, data: null,
      error: `The server answered with nothing (HTTP ${status}).${hintFor(status)}`,
    };
  }

  // An HTML body from a JSON endpoint almost always means a sign-in redirect or
  // a platform error page, and "Unexpected token '<'" says neither.
  if (body.startsWith("<")) {
    return {
      ok: false, status, data: null,
      error: `The server sent a web page instead of data (HTTP ${status}).` +
        `${hintFor(status)} If you were idle for a while, sign in again.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false, status, data: null,
      error: `The server's answer could not be read (HTTP ${status}).${hintFor(status)}`,
    };
  }

  if (!ok) {
    // A route that names its own reason is always better than a status code.
    const named = (parsed as { error?: unknown } | null)?.error;
    return {
      ok: false, status, data: parsed as T,
      error: typeof named === "string" && named.trim()
        ? named
        : `Request failed (HTTP ${status}).${hintFor(status)}`,
    };
  }

  return { ok: true, status, data: parsed as T, error: null };
}

/** Read a fetch Response the safe way. Never throws on a bad body. */
export async function readJson<T = unknown>(res: Response): Promise<ResponseReading<T>> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    // The connection died mid-body. Reported as an empty answer, which is what
    // it is from the reader's point of view.
    return {
      ok: false, status: res.status, data: null,
      error: `The connection dropped before the server finished answering (HTTP ${res.status}).`,
    };
  }
  return interpretResponse<T>(res.status, res.ok, text);
}
