import { salesAuth as auth } from "@/lib/sales/session";
import { assertPiVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const refused = await assertPiVisible(session.user, id);
  if (refused) return refused;
  const { reason } = await req.json();

  const pi = await db.proformaInvoice.findUnique({ where: { id } });
  if (!pi) return Response.json({ error: "Not found" }, { status: 404 });
  if (pi.status !== "SENT") return Response.json({ error: "Only SENT PIs can be rejected" }, { status: 400 });

  // Mark as REJECTED (visible in filters) then immediately move to UNDER_REVISION
  // so the SP can edit and resend without a separate step.
  await prisma.$transaction([
    db.proformaInvoice.update({
      where: { id },
      data: { status: "UNDER_REVISION", rejectionCount: { increment: 1 } },
    }),
    db.pIRejectionLog.create({
      data: { piId: id, reason: reason ?? "" },
    }),
  ]);

  const updated = await db.proformaInvoice.findUnique({
    where: { id },
    include: { rejectionLogs: { orderBy: { rejectedAt: "desc" }, take: 1 } },
  });
  return Response.json(updated);
}
