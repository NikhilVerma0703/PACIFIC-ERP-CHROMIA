/** Pure date helpers — safe to import from anywhere, including tests. */

const MS_PER_DAY = 86_400_000;

/** Whole days between two instants. Never negative. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

/** Whole minutes between two instants. Never negative. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

/** "3 h 25 min" / "45 min" / "2 d 4 h" */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`;
}

/**
 * A calendar day on its way into a `DATE` column.
 *
 * The rest of the app builds dates at local midnight, which is the only way a
 * "day" can be compared or displayed correctly. PostgreSQL, though, casts an
 * instant to `DATE` in UTC — so local midnight in India (18:30 the previous
 * day, in UTC) would be filed under yesterday. Rebuilding the same year, month
 * and day at UTC midnight makes the stored day the day that was typed.
 */
export function toDateColumn(date: Date): Date;
export function toDateColumn(date: Date | null | undefined): Date | null;
export function toDateColumn(date: Date | null | undefined): Date | null {
  if (!date) return null;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}
