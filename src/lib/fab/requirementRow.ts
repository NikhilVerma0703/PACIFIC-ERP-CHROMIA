// Shared parse/math for manager edits of PO piece rows after PDF import.
// Pure so node --test can cover the numbers the API will write.

export const SQ_IN_PER_SQ_FT = 144;

export interface RequirementRowFields {
  pieceLabel: string;
  lengthIn: number;
  widthIn: number;
  quantity: number;
  notes: string | null;
  sqftPerPiece: number;
  totalSqft: number;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function rowSqft(lengthIn: number, widthIn: number, quantity: number): {
  sqftPerPiece: number;
  totalSqft: number;
} {
  const sqftPerPiece = round2((lengthIn * widthIn) / SQ_IN_PER_SQ_FT);
  return { sqftPerPiece, totalSqft: round2(sqftPerPiece * quantity) };
}

function finitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export function parseRequirementRowInput(
  body: unknown,
  opts: { partial?: boolean } = {},
): { ok: true; value: Partial<RequirementRowFields> } | { ok: false; error: string } {
  if (body == null || typeof body !== "object") {
    return { ok: false, error: "Malformed request body." };
  }
  const b = body as Record<string, unknown>;
  const out: Partial<RequirementRowFields> = {};
  const partial = opts.partial === true;

  if (b.pieceLabel !== undefined || !partial) {
    const label = typeof b.pieceLabel === "string" ? b.pieceLabel.trim() : "";
    if (!label) return { ok: false, error: "A row label is required." };
    if (label.length > 40) return { ok: false, error: "Keep the row label to 40 characters." };
    out.pieceLabel = label;
  }

  if (b.lengthIn !== undefined || b.length !== undefined || !partial) {
    const lengthIn = Number(b.lengthIn ?? b.length);
    if (!finitePositive(lengthIn)) return { ok: false, error: "Length must be a number greater than 0." };
    out.lengthIn = round2(lengthIn);
  }

  if (b.widthIn !== undefined || b.width !== undefined || !partial) {
    const widthIn = Number(b.widthIn ?? b.width);
    if (!finitePositive(widthIn)) return { ok: false, error: "Width must be a number greater than 0." };
    out.widthIn = round2(widthIn);
  }

  if (b.quantity !== undefined || !partial) {
    const quantity = Number(b.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, error: "Quantity must be a whole number of at least 1." };
    }
    if (quantity > 50_000) return { ok: false, error: "Quantity is too large." };
    out.quantity = quantity;
  }

  if (b.notes !== undefined) {
    if (b.notes !== null && typeof b.notes !== "string") {
      return { ok: false, error: "Notes must be text." };
    }
    const notes = typeof b.notes === "string" ? b.notes.trim() : "";
    if (notes.length > 500) return { ok: false, error: "Keep notes to 500 characters." };
    out.notes = notes === "" ? null : notes;
  }

  return { ok: true, value: out };
}
