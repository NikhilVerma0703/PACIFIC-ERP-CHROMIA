/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const docs = await db.salesShipmentDocs.findUnique({ where: { orderId: id } });
  return NextResponse.json(docs ?? {});
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // Allowed editable fields
  const allowed = [
    "containerNo", "vesselName", "portOfLoading", "portOfDischarge",
    "etaDate", "etdDate", "blDate",
    "blNo", "sbNo",
    "linerOtlNo", "eSealNo", "vehicleNo",
    "packageDescription",
    "grossWeight", "netWeight",
    "packingItems",
    "paymentDueDate",
    // blDocUrl, fumigationCertUrl, bankDetailsUrl, stuffingPhotos are handled
    // via /doc-upload to avoid the 10MB body size limit — do NOT add them here
  ];

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

  // Auto-send shipping docs email if all PDFs uploaded + BL set + not yet sent
  const allDocsReady =
    docs.blNo &&
    docs.blDocUrl          && (docs.blDocUrl as string).startsWith("data:") &&
    docs.fumigationCertUrl && (docs.fumigationCertUrl as string).startsWith("data:") &&
    docs.bankDetailsUrl    && (docs.bankDetailsUrl as string).startsWith("data:") &&
    !docs.shippingDocsMailSentAt;

  if (allDocsReady) {
    // Fire-and-forget: send in background so PATCH response returns quickly
    import("@/lib/sales/sendShippingDocsEmail")
      .then(({ sendShippingDocsEmail }) => sendShippingDocsEmail(id))
      .catch(() => { /* non-blocking -- user can retry manually */ });
  }

  return NextResponse.json(docs);
}
