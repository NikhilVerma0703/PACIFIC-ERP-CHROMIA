// GET  /api/office/commercial/clients — the customer master, searched and paged
// POST /api/office/commercial/clients — a new client: one row on the shared
//      sales_clients master plus its commercial_client_ext (GSTIN, PAN, state
//      code, customer code, printed address blocks) from the same form.
//
// The master is SHARED with the ported International Sales module, so this
// route never deletes and never deactivates by accident: `isActive` is
// patch-only, and a name that already exists is a warning on the created row,
// not a refusal (two legal entities can trade under one name, and the person
// typing is the one who knows).
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import {
  parseClientBody, clientListWhere, wantsAll, pageParams, duplicateNameWarning,
} from "@/lib/commercial/clients-rules";
import { db, CLIENT_INCLUDE, shapeClient, nameCandidates } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const where = clientListWhere({ q: u.searchParams.get("q"), all: wantsAll(u.searchParams.get("all")) });
    const { page, limit, skip, take } = pageParams({ page: u.searchParams.get("page"), limit: u.searchParams.get("limit") });
    const [rows, total] = await Promise.all([
      db.salesClient.findMany({ where, include: CLIENT_INCLUDE, orderBy: { name: "asc" }, skip, take }),
      db.salesClient.count({ where }),
    ]);
    const items = (rows as Array<Record<string, unknown>>).map(shapeClient);
    return json(plain({ items, total, page, limit }));
  });
}

export async function POST(req: Request) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const userId = g.user?.id;
    if (!userId) fail(401, "Please sign in.");
    const body = await readBody<Record<string, unknown>>(req);
    const parsed = parseClientBody(body, "create");
    if (!parsed.ok) fail(parsed.status, parsed.error);

    const name = String(parsed.client.name ?? "");
    const warning = duplicateNameWarning(name, await nameCandidates(name));

    const created = await db.salesClient.create({
      data: {
        ...parsed.client,
        createdById: userId,
        // The ext row is written only when the form actually carried one of
        // its fields, so a plain "add a customer" does not leave an empty
        // commercial_client_ext behind.
        commercialExt: parsed.extTouched ? { create: parsed.ext } : undefined,
      },
      include: CLIENT_INCLUDE,
    });
    return json(plain({ ...shapeClient(created), warning }), 201);
  });
}
