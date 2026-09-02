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
  if (body.trackingLink != null && body.trackingLink !== "" && !/^https?:\/\/\S+$/i.test(String(body.trackingLink).trim())) {
    return NextResponse.json({ error: "Tracking link must be a full http:// or https:// URL" }, { status: 400 });
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

  // NO auto-send here. This route used to fire sendShippingDocsEmail in the
  // background the moment BL No. + the three PDFs were present, while the
  // "Send Shipping Docs" button saves through this same route and then mails
  // explicitly — one customer-facing mail, two triggers racing each other.
  // /doc-upload still auto-sends when the last PDF lands (that is the path that
  // actually completes the document set), and the button covers the rest; both
  // go through the claim in sendShippingDocsEmail. Re-adding a trigger here
  // brings the double-send back.

  return NextResponse.json(docs);
}
