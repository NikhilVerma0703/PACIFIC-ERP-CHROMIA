/* eslint-disable @typescript-eslint/no-explicit-any */
// The Measurement List — pdfmake, A4 portrait, laid out like the CIOT
// workbook's "Measmt List" tab: one line per slab in crate order, a subtotal
// after each crate, and a grand total in pieces, square metres and square feet.
//
// The customer's own slab number prints in its own column WHEN ANY SLAB HAS
// ONE (open question 16, default: both columns exist; theirs prints when
// filled, ours always). With no customer numbering there is no empty column.
// Their BATCH is printed the same way — under ours in the Batch cell, never
// instead of it, which is what §16 asks for and what the sheet used to lose.
//
// Row order, subtotals and totals are decided in ../packing-rules
// (measurementRows) and tested there; this file only draws them.
import { buildPdf } from "@/lib/sales/pdf/common";
import type { CommercialSettings } from "@/lib/commercial/settings-defaults";
import {
  measurementRows, partyLines, fallbackParty, fmtSlabNo, measurementHeaderRef,
  type SlabLike, type CrateLike, type PartyLike,
} from "@/lib/commercial/packing-rules";
import { pieceSheet, sizeFromMm, type PieceLike } from "@/lib/commercial/pieces-rules";
import { sizeInUnit, parseMeasurementUnit, type MeasurementUnit } from "@/lib/commercial/measure";

export interface MeasurementListPdfInput {
  list: {
    number: string;
    createdAt?: string | Date | null;
    /** cm (347 × 201) or in (137 × 79) — the unit the Length and Width columns
     *  print in (answer 17). The rows are stored in centimetres either way. */
    measurementUnit?: MeasurementUnit | string | null;
    containerNo?: string | null;
    vehicleNo?: string | null;
    crates: CrateLike[];
    slabs: SlabLike[];
    /** Cut-to-size lines (round three, answer 5): stored in millimetres, printed
     *  under the slab lines in the list's own unit, with the unit in the heading. */
    pieces?: PieceLike[];
  };
  order: {
    number: string;
    kind: "DOMESTIC" | "EXPORT" | string;
    customerPoNumber?: string | null;
    consignee?: PartyLike | null;
  };
  client?: { name: string; address?: string | null; city?: string | null; country?: string | null } | null;
  ext?: { shippingAddress?: PartyLike | null; billingAddress?: PartyLike | null } | null;
  settings: CommercialSettings;
  invoice?: { number: string; invoiceDate?: string | Date | null } | null;
}

const GREY = "#f2f2f2";
const B = "#000000";

function fmt(n: number | null | undefined, dp: number): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

const th = (text: string, alignment: "left" | "center" | "right" = "center"): any =>
  ({ text, fontSize: 6.5, bold: true, alignment, fillColor: GREY, margin: [2, 3, 2, 3] });

const td = (text: string, alignment: "left" | "center" | "right" = "left", opts: Record<string, any> = {}): any =>
  ({ text, fontSize: 7, alignment, margin: [2, 1.5, 2, 1.5], ...opts });

