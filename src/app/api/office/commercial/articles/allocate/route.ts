// POST /api/office/commercial/articles/allocate
//      { clientId, ids? } → { allocations, skipped, nextRef }
//
// "Autogenerate" (round four, answer 2). With `ids` it fills the articles
// named — one row's button on the screen sends one id; without them it fills
// every blank article this customer has, which is the bulk action off the
// customer's own sheet.
//
// ONE ROUTE FOR BOTH because the interesting part is identical and is the part
// that must not be written twice: whether this customer's barcodes may be
// generated at all, which codes are already spent, and the floor that walks
// forward so two articles in one run cannot be handed the same reference.
// articles-rules.planEanAllocation decides all of it, pure and tested; this
// file reads the rows, writes what the plan says, and moves the floor.
//
// Gated `write` on the designCodes AREA, like every other change to a code.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, plain, readBody, str } from "@/lib/commercial/http";
import { planEanAllocation } from "@/lib/commercial/articles-rules";
import { describeGs1Prefix } from "@/lib/commercial/barcode";
import { db, areaRefusal, loadClientArticles, isEanUniqueViolation } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const g = await commercialGate("write", "designCodes");
  if (!g.ok) return deny(g);
  const refused = areaRefusal(g, "write");
  if (refused) return refused;

  return handle(async () => {
    const body = await readBody<Record<string, unknown>>(req);
    const clientId = str(body.clientId);
    // THE SERIES BELONGS TO A CUSTOMER. Our own rows (client_id NULL) answer
    // for a customer who has not sent their codes yet, and there is no prefix
    // to build one out of — a code invented under nobody's prefix is not an
    // EAN-13, it is thirteen digits that will collide with somebody's real
    // article one day.
    if (!clientId) {
      fail(400, "Pick the customer whose series the barcode comes out of — an article of ours has no GS1 prefix to generate from.");
    }
    const ids = Array.isArray(body.ids)
      ? body.ids.map((x) => String(x)).filter(Boolean)
      : null;

    const series = await db.commercialClientBarcode.findUnique({ where: { clientId } });
    const verdict = describeGs1Prefix(series?.gs1Prefix);
    if (!verdict.ok || !verdict.value) fail(400, verdict.message ?? "This customer has no GS1 company prefix on file.");

    const rows = await loadClientArticles(clientId);
    if (!rows.length) fail(404, "This customer has no articles yet, so there is nothing to give a barcode to.");

    // Codes under this prefix held by rows that are NOT this customer's. The
    // unique index is global, so one of those would collide at the insert; the
    // allocator is told about them and goes above them instead.
    const elsewhere: Array<{ ean: string | null }> = await db.commercialCustomerArticle.findMany({
      where: { ean: { startsWith: verdict.value }, NOT: { clientId } },
      select: { ean: true },
    });

    const plan = planEanAllocation({
      prefix: verdict.value,
      floor: series?.nextRef === null || series?.nextRef === undefined ? 0 : Number(series.nextRef),
      rows,
      ids,
      otherEans: elsewhere.map((e) => e.ean),
    });

    // Nothing to write. A blocked customer is a 409 — it is a conflict with a
    // duplicate somebody has to settle, not a malformed request — and it comes
    // back in the same words the labels route refuses with.
    if (!plan.ok) fail(409, plan.message ?? "There was no barcode to allocate.");

    const by = actorStamp(g.user).id;
    try {
      // ONE TRANSACTION. The codes and the floor move together: a run that
      // wrote nine articles and then failed to move the floor would leave the
      // floor behind the series, which is survivable (the allocator takes the
      // greater of the floor and what is in use), but a floor moved without
      // the codes would skip nine references for nothing. Both directions are
      // avoided by writing them as one.
      await db.$transaction([
        ...plan.allocations.map((a) => db.commercialCustomerArticle.update({
          where: { id: a.id },
          data: { ean: a.ean, eanSource: "GENERATED", eanBlockedReason: null, updatedById: by },
        })),
        db.commercialClientBarcode.update({
          where: { clientId },
          data: { nextRef: BigInt(plan.nextFloor ?? 0), updatedById: by },
        }),
      ]);
    } catch (e) {
      // Somebody typed one of these codes in by hand between the read and the
      // write. Nothing was written (the transaction rolled back), so the honest
      // answer is "run it again" — the second run reads the code they typed,
      // goes above it, and allocates a different one.
      if (isEanUniqueViolation(e)) {
        fail(409, "One of these codes was taken while this run was being prepared, so nothing was allocated. Try again — the next run goes above whatever was just entered.");
      }
      throw e;
    }

    return json(plain({
      allocations: plan.allocations,
      skipped: plan.skipped,
      nextRef: plan.nextFloor,
      message: plan.message,
    }));
  });
}
