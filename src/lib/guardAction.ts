/** Wraps a server action whose business failures already come back as a value
 *  (a message string, an `{ ok: false, message }` result) so a failed CALL comes
 *  back the same way.
 *
 *  The action itself answers "batch not found" or "hour already logged" with a
 *  value; but the invocation REJECTS when the tablet's Wi-Fi drops mid-post or
 *  the session has expired. Inside useActionState / startTransition React 19
 *  routes that rejection to the nearest error boundary, and this app has none
 *  below global-error.tsx — so the whole page was replaced by "Something went
 *  wrong — reload" and the in-charge typed the record again. With the guard the
 *  form stays exactly as it was, shows `onFail`, and the next Save works.
 *
 *  Success is untouched: the action's own result is returned as-is. Forms
 *  submitted before hydration still work — React 19 queues such submits and
 *  replays them once the handler is live. */
export const SERVER_UNREACHABLE = "Could not reach the server — nothing was saved. Check the connection and try again.";

export function guardAction<P, R>(action: (prev: P, fd: FormData) => Promise<R>, onFail: R): (prev: P, fd: FormData) => Promise<R> {
  return async (prev, fd) => {
    try { return await action(prev, fd); }
    catch { return onFail; }
  };
}
