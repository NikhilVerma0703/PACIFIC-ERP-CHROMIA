// HOW A PIECE IS NAMED: {projectCode}-{rowLetter}-{n}
//
//   PRJ1-A-1   the first piece of the first row of project PRJ1
//   PRJ1-A-12  the twelfth piece of that same row
//   PRJ1-B-1   the first piece of the second row
//
// One letter per ORDERED ROW, one number per PIECE. That is the whole rule, and
// it is the owner's: a cutter reading a piece of stone sees which row it belongs
// to and which piece of that row it is, without a lookup.
//
// PURE, AND IT IMPORTS NOTHING — same rule as slabLoss.ts, releasePlan.ts and
// sampling/size.ts: `node --test` resolves ESM strictly, so a relative import
// without a .ts extension fails at runtime while adding the extension fights the
// Next build.
//
// ─────────────────────────────────────────────────────────── PAST Z ─────────
// 26 letters do not cover a real order. The Kerasom sheet is 28 rows; PO 10026
// is 23. So the sequence continues the way a spreadsheet's columns do:
//
//   A … Z, AA, AB … AZ, BA … ZZ, AAA …
//
// This is BIJECTIVE base-26, not ordinary base-26, and the difference is the
// bug it avoids: there is no zero digit, so Z is followed by AA rather than by
// "BA" or "A0", and every index maps to exactly one label with no gaps and no
// collisions. Getting this wrong is not a cosmetic problem — two rows sharing a
// letter means two different sizes carrying the same code on the floor.
//
// ───────────────────────────────────────────────── THE LETTER IS STORED ─────
// fab_requirement.row_letter, assigned once when the row is imported, and never
// recomputed. Deriving it from row order at read time would look simpler and be
// wrong: adding a second purchase order to a project, or deleting a row, would
// silently re-letter every piece already cut and stickered. A label on stone
// cannot be migrated.
//
// The letter is unique per PROJECT, not per PO, because the code's root is the
// project code and fab_piece.piece_code is @unique globally.

/** Letters only, upper case, no I/O exclusions — a code is read from a screen
 *  as often as from a sticker, and skipping letters costs more confusion than
 *  it saves. */
const A = "A".charCodeAt(0);
const ALPHABET = 26;

/**
 * The label for the 0-based row index: 0 -> "A", 25 -> "Z", 26 -> "AA".
 *
 * Bijective base-26. Negative, fractional and non-finite indexes are clamped to
 * 0 rather than throwing: this runs inside an import loop, and one malformed
 * row must not take the whole purchase order down with it.
 */
export function rowLetter(index: number): string {
  let i = Number.isFinite(index) ? Math.floor(index) : 0;
  if (i < 0) i = 0;
  let out = "";
  // Bijective: subtract one each round so the digit range is 1..26, not 0..25.
  do {
    out = String.fromCharCode(A + (i % ALPHABET)) + out;
    i = Math.floor(i / ALPHABET) - 1;
  } while (i >= 0);
  return out;
}

/**
 * The inverse: "A" -> 0, "Z" -> 25, "AA" -> 26. Null for anything that is not a
 * run of A-Z, which is how a legacy label ("Row 3", "2B", "") is recognised
 * rather than mis-parsed into a number that would collide with a real row.
 */
export function rowLetterIndex(label: string | null | undefined): number | null {
  const s = String(label ?? "").trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return null;
  let n = 0;
  for (const ch of s) n = n * ALPHABET + (ch.charCodeAt(0) - A + 1);
  return n - 1;
}

/**
 * The next free letter for a project, given every letter it already uses.
 *
 * Takes the MAXIMUM and adds one rather than filling the first gap. A deleted
 * row must not hand its letter to a different size later — somewhere there is a
 * cut sheet, a photograph or a piece of stone still carrying it.
 */
export function nextRowLetter(existingLetters: Array<string | null | undefined>): string {
  let maxIndex = -1;
  for (const l of existingLetters ?? []) {
    const i = rowLetterIndex(l);
    if (i !== null && i > maxIndex) maxIndex = i;
  }
  return rowLetter(maxIndex + 1);
}

/**
 * Letters for a run of new rows, continuing after whatever the project holds.
 * One call rather than a loop of nextRowLetter, so an import cannot hand the
 * same letter to two rows by reading a list it has not written yet.
 */
