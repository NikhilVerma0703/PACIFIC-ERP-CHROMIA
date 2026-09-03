/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET  /api/sales/orders/[id]/doc-upload
 *   → { hasPackingList, hasMeasurementList, hasInvoice, photoCount }
 *
 * PATCH /api/sales/orders/[id]/doc-upload
 *   Body: one of:
 *     { type: "packingList"|"measurementList"|"blDoc"|"fumigationCert"|"bankDetails", data: string|null }
 *     { type: "photoAppend", data: { url: string, filename: string, caption?: string } }
 *     { type: "photoRemove", data: number }   ← index to remove
 *     { type: "photoReorder", data: Photo[] } ← full new order
 *
 * Uses raw SQL throughout — columns were added via migrations, not all in Prisma schema.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

// ── What may be stored ──────────────────────────────────────────────────────
// Everything this route writes ends up in Neon as text/jsonb and is later
// served as a PDF (packing-list-pdf, measurement-list-pdf, the merge in
// generate-invoice), mailed as a PDF attachment (sendShippingDocsEmail) or
// mailed as an image (dispatch-email). Nothing checked the payload before it
// was written: any string landed in a document column, any JSON in the photo
// array, and the only size limit was the platform's request ceiling — an
// unbounded base64 column is direct storage cost.
//
// The UI sends FileReader data: URLs — application/pdf for the five document
// slots (their pickers accept only PDFs, and a non-PDF there is already a
// broken attachment downstream) and image/* for stuffing photos (any image
// subtype: phones hand over JPEG, PNG, HEIC, WebP). So a document must be a
// PDF data: URL, a photo an image data: URL — or an http(s) URL, which older
// rows still carry and a reorder echoes back — each under the 10 MB decoded
// ceiling every other upload in the repo uses (lib/fab/poPdf.ts, the OCR and
// Chromia intakes). Real uploads are far smaller: Vercel's ~4.5 MB request
// limit already bounds what reaches this handler, so nothing that uploads
// today is refused; only what no real user sends is.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const isPdfMime   = (m: string) => m === "application/pdf" || m === "application/x-pdf";
const isImageMime = (m: string) => m.startsWith("image/");

/** Decoded byte size of a data: URL whose MIME passes `mimeOk`; null when it is
 *  not such a URL. base64 is what FileReader emits; a plain data: URL is sized as-is. */
function dataUrlBytes(s: string, mimeOk: (mime: string) => boolean): number | null {
  const m = /^data:([^;,]+)(;[^,]*)?,/i.exec(s);
  if (!m || !mimeOk(m[1].toLowerCase())) return null;
  const body = s.length - m[0].length;
  return /;base64/i.test(m[2] ?? "") ? Math.floor((body * 3) / 4) : body;
}

type Photo = { url: string; filename?: string; caption?: string };

