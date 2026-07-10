/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { generatePiPdfAuto } from "@/lib/sales/pdf/piPdfmake";

const db = prisma as any;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const pi = await db.proformaInvoice.findUnique({ where: { id }, select: { piNumber: true } });

    // Engine + template are chosen inside generatePiPdfAuto: the productType's
    // HTML template when puppeteer exists, the pdfmake layout otherwise — so
    // Vercel (no puppeteer) no longer answers "PDF engine not installed".
    const buf = await generatePiPdfAuto(id);
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
