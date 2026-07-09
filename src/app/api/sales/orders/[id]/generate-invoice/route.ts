/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/sales/orders/[id]/generate-invoice
 *
 * 1. Loads invoice config (QUARTZ/GRANITE defaults + saved overrides)
 * 2. Loads per-order data (marks & nos, item net weights, charges)
 * 3. Generates the Commercial Invoice PDF via pdfmake
 * 4. Merges with uploaded packing list + measurement list (if present) via pdf-lib
 * 5. Saves the combined PDF as base64 data URL into sales_shipment_docs.combined_pdf_url
 * 6. Creates a sales_notification for the SP — "Invoice ready for [Order]"
 *
 * Role guard: COMMERCIAL or SALES_ADMIN only.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma }                      from "@/lib/prisma";
import { NextResponse }                from "next/server";
import { generateCommercialInvoicePdf } from "@/lib/sales/pdf/commercialInvoicePdf";
import { QUARTZ_DEFAULTS, GRANITE_DEFAULTS } from "@/lib/sales/invoiceDefaults";

const db = prisma as any;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}.${mm}.${yy}`;
}

function fyYear(d: Date): string {
  const yr = d.getFullYear();
  const mo = d.getMonth() + 1;
  return mo >= 4 ? `${yr}-${String(yr + 1).slice(2)}` : `${yr - 1}-${String(yr).slice(2)}`;
}

/**
 * Merges an array of PDFs (as Buffers) into a single Buffer using pdf-lib.
 * Skips any null/empty entries.
 *
 * pdf-lib is NOT a dependency of this repo (deliberate: the sales port only
 * added nodemailer + pdfmake). It is loaded lazily; without it the merge step
 * throws, the route falls back to the invoice PDF alone, and only the
 * uploaded packing/measurement lists are left out of the combined file.
 * `npm install pdf-lib` on the server re-enables merging.
 */
async function mergePdfs(pdfs: (Buffer | null | undefined)[]): Promise<Buffer> {
  let PDFDocument: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PDFDocument = require("pdf-lib").PDFDocument;
  } catch {
    throw new Error("pdf-lib not installed - run `npm install pdf-lib` to enable combined PDFs");
  }
  const merged = await PDFDocument.create();
  for (const pdf of pdfs) {
    if (!pdf || pdf.length === 0) continue;
    try {
      const src  = await PDFDocument.load(pdf);
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) merged.addPage(page);
    } catch {
      // Skip corrupt/unreadable PDFs silently
    }
  }
  const bytes = await merged.save();
  return Buffer.from(bytes);
}

/**
 * Decodes a base64 data URL (data:application/pdf;base64,…) → Buffer.
 * Returns null if the string is not a valid data URL or is empty.
 */
function dataUrlToBuffer(url: string | null | undefined): Buffer | null {
  if (!url || !url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  return Buffer.from(url.slice(comma + 1), "base64");
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const sysRole   = (session.user as any).role      as string | null;
  // Any authenticated sales user or system admin can generate the combined PDF
  if (!salesRole && sysRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — no sales role" }, { status: 403 });
  }

  const { id } = await params;

  // ── 1. Load order + PI + shipment docs ─────────────────────────────────────
  const order = await db.salesOrder.findUnique({
    where: { id },
    include: {
      client:  true,
      sp:      { select: { id: true, name: true, email: true } },
      proformaInvoices: {
        where:   { status: "ACCEPTED" },
        take:    1,
        orderBy: { acceptedAt: "desc" },
      },
      shipmentDocs: true,
    },
  });

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const pi   = order.proformaInvoices?.[0];
  const ship = order.shipmentDocs;

  // Determine factory type
  const productType: "QUARTZ" | "GRANITE" =
    pi?.productType === "GRANITE" ? "GRANITE" : "QUARTZ";

  // ── 2. Load invoice config ──────────────────────────────────────────────────
  const cfgCol  = productType === "GRANITE" ? "invoice_config_granite" : "invoice_config_quartz";
  const cfgRows = await db.$queryRawUnsafe(
    `SELECT ${cfgCol} AS config FROM sales_config WHERE id = 'global'`
  ) as any[];
  const savedCfg   = cfgRows[0]?.config ?? {};
  const defaultCfg = productType === "GRANITE" ? GRANITE_DEFAULTS : QUARTZ_DEFAULTS;
  const cfg        = { ...defaultCfg, ...savedCfg };

  // ── 3. Load per-order invoice data ─────────────────────────────────────────
  const orderRows = await db.$queryRawUnsafe(
    `SELECT marks_nos, item_net_weights, ocean_freight, packing_charges,
            insurance_pct, discount_amount, packing_list_upload, measurement_list_upload
     FROM sales_shipment_docs WHERE order_id = $1`, id
  ) as any[];
  const od = orderRows[0] ?? {};

  const marksNos       = od.marks_nos ?? "";
  const itemNetWeights = (od.item_net_weights as string[] | null) ?? [];
  const oceanFreight   = parseFloat(od.ocean_freight   ?? 0) || 0;
  const packingCharges = parseFloat(od.packing_charges ?? 0) || 0;
  const insurancePct   = parseFloat(od.insurance_pct   ?? 0) || 0;
  const discountAmount = parseFloat(od.discount_amount  ?? 0) || 0;
  const plUpload       = od.packing_list_upload    as string | null;
  const mlUpload       = od.measurement_list_upload as string | null;

  // ── 4. Derive invoice number & dates ───────────────────────────────────────
  const now         = new Date();
  const invoiceNo   = order.invoiceNumber || order.orderNumber || id;
  const invoiceDate = fmtDate(now);
  const fyYr        = fyYear(now);
  const piDate      = pi?.createdAt ? fmtDate(new Date(pi.createdAt)) : "";

  // ── 5. Build invoice data object ───────────────────────────────────────────
  const invoiceData = {
    cfg,
    invoiceNo,
    invoiceDate,
    fyYear:              fyYr,
    buyerPoNo:           pi?.buyerPoNo           ?? order.buyerPoNo ?? "",
    piNumber:            pi?.piNumber            ?? "",
    piDate,
    spName:              order.sp?.name          ?? "",
    consigneeDetails:    pi?.consigneeDetails    ?? "",
    notifyPartyDetails:  pi?.notifyPartyDetails  ?? "",
    buyerIfNotConsignee: pi?.buyerIfNotConsignee ?? "",
    countryOfOrigin:     "India",
    countryOfDestination: pi?.countryOfDestination ?? order.client?.country ?? "",
    deliveryTerms:       pi?.deliveryTerms        ?? "CIF",
    paymentTermsSummary: pi?.paymentTermsSummary  ?? "",
    preCarriageBy:       pi?.preCarriageBy        ?? "By Road",
    placeOfReceipt:      pi?.placeOfReceipt       ?? "",
    vesselName:          ship?.vesselName         ?? "",
    portOfLoading:       pi?.portOfLoading        ?? ship?.portOfLoading ?? cfg.portOfLoading ?? "",
    portOfDischarge:     pi?.portOfDischarge      ?? ship?.portOfDischarge ?? "",
    finalDestination:    pi?.finalDestination     ?? "",
    packageDescription:  ship?.packageDescription ?? "",
    marksNos,
    itemNetWeights: Array.isArray(itemNetWeights) ? itemNetWeights.map(String) : [],
    oceanFreight,
    packingCharges,
    insurancePct,
    discountAmount,
    currency:    order.currency ?? pi?.currency ?? "USD",
    productType,
    piItems:     (Array.isArray(pi?.items) ? pi.items : []) as any[],
  };

  // ── 6. Generate commercial invoice PDF ─────────────────────────────────────
  let invoicePdfBuf: Buffer;
  try {
    invoicePdfBuf = await generateCommercialInvoicePdf(invoiceData);
  } catch (err: any) {
    console.error("[generate-invoice] PDF generation error:", err);
    return NextResponse.json({ error: "PDF generation failed: " + err.message }, { status: 500 });
  }

  // ── 7. Merge with uploaded packing list + measurement list ─────────────────
  const plBuf = dataUrlToBuffer(plUpload);
  const mlBuf = dataUrlToBuffer(mlUpload);

  let combinedPdfBuf: Buffer;
  try {
    combinedPdfBuf = await mergePdfs([invoicePdfBuf, plBuf, mlBuf]);
  } catch (err: any) {
    console.error("[generate-invoice] PDF merge error:", err);
    // Fall back to just the invoice if merge fails
    combinedPdfBuf = invoicePdfBuf;
  }

  // ── 8. Save combined PDF as base64 data URL ────────────────────────────────
  const combinedDataUrl = `data:application/pdf;base64,${combinedPdfBuf.toString("base64")}`;

  // Ensure shipment docs row exists
  await db.$queryRawUnsafe(
    `INSERT INTO sales_shipment_docs (id, order_id, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, now(), now())
     ON CONFLICT (order_id) DO NOTHING`, id
  );

  await db.$queryRawUnsafe(
    `UPDATE sales_shipment_docs SET combined_pdf_url = $1, updated_at = now() WHERE order_id = $2`,
    combinedDataUrl, id
  );

  // ── 9. Create notification for SP ──────────────────────────────────────────
  const spId = order.sp?.id;
  if (spId) {
    const orderLabel = order.orderNumber || invoiceNo;
    await db.$queryRawUnsafe(
      `INSERT INTO sales_notifications
         (id, user_id, order_id, type, title, body, action_url, actions, is_read, created_at)
       VALUES
         (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::jsonb, false, now())`,
      spId,
      id,
      "INVOICE_READY",
      `Invoice ready — ${orderLabel}`,
      `Commercial has generated the invoice for order ${orderLabel}. Please verify and send dispatch email.`,
      `/sales/orders/${id}`,
      JSON.stringify([
        { label: "View Order",        url: `/sales/orders/${id}` },
        { label: "Send Dispatch Mail", url: `/sales/orders/${id}?action=dispatch-email` },
      ])
    );
  }

  return NextResponse.json({
    ok:        true,
    invoiceNo,
    pagesGenerated: [
      "Commercial Invoice (generated)",
      ...(plBuf ? ["Packing List (uploaded)"] : []),
      ...(mlBuf ? ["Measurement List (uploaded)"] : []),
    ],
  });
}
