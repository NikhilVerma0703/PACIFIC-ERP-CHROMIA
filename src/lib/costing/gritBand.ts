// Silo size string -> rate-card band key. NO IMPORTS, deliberately.
//
// This lived in batchData.ts, which imports "server-only" and Prisma and is
// therefore unreachable from `node --test`. That is not a stylistic detail: it
// is why a function every grit rate is looked up by shipped two defects with no
// test able to catch either. Same reason lib/roles.ts and
// lib/costing/verification.ts have no imports.

/** Normalise silo size strings ("# 8-16", "#8-16", " 0.1-0.4 ") to band keys. */
export function bandOf(raw: string | null): string {
  const s = (raw ?? "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.includes("8-16")) return "8-16";
  if (/^#?400#?$/.test(s)) return "filler-400";
  // A leading or trailing # is decoration the plant types inconsistently — the
  // filler branch above already tolerates it on 400, and the docstring claims
  // this function does too, but the regex below never accepted it. "#0.1-0.4"
  // fell through to the raw string and became the catalogue key
  // "grit-#0.1-0.4", which no rate card has, so that tonnage could not be
  // priced from any screen.
  const core = s.replace(/^#+/, "").replace(/#+$/, "");
  const m = core.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (!m) return s;
  // Fold precision. "0.10-0.40" and "0.1-0.4" are one band on the floor and
  // were two keys here, the second of which the catalogue has no rate for —
  // so the same grit split into a priced half and an unpriceable half
  // depending on how somebody typed it into the silo record.
  //
  // SAFE TO CHANGE, and the reason is worth stating: every key this used to
  // produce for a malformed size was absent from RATE_ITEMS, the panel only
  // renders catalogue items, and the write route refuses an unknown item
  // ("Unknown material"). So no batch can ever have carried a saved price
  // against one. This can move tonnage OUT of "consumed but not priced" and
  // into a real band; it cannot orphan a price that exists.
  const n = (x: string) => String(Number(x));
  return `${n(m[1])}-${n(m[2])}`;
}

/** Rate-card item key for a grit band. */
export const gritItemKey = (band: string) => `grit-${band}`;
export const GRIT_BAND_LABELS: Readonly<Record<string, string>> = {
  "0.1-0.4": "Grit 0.1 – 0.4",
  "0.3-0.7": "Grit 0.3 – 0.7",
  "0.6-1.2": "Grit 0.6 – 1.2",
  "1.2-2.5": "Grit 1.2 – 2.5",
  "8-16": "Glass grit # 8-16",
};
