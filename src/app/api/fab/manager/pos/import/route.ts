// POST /api/fab/manager/pos/import
// Body: multipart/form-data { poId: string, file: File }
// Returns 200 { success: true, requirementsCreated, totalPieces } · 4xx { error }
//
// STEP TWO OF TWO: the confirm. The same PDF is uploaded again and parsed
// again — the browser does not post back the rows the preview showed it.
// Rows that arrive as JSON are rows a browser could have edited, and the whole
// point of reconciling against the document's own totals row is that nothing
// gets between the customer's PDF and the requirement rows.
//
// ONE REQUIREMENT PER LIVE ROW, carrying length, width, quantity, the row
// number as piece_label, and po_id. sink_quantity is left NULL: the supervisor
// assigns sinks later on a board that starts empty, and pre-filling it from the
// width (or from anything else) would put a decision in his mouth.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { parsePoPdfUpload } from "@/lib/fab/poPdf";
import { flatRowLabel } from "@/lib/fab/flatSheetParser";
import { PO_REQUIREMENT_SLAB_CODE } from "@/lib/fab/poParser";
import { deriveRoutingFlags } from "@/lib/fab/requirement-derive";

// pdfjs-dist is loaded at request time from its LEGACY build and is listed in
// next.config.mjs serverExternalPackages. Both facts only hold on the Node
// runtime, so say so explicitly rather than relying on the App Router default —
// the finance route that reads PDFs the same way has always declared it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Thrown inside the transaction when another confirm got there first. */
class AlreadyImported extends Error {}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function POST(req: Request) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  let poId = "";
  let file: File | null = null;
  try {
    const form = await req.formData();
    poId = String(form.get("poId") ?? "").trim();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return Response.json({ error: "Malformed upload." }, { status: 400 });
  }
  if (!poId) return Response.json({ error: "poId required" }, { status: 400 });
  if (!file) return Response.json({ error: "No file uploaded." }, { status: 400 });

  const po = await prisma.fabPo.findUnique({
    where: { id: poId },
    select: { id: true, projectId: true, poNumber: true, pdfImportedAt: true },
  });
  if (!po) return Response.json({ error: "That purchase order no longer exists — refresh and look again." }, { status: 404 });
  if (po.pdfImportedAt) {
    return Response.json(
      { error: `PO ${po.poNumber} already has its PDF imported. Nothing was changed — open the PO to see its rows.` },
      { status: 409 },
    );
  }

  const parsed = await parsePoPdfUpload(file);
  if (!parsed.ok) {
    // The preview said the same thing, but the file can be swapped between the
    // two steps, so this is a real check and not a formality.
    return Response.json(
      { error: parsed.errors[0], errors: parsed.errors, warnings: parsed.warnings },
      { status: 422 },
    );
  }

  // Flags for a row nobody has assigned a sink to yet: polish always, no sink,
  // no fabrication. Derived rather than written out, so this intake cannot
  // drift from what the release path believes.
  const flags = deriveRoutingFlags({ sinkQuantity: null });

  const rows: Prisma.FabRequirementCreateManyInput[] = parsed.rows.map(r => ({
    projectId: po.projectId,
    poId: po.id,
    pieceLabel: flatRowLabel(r.rowNumber),
    // fab_requirement.slab_code is NOT NULL and a purchase order has no slab
    // code — the slab is the supervisor's choice, later. See the constant.
    slabCode: PO_REQUIREMENT_SLAB_CODE,
    length: r.lengthIn,
    width: r.widthIn,
    quantity: r.quantity,
    sqftPerPiece: round2((r.lengthIn * r.widthIn) / 144),
    totalSqft: r.totalSqft,
    sinkRequired: flags.sinkRequired,
    fabricationRequired: flags.fabricationRequired,
    polishRequired: flags.polishRequired,
    // sinkQuantity is deliberately absent: NULL means "the supervisor has not
    // looked at this row yet", which is the truth about every row here.
  }));

  const totalPieces = parsed.totals.totalPieces;
  // Captured before the transaction: `file` is a let, so its narrowing to File
  // does not survive into the callback below.
  const fileName = file.name;

  try {
    const created = await prisma.$transaction(async (tx) => {
      // LATCH, not a re-read. Two managers confirming the same PO seconds apart
      // both pass the check above; this UPDATE ... WHERE pdf_imported_at IS NULL
      // takes the row lock and re-evaluates against the newest committed
      // version, so exactly one of them matches a row and the other imports
      // nothing. A count() inside the transaction would not do that.
      const claimed = await tx.fabPo.updateMany({
        where: { id: po.id, pdfImportedAt: null },
        data: { pdfFileName: fileName, pdfImportedAt: new Date() },
      });
      if (claimed.count === 0) throw new AlreadyImported();

      const written = await tx.fabRequirement.createMany({ data: rows });
      await tx.fabProject.update({
        where: { id: po.projectId },
        data: { numberOfPieces: { increment: totalPieces } },
      });
      return written.count;
    });

    return Response.json({ success: true, requirementsCreated: created, totalPieces });
  } catch (e) {
    if (e instanceof AlreadyImported) {
      return Response.json(
        { error: `PO ${po.poNumber} was imported by someone else a moment ago. Nothing was created twice — refresh to see its rows.` },
        { status: 409 },
      );
    }
    console.error("fab/manager/pos/import error:", e);
    return Response.json({ error: "Could not import the purchase order. Nothing was created." }, { status: 500 });
  }
}
