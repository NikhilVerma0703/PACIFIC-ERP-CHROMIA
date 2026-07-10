/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = session.user as any;
  const salesRole = user.salesRole as string | undefined;

  // Only COMMERCIAL and SALES_ADMIN can upload BL
  const canUploadBL = salesRole === "COMMERCIAL" || salesRole === "SALES_ADMIN";
  if (!canUploadBL) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { blNo, sbNo, blDocUrl } = body as { blNo: string; sbNo?: string; blDocUrl?: string };

  if (!blNo) return Response.json({ error: "blNo is required" }, { status: 400 });

  const db = prisma as any;

  const docs = await db.salesShipmentDocs.upsert({
    where: { orderId: id },
    create: {
      orderId: id,
      blNo,
      ...(sbNo     ? { sbNo }     : {}),
      ...(blDocUrl ? { blDocUrl } : {}),
    },
    update: {
      blNo,
      ...(sbNo     !== undefined ? { sbNo }     : {}),
      ...(blDocUrl !== undefined ? { blDocUrl } : {}),
    },
  });


  return Response.json(docs);
}
