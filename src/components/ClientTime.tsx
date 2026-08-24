"use client";

import { useEffect, useState } from "react";

/** An instant written in the viewer's own locale and time zone — filled in
 *  AFTER mount, on purpose.
 *
 *  A server component that passes a timestamp to a client component and lets
 *  it call toLocaleString() during render gets two different strings: Vercel
 *  renders in UTC, the tablet hydrates in IST, and React 19 throws the whole
 *  subtree away ("Hydration failed because the server rendered text didn't
 *  match the client") and paints it again — a flash and a double render on
 *  every load of /batch, /batch/slabs and /robo/slabs while an undoable action
 *  exists. Rendering nothing on the server and the formatted time from an
 *  effect makes the first client render agree with the server, and the text
 *  that then appears is exactly the one the browser ended up showing before.
 *
 *  `options` should be a module-level constant (or omitted) so the effect does
 *  not re-run on every parent render.
 *
 *  `prefix` is the separator that belongs to the time (" · "). It lives HERE,
 *  not at the call site, so the pre-hydration paint reads "— by Ravi" rather
 *  than "— by Ravi · " with a dangling dot waiting for a timestamp. */
export function ClientTime({ iso, prefix = "", options }: { iso: string; prefix?: string; options?: Intl.DateTimeFormatOptions }) {
  const [text, setText] = useState("");
  useEffect(() => { setText(new Date(iso).toLocaleString(undefined, options)); }, [iso, options]);
  return <>{text ? prefix + text : ""}</>;
}
