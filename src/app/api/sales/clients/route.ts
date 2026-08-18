/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/sales/clients -- list clients for current SP (or all for SALES_ADMIN)
// POST /api/sales/clients -- create a new client
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { getAssignedSpIds } from "@/lib/sales/rmScope";
import { getSpMap } from "@/lib/sales/spLookup";

const db = prisma as any;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid       = (session.user as any).id as string;
  const salesRole = (session.user as any).salesRole as string | null;

  const url   = new URL(req.url);
  // No explicit limit -> return the FULL scoped list. The old default of 10
  // (name-ASC) hid every client past the first ten: a freshly added client
  // "never appeared" here or in the PI form's client dropdown — reported as
  // "clients cannot be added". Both UI callers fetch with no params.
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, parseInt(limitParam) || 10) : null;
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
    orderBy: { name: "asc" },
    ...(limit ? { take: limit, skip: (page - 1) * limit } : {}),
  });
  // createdById has no Prisma relation (no hard FK) — stitch user info in
  const userMap = await getSpMap(clients.map((c: any) => c.createdById));
  return Response.json(clients.map((c: any) => ({
    ...c,
    createdBy: userMap.get(c.createdById) ?? null,
  })));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid       = (session.user as any).id as string;
  const salesRole = (session.user as any).salesRole as string | null;
  if (!salesRole) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, email, phone, country, city, address, contactPerson, ccEmails } = body;
  if (!name || !String(name).trim()) return Response.json({ error: "name required" }, { status: 400 });

  try {
    const client = await db.salesClient.create({
      data: {
        name, email, phone, address, contactPerson,
        city:    city ?? null,        // 0025 (nullable, applied)
        country: country ?? "",       // NOT NULL in the DB — never let it reach Prisma undefined
        ccEmails: Array.isArray(ccEmails) ? ccEmails.filter(Boolean) : [],
        createdById: uid,
      },
    });
    return Response.json(client, { status: 201 });
  } catch (err: any) {
    // Surface a real reason — the form used to show nothing actionable.
    const msg = String(err?.message ?? "unknown error").split("\n").pop();
    return Response.json({ error: `Could not create client: ${msg}` }, { status: 500 });
  }
}
