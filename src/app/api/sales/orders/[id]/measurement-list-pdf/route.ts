/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET /api/sales/orders/[id]/measurement-list-pdf
 * Serves the uploaded measurement list PDF if one exists.
 * Returns 404 if no measurement list has been uploaded yet.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";

const db = prisma as any;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;

  const rows: any[] = await db.$queryRaw`
    SELECT measurement_list_upload
    FROM sales_shipment_docs
    WHERE order_id = ${id}
      AND measurement_list_upload IS NOT NULL
      AND measurement_list_upload != ''
  `;

  if (!rows.length || !rows[0].measurement_list_upload) {
    return new Response(
      JSON.stringify({ error: "No measurement list uploaded for this order" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const dataUri: string = rows[0].measurement_list_upload;
  const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
  const buf = Buffer.from(base64, "base64");

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="MeasurementList-${id}.pdf"`,
    },
  });
}
