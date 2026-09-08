"use client";
// The shade chip (answer 13), shared by the planning queue and the design-code
// editor so the same colour means the same shade on both screens.

/** The shade chip, shared by the queue and this editor: light reads pale,
 *  dark reads dark, so the planner's eye can follow the sequence. */
export function ShadeChip({ shade, confirmed = true }: { shade: string | null; confirmed?: boolean }) {
  const s = (shade ?? "").toUpperCase();
  const cls = s === "LIGHT" ? "bg-gray-100 text-gray-700 border-gray-300"
    : s === "DARK" ? "bg-gray-800 text-white border-gray-800"
    : s === "MEDIUM" ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-white text-gray-400 border-dashed border-gray-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`} title={confirmed ? undefined : "Guessed from the name — not confirmed"}>
      {s ? s.toLowerCase() : "no shade"}{!confirmed && s ? "?" : ""}
    </span>
  );
}
