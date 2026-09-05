/**
 * Multiple Robos on one delay, without a schema change.
 *
 * A delay can now name more than one Robo — both were responsible for the same
 * stoppage — and it must stay ONE delay record, not one per Robo. The existing
 * `RoboDelayLog.machineName` column already carries the machine for display and
 * is aggregated by nothing (delays group by code, category and date, never by
 * machine — verified), so it holds the set: the canonical names, comma-joined,
 * e.g. "Roycut-1, Roymix". `machineId` keeps the FIRST of them so a single-Robo
 * record is byte-for-byte what it was and the optional relation still resolves.
 *
 * These are the two pure conversions between that stored string and the list the
 * form works with. Alias-free so `node --test` can reach them.
 */

/** The machine names on a delay, from the stored comma-joined string. A legacy
 *  single name ("Roycut-1") returns `["Roycut-1"]`; blank or null returns `[]`. */
export function splitMachineNames(machineName: string | null | undefined): string[] {
  return (machineName ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

/** The stored string from a list of names: trimmed, de-duplicated, order kept,
 *  comma-joined. Empty in, empty out — a delay with no machine stores "". */
export function joinMachineNames(names: readonly (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = (raw ?? "").trim();
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.join(", ");
}

/** The first machine name, or null — what `machineId` is resolved from so a
 *  single-Robo delay keeps its exact old shape and the relation still points
 *  somewhere. */
export function firstMachineName(names: readonly string[]): string | null {
  return names.length > 0 ? names[0] : null;
}
