import { NextResponse } from "next/server";
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import { getSpMap } from "@/lib/sales/spLookup";

const db = prisma as any;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assignments = await db.salesManagerAssignment.findMany({
    where: { isActive: true },
    orderBy: { assignedAt: "desc" },
  });

  // spId/managerId carry no Prisma relation (no hard FK) — stitch users in
  const userMap = await getSpMap(assignments.flatMap((a: any) => [a.spId, a.managerId]));
  return NextResponse.json(assignments.map((a: any) => ({
    ...a,
    sp:      userMap.get(a.spId)      ?? null,
    manager: userMap.get(a.managerId) ?? null,
  })));
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

  // Fetch the created record, then stitch user info (no relations on model)
  const assignment = await db.salesManagerAssignment.findUnique({ where: { id } });
  const userMap = await getSpMap([spId, managerId]);
  return NextResponse.json({
    ...assignment,
    sp:      userMap.get(spId)      ?? null,
    manager: userMap.get(managerId) ?? null,
  }, { status: 201 });
}