export async function generateMeasurementListPdf(input: MeasurementListPdfInput): Promise<Buffer> {
  const { list, order, settings } = input;
  const company = settings.company;
  const sheet = measurementRows(list.slabs, list.crates);
  const both = sheet.hasCustomerNos;
  const ref = measurementHeaderRef(input.invoice ?? null, list);

  const consignee = (order.consignee && (order.consignee.name || (order.consignee.lines ?? []).length))
    ? order.consignee
    : fallbackParty(input.client ?? null, input.ext ?? null);

  // The unit is in the heading and the figure is converted at the edge: a
  // list switched to inches prints 136.6 × 79.1 under "Length in", never a
  // centimetre figure under an inch heading. Inches carry one decimal because
  // the conversion produces one; centimetres print whole, as the sheet always has.
  const unit: MeasurementUnit = parseMeasurementUnit(list.measurementUnit) ?? "cm";
  const sizeDp = unit === "in" ? 1 : 0;
  const size = (cm: number | null): string => fmt(sizeInUnit(cm, unit), sizeDp);

  const batchHead = sheet.hasCustomerBatches ? "Batch\nours / theirs" : "Batch";
  const header = both
    ? [th("Sl"), th("Design / SKU", "left"), th(batchHead), th("Cust. Slab No"), th("Slab No"), th("Thick"), th(`Length\n${unit}`), th(`Width\n${unit}`), th("Sqm"), th("Crate")]
    : [th("Sl"), th("Design / SKU", "left"), th(batchHead), th("Slab No"), th("Thick"), th(`Length\n${unit}`), th(`Width\n${unit}`), th("Sqm"), th("Crate")];

  const body: any[][] = [header];
  for (const r of sheet.rows) {
    if (r.kind === "slab") {
      const cells = [
        td(String(r.sl), "center"),
        td(r.description),
        // Ours on the first line, theirs under it when they gave one — never
        // instead of ours (OPEN-QUESTIONS §16).
        td(sheet.hasCustomerBatches && r.customerBatch ? `${r.batch || "—"}\n${r.customerBatch}` : r.batch, "center"),
        ...(both ? [td(r.customerSlabNo, "center")] : []),
        td(fmtSlabNo(r.slabNumber), "center"),
        td(r.thickness, "center"),
        td(size(r.lengthCm), "right"),
        td(size(r.widthCm), "right"),
        td(fmt(r.sqm, 4), "right"),
        td(r.crateNo != null ? String(r.crateNo) : "—", "center"),
      ];
      body.push(cells);
    } else {
      const label = r.crateNo != null ? `Crate ${r.crateNo} — ${r.slabs} slab(s)` : `Not in a crate — ${r.slabs} slab(s)`;
      body.push([
        { text: label, fontSize: 7, bold: true, alignment: "right", fillColor: GREY, colSpan: both ? 8 : 7, margin: [2, 2, 2, 2] },
        ...Array.from({ length: both ? 7 : 6 }, () => ({})),
        { text: fmt(r.sqm, 4), fontSize: 7, bold: true, alignment: "right", fillColor: GREY, margin: [2, 2, 2, 2] },
        { text: "", fillColor: GREY },
      ]);
    }
  }
  // The square feet go in the label rather than the last column: the Crate
  // column is 24pt wide and "375.596 sqft" wraps to three lines in it.
  body.push([
    { text: `TOTAL — ${sheet.totals.slabs} slab(s) · ${fmt(sheet.totals.sqft, 3)} sqft`, fontSize: 7.5, bold: true, alignment: "right", colSpan: both ? 8 : 7, margin: [2, 3, 2, 3] },
    ...Array.from({ length: both ? 7 : 6 }, () => ({})),
    { text: fmt(sheet.totals.sqm, 4), fontSize: 7.5, bold: true, alignment: "right", margin: [2, 3, 2, 3] },
    { text: "", margin: [2, 3, 2, 3] },
  ]);

  const widths = both
    ? [18, "*", 46, 50, 44, 26, 32, 30, 42, 24]
    : [18, "*", 50, 48, 28, 34, 32, 46, 26];

  // ── the cut-to-size lines (round three, answer 5) ──────────────────────────
  // The measurement list is the sheet that carries SIZES, so his cut-to-size
  // columns belong on it in full: crate, drawing, piece, material, L × W × T,
  // sqft, quantity, building and weight, with a subtotal per crate and the
  // sheet's TOTAL — the rows and the subtotals decided in ../pieces-rules.
  //
  // The rows are millimetres; the heading names the printed unit and the figure
  // is converted into it, so a heading can never sit over a number in another
  // unit, which is what his own workbook does.
  const psheet = pieceSheet(list.pieces ?? []);
  const mm = (v: number | null | undefined): string => fmt(sizeFromMm(v ?? null, unit), unit === "in" ? 2 : 1);

  type PieceRow = Extract<typeof psheet.rows[number], { kind: "piece" }>;
  interface PieceCol { head: string; width: number | string; align: "left" | "center" | "right"; cell: (r: PieceRow) => string }
  const pieceCols: PieceCol[] = [
    { head: "Sl", width: 18, align: "center", cell: (r) => String(r.sl) },
    { head: "Crate\nNo.", width: 28, align: "center", cell: (r) => r.crateNo ?? "—" },
    ...(psheet.hasDrawings ? [{ head: "Drawing\nNo.", width: 44, align: "center" as const, cell: (r: PieceRow) => r.drawingNo }] : []),
    { head: "Piece\nNo.", width: 30, align: "center", cell: (r) => r.pieceNo },
    { head: "Material Name", width: "*", align: "left", cell: (r) => r.design },
    { head: `Length\n${unit}`, width: 36, align: "right", cell: (r) => mm(r.lengthMm) },
    { head: `Width\n${unit}`, width: 32, align: "right", cell: (r) => mm(r.widthMm) },
    { head: `Thick\n${unit}`, width: 30, align: "right", cell: (r) => mm(r.thicknessMm) },
    { head: "Sqft", width: 38, align: "right", cell: (r) => fmt(r.sqft, 3) },
    { head: "Qty\n(Pcs)", width: 26, align: "center", cell: (r) => String(r.quantity) },
    ...(psheet.hasRooms ? [{ head: "Building", width: 54, align: "left" as const, cell: (r: PieceRow) => r.room }] : []),
    ...(psheet.hasWeights ? [{ head: "Weight\n(Kgs)", width: 38, align: "right" as const, cell: (r: PieceRow) => fmt(r.weightKg, 2) }] : []),
  ];
  const sqftAt = pieceCols.findIndex((c) => c.head === "Sqft");
  const tailFrom = sqftAt + 2;

  const pieceTotalRow = (label: string, sqft: number, pcs: number, kg: number | null, fill?: string): any[] => [
    { text: label, fontSize: 7, bold: true, alignment: "right", colSpan: sqftAt, margin: [2, 2, 2, 2], fillColor: fill },
    // An empty TEXT, not a bare {}: pdfmake throws "Unrecognized document
    // structure" on a cell that carries a fill and no content, which is exactly
    // what a grey crate-subtotal row is made of.
    ...Array.from({ length: sqftAt - 1 }, () => ({ text: "", fillColor: fill })),
    { text: fmt(sqft, 3), fontSize: 7, bold: true, alignment: "right", margin: [2, 2, 2, 2], fillColor: fill },
    { text: String(pcs), fontSize: 7, bold: true, alignment: "center", margin: [2, 2, 2, 2], fillColor: fill },
    ...pieceCols.slice(tailFrom).map((c) => ({
      text: c.head.startsWith("Weight") ? (kg == null ? "" : fmt(kg, 2)) : "",
      fontSize: 7, bold: true, alignment: c.align, margin: [2, 2, 2, 2], fillColor: fill,
    })),
  ];

  const pieceBody: any[][] = [pieceCols.map((c) => th(c.head, c.align))];
  for (const r of psheet.rows) {
    if (r.kind === "piece") pieceBody.push(pieceCols.map((c) => td(c.cell(r), c.align)));
    else pieceBody.push(pieceTotalRow(r.crateNo ? `Crate ${r.crateNo} — ${r.pieces} pc(s)` : `Not in a crate — ${r.pieces} pc(s)`, r.sqft, r.pieces, r.weightKg, GREY));
  }
  pieceBody.push(pieceTotalRow(`TOTAL — ${psheet.totals.lines} line(s)`, psheet.totals.sqft, psheet.totals.pieces, psheet.totals.weightKg));

  const pieceBlock: any[] = psheet.rows.length ? [
    { text: " ", fontSize: 4 },
    { text: `Cut to Size — sizes in ${unit === "in" ? "inches" : "centimetres"}`, fontSize: 8, bold: true, margin: [0, 0, 0, 2] },
    {
      table: { headerRows: 1, widths: pieceCols.map((c) => c.width), body: pieceBody },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => "#666", vLineColor: () => "#666" },
    },
  ] : [];

  const docDef: any = {
    pageSize: "A4",
    pageMargins: [20, 20, 20, 28],
    defaultStyle: { font: "Roboto", fontSize: 7.5 },
    footer: (page: number, count: number) => ({
      columns: [
        { text: `${list.number} · Measurement List`, fontSize: 6, color: "#777", margin: [20, 0, 0, 0] },
        { text: `Page ${page} of ${count}`, fontSize: 6, color: "#777", alignment: "right", margin: [0, 0, 20, 0] },
      ],
    }),
    content: [
      { text: "Measurement List", fontSize: 12, bold: true, alignment: "center" },
      { text: company.legalName, fontSize: 8, alignment: "center", margin: [0, 1, 0, 5] },
      {
        table: {
          widths: ["50%", "50%"],
          body: [[
            {
              stack: [
                { text: "Consignee", fontSize: 6, bold: true, color: "#555" },
                ...partyLines(consignee).map((l) => ({ text: l, fontSize: 7.5 })),
              ],
              margin: [3, 2, 3, 2],
            },
            {
              stack: [
                { text: `${ref.label}: ${ref.value}`, fontSize: 7.5 },
                { text: `${ref.dateLabel}: ${ref.dateValue}`, fontSize: 7.5 },
                { text: `PI / Order Ref.: ${order.number}`, fontSize: 7.5 },
                { text: `Buyer's PO: ${order.customerPoNumber ?? "—"}`, fontSize: 7.5 },
                { text: `Packing List: ${list.number}${list.containerNo ? `   Container: ${list.containerNo}` : ""}`, fontSize: 7.5 },
              ],
              margin: [3, 2, 3, 2],
            },
          ]],
        },
        layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => B, vLineColor: () => B },
      },
      { text: " ", fontSize: 3 },
      // A list may pack slabs, pieces, or both (round three, answer 5). Each
      // table prints only when it has rows: a cut-to-size list was showing an
      // empty slab table whose TOTAL read nought slabs, which is a line a
      // customs desk has to ask about.
      ...(list.slabs.length ? [{
        table: { headerRows: 1, widths, body },
        layout: {
          hLineWidth: () => 0.5, vLineWidth: () => 0.5,
          hLineColor: () => "#666", vLineColor: () => "#666",
        },
      }] : []),
      ...pieceBlock,
      {
        columns: [
          { text: `${sheet.totals.slabs} slab(s) · ${fmt(sheet.totals.sqm, 4)} sqm · ${fmt(sheet.totals.sqft, 3)} sqft${psheet.rows.length ? ` · ${psheet.totals.pieces} cut piece(s) · ${fmt(psheet.totals.sqft, 3)} sqft` : ""} · sizes in ${unit === "in" ? "inches" : "centimetres"}`, fontSize: 7, color: "#555" },
          {
            stack: [
              { text: `For ${company.legalName}`, fontSize: 7.5, bold: true, alignment: "right" },
              { text: " ", fontSize: 16 },
              { text: "Authorised Signatory", fontSize: 7.5, alignment: "right" },
            ],
          },
        ],
        margin: [0, 8, 0, 0],
      },
    ],
  };

  return buildPdf(docDef);
}
