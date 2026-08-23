import { salesAuth as auth } from "@/lib/sales/session";
import { assertClientVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";

const db = prisma as any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const refused = await assertClientVisible(session.user, id);
  if (refused) return refused;
  const client = await db.salesClient.findUnique({ where: { id } });
  if (!client) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(client);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const refused = await assertClientVisible(session.user, id);
  if (refused) return refused;
  const body = await req.json();
  const { name, email, phone, country, city, address, contactPerson, ccEmails } = body;
  // Only update fields the caller actually sent — the edit modal has no
  // address input, and the old unconditional spread blanked address ("") on
  // every save. city persists since 0025.
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries({ name, email, phone, country, city, address, contactPerson })) {
    if (v !== undefined) data[k] = v;
  }
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
  const refused = await assertClientVisible(session.user, id);
  if (refused) return refused;
  try {
    await db.salesClient.delete({ where: { id } });
  } catch {
    // FK from proforma_invoices / sales_orders — deleting used to 500 silently
    // and the row just "came back" on reload.
    return Response.json(
      { error: "This client has PIs or orders and cannot be deleted." },
      { status: 409 },
    );
  }
  return Response.json({ success: true });
}
