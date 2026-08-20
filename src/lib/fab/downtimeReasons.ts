export const DOWNTIME_REASONS = [
  { id: "BREAKDOWN",    label: "Breakdown" },
  { id: "ELECTRICITY",  label: "Electricity" },
  { id: "NO_MATERIAL",  label: "No material" },
  { id: "MAINTENANCE",  label: "Maintenance" },
  { id: "CHANGEOVER",   label: "Changeover" },
  { id: "OTHER",        label: "Other" },
] as const;

export type DowntimeReasonId = (typeof DOWNTIME_REASONS)[number]["id"];

export function isDowntimeReason(value: unknown): value is DowntimeReasonId {
  return typeof value === "string" && DOWNTIME_REASONS.some(r => r.id === value);
}

export function downtimeLabel(id: string): string {
  return DOWNTIME_REASONS.find(r => r.id === id)?.label ?? id;
}
