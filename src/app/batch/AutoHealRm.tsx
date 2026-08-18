"use client";
// Auto-trigger for the batch-scoped RM heal. The batch report rendered because the
// server saw N pending cycles; this fires the heal ONCE on mount (a proper server
// action, not a write-on-render), then refreshes so the badges and mixer section
// pick up the new links. Safe to double-fire: the allocator only touches cycles
// whose filler link is still empty, and the advisory lock serializes runs.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { healBatchRm } from "@/app/batch/rmHealActions";

export function AutoHealRm({ batch, pending }: { batch: string; pending: number }) {
  const router = useRouter();
  const fired = useRef(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    healBatchRm(batch).then((r) => {
      setMsg(r.message);
      if (r.ok && r.healed > 0) router.refresh();
    }).catch(() => setMsg(null));
  }, [batch, router]);
  return (
    <p className="text-xs text-gray-500">
      {msg ?? `Re-linking grit/filler for ${pending} cycle(s) of this batch automatically…`}
    </p>
  );
}
