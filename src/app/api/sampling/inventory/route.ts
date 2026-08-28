// GET /api/sampling/inventory
//
// What is on the shelf: one row per (colour+finish, size), plus one row per
// colour+finish that has never held stock at all.
//
// GATED ON "view" — the inventory IS the thing the Fabrication Supervisor may
// not see (lib/sampling/actions.ts: he may add stock and nothing else), so this
// is the endpoint his 403 is correct on. His controls on
// /fab/supervisor/slabs deliberately call the catalogue and the sizes list, and
// never this.
//
// ─────────────────────────────────────────────────────────────────────────────
// IT RETURNS EVERYTHING AND FILTERS NOWHERE. No search parameter, no
// quantity > 0 clause.
//
// The whole catalogue is 56 colours over 7 series with 59 colour+finish rows;
// the shelves on top of that are in the low hundreds and will grow by a size at
// a time. That is one small payload, and sending it whole buys two things the
// screen cannot have otherwise: a search that answers on the keystroke, and an
// HONEST DEFAULT. The screen hides empty shelves by default — a zero is not
// stock — and the only way to say "nothing in stock, but three empty shelves
// match that search" is to hold the empty ones too. A WHERE clause here would
// make "no such colour" and "none left" render as the same empty table, which
// is the failure lib/fab/postJson.ts exists to stop one layer down.
//
// The grouping, the search and the counting are lib/sampling/inventory.ts —
// pure, and unit-tested — so this route selects and converts and decides
// nothing.
//
// COLOUR+FINISH ROWS WITH NO SHELF arrive with sizeId null. That is not a shelf
// holding nothing: it is a colour nobody has ever cut, which is the answer to a
// different question ("do we have any Nebula Ash?" — no, and we never have).
// groupInventory keeps them out of the size lists and lets the finish appear.
//
// IT RETURNS AN ARRAY — getJson() turns a non-array body into a successful
// empty list.

import { prisma } from "@/lib/prisma";
import { samplingGate } from "@/lib/sampling/access";
import type { InventoryRow } from "@/lib/sampling/inventory";

export const dynamic = "force-dynamic";

function deny(status: number) {
  return Response.json(
    { error: status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
    { status },
  );
}

export async function GET() {
  const g = await samplingGate("view");
  if (!g.ok) return deny(g.status);

  const [stock, finishes] = await Promise.all([
    prisma.samplingStock.findMany({
      select: {
        id: true,
        quantity: true,
        colourFinishId: true,
        size: { select: { id: true, lengthIn: true, widthIn: true, thicknessMm: true } },
        colourFinish: {
          select: {
            id: true,
            finish: true,
            colour: {
              select: {
                name: true,
                position: true,
                series: { select: { name: true, position: true } },
              },
            },
          },
        },
      },
    }),
    prisma.productColourFinish.findMany({
      select: {
        id: true,
        finish: true,
        colour: {
          select: {
            name: true,
            position: true,
            series: { select: { name: true, position: true } },
          },
        },
      },
    }),
  ]);

  const rows: InventoryRow[] = stock.map((s) => ({
    stockId: s.id,
    colourFinishId: s.colourFinishId,
    seriesName: s.colourFinish.colour.series.name,
    seriesPosition: s.colourFinish.colour.series.position,
    colourName: s.colourFinish.colour.name,
    colourPosition: s.colourFinish.colour.position,
    finish: s.colourFinish.finish,
    sizeId: s.size.id,
    // Decimal -> number at the seam. NUMERIC(10,2) arrives as a Prisma Decimal
    // and JSON.stringify would send it as the string "4.00", which then reads
    // as a different size from 4 in every comparison the screen makes.
    lengthIn: Number(s.size.lengthIn),
    widthIn: Number(s.size.widthIn),
    thicknessMm: Number(s.size.thicknessMm),
    quantity: Number(s.quantity),
  }));

  // The colour+finish rows nothing has ever been counted against.
  const withStock = new Set(rows.map((r) => r.colourFinishId));
  for (const f of finishes) {
    if (withStock.has(f.id)) continue;
    rows.push({
      stockId: null,
      colourFinishId: f.id,
      seriesName: f.colour.series.name,
      seriesPosition: f.colour.series.position,
      colourName: f.colour.name,
      colourPosition: f.colour.position,
      finish: f.finish,
      sizeId: null,
      lengthIn: null,
      widthIn: null,
      thicknessMm: null,
      quantity: 0,
    });
  }

  return Response.json(rows);
}
