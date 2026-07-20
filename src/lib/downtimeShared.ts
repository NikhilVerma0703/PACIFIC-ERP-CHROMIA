// Pure downtime constants + formatters, importable from CLIENT components.
// lib/downtime.ts re-exports these so its existing (server-side) importers are
// untouched — but downtime.ts itself pulls in prisma, which a client bundle
// must never do, hence this split.

export const DELAY_FIELDS = [
  { key: "process", label: "Process delay", col: "processDelayDurationMinutes" },
  { key: "cleaning", label: "Cleaning", col: "cleaningDelayDurationMinutes" },
  { key: "breakdown", label: "Breakdown (mech/elec)", col: "breakdownDelayDurationMechanicalOrElectricalMinutes" },
  { key: "powerout", label: "Power-out", col: "poweroutDelayDurationMinutes" },
] as const;
export const DELAY_LABEL: Record<string, string> = Object.fromEntries(DELAY_FIELDS.map((d) => [d.key, d.label]));

/** "750 min" -> "12h 30m" */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}
