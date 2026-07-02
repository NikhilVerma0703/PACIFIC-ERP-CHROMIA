// Server error alerting (Next.js instrumentation hook). Every unhandled server
// error is logged, and — when ALERT_WEBHOOK_URL is set (e.g. a Slack/Teams
// incoming webhook) — pushed as an alert so someone actually finds out.
// No dependencies, no-op without the env var. Swap for Sentry later by adding
// a DSN + @sentry/nextjs here if deeper tracing is ever needed.

export function register(): void { /* nothing to set up */ }

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routeType: string }
): Promise<void> {
  const e = err as { message?: string; digest?: string; stack?: string } | null;
  const line = `[server-error] ${request.method} ${request.path} (${context.routerKind}/${context.routeType}): ${e?.message ?? String(err)}${e?.digest ? ` [digest ${e.digest}]` : ""}`;
  console.error(line);
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (!hook) return;
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `🔴 Pacific ERP ${line}` }),
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* alerting must never break the request */ }
}