export function assignRowLetters(
  existingLetters: Array<string | null | undefined>,
  count: number,
): string[] {
  let maxIndex = -1;
  for (const l of existingLetters ?? []) {
    const i = rowLetterIndex(l);
    if (i !== null && i > maxIndex) maxIndex = i;
  }
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return Array.from({ length: n }, (_, k) => rowLetter(maxIndex + 1 + k));
}

/**
 * The piece code itself.
 *
 * NOT ZERO-PADDED, which is the owner's spelling — "numbers start from 1". The
 * cost is that a plain string sort puts A-10 before A-2, so anything ordering
 * pieces for a person must sort by the NUMBER (piecesInRowOrder below), never by
 * the code. That is a display concern; the code's job is to be short enough to
 * write on stone.
 */
export function formatPieceCode(projectCode: string, letter: string, n: number): string {
  const p = String(projectCode ?? "").trim();
  const l = String(letter ?? "").trim().toUpperCase();
  const i = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  return `${p}-${l}-${i}`;
}

/** What a code says, or null if it is not one of ours. Used to continue a
 *  row's numbering and to recognise the two retired formats. */
export interface ParsedPieceCode {
  projectCode: string;
  letter: string;
  n: number;
}

export function parsePieceCode(code: string | null | undefined): ParsedPieceCode | null {
  const s = String(code ?? "").trim();
  // Project codes may contain hyphens, so anchor on the LAST two segments.
  const m = /^(.+)-([A-Z]+)-(\d+)$/.exec(s.toUpperCase());
  if (!m) return null;
  const n = Number(m[3]);
  if (!Number.isFinite(n) || n < 1) return null;
  return { projectCode: m[1], letter: m[2], n };
}

/**
 * Where a ROW's piece numbering resumes.
 *
 * A row is not cut in one go: 28 ordered pieces can be 12 on one slab and 16 on
 * the next, days apart. Numbering restarts at 1 on the second slab unless this
 * is asked, and fab_piece.piece_code is @unique globally — so the second slab
 * would not merely mislabel, it would fail to insert.
 *
 * Only codes matching THIS project and THIS letter are counted. The retired
 * formats ({projectCode}-{NNNN} from release-project, and
 * {projectCode}-{label}-{NNN}-{slabSuffix} from the old cutting queue) do not
 * parse and are ignored rather than guessed at.
 */
export function nextPieceNumberInRow(
  projectCode: string,
  letter: string,
  existingPieceCodes: Array<string | null | undefined>,
): number {
  const wantProject = String(projectCode ?? "").trim().toUpperCase();
  const wantLetter = String(letter ?? "").trim().toUpperCase();
  let next = 1;
  for (const code of existingPieceCodes ?? []) {
    const p = parsePieceCode(code);
    if (!p) continue;
    if (p.projectCode !== wantProject || p.letter !== wantLetter) continue;
    if (p.n >= next) next = p.n + 1;
  }
  return next;
}

/** Sort pieces the way a person counts them: by letter, then by number. Exists
 *  because the codes are not zero-padded and a string sort reads A-10 < A-2. */
export function comparePieceCodes(a: string, b: string): number {
  const pa = parsePieceCode(a);
  const pb = parsePieceCode(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  if (pa.projectCode !== pb.projectCode) return pa.projectCode.localeCompare(pb.projectCode);
  const la = rowLetterIndex(pa.letter) ?? 0;
  const lb = rowLetterIndex(pb.letter) ?? 0;
  if (la !== lb) return la - lb;
  return pa.n - pb.n;
}

/**
 * How a ROW is named on screen, given its stored letter.
 *
 * Falls back to the imported label ("Row 3") when a row has no letter yet —
 * every requirement created before scripts/0054, and any row whose backfill was
 * skipped. Showing the old label is honest; inventing a letter for it would put
 * a name on screen that no piece of stone carries.
 */
export function rowLabel(
  rowLetterValue: string | null | undefined,
  fallbackLabel?: string | null,
): string {
  const l = String(rowLetterValue ?? "").trim().toUpperCase();
  if (/^[A-Z]+$/.test(l)) return l;
  const f = String(fallbackLabel ?? "").trim();
  return f || "—";
}
