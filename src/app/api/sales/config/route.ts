import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await db.salesConfig.findUnique({ where: { id: "global" } });
  return NextResponse.json(config ?? {});
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const isAdmin   = salesRole === "SALES_ADMIN";
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();

  // Only allow known safe fields
  const allowed = [
    "companyName", "companyAddress", "iecCode", "gstNo", "panNo",
    "bankName", "bankBranch", "accountNo", "ifscCode", "swiftCode", "adCode",
    "ccEmails", "logoUrl", "ceoEmail",
  ];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  const config = await db.salesConfig.upsert({
    where:  { id: "global" },
    update: data,
    create: { id: "global", ...data },
  });

  return NextResponse.json(config);
}
