/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/sales/mailer";
import { getCCList } from "@/lib/sales/mailHelpers";
import { generatePiPdfAuto } from "@/lib/sales/pdf/piPdfmake";
import { resolveBody } from "@/lib/sales/mailBodies";
import { piEmailHtml } from "@/lib/sales/emailTemplates";
import { getSp } from "@/lib/sales/spLookup";
import { NextResponse } from "next/server";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = prisma as any;

  const pi = await db.proformaInvoice.findUnique({
    where: { id },
    include: { client: true },
  });
  if (!pi)                   return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (pi.status !== "DRAFT") return NextResponse.json({ error: "Only DRAFT PIs can be sent" }, { status: 400 });
  if (!pi.client.email)      return NextResponse.json({ error: "Client has no email address" }, { status: 400 });

  // spId has no Prisma relation (no hard FK) — resolve separately
  pi.sp = await getSp(pi.spId);

  try {
    const [pdfBuffer, cc, customBody] = await Promise.all([
      // Engine/template picked per productType + availability; previously this
      // was always the Quartz HTML template and threw on Vercel (no puppeteer),
      // which failed the whole send.
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
    console.log(`PI email sent for ${pi.piNumber} → ${pi.client.email}`);
  } catch (mailErr: any) {
    console.error("Direct PI email failed:", mailErr?.message);
    return NextResponse.json({ error: "Failed to send email. Please try again." }, { status: 500 });
  }

  // Email sent — now mark the PI as SENT
  const updated = await db.proformaInvoice.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date() },
  });

  return NextResponse.json(updated);
}
