/**
 * Chart tokens and row shapes shared by the Robo Reports page and its charts.
 *
 * Deliberately free of any charting library import: the page reads these for
 * its legends and value lists without pulling Recharts into the first load.
 */

/** Categorical slots, fixed order (validated for CVD separation on white). */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
export const ROBOT_INDEX: Record<string, number> = { R1: 0, R2: 1, R3: 2, R4: 3 };
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
export interface TrendPoint { date: string; label: string; slabs: number; delayMins: number; slabsPerHour: number }

export function pct(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 1000) / 10}%`;
}
