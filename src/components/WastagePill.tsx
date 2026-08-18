"use client";

import { useState } from "react";
import { Badge } from "@/components/ui";

const tone = (pct: number): "red" | "amber" | "green" => (pct > 12 ? "red" : pct >= 8 ? "amber" : "green");
const k = (n: number) => Math.round(n).toLocaleString("en-IN");

export function WastagePill({ pct, kg, mixWeight, slabWeight }: { pct: number; kg: number; mixWeight: number; slabWeight: number }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center gap-1">
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1">
        <Badge tone={tone(pct)}>Wastage {pct.toFixed(2)}%</Badge>
        <span className="text-[10px] text-gray-400 underline decoration-dotted underline-offset-2">how?</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-3 text-xs shadow-lg">
            <div className="mb-2 font-semibold text-gray-800">How this wastage is calculated</div>
            <div className="space-y-1 text-gray-600">
              <div className="flex justify-between gap-4"><span>Mix weight (all mixer cycles)</span><span className="font-medium text-gray-900">{k(mixWeight)} kg</span></div>
              <div className="flex justify-between gap-4"><span>&minus; Slab weight (pressed)</span><span className="font-medium text-gray-900">{k(slabWeight)} kg</span></div>
              <div className="flex justify-between gap-4 border-t border-gray-100 pt-1"><span>= Wastage</span><span className="font-medium text-gray-900">{k(kg)} kg</span></div>
              <div className="flex justify-between gap-4"><span>&divide; Mix weight &times; 100</span><span className="font-semibold text-brand">{pct.toFixed(2)}%</span></div>
            </div>
            <div className="mt-2 border-t border-gray-100 pt-2 text-[11px] text-gray-400">&lt;8% ok &middot; 8&ndash;12% high &middot; &gt;12% bad</div>
          </div>
        </>
      )}
    </span>
  );
}
