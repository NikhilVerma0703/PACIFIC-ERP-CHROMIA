/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;
  const docs = await db.salesShipmentDocs.findUnique({ where: { orderId: id } });
  return NextResponse.json(docs ?? {});
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;
  const body = await req.json();

  // Allowed editable fields
  const allowed = [
    "containerNo", "vesselName", "portOfLoading", "portOfDischarge",
    "etaDate", "etdDate", "blDate",
    "blNo", "sbNo",
    "linerOtlNo", "eSealNo", "vehicleNo",
    // trackingLink was missing from this list while the form, buildPayload and
    // the ETA reminder template all carried it: the link the user typed was
    // dropped here and the response then repainted the field empty, under a
    // green "Saved". Customers got ETA reminders with no tracking link at all.
    "trackingLink",
    "packageDescription",
    "grossWeight", "netWeight",
    "packingItems",
    "paymentDueDate",
    // blDocUrl, fumigationCertUrl, bankDetailsUrl, stuffingPhotos are handled
    // via /doc-upload to avoid the 10MB body size limit — do NOT add them here
  ];

  // The tracking link is interpolated straight into an href by the ETA reminder
  // template (lib/sales/emailTemplates.ts), so it has to be a real http(s) URL
  // before it is stored — a "javascript:" or bare "track.cma-cgm.com/..." value
  // reaches the customer's inbox as a live link nobody here can vet.
  //
  // The first version of this guard was /^https?:\/\/\S+$/i, which blocked
  // "javascript:" but happily accepted
  //     https://a.com"><script>...</script>
  // — no whitespace, so it matched — and emailTemplates.ts then interpolated it
  // unescaped into href="${trackingLink}". Parse it properly instead, and reject
  // the characters that end an attribute. The template ALSO escapes now (that is
  // the durable half of the fix); this half stops the value being stored at all.
  //
  // What this refuses that the old one allowed: quotes, angle brackets,
  // backticks and any internal whitespace. A real carrier link
  // (https://track.cma-cgm.com/csinfo?SearchBy=Container&Reference=MSBU1095261)
  // has none of those — query strings, &, = and % are all still fine. Measured
  // 2026-09-03: 32 sales_shipment_docs rows, 0 with a tracking_link, so no
  // stored value is refused by tightening this.
  if (body.trackingLink != null && body.trackingLink !== "") {
    const raw = String(body.trackingLink).trim();
    let parsed: URL | null = null;
    try { parsed = new URL(raw); } catch { parsed = null; }
    if (/["'<>`\s]/.test(raw) || !parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      return NextResponse.json({ error: "Tracking link must be a full http:// or https:// URL, with no spaces or quotes" }, { status: 400 });
    }
    // Store the trimmed form — otherwise a value with a stray leading space is
    // validated in one shape and saved in another.
    body.trackingLink = raw;
  }

  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) {
      if ((key === "etaDate" || key === "etdDate" || key === "blDate" || key === "paymentDueDate") && body[key]) {
        data[key] = new Date(body[key]);
      } else if ((key === "stuffingPhotos" || key === "packingItems") && Array.isArray(body[key])) {
        data[key] = body[key];
      } else if ((key === "grossWeight" || key === "netWeight") && body[key] !== "" && body[key] != null) {
        data[key] = Number(body[key]);
      } else {
        data[key] = body[key] || null;
      }
    }
  }

  const docs = await db.salesShipmentDocs.upsert({
    where:  { orderId: id },
    update: data,
    create: { orderId: id, ...data },
  });

  // If BL No just set, mark blDocSentAt
  if (body.blNo && !docs.blDocSentAt) {
    await db.salesShipmentDocs.update({
      where: { orderId: id },
      data:  { blDocSentAt: new Date() },
    }).catch(() => {});
  }

  // ── THE auto-send decision point ────────────────────────────────────────────
  // There is exactly ONE place that decides to auto-mail the shipping documents,
  // and this is it. Read the history before moving it again:
  //
  //  1. Originally BOTH this route and /doc-upload fired sendShippingDocsEmail
  //     in the background, and the "Send Shipping Docs" button saved through
  //     this route and then mailed explicitly — three triggers, one customer,
  //     duplicate mails.
  //  2. The repair deleted the trigger here and left /doc-upload as "the path
  //     that actually completes the document set". It is not. The three PDFs
  //     never reach /doc-upload on their own: ShippingDocsClient holds them in
  //     browser state (handlePdfUpload only calls setState) and pushes all three
  //     from uploadShippingDocs(), which every flow calls immediately BEFORE
  //     this PATCH. So /doc-upload always sees bl_no exactly as it was — NULL on
  //     the ordinary "type the BL No. and save" ordering — decides not to send,
  //     and then this route stored the BL and sent nothing either. An order that
  //     used to mail itself the moment the set was complete went silent.
  //
  // Here is the only point that runs after BOTH the PDFs and blNo are durable,
  // so here is where the decision belongs. `docs` is the row as just written.
  //
  // Two things keep this from becoming the double-send again:
  //   - onlyIfUnsent — the readiness test below is a plain read, so two saves
  //     landing together both see "not sent"; the stamp is claimed atomically by
  //     the compare-and-swap inside sendShippingDocsEmail, and onlyIfUnsent says
  //     an automatic trigger must never re-mail an order that already carries a
  //     stamp. Only a human at the button may deliberately re-send a corrected
  //     set.
  //   - autoSend:false — the "Send Shipping Docs" button saves through this same
  //     route and then mails explicitly. If this fired there too, the button
  //     would be racing a background sender it started itself: the CAS lets one
  //     through, and the loser (usually the button) returns 400 "already being
  //     sent", which the operator reads as a failure and retries — and the retry
  //     DOES send, because it swaps on the new stamp. That is a genuine duplicate
  //     produced by the duplicate guard. So the button passes autoSend:false and
  //     owns its own send; every other caller (plain Save, the dispatch-email
  //     save, anything future that omits the flag) keeps the automatic one.
  //
  // Measured 2026-09-03: 32 sales_shipment_docs rows, 31 with a container_no but
  // 0 with a bl_no, 0 with any of the three PDFs and 0 with
  // shipping_docs_mail_sent_at — the BL-release mail has never actually fired in
  // production. Nothing will alert us if this path is dead; the first symptom is
  // a bank waiting on documents nobody mailed.
  if (body.autoSend !== false) {
    const ready =
      !!docs.blNo &&
      typeof docs.blDocUrl === "string"          && docs.blDocUrl.startsWith("data:") &&
      typeof docs.fumigationCertUrl === "string" && docs.fumigationCertUrl.startsWith("data:") &&
      typeof docs.bankDetailsUrl === "string"    && docs.bankDetailsUrl.startsWith("data:") &&
      !docs.shippingDocsMailSentAt;
    if (ready) {
      // Fire and forget: a mailer outage must not fail the save the operator
      // just made. The claim/rollback inside the sender keeps the stamp honest.
      import("@/lib/sales/sendShippingDocsEmail")
        .then(({ sendShippingDocsEmail }) => sendShippingDocsEmail(id, undefined, { onlyIfUnsent: true }))
        .catch(() => {});
    }
  }

  return NextResponse.json(docs);
}
