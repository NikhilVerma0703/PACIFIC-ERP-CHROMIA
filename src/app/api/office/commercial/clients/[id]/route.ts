// GET   /api/office/commercial/clients/[id] — one client, its commercial ext,
//       and the enquiries and orders already on it.
// PATCH /api/office/commercial/clients/[id] — edit the sales_clients row AND
//       upsert commercial_client_ext from the same body. Only the keys the
//       body carries are written, so a partial save cannot blank a field the
//       form did not show.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { parseClientBody, duplicateNameWarning } from "@/lib/commercial/clients-rules";
import { db, loadClientRow, shapeClient, upsertExt, nameCandidates } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** The client's own history — 20 of each, newest first. Queried from the two
 *  commercial tables rather than through the relation include so the payload
 *  stays the columns the detail page prints. */
async function history(clientId: string) {
  const [enquiries, orders] = await Promise.all([
    db.commercialEnquiry.findMany({
      where: { clientId }, orderBy: { receivedAt: "desc" }, take: 20,
      select: { id: true, number: true, status: true, subject: true, receivedAt: true, orderId: true },
    }),
    db.commercialOrder.findMany({
      where: { clientId }, orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, number: true, kind: true, status: true, currency: true, createdAt: true },
    }),
  ]);
  return { enquiries, orders };
}

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "clients");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id } = await params;
    const row = await loadClientRow(id);
    return json(plain({ ...shapeClient(row), ...(await history(id)) }));
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "clients");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id } = await params;
    await loadClientRow(id);                       // 404 before anything is parsed
    const body = await readBody<Record<string, unknown>>(req);
    const parsed = parseClientBody(body, "patch");
    if (!parsed.ok) fail(parsed.status, parsed.error);

    const newName = typeof parsed.client.name === "string" ? parsed.client.name : null;
    const warning = newName ? duplicateNameWarning(newName, await nameCandidates(newName), id) : null;

    if (Object.keys(parsed.client).length) await db.salesClient.update({ where: { id }, data: parsed.client });
    if (parsed.extTouched) await upsertExt(id, parsed.ext);

    const row = await loadClientRow(id);
    return json(plain({ ...shapeClient(row), ...(await history(id)), warning }));
  });
}
