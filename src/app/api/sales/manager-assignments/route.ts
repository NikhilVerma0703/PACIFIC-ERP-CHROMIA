import { NextResponse } from "next/server";
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

const db = prisma as any;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assignments = await db.salesManagerAssignment.findMany({
    where: { isActive: true },
    include: {
      sp: { select: { id: true, name: true, email: true } },
      manager: { select: { id: true, name: true, email: true } },
    },
    orderBy: { assignedAt: "desc" },
  });

  return NextResponse.json(assignments);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const isAdmin   = salesRole === "SALES_ADMIN";
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { spId, managerId, note } = await req.json();
  if (!spId || !managerId) return NextResponse.json({ error: "spId and managerId required" }, { status: 400 });

  const now = new Date();

  // Deactivate any existing active assignment for this SP (raw SQL — safe)
  await db.$queryRawUnsafe(
    `UPDATE sales_manager_assignments SET is_active = false, updated_at = $1 WHERE sp_id = $2 AND is_active = true`,
    now, spId
  );

  const id = randomUUID();
  await db.$queryRawUnsafe(
    `INSERT INTO sales_manager_assignments (id, sp_id, manager_id, note, is_active, assigned_at, updated_at)
     VALUES ($1, $2, $3, $4, true, $5, $5)`,
    id, spId, managerId, note ?? null, now
  );

  // Fetch the created record with relations using Prisma (read is fine)
  const assignment = await db.salesManagerAssignment.findUnique({
    where: { id },
    include: {
      sp: { select: { id: true, name: true, email: true } },
      manager: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(assignment, { status: 201 });
}
