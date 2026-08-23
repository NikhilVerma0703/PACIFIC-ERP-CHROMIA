/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";
import { generatePackingListPdf } from "@/lib/sales/pdf/packingListPdf";

const db = prisma as any;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;
  try {
    // Check for a manually-uploaded packing list first
    const rows: any[] = await db.$queryRaw`
      SELECT packing_list_upload
      FROM sales_shipment_docs
      WHERE order_id = ${id}
        AND packing_list_upload IS NOT NULL
        AND packing_list_upload != ''
    `;

    if (rows.length && rows[0].packing_list_upload) {
      const dataUri: string = rows[0].packing_list_upload;
      const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
      const buf = Buffer.from(base64, "base64");
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="PackingList-${id}.pdf"`,
        },
      });
    }

    // No upload → auto-generate from packages data
    const buf = await generatePackingListPdf(id);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="PackingList-${id}.pdf"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
