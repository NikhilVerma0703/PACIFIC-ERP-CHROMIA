"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches the current server page every `seconds` (default 60). Render-less.
 *
 *  Same guards as scoreboard/AutoRefresh: a tick is skipped while the previous
 *  router.refresh() is still in flight (a month-wide /mis re-render can take
 *  longer than the interval, and two could overlap), it only runs while the tab
 *  is visible, and it runs once when the tab becomes visible again so a page
 *  returned to after a long hide is current at once instead of up to a whole
 *  interval later. The interval and what it refreshes are unchanged. */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // read through a ref so the interval closure sees the CURRENT value
  const busy = useRef(false);
  busy.current = pending;
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible" || busy.current) return;
      start(() => router.refresh());
    };
    const id = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [router, seconds]);
  return null;
}
