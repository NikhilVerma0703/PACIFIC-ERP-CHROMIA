"use client";
// The shade chip (answer 13), shared by the planning queue and the design-code
// editor so the same colour means the same shade on both screens.

/**
 * The shade chip, shared by the queue and this editor: light reads pale,
 * dark reads dark, so the planner's eye can follow the sequence.
 *
 * When the design has a COLOUR on file (round two, answer 15) the chip wears
 * it: a swatch dot of the real hex sits beside the word, and the L* the
 * sequencing rule reads is in the tooltip. The word stays — the swatch says
 * what the slab looks like, the word says which band the queue put it in, and
 * on an unmeasured design the word is all there is.
 */
export function ShadeChip({
  shade, confirmed = true, hex = null, colourName = null, labL = null,
}: {
  shade: string | null;
  confirmed?: boolean;
  hex?: string | null;
  colourName?: string | null;
  labL?: number | null;
}) {
  const s = (shade ?? "").toUpperCase();
  const cls = s === "LIGHT" ? "bg-gray-100 text-gray-700 border-gray-300"
    : s === "DARK" ? "bg-gray-800 text-white border-gray-800"
    : s === "MEDIUM" ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-white text-gray-400 border-dashed border-gray-300";
  const swatch = hex && /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : null;
  const title = [
    colourName || null,
    swatch,
    labL == null ? null : `L* ${Number(Number(labL).toFixed(1))}`,
    confirmed ? null : "shade guessed from the name — not confirmed",
  ].filter(Boolean).join(" · ") || undefined;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`} title={title}>
      {swatch && (
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/20"
          style={{ backgroundColor: swatch }}
        />
      )}
      {s ? s.toLowerCase() : "no shade"}{!confirmed && s ? "?" : ""}
    </span>
  );
}
