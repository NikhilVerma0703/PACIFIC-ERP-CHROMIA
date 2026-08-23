/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/sales/pi/[id]/resend
 * Re-sends a revised PI (must be in UNDER_REVISION status).
 * Sets status back to SENT, marks the latest revision as sentAt, sends email directly.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertPiVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { sendMail } from "@/lib/sales/mailer";
import { getCCList } from "@/lib/sales/mailHelpers";
import { generatePiPdfAuto } from "@/lib/sales/pdf/piPdfmake";
import { resolveBody } from "@/lib/sales/mailBodies";
import { piEmailHtml } from "@/lib/sales/emailTemplates";
import { getSp } from "@/lib/sales/spLookup";

const db = prisma as any;

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const refused = await assertPiVisible(session.user, id);
  if (refused) return refused;

  const pi = await db.proformaInvoice.findUnique({
    where: { id },
    include: { client: true },
  });
  if (!pi) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // spId has no Prisma relation (no hard FK) — resolve separately
  pi.sp = await getSp(pi.spId);

  if (!["DRAFT", "UNDER_REVISION"].includes(pi.status)) {
    return NextResponse.json({ error: "PI must be DRAFT or UNDER_REVISION to resend" }, { status: 400 });
  }
  if (!pi.client.email) {
    return NextResponse.json({ error: "Client has no email address" }, { status: 400 });
  }

  // Mark latest revision as sent
  const latestRevision = await db.pIRevision.findFirst({
    where: { piId: id },
    orderBy: { revisionNo: "desc" },
  });
  if (latestRevision) {
    await db.pIRevision.update({
      where: { id: latestRevision.id },
      data:  { sentAt: new Date() },
    });
  }

  // Send email first — only mark SENT if it succeeds
  try {
    const [pdfBuffer, cc, customBody] = await Promise.all([
      generatePiPdfAuto(id),
      getCCList(pi.spId, pi.clientId),
      resolveBody("pi_body", {
        clientName:    pi.client?.name  || "Sir/Madam",
        piNumber:      pi.piNumber,
        currency:      pi.currency,
        totalAmount:   Number(pi.totalAmount).toFixed(2),
        paymentTerms:  pi.paymentTermsSummary || "",
        deliveryTerms: pi.deliveryTerms       || "",
        validityDays:  String(pi.validityDays || 30),
        portOfLoading: pi.portOfLoading       || "",
        spName:        pi.sp?.name            || "Pacific Group",
      }),
    ]);
    await sendMail({
      spId:        pi.spId,
      to:          pi.client.email,
      subject:     `Proforma Invoice ${pi.piNumber} — Pacific Engineered Surfaces`,
      html:        piEmailHtml(pi, customBody),
      attachments: [{ filename: `PI-${pi.piNumber}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
      ...(cc.length ? { cc: cc.join(",") } : {}),
    } as any);
  } catch (mailErr: any) {
    console.error("PI resend email failed:", mailErr?.message);
    return NextResponse.json({ error: `Email failed: ${mailErr?.message}` }, { status: 500 });
  }

  // Email succeeded — now update status
  const updated = await db.proformaInvoice.update({
    where: { id },
    data:  { status: "SENT", sentAt: new Date() },
  });

  return NextResponse.json(updated);
}
