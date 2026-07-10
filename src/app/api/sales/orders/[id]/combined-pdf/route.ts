import { salesAuth as auth } from "@/lib/sales/session";
import { generateCombinedShipmentPdf } from "@/lib/sales/pdf/combinedShipmentPdf";
import { prisma } from "@/lib/prisma";

const db = prisma as any;

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const order = await db.salesOrder.findUnique({ where: { id }, select: { invoiceNumber: true, orderNumber: true } });
  if (!order) return new Response("Not found", { status: 404 });

  const filename = `${order.invoiceNumber || order.orderNumber}_Combined.pdf`;

  // ── Prefer the PDF saved by generate-invoice (has the full commercial invoice) ──
  const savedRows: any[] = await db.$queryRawUnsafe(
    `SELECT combined_pdf_url FROM sales_shipment_docs WHERE order_id = $1`, id
  ).catch(() => []);
  const savedDataUrl = savedRows[0]?.combined_pdf_url as string | null;
  if (savedDataUrl && savedDataUrl.startsWith("data:")) {
    const comma = savedDataUrl.indexOf(",");
    const buf   = Buffer.from(savedDataUrl.slice(comma + 1), "base64");
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  }

  // ── Fallback: auto-generate from uploaded docs (old behaviour) ──
  const [piRows, docRows]: [any[], any[]] = await Promise.all([
    db.$queryRaw`
      SELECT EXISTS(
        SELECT 1 FROM proforma_invoices
        WHERE order_id = ${id} AND status = 'ACCEPTED'
      ) AS "hasInvoice"
    `,
    db.$queryRaw`
      SELECT
        COALESCE((packing_list_upload IS NOT NULL AND packing_list_upload != ''), false)        AS "hasPackingList",
        COALESCE((measurement_list_upload IS NOT NULL AND measurement_list_upload != ''), false) AS "hasMeasurementList"
      FROM sales_shipment_docs
      WHERE order_id = ${id}
    `,
  ]);

  const hasInvoice         = !!piRows[0]?.hasInvoice;
  const hasPackingList     = !!docRows[0]?.hasPackingList;
  const hasMeasurementList = !!docRows[0]?.hasMeasurementList;

  if (!hasInvoice || !hasPackingList) {
    // No uploaded docs yet — just serve the auto-generated fallback
  }

  const buf = await generateCombinedShipmentPdf(id);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
