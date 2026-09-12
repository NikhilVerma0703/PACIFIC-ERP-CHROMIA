// GET /api/office/commercial/articles/gs1/[clientId] → the client's series
// PUT /api/office/commercial/articles/gs1/[clientId] → sets it
//
// The CUSTOMER'S own GS1 company prefix (round four, answer 2:
// commercial_client_barcode). Every code on the sheet the owner sent is
// 8720847 + a five-digit item reference + a check digit, and autogeneration
// continues THAT series — so the prefix is theirs, it is stored per client, and
// the next customer's will be a different length.
//
// WHY IT SITS UNDER /articles AND NOT UNDER /clients. The prefix is only ever
// read to build an article's barcode, and it is maintained on the articles
// screen by the same people who maintain the codes. Gated on the designCodes
// AREA, exactly as article editing is (see ../../_lib): a login that may not
// change an item code may not change the series its barcodes come out of
// either.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, plain, readBody, str } from "@/lib/commercial/http";
import { describeGs1Prefix, highestItemRefInUse, allocateEan13 } from "@/lib/commercial/barcode";
import { db, areaRefusal, loadClientArticles } from "../../_lib";
import { barcodeBlockFor } from "@/lib/commercial/articles-rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ clientId: string }> };

async function clientIdOf(params: Ctx["params"]): Promise<string> {
  const { clientId } = await params;
  const id = str(clientId);
  if (!id) fail(400, "Which customer's barcode series?");
  return id as string;
}

/**
 * The series as it stands, with what it would hand out next.
 *
 * THE PREVIEW IS THE POINT OF THE GET. A prefix on its own is seven digits
 * nobody can check by eye; "the next code is 8720847172338" beside the nine
 * codes already on the customer's sheet is a thing the desk can recognise as
 * right or wrong before a single label is printed. It is computed exactly as
 * the allocator computes it — the same floor, the same highest reference in
 * use — so what it shows is what the button will do.
 */
async function seriesOf(clientId: string) {
  const [client, row, articles] = await Promise.all([
    db.salesClient.findUnique({ where: { id: clientId }, select: { id: true, name: true } }),
    db.commercialClientBarcode.findUnique({ where: { clientId } }),
    loadClientArticles(clientId),
  ]);
  if (!client) fail(404, "That customer is not in the master.");

  const prefix = row?.gs1Prefix ?? null;
  const verdict = describeGs1Prefix(prefix);
  const floor = row?.nextRef === null || row?.nextRef === undefined ? 0 : Number(row.nextRef);
  const eans = articles.map((a) => a.ean);
  const block = barcodeBlockFor(articles);

  // Every code in the WHOLE table under this prefix, not only this client's.
  // The unique index is global and a code is a code: if another customer's row
  // holds one under this prefix — a shared group, a row filed against the wrong
  // client — reissuing it would fail at the insert, or worse, succeed and print
  // two articles the same.
  const elsewhere: Array<{ ean: string | null }> = verdict.ok && verdict.value
    ? await db.commercialCustomerArticle.findMany({
        where: { ean: { startsWith: verdict.value }, NOT: { clientId } },
        select: { ean: true },
      })
    : [];

  const inUse = [...eans, ...elsewhere.map((e) => e.ean)];
  const next = verdict.ok ? allocateEan13({ prefix, inUse, floor }) : null;

  return {
    clientId,
    clientName: client.name as string,
    gs1Prefix: prefix,
    nextRef: floor,
    notes: row?.notes ?? null,
    itemRefWidth: verdict.refWidth,
    capacity: verdict.capacity,
    prefixMessage: verdict.message,
    highestInUse: verdict.ok ? highestItemRefInUse(verdict.value, inUse) : null,
    /** What "Autogenerate" would put on the next blank article, or why it
     *  would refuse. */
    nextEan: next?.ean ?? null,
    nextMessage: next?.message ?? null,
    blocked: block.blocked,
    blockedMessage: block.message,
    blockedArticles: block.articles,
    withoutBarcode: articles.filter((a) => !a.ean).length,
    total: articles.length,
  };
}

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "designCodes");
  if (!g.ok) return deny(g);
  const refused = areaRefusal(g, "view");
  if (refused) return refused;
  return handle(async () => json(plain(await seriesOf(await clientIdOf(params)))));
}

export async function PUT(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "designCodes");
  if (!g.ok) return deny(g);
  const refused = areaRefusal(g, "write");
  if (refused) return refused;
  return handle(async () => {
    const clientId = await clientIdOf(params);
    const body = await readBody<Record<string, unknown>>(req);

    // describeGs1Prefix says WHICH digit is wrong and how much room the prefix
    // leaves, which is the sentence somebody typing a customer's prefix off an
    // email needs. The column's CHECK says only ^[0-9]{6,11}$.
    const verdict = describeGs1Prefix(body.gs1Prefix);
    if (!verdict.ok || !verdict.value) fail(400, verdict.message ?? "That is not a GS1 company prefix.");

    // THE FLOOR IS NOT A COUNTER (answer 2), so it is not validated against
    // what is in use — it is ALLOWED to be behind, and the allocator takes the
    // greater of the two. What it may not be is a fraction, a negative, or
    // wider than the references this prefix has room for, because none of
    // those can become an item reference at all.
    const rawFloor = body.nextRef;
    const floor = rawFloor === null || rawFloor === undefined || rawFloor === "" ? 0 : Number(rawFloor);
    if (!Number.isInteger(floor) || floor < 0) {
      fail(400, "The next item reference is a whole number, zero or more — it is the floor the series starts from, not a code.");
    }
    if (floor >= verdict.capacity) {
      fail(400, `A ${verdict.value.length}-digit prefix leaves ${verdict.refWidth} digits for the item reference, so the highest there is runs to ${verdict.capacity - 1} — ${floor} cannot be one.`);
    }

    const client = await db.salesClient.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) fail(404, "That customer is not in the master.");

    const data = {
      gs1Prefix: verdict.value,
      nextRef: BigInt(floor),
      notes: str(body.notes),
      updatedById: actorStamp(g.user).id,
    };
    await db.commercialClientBarcode.upsert({
      where: { clientId },
      update: data,
      create: { clientId, ...data },
    });

    // A CHANGED PREFIX DOES NOT TOUCH THE CODES ALREADY ISSUED. They are the
    // customer's, printed on stock that has shipped, and a prefix is changed
    // when GS1 issues a second one — not to correct history. But the series
    // then continues from a reference nobody can see on the screen, because the
    // codes on the screen are under the OLD prefix and the allocator ignores
    // them by construction, so the count of them is said out loud rather than
    // discovered when the next code looks nothing like the last.
    const elsewhere = await db.commercialCustomerArticle.count({
      where: { clientId, ean: { not: null }, NOT: { ean: { startsWith: verdict.value } } },
    });
    const series = await seriesOf(clientId);
    return json(plain({
      ...series,
      saved: true,
      note: elsewhere > 0
        ? `${elsewhere} article(s) of this customer carry codes under a different prefix. They are left exactly as they are, and the series continues under ${verdict.value} alone.`
        : null,
    }));
  });
}
