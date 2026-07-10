/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { generatePIPdf } from "@/lib/sales/pdf/piPdf";
import { generateGranitePiPdf } from "@/lib/sales/pdf/piGranitePdf";

const db = prisma as any;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    // Pick template based on productType
    const pi = await db.proformaInvoice.findUnique({ where: { id }, select: { productType: true, piNumber: true } });
    const isGranite = pi?.productType === "GRANITE";

    const buf = isGranite ? await generateGranitePiPdf(id) : await generatePIPdf(id);
    const filename = pi?.piNumber ? `${pi.piNumber}.pdf` : `PI-${id}.pdf`;

    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
