/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/sales/clients -- list clients for current SP (or all for SALES_ADMIN)
// POST /api/sales/clients -- create a new client
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { getAssignedSpIds } from "@/lib/sales/rmScope";

const db = prisma as any;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid       = (session.user as any).id as string;
  const salesRole = (session.user as any).salesRole as string | null;

  const url   = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "10");
  const page  = parseInt(url.searchParams.get("page")  ?? "1");
  const from  = url.searchParams.get("from");
  const to    = url.searchParams.get("to");
  const spFilter = url.searchParams.get("sp"); // RM can filter to specific SP

  const isGlobalAdmin = salesRole === "SALES_ADMIN" || salesRole === "COMMERCIAL" || salesRole === "ACCOUNTS";

  // Scope: SP sees own; RM sees assigned SPs (including self); admin sees all
  let createdByFilter: object = {};
  if (!isGlobalAdmin) {
    if (salesRole === "REPORTING_MANAGER") {
      const assignedSpIds = await getAssignedSpIds(uid, salesRole);
      const ids = assignedSpIds || [];
      // RM can further filter to a single SP
      if (spFilter && spFilter !== "ALL" && ids.includes(spFilter)) {
        createdByFilter = { createdById: spFilter };
      } else {
        createdByFilter = { createdById: { in: ids } };
      }
    } else {
      createdByFilter = { createdById: uid };
    }
  } else if (spFilter && spFilter !== "ALL") {
    createdByFilter = { createdById: spFilter };
  }

  const clients = await db.salesClient.findMany({
    where: {
      ...createdByFilter,
      ...(from || to ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to + "T23:59:59Z") } : {}),
        },
      } : {}),
    },
    include: {
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
    take: limit,
    skip: (page - 1) * limit,
  });
  return Response.json(clients);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid       = (session.user as any).id as string;
  const salesRole = (session.user as any).salesRole as string | null;
  if (!salesRole) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, email, phone, country, address, contactPerson, ccEmails } = body;
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  const client = await db.salesClient.create({
    data: {
      name, email, phone, country, address, contactPerson,
      ccEmails: Array.isArray(ccEmails) ? ccEmails.filter(Boolean) : [],
      createdById: uid,
    },
  });
  return Response.json(client, { status: 201 });
}
