// Classify silos into the three correction surfaces the line uses:
//   · GRIT   — the 16 numbered silos (101–108, 201–208)
//   · FILLER — the 4 named filler buffers
//   · RESIN  — handled separately via the Daily Resin Tank ledger
// "Roy" (the Roy mixer's buffer) is intentionally out of this scope.

export const GRIT_SILOS = [
  "101", "102", "103", "104", "105", "106", "107", "108",
  "201", "202", "203", "204", "205", "206", "207", "208",
];

export const FILLER_SILOS = [
  "Filler A Buffer A", "Filler A Buffer B",
  "Filler B Buffer A", "Filler B Buffer B",
];

export type SiloKind = "grit" | "filler" | "roy" | "other";

export function classifySilo(siloNo: string | null | undefined): SiloKind {
  const s = (siloNo ?? "").toString().trim();
  if (!s) return "other";
  if (GRIT_SILOS.includes(s)) return "grit";
  if (/^filler/i.test(s)) return "filler";
  if (/^roy/i.test(s)) return "roy";
  return "other";
}

export function isCorrectableSilo(siloNo: string | null | undefined): boolean {
  const k = classifySilo(siloNo);
  return k === "grit" || k === "filler";
}
