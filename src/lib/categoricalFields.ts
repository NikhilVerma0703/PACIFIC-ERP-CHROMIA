// Free-text fields that are really CATEGORICAL — a typo here breaks design
// reconciliation, vein/GEV grouping or invoice reporting. Entry forms render
// these as dropdowns of the values already in use, with a "+ Add new…" escape.
// (Pure module — safe to import from client components.)
export const CURATED_TEXT_FIELDS = new Set([
  "designName",        // Press, Kreos, Jot
  "veinDesignName",    // Distributor
  "distributorVein1", "distributorVein2",
  "gevDesignName", "gev1", "gev2", "gev3",
  "design",            // MIS
  "paymentTerms", "portOfLoading", "deliveryTerms", // Shipping & Invoice
]);

export const isCurated = (field: string) => CURATED_TEXT_FIELDS.has(field);
export const OTHER_SENTINEL = "__other__";

/** Canonical size text: trims, collapses runs of spaces, and removes spaces
 * around hyphens — "0.1 - 0.4", "0.1- 0.4" and "0.1-0.4" all become "0.1-0.4".
 * Mesh suffixes keep one space: "400 #". Applied on every save so spacing
 * variants can never multiply again. */
export function canonSize(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/\s+/g, " ").replace(/\s*-\s*/g, "-");
  return s || null;
}

/** Friendly display names for resin tanks (stored values stay I1/O1 etc.). */
export const TANK_LABELS: Record<string, string> = {
  I1: "Daily Tank 1", I2: "Daily Tank 2", I3: "Daily Tank 3",
  O1: "Storage Tank 1", O2: "Storage Tank 2", O3: "Storage Tank 3", O4: "Storage Tank 4",
};
export const tankLabel = (v: unknown): string => TANK_LABELS[String(v ?? "").trim()] ?? String(v ?? "");
