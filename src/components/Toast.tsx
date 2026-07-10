"use client";

import { useEffect, useState } from "react";

/** Large auto-dismissing toast. Re-shows every time `trigger` increments. */
export function Toast({ trigger, text, tone = "green" }: { trigger: number; text: string; tone?: "green" | "red" }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!trigger) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(id);
  }, [trigger]);
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
      <div className={`rounded-xl px-6 py-3.5 text-base font-semibold text-white shadow-lg ${tone === "green" ? "bg-green-600" : "bg-red-600"}`}>
        {text}
      </div>
    </div>
  );
}
