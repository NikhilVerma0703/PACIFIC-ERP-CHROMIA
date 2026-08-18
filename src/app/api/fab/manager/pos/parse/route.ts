// POST /api/fab/manager/pos/parse
// Body: multipart/form-data { file: File }
// Returns 200 { ok: true, preview } · 422 { ok: false, error, errors, warnings }
//
// STEP ONE OF TWO, AND IT WRITES NOTHING. This route opens the purchase order,
// reads the page-2 piece table out of it, reconciles it against the table's own
// totals row and hands the manager back exactly what would be created. Nothing
// reaches the database until he posts the same file to ../import.
//
// It reads ONLY the piece table. Page 1 — PO number, buyer, material,
// thickness, dates, terms, destination, prices — is never touched, so a PO
// whose commercial header changed still imports and a PO whose table changed
// still does not.

import { fabGate } from "@/lib/fab/access";
import { parsePoPdfUpload } from "@/lib/fab/poPdf";
import { flatRowLabel } from "@/lib/fab/flatSheetParser";

/** Reading a two-page PDF is fast; the ceiling is for a cold lambda that has to
 *  evaluate the pdf.js legacy build first. */
export const maxDuration = 60;

export async function POST(req: Request) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return Response.json({ error: "Malformed upload." }, { status: 400 });
  }
  if (!file) return Response.json({ error: "No file uploaded." }, { status: 400 });

  const parsed = await parsePoPdfUpload(file);

  if (!parsed.ok) {
    // Every problem at once, and the first one as the headline — a manager
    // fixing one error at a time on a document he cannot edit is a manager who
    // gives up and asks someone to type the rows in by hand.
    return Response.json(
      { ok: false, error: parsed.errors[0], errors: parsed.errors, warnings: parsed.warnings },
      { status: 422 },
    );
  }

  return Response.json({
    ok: true,
    preview: {
      fileName: file.name,
      rows: parsed.rows.map(r => ({
        rowNumber: r.rowNumber,
        label: flatRowLabel(r.rowNumber),
        lengthIn: r.lengthIn,
        widthIn: r.widthIn,
        quantity: r.quantity,
        totalSqft: r.totalSqft,
      })),
      skipped: {
        count: parsed.skippedZeroQtyRows.length,
        rowNumbers: parsed.skippedZeroQtyRows.map(r => r.rowNumber),
      },
      // Both figures, side by side, because "the totals agree" is the one thing
      // the manager is being asked to confirm.
      computed: {
        rowCount: parsed.totals.rowCount,
        totalPieces: parsed.totals.totalPieces,
        totalSqft: parsed.totals.totalSqftRounded,
        totalSqftExact: parsed.totals.totalSqft,
      },
      stated: parsed.stated,
      warnings: parsed.warnings,
    },
  });
}
