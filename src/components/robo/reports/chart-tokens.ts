/**
 * Chart tokens and row shapes shared by the Robo Reports page and its charts.
 *
 * Deliberately free of any charting library import: the page reads these for
 * its legends and value lists without pulling Recharts into the first load.
 */

/** Categorical slots, fixed order (validated for CVD separation on white). */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
export const ROBOT_INDEX: Record<string, number> = { R1: 0, R2: 1, R3: 2, R4: 3 };

/**
 * A longer categorical ramp for the all-delay-types bar chart, which shows one
 * bar per delay code — a dozen or more. Extends SERIES with distinct hues and
 * cycles (`% length`) if a plant ever runs past the end. The bar and its table
 * row read the SAME index, so a code's colour is the same in both.
 */
export const DELAY_SERIES = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4",
  "#7c5cd0", "#22b3c9", "#d1512e", "#4b5b6b", "#8a5a2b",
  "#9a9a92", "#3fa34d",
];
export const DELAY_HUE = "#eb6834";
export const PRODUCTION_HUE = "#2a78d6";

/* Recessive chart chrome */
export const GRID = "#e1e0d9";
export const AXIS = "#c3c2b7";
export const MUTED = "#898781";

export const TOOLTIP_STYLE = {
  borderRadius: "8px",
  border: `1px solid ${GRID}`,
  fontSize: "12px",
  boxShadow: "0 2px 8px rgba(11,11,11,0.08)",
};

export interface MachineSlice { name: string; short: string; minutes: number }
export interface DelaySlice { code: string; description: string; category: string; minutes: number; events: number }
export interface TrendPoint {
  date: string;
  label: string;
  slabs: number;
  delayMins: number;
  /** That date's slabs ÷ the hours the Robo line ran that date (lib/robo/dailyRate.ts). */
  slabsPerHour: number;
  /** The minutes the Robo line ran that date — the divisor behind slabsPerHour. */
  lineMinutes: number;
}

export function pct(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 1000) / 10}%`;
}