/** The photo an element may be stored as, or the reason it may not. */
function checkPhoto(p: unknown): { ok: true; photo: Photo } | { ok: false; error: string } {
  if (!p || typeof p !== "object") return { ok: false, error: "Each photo must be an object with a url." };
  const { url, filename, caption } = p as Record<string, unknown>;
  if (typeof url !== "string" || !url) return { ok: false, error: "Photo url is required." };
  if (!/^https?:\/\//i.test(url)) {
    const bytes = dataUrlBytes(url, isImageMime);
    if (bytes === null) return { ok: false, error: "Stuffing photos must be images." };
    if (bytes > MAX_UPLOAD_BYTES) return { ok: false, error: "Photo too large (max 10 MB)." };
  }
  if (filename !== undefined && (typeof filename !== "string" || filename.length > 255)) return { ok: false, error: "Photo filename must be a string of at most 255 characters." };
  if (caption !== undefined && (typeof caption !== "string" || caption.length > 500)) return { ok: false, error: "Photo caption must be a string of at most 500 characters." };
  return { ok: true, photo: { url, ...(typeof filename === "string" ? { filename } : {}), ...(caption ? { caption: caption as string } : {}) } };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;

  const [rows, piRows]: [any[], any[]] = await Promise.all([
    db.$queryRaw`
      SELECT
        COALESCE((packing_list_upload IS NOT NULL AND packing_list_upload != ''), false)        AS "hasPackingList",
        COALESCE((measurement_list_upload IS NOT NULL AND measurement_list_upload != ''), false) AS "hasMeasurementList",
        COALESCE(jsonb_array_length(stuffing_photos::jsonb), 0)                                 AS "photoCount"
      FROM sales_shipment_docs
      WHERE order_id = ${id}
    `,
    db.$queryRaw`
      SELECT EXISTS(
        SELECT 1 FROM proforma_invoices
        WHERE order_id = ${id} AND status = 'ACCEPTED'
      ) AS "hasInvoice"
    `,
  ]);

  const hasPackingList     = rows.length > 0   ? !!rows[0].hasPackingList     : false;
  const hasMeasurementList = rows.length > 0   ? !!rows[0].hasMeasurementList : false;
  const photoCount         = rows.length > 0   ? Number(rows[0].photoCount)   : 0;
  const hasInvoice         = piRows.length > 0 ? !!piRows[0].hasInvoice       : false;

  return NextResponse.json({ hasPackingList, hasMeasurementList, hasInvoice, photoCount });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;
  const body = await req.json() as { type: string; data: any; autoSend?: boolean };
  const { type, data } = body;

  const validTypes = [
    "packingList", "measurementList",
    "blDoc", "fumigationCert", "bankDetails",
    "photoAppend", "photoRemove", "photoReorder",
  ];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  // Validate BEFORE the upsert below creates a row (the order itself is known
  // to exist — assertOrderVisible above answered 404 otherwise).
  const isDocumentType = ["packingList", "measurementList", "blDoc", "fumigationCert", "bankDetails"].includes(type);
  const documentData: string | null = isDocumentType && data != null && data !== "" ? data : null;
  if (isDocumentType && data != null && data !== "") {
    if (typeof data !== "string") return NextResponse.json({ error: "Document must be a data: URL." }, { status: 400 });
    const bytes = dataUrlBytes(data, isPdfMime);
    if (bytes === null) return NextResponse.json({ error: "Only a PDF is accepted here." }, { status: 415 });
    if (bytes > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File too large (max 10 MB)." }, { status: 413 });
  }
  let photoIn: Photo | null = null;
  if (type === "photoAppend") {
    const c = checkPhoto(data);
    if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
    photoIn = c.photo;
  }
  let photosIn: Photo[] | null = null;
  if (type === "photoReorder") {
    if (!Array.isArray(data)) return NextResponse.json({ error: "photoReorder expects the full photo array." }, { status: 400 });
    photosIn = [];
    for (const el of data) {
      const c = checkPhoto(el);
      if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
      photosIn.push(c.photo);
    }
  }
  if (type === "photoRemove" && (!Number.isInteger(Number(data)) || Number(data) < 0)) {
    return NextResponse.json({ error: "photoRemove expects the index to remove." }, { status: 400 });
  }

  // Ensure a sales_shipment_docs row exists for this order
  await db.$executeRaw`
    INSERT INTO sales_shipment_docs (id, order_id, created_at, updated_at)
    VALUES (gen_random_uuid()::text, ${id}, now(), now())
    ON CONFLICT (order_id) DO NOTHING
  `;

  // ── Single-column document uploads ─────────────────────────────────────────
  const colMap: Record<string, string> = {
    packingList:     "packing_list_upload",
    measurementList: "measurement_list_upload",
    blDoc:           "bl_doc_url",
    fumigationCert:  "fumigation_cert_url",
    bankDetails:     "bank_details_url",
  };
  if (colMap[type]) {
    const col = colMap[type];
    await db.$queryRawUnsafe(
      `UPDATE sales_shipment_docs SET ${col} = $1, updated_at = now() WHERE order_id = $2`,
      documentData, id
    );

    // After uploading a shipping doc, check if auto-send trigger conditions are met.
    //
    // autoSend:false means "the caller is mid-flow and will decide about mailing
    // itself — do not start a background sender behind it". ShippingDocsClient's
    // uploadShippingDocs() sends it on all three PDFs, because it re-POSTs every
    // PDF it holds (including ones hydrated from the row on mount, so it fires on
    // ordinary saves, not just when a file is picked) and then PATCHes /shipping.
    // Without the flag one click started up to three background senders plus its
    // own explicit POST: the compare-and-swap in sendShippingDocsEmail let one
    // through and handed the button a 400 "already being sent", which the screen
    // painted red — so the operator clicked again, the second click swapped on
    // the new stamp, and the customer got a real duplicate of the BL-release
    // mail. It also kicked off four concurrent generateCombinedShipmentPdf runs.
    //
    // The auto-send decision now lives in the /shipping PATCH, which is the only
    // point that runs after BOTH the PDFs and the BL number are persisted — see
    // the long note there. This trigger is kept, unchanged in behaviour, for any
    // caller that uploads a document WITHOUT following it with a shipping PATCH:
    // omitting the flag still auto-sends, so nothing that worked before is
    // refused, and it is a live safety net if a future upload path forgets.
    if (["blDoc", "fumigationCert", "bankDetails"].includes(type) && data && body.autoSend !== false) {
      try {
        const { sendShippingDocsEmail } = await import("@/lib/sales/sendShippingDocsEmail");
        const check = await db.$queryRawUnsafe(
          `SELECT bl_no, bl_doc_url, fumigation_cert_url, bank_details_url, shipping_docs_mail_sent_at
           FROM sales_shipment_docs WHERE order_id = $1`, id
        ) as any[];
        const d = check[0];
        if (
          d?.bl_no &&
          d?.bl_doc_url?.startsWith("data:") &&
          d?.fumigation_cert_url?.startsWith("data:") &&
          d?.bank_details_url?.startsWith("data:") &&
          !d?.shipping_docs_mail_sent_at
        ) {
          // onlyIfUnsent: the check above is a read, so two uploads finishing
          // together both see "not sent yet"; the flag is claimed atomically
          // inside the sender and this says an auto-trigger must never mail an
          // order that already has a stamp — only a human at the button may
          // deliberately re-send a corrected set.
          sendShippingDocsEmail(id, undefined, { onlyIfUnsent: true }).catch(() => {});
        }
      } catch { /* non-blocking */ }
    }
    return NextResponse.json({ ok: true });
  }

  // ── Stuffing photos (JSONB array operations) ────────────────────────────────
  if (type === "photoAppend") {
    // data = { url: string, filename: string, caption?: string } — checked above
    const photo = photoIn as Photo;
    await db.$queryRawUnsafe(
      `UPDATE sales_shipment_docs
       SET stuffing_photos = COALESCE(stuffing_photos, '[]'::jsonb) || $1::jsonb,
           updated_at = now()
       WHERE order_id = $2`,
      JSON.stringify([photo]), id
    );
    // Return current photo array so client stays in sync
    const rows = await db.$queryRawUnsafe(
      `SELECT stuffing_photos FROM sales_shipment_docs WHERE order_id = $1`, id
    ) as any[];
    return NextResponse.json({ ok: true, photos: rows[0]?.stuffing_photos ?? [] });
  }

  if (type === "photoRemove") {
    // data = index (number) to remove
    const idx = Number(data);
    await db.$queryRawUnsafe(
      `UPDATE sales_shipment_docs
       SET stuffing_photos = (
         SELECT jsonb_agg(el) FROM jsonb_array_elements(stuffing_photos) WITH ORDINALITY arr(el, pos)
         WHERE pos - 1 != $1
       ),
       updated_at = now()
       WHERE order_id = $2`,
      idx, id
    );
    const rows = await db.$queryRawUnsafe(
      `SELECT stuffing_photos FROM sales_shipment_docs WHERE order_id = $1`, id
    ) as any[];
    return NextResponse.json({ ok: true, photos: rows[0]?.stuffing_photos ?? [] });
  }

  if (type === "photoReorder") {
    // data = full reordered Photo[] array — checked above, stored as {url, filename, caption?} only
    const photos = photosIn as Photo[];
    await db.$queryRawUnsafe(
      `UPDATE sales_shipment_docs SET stuffing_photos = $1::jsonb, updated_at = now() WHERE order_id = $2`,
      JSON.stringify(photos), id
    );
    return NextResponse.json({ ok: true, photos });
  }

  return NextResponse.json({ error: "Unhandled type" }, { status: 400 });
}
