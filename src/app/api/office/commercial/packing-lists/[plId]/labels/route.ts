// GET /api/office/commercial/packing-lists/[plId]/labels?kind=crate|piece
//     → the label PDF (round three, answer 4)
// GET .../labels?kind=crate&format=json
//     → { crates, missing, missingBarcodes, pieceCount, truncated } for the screen
//
// Two label kinds off one packing list: a CRATE label per crate and article,
// and a PIECE label per piece. What goes on each is decided in
// lib/commercial/articles-rules (pure, tested) and drawn in
// lib/commercial/pdf/labels.
//
// `format=json` is the same answer without the paper. The screen asks for it
// so it can say WHICH lines have no article on file before anybody prints —
// a crate label with no barcode is a label somebody has to chase, and it is
// better named on the screen than discovered on the pallet.
//
// Gated `view` on the `packing` AREA: whoever may read the packing list may
// print its labels. Not wrapped in handle() when it answers a PDF — the body
// is not JSON, so a failure answers JSON by hand, exactly as the packing-list
// and measurement-list routes do.
import { prisma } from "@/lib/prisma";
import { commercialGate } from "@/lib/commercial/access";
import { deny, json } from "@/lib/commercial/http";
import {
  crateLabels, pieceLabels, missingArticles, missingBarcodes, parseLabelKind,
  type LabelsInput, type ArticleRow,
} from "@/lib/commercial/articles-rules";
import { generateCrateLabelsPdf, generatePieceLabelsPdf, PIECE_LABELS_PER_PAGE } from "@/lib/commercial/pdf/labels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

type Ctx = { params: Promise<{ plId: string }> };

const dec = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * The list, its crates, its pieces and its slabs, plus every article that could
 * describe a design on it.
 *
 * The articles are fetched by the DESIGNS ACTUALLY PACKED rather than by the
 * customer: the fallback row for a design has no client (articles-rules.
 * articleFor prefers the customer's own row and takes ours second), so a
 * client-filtered query would silently lose it.
 */
async function loadForLabels(plId: string) {
  const list = await db.commercialPackingList.findUnique({
    where: { id: plId },
    select: {
      id: true, number: true, createdAt: true, finalisedAt: true, dispatchedAt: true,
      order: { select: { id: true, number: true, clientId: true } },
      crates: { select: { id: true, crateNo: true }, orderBy: { crateNo: "asc" } },
      pieces: {
        select: { id: true, crateId: true, crateNo: true, design: true, lengthMm: true, widthMm: true, thicknessMm: true, quantity: true },
        orderBy: { createdAt: "asc" },
      },
      slabs: {
        select: { id: true, crateId: true, design: true, lengthCm: true, widthCm: true, thickness: true },
        orderBy: { sortOrder: "asc" },
      },
      invoices: { select: { invoiceDate: true, status: true }, orderBy: { invoiceDate: "desc" } },
    },
  });
  if (!list) return null;

  const designs = Array.from(new Set<string>([
    ...list.pieces.map((p: { design: string }) => String(p.design ?? "").trim()),
    ...list.slabs.map((s: { design: string | null }) => String(s.design ?? "").trim()),
  ].filter(Boolean)));

  const articles: ArticleRow[] = designs.length
    ? (await db.commercialCustomerArticle.findMany({
        where: { OR: designs.map((d) => ({ design: { equals: d, mode: "insensitive" } })) },
        select: { id: true, clientId: true, design: true, lengthCm: true, widthCm: true, thicknessCm: true, itemCode: true, description: true, ean: true, notes: true },
      })).map((a: Record<string, unknown>) => ({
        id: String(a.id),
        clientId: (a.clientId as string | null) ?? null,
        design: String(a.design),
        lengthCm: Number(a.lengthCm), widthCm: Number(a.widthCm), thicknessCm: Number(a.thicknessCm),
        itemCode: (a.itemCode as string | null) ?? null,
        description: (a.description as string | null) ?? null,
        ean: (a.ean as string | null) ?? null,
        notes: (a.notes as string | null) ?? null,
      }))
    : [];

  const issued = list.invoices.find((i: { status: string }) => i.status === "ISSUED") ?? list.invoices[0] ?? null;

  const input: LabelsInput = {
    clientId: list.order?.clientId ?? null,
    crates: list.crates.map((c: { id: string; crateNo: number }) => ({ id: c.id, crateNo: Number(c.crateNo) })),
    pieces: list.pieces.map((p: Record<string, unknown>) => ({
      crateId: (p.crateId as string | null) ?? null,
      crateNo: (p.crateNo as string | null) ?? null,
      design: String(p.design ?? ""),
      lengthMm: dec(p.lengthMm), widthMm: dec(p.widthMm), thicknessMm: dec(p.thicknessMm),
      quantity: Number(p.quantity ?? 1),
    })),
    slabs: list.slabs.map((s: Record<string, unknown>) => ({
      crateId: (s.crateId as string | null) ?? null,
      design: (s.design as string | null) ?? null,
      lengthCm: dec(s.lengthCm), widthCm: dec(s.widthCm),
      thickness: (s.thickness as string | null) ?? null,
    })),
    articles,
    list: {
      dispatchedAt: list.dispatchedAt ?? null,
      finalisedAt: list.finalisedAt ?? null,
      invoiceDate: issued?.invoiceDate ?? null,
      createdAt: list.createdAt ?? null,
    },
  };
  return { number: String(list.number), orderNumber: String(list.order?.number ?? ""), input };
}

/** `PL-0007 crate labels.pdf` — the filename a packer will look for. */
const filenameOf = (number: string, kind: string): string =>
  `${String(number).replace(/[\\/:*?"<>|]/g, "-")} ${kind} labels.pdf`;

export async function GET(req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "packing");
  if (!g.ok) return deny(g);
  try {
    const { plId } = await params;
    if (!plId) return json({ error: "Missing packing list id" }, 400);

    const sp = new URL(req.url).searchParams;
    const kind = parseLabelKind(sp.get("kind"));
    if (!kind) return json({ error: 'Which labels — kind=crate or kind=piece?' }, 400);

    const src = await loadForLabels(plId);
    if (!src) return json({ error: "Packing list not found" }, 404);

    // TWO LISTS, NOT ONE. `missing` is "no article on file — add the row";
    // `missingBarcodes` is "the row is there and the barcode is not — chase the
    // customer, or fix the digit somebody mistyped". Both print a crate label
    // without bars, and they are chased by different people.
    const missing = missingArticles(src.input);

    if (sp.get("format") === "json") {
      const pieces = pieceLabels(src.input);
      return json({
        number: src.number,
        orderNumber: src.orderNumber,
        kind,
        missing,
        missingBarcodes: missingBarcodes(src.input),
        crates: crateLabels(src.input),
        pieceCount: pieces.labels.length,
        pieceLabelsPerPage: PIECE_LABELS_PER_PAGE,
        truncated: pieces.truncated,
      });
    }

    const buf = kind === "crate"
      ? await generateCrateLabelsPdf({ listNumber: src.number, labels: crateLabels(src.input) })
      : await (async () => {
          const { labels, truncated } = pieceLabels(src.input);
          return generatePieceLabelsPdf({ listNumber: src.number, labels, truncated });
        })();

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filenameOf(src.number, kind)}"`,
        // The label carries a quantity and a shipping date that both move
        // while a list is being packed; a cached sheet is a wrong sheet.
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const status = typeof e === "object" && e !== null && typeof (e as { status?: number }).status === "number" ? (e as { status: number }).status : 500;
    return json({ error: (e as Error)?.message ?? "Could not build the labels" }, status);
  }
}
