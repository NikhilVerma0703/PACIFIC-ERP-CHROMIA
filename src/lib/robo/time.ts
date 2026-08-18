/**
 * Typed 24-hour time entry — the pure half of components/robo/TimeInput.tsx.
 *
 * These live in lib rather than beside the component so `node --test` can
 * reach them: the test runner strips TypeScript types but does not compile
 * JSX, so anything imported by a test has to be a .ts file.
 *
 * The shape they produce is exactly the "HH:MM" string `<input type="time">`
 * produced before, so durations, exports, reports and the register import all
 * keep working unchanged.
 */

/** True only for a complete, valid 24-hour time: "07:05", "23:59". */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/**
 * Spaces digits into HH:MM while typing: "930" -> "9:30", "0930" -> "09:30".
 *
 * Everything that is not a digit is dropped, so the operator may type the
 * colon or not and the field behaves the same either way. A leading 3-9 can
 * only be a single-digit hour (there is no 30-something o'clock), so the
 * colon lands after one digit — that is what lets "930" mean half past nine
 * while "0930" and "1230" still mean what they look like.
 */
export function maskTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length === 0) return "";
  const hourLen = /^[3-9]/.test(digits) ? 1 : 2;
  if (digits.length <= hourLen) return digits;
  return `${digits.slice(0, hourLen)}:${digits.slice(hourLen, hourLen + 2)}`;
}

/**
 * Pads a short entry when the field loses focus: "9:5" -> "09:05",
 * "930" -> "09:30". Anything that is not a time this function recognises is
 * returned untouched, so the field shows what was typed and isValidTime()
 * flags it — normalising is not allowed to invent a time nobody entered.
 */
export function normaliseTime(value: string): string {
  const v = value.trim();
  if (!v) return "";

  const pad = (h: number, min: number) =>
    h > 23 || min > 59 ? null : `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

  // Digits with no colon — pasted, or typed straight through. The last two are
  // always the minutes, so "930" is 9:30 rather than 93:0.
  const bare = v.match(/^(\d{3,4})$/);
  if (bare) {
    const d = bare[1];
    return pad(Number(d.slice(0, d.length - 2)), Number(d.slice(-2))) ?? v;
  }

  const m = v.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return v;
  return pad(Number(m[1]), Number(m[2])) ?? v;
}
