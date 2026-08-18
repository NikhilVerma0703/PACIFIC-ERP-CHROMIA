/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/sales/pi/[id]/revision
 * Mark a SENT PI as UNDER_REVISION, record the revision, and optionally re-send.
 * Body: { reason?, customerRemarks?, resend?: boolean }
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { reason, customerRemarks } = body as {
    reason?: string;
    customerRemarks?: string;
  };

  const pi = await db.proformaInvoice.findUnique({ where: { id } });
  if (!pi) return NextResponse.json({ error: "PI not found" }, { status: 404 });

  if (!["SENT", "UNDER_REVISION"].includes(pi.status)) {
    return NextResponse.json(
      { error: "Can only request revision on a SENT or UNDER_REVISION PI" },
      { status: 400 }
    );
  }

  const revisionNo = (pi.revisionCount ?? 0) + 1;
  const userId = (session.user as any).id;

  // Create revision record + update status
  const [revision] = await db.$transaction([
    db.pIRevision.create({
      data: {
        piId:            id,
        revisionNo,
        reason:          reason || null,
        customerRemarks: customerRemarks || null,
        createdById:     userId,
      },
    }),
    db.proformaInvoice.update({
      where: { id },
      data: {
        status:        "UNDER_REVISION",
        revisionCount: revisionNo,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, revisionNo, revisionId: revision.id });
}
