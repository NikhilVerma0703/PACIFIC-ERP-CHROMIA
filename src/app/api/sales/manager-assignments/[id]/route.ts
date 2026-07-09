import { NextResponse } from "next/server";
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const isAdmin   = salesRole === "SALES_ADMIN";
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const db = prisma as any;

  const existing = await db.salesManagerAssignment.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

  await db.salesManagerAssignment.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
