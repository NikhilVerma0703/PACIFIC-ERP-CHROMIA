/* eslint-disable @typescript-eslint/no-explicit-any */
// Ownership transfer — the Sales Admin is the SUPER-OWNER of every sales
// record; this endpoint hands a client/PI/order to a different salesperson
// (the new owner gets it in their scope, the old owner loses it). ADMIN ONLY.
import { salesAuth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";

const db = prisma as any;

async function adminSession() {
  const session = await salesAuth();
  if (!session?.user) return { err: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if ((session.user as any).salesRole !== "SALES_ADMIN") return { err: Response.json({ error: "Only the Sales Admin can transfer ownership." }, { status: 403 }) };
  return { user: session.user as any };
}

/** Active International Sales users an admin can hand a record to. */
export async function GET() {
  const s = await adminSession();
  if ("err" in s) return s.err;
  let rows: any[] = [];
  try {
    rows = await db.user.findMany({ where: { branch: "INTERNATIONAL_SALES", active: true }, select: { id: true, name: true, email: true }, orderBy: { email: "asc" } });
  } catch {
    // Branch enum value missing (pre-0023) — fall back and filter in JS.
    const all: any[] = await db.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, branch: true }, orderBy: { email: "asc" } });
    rows = all.filter((u) => String(u.branch ?? "") === "INTERNATIONAL_SALES");
  }
  return Response.json(rows.map(({ id, name, email }: any) => ({ id, name, email })));
}

const TARGET: Record<string, { model: string; field: string }> = {
  ORDER:  { model: "salesOrder",      field: "spId" },
  PI:     { model: "proformaInvoice", field: "spId" },
  CLIENT: { model: "salesClient",     field: "createdById" },
};

export async function POST(req: Request) {
  const s = await adminSession();
  if ("err" in s) return s.err;
  const { type, id, toSpId } = (await req.json().catch(() => ({}))) as { type?: string; id?: string; toSpId?: string };
  const target = TARGET[String(type ?? "")];
  if (!target || !id || !toSpId) return Response.json({ error: "type (CLIENT|PI|ORDER), id and toSpId are required" }, { status: 400 });
  const to = await db.user.findUnique({ where: { id: toSpId }, select: { id: true, active: true, branch: true } }).catch(() => null);
  if (!to || !to.active || String(to.branch ?? "") !== "INTERNATIONAL_SALES")
    return Response.json({ error: "New owner must be an active International Sales user." }, { status: 422 });
  try {
    await db[target.model].update({ where: { id }, data: { [target.field]: toSpId } });
  } catch {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
