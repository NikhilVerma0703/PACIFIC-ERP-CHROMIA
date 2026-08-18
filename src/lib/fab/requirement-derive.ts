// ============================================================
// lib/requirement-derive.ts
//
// Shared logic for turning a raw parsed Excel row into the
// derived fields the rest of the system routes on:
//   - inch -> mm conversion (Excel is always inches; DB/production is mm)
//   - sinkRequired   (sink cuts present)
//   - polishRequired (edge polish DE&P present) — combined single flag,
//     not per-side, since the sheet only gives one DE&P length per piece
//   - fabricationRequired (= sinkRequired; fabrication here means the
//     outsourced hand-polish of the sink cutout, so it never applies to
//     a piece without a sink)
//
// Used by both /api/projects (legacy create) and
// /api/supervisor-v2/release-project (current release path) so the two
// piece-creation flows can't drift out of sync.
// ============================================================

export const INCH_TO_MM = 25.4;

/** Convert a nullable/undefined inch value to mm. Returns undefined if input is falsy/0. */
export function inchToMm(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === 0) return value === 0 ? 0 : undefined;
  return Math.round(value * INCH_TO_MM * 100) / 100; // round to 2dp to avoid float noise
}

export interface RoutingFlagsInput {
  sinkCuts?: number | null;
  sinkModel?: string | null;
  depLength?: number | null;
}

export interface RoutingFlags {
  sinkRequired: boolean;
  polishRequired: boolean;
  fabricationRequired: boolean;
}

/**
 * Derive the routing flags that the cutting/polishing/sink/fabrication
 * queues key off, from the raw Excel-sourced requirement fields.
 *
 * Rule (locked with production team):
 *  - sinkRequired      = sinkCuts > 0 OR a sinkModel string is present
 *  - polishRequired    = depLength (DE&P) > 0
 *  - fabricationRequired = sinkRequired
 *      (fabrication = outsourced hand-polish of the sink cutout itself;
 *       only ever relevant once a sink exists, and only actionable after
 *       sink-cutting is completed)
 */
export function deriveRoutingFlags(input: RoutingFlagsInput): RoutingFlags {
  const sinkRequired =
    (input.sinkCuts ?? 0) > 0 || !!(input.sinkModel && input.sinkModel.trim().length > 0);

  const polishRequired = (input.depLength ?? 0) > 0;

  return {
    sinkRequired,
    polishRequired,
    fabricationRequired: sinkRequired,
  };
}
