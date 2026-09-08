// POST /api/office/commercial/design-codes/seed → { inserted, designs, items }
//
// One master row for every distinct finished-goods design name not already
// there (answer 20), shade guessed from the name, shadeConfirmed = false so
// the editor shows which shades nobody has looked at yet. Idempotent: a second
// run inserts only what is new and never touches a row somebody edited.
//
// The names come from the same reader the stock picker uses (stock/designs
// _lib), over EVERY status — a design whose slabs have all been dispatched
// still needs its code on the next order's paperwork.
//
// READ UNFILTERED (isAdmin: true), WHOEVER SEEDS. The sales-approval filter
// exists for the stock PICKER: it hides unapproved slabs from a sales-facing
// audience so nobody offers a customer stock they may not sell. The design
// master is not a stock picker — it is the plant's list of every design and
// its code and shade, and a design hidden from sales still has to carry a
// code on paperwork and a shade in the queue. Anyone here has passed the
// "plan" gate (ADMIN or the Commercial Manager), so the filter would only make
// the Commercial Manager's seed silently omit the hidden designs, and the
// first order for one of them would then find no code and a MEDIUM guess.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, handle, plain } from "@/lib/commercial/http";
import { seedRows } from "@/lib/commercial/design-rules";
import { listStockDesigns } from "../../stock/designs/_lib";
import { db } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const g = await commercialGate("plan");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const [stock, existing] = await Promise.all([
      listStockDesigns({ isAdmin: true, availableOnly: false }),
      db.commercialDesignCode.findMany({ select: { design: true } }) as Promise<Array<{ design: string }>>,
    ]);
    const rows = seedRows(existing.map((r) => r.design), stock);
    const stamp = actorStamp(g.user);
    if (rows.length) {
      await db.commercialDesignCode.createMany({
        data: rows.map((r) => ({ ...r, updatedById: stamp.id })),
        skipDuplicates: true,
      });
    }
    const items = await db.commercialDesignCode.findMany({ orderBy: { design: "asc" } });
    return json(plain({ inserted: rows.length, designs: rows.map((r) => r.design), items, total: items.length }), rows.length ? 201 : 200);
  });
}
