export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}
export function getDurationMinutes(inTime: string, outTime: string): number | null {
  if (!inTime || !outTime) return null;
  const [ih, im] = inTime.split(":").map(Number);
  const [oh, om] = outTime.split(":").map(Number);
  const diff = oh * 60 + om - (ih * 60 + im);
  return diff > 0 ? diff : null;
}
export function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
/** Local calendar date (YYYY-MM-DD) — not UTC, so night shifts get the right date. */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function nowTimeStr(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

/** Readable duration for KPI cards: "37 minutes", "4 hours 58 minutes", "4 hours". */
export function fmtDurationLong(mins: number): string {
  if (!mins || mins <= 0) return "0 minutes";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  if (m > 0) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

/* ── Slab status ───────────────────────────────────────────── */
export const SLAB_IN_PROCESSING = "IN_PROCESSING";
export const SLAB_COMPLETED = "COMPLETED";

export function slabStatusLabel(status: string): string {
  if (status === SLAB_IN_PROCESSING) return "In-Processing";
  if (status === SLAB_COMPLETED) return "Completed";
  return status;
}

export function slabStatusClass(status: string): string {
  if (status === SLAB_COMPLETED) return "bg-green-100 text-green-700";
  if (status === SLAB_IN_PROCESSING) return "bg-amber-100 text-amber-700";
  return "bg-gray-100 text-gray-600";
}

/* ── Remark / delay rendering ──────────────────────────────── */
export interface DelayLike {
  durationMinutes: number;
  startTime?: string | null;
  endTime?: string | null;
  remarks?: string | null;
  machineName?: string | null;
  delayCode?: { code: string; description: string } | null;
}

/** "C1 Robo1 5m [10:00-10:05] - note - free remark", or "-" when there is
 *  nothing to show.
 *
 *  The machine goes through machineLabel() for the same reason every screen
 *  does: the delay log stores "Roycut-1", the operator who logged it knows the
 *  machine as "Robo1". This line was the last place the rename missed, so the
 *  Remark column on Slabs Records printed a name that appears nowhere else in
 *  the UI. */
export function formatSlabRemarks(
  remarks: string | null | undefined,
  delays: DelayLike[] | undefined | null
): string {
  const parts: string[] = [];
  for (const d of delays ?? []) {
    const code = d.delayCode?.code ?? "";
    const machine = d.machineName ? ` ${machineLabel(d.machineName)}` : "";
    const window = d.startTime && d.endTime ? ` [${d.startTime}-${d.endTime}]` : "";
    const note = d.remarks?.trim() ? ` - ${d.remarks.trim()}` : "";
    parts.push(`${code}${machine} ${d.durationMinutes}m${window}${note}`.trim());
  }
  if (remarks?.trim()) parts.push(remarks.trim());
  return parts.length > 0 ? parts.join(" · ") : "-";
}

/** Shop-floor display names for the four robo machines. The DB/machine.name
 * values ("Roycut-1", "Roymix", "Roycut-2", "Roycut-3") are the identity used
 * for ordering, preset matching and reports and MUST stay as-is; this only
 * changes what operators SEE. */
export const MACHINE_LABEL: Record<string, string> = {
  "Roycut-1": "Robo1",
  "Roymix":   "Robo2",
  "Roycut-2": "Robo3",
  "Roycut-3": "Robo4",
};
export const machineLabel = (name: string | null | undefined): string =>
  (name && MACHINE_LABEL[name]) || name || "";

/** Display name back to the stored one — the reverse of machineLabel.
 *
 *  The rename gave operators Robo1..Robo4 while the database kept Roycut-1 /
 *  Roymix / Roycut-2 / Roycut-3, and that is right: the stored names carry the
 *  line ordering, the RoyMix-specific field rules, the design-preset keys and
 *  the machine on every delay log ever saved.
 *
 *  But the rename also changed what people TYPE. A register workbook written
 *  after it says "Robo2" in the Machine column, and the importer matches that
 *  column against the stored names — so those rows failed the lookup and were
 *  dropped by a .filter() with no error and no count, taking the whole
 *  Production Setup sheet for that machine with them. A silent loss, because
 *  nothing on screen can tell "this machine was not in the file" from "this
 *  machine was not recognised".
 *
 *  Matching is case-insensitive and trims, because a header typed by hand is
 *  not a key. Anything already stored-shaped, or simply unknown, passes
 *  through untouched so an unmapped machine still reaches the same lookup it
 *  always did. */
const STORED_BY_DISPLAY: Record<string, string> = Object.fromEntries(
  Object.entries(MACHINE_LABEL).map(([stored, shown]) => [shown.toLowerCase(), stored]),
);
export function canonicalMachineName(input: string | null | undefined): string {
  if (!input) return "";
  const v = input.trim();
  return STORED_BY_DISPLAY[v.toLowerCase()] ?? v;
}
