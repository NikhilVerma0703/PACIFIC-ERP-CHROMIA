"use client";

// Keeps the RUNNING shift's card current without anyone pressing reload.
//
// It re-renders the server page rather than fetching the shift on its own,
// because ShiftCard reaches @/lib/downtime -> @/lib/prisma and so cannot be
// imported into a client component. Drawing a second, client-side copy of the
// card is the thing ShiftCard exists to prevent — the MIS page and the
// scoreboard already share one card so the two cannot drift.
//
// The page rebuilds a whole range of shift scores on every refresh, so this is
// deliberately careful about when it fires:
//   - never while the tab is hidden (a background tab needs nothing),
//   - never while a refresh is still in flight, so slow rebuilds cannot stack,
//   - immediately on becoming visible again, so a tab returned to is current.
// MIS is entered once an hour, so the interval only has to be short enough that
// the card is never visibly stale — not fast.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ seconds = 120 }: { seconds?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState<string | null>(null);
  // The interval closure is created once; `pending` read through a ref so it
  // sees the CURRENT value rather than the one captured on mount.
  const busy = useRef(false);
  busy.current = pending;

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible" || busy.current) return;
      start(() => {
        router.refresh();
        setAt(new Date().toLocaleTimeString());
      });
    };
    const id = setInterval(tick, Math.max(15, seconds) * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${pending ? "bg-amber-500" : "bg-green-500"}`} />
      {pending ? "updating…" : `live · every ${Math.round(seconds / 60) || 1} min`}
      {/* Rendered only after the first tick, so the server and the client agree
          on the markup at hydration. */}
      {at && !pending && <span className="text-gray-400">· updated {at}</span>}
    </span>
  );
}
