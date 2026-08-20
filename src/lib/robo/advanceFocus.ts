/**
 * Where the cursor goes when a field is done — the pure half of
 * components/robo/useFieldAdvance.ts.
 *
 * In lib rather than beside the hook so `node --test` can reach it: the test
 * runner strips TypeScript types but does not compile JSX, so anything a test
 * imports has to be a .ts file. Same split as time.ts and its TimeInput.
 *
 * WHY THIS EXISTS. Logging a slab on a tablet is four to six short fields
 * repeated for every slab of the shift, and between each one the operator had
 * to put a finger on the next box. That is a tap per field, taken while the
 * line is running, on a screen the size of a page — and the on-screen keyboard
 * covers half of it, so the next box is often not even visible to aim at.
 *
 * The rule is deliberately "the next EMPTY field", not "the next field": the
 * S.No. and slab number arrive already filled in from the register, a slab
 * being finished already has its In time, and stopping on a box that is
 * already right would be a tap to skip it — the opposite of the point.
 */

/** One field, as far as this decision is concerned. */
export interface AdvanceCandidate {
  /** Its current value. Whitespace only counts as empty. */
  value: string;
  /** Not somewhere the cursor may land: disabled, read-only, or not on screen. */
  skip?: boolean;
}

const isEmpty = (v: string) => v.trim() === "";

/**
 * The index to move the cursor to after finishing the field at `from`, or null
 * to leave it where it is.
 *
 * Only looks FORWARD, and does not wrap. An operator who has reached the end
 * of the row is either done or deliberately correcting something behind them;
 * throwing the cursor back to the top would fight both. Null is the caller's
 * cue to let go of the field instead — which on a tablet drops the keyboard
 * and puts the Save button back on screen.
 */
export function nextFieldToFocus(fields: readonly AdvanceCandidate[], from: number): number | null {
  if (!Number.isInteger(from) || from < 0 || from >= fields.length) return null;
  for (let i = from + 1; i < fields.length; i++) {
    const f = fields[i];
    if (f.skip) continue;
    if (isEmpty(f.value)) return i;
  }
  return null;
}
