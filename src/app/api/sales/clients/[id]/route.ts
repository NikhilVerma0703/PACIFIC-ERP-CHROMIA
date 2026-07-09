import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";

const db = prisma as any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const client = await db.salesClient.findUnique({ where: { id } });
  if (!client) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(client);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { name, email, phone, country, address, contactPerson, ccEmails } = body;
  // "city" is not a column in sales_clients — stripped from body before update
  const data: Record<string, unknown> = { name, email, phone, country, address, contactPerson };
  if (Array.isArray(ccEmails)) {
    data.ccEmails = ccEmails.filter(Boolean);
  }
  const client = await db.salesClient.update({ where: { id }, data });
  return Response.json(client);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await db.salesClient.delete({ where: { id } });
  return Response.json({ success: true });
}
