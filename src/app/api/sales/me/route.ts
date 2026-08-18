// GET /api/sales/me — current user's sales profile and assigned manager
// PATCH /api/sales/me — update SMTP settings
//
// The users.smtp_* columns are OPTIONAL (scripts/0021, user-applied) and not in
// the Prisma model, so they're read/written with raw SQL that degrades to null
// / a clear error until the columns exist. Mail itself no-ops until configured.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";

const db = prisma as any;

async function smtpRow(uid: string): Promise<{ smtpHost: string | null; smtpPort: number | null; smtpUser: string | null } | null> {
  try {
    const rows: any[] = await db.$queryRaw`
      SELECT smtp_host, smtp_port, smtp_user FROM users WHERE id = ${uid}`;
    const r = rows[0];
    if (!r) return null;
    return {
      smtpHost: r.smtp_host ?? null,
      smtpPort: r.smtp_port == null ? null : Number(r.smtp_port),
      smtpUser: r.smtp_user ?? null,
    };
  } catch {
    return null; // smtp columns not provisioned yet
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid = session.user.id;
  const salesRole = session.user.salesRole as string | null;

  const user = await db.user.findUnique({
    where: { id: uid },
    select: { id: true, name: true, email: true, salesRole: true },
  });
  const smtp = await smtpRow(uid);

  let managerId: string | null = null;
  if (salesRole === "SALESPERSON") {
    const asgn = await db.salesManagerAssignment.findFirst({
      where: { spId: uid },
      select: { managerId: true },
    });
    managerId = asgn?.managerId ?? null;
  }

  return Response.json({
    ...user,
    smtpHost: smtp?.smtpHost ?? null,
    smtpPort: smtp?.smtpPort ?? null,
    smtpUser: smtp?.smtpUser ?? null,
    managerId,
    salesRole,
  });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid = session.user.id;

  const body = await req.json();
  const { smtpHost, smtpPort, smtpUser, smtpPass } = body as {
    smtpHost?: string; smtpPort?: number; smtpUser?: string; smtpPass?: string;
  };

  try {
    if (smtpHost !== undefined)
      await db.$executeRaw`UPDATE users SET smtp_host = ${smtpHost || null} WHERE id = ${uid}`;
    if (smtpPort !== undefined)
      await db.$executeRaw`UPDATE users SET smtp_port = ${smtpPort ? Number(smtpPort) : null} WHERE id = ${uid}`;
    if (smtpUser !== undefined)
      await db.$executeRaw`UPDATE users SET smtp_user = ${smtpUser || null} WHERE id = ${uid}`;
    if (smtpPass !== undefined)
      await db.$executeRaw`UPDATE users SET smtp_pass = ${smtpPass || null} WHERE id = ${uid}`;
  } catch {
    return Response.json(
      { error: "SMTP storage not provisioned — apply scripts/0021-sales-smtp-mail-columns.sql first (or use the SMTP_* env vars)." },
      { status: 501 },
    );
  }

  const smtp = await smtpRow(uid);
  return Response.json({ id: uid, ...smtp });
}
