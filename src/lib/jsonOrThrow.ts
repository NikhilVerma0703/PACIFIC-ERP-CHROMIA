import { readJson } from "./readJson";

/** Drop-in for `.then((r) => r.json())` in a fetch chain: the parsed body on
 *  success, otherwise an Error carrying readJson's human-readable message.
 *
 *  `r.json()` on its own has two failure modes that the consumables widgets
 *  hit: an expired session (middleware answers /api/* with the login page's
 *  HTML, 200) threw "Unexpected token '<'" out of the chain, and a JSON error
 *  body ({ error }) was stored AS the list and crashed the next .filter(). Both
 *  now reject with a message, and the caller's catch can clear its skeleton
 *  and say what happened. Returns Promise<any> because that is exactly what
 *  r.json() returned and the chains were typed against it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonOrThrow(r: Response): Promise<any> {
  const res = await readJson<unknown>(r);
  if (!res.ok || res.data == null) throw new Error(res.error ?? `Request failed (HTTP ${res.status}).`);
  return res.data;
}
