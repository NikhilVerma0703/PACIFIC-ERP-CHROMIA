// GET /api/office/commercial/invoices — the invoice register.
// Filters: ?kind=DTA|EXPORT &status= &orderId= &from=YYYY-MM-DD &to=YYYY-MM-DD &q=
// Paged with ?page=&limit= (1 / 50 by default). Each row carries its order's
// number and the client's name, which is what the register lists by.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain } from "@/lib/commercial/http";
import { invoicesWhere, pageArgs, unpricedLineNos } from "@/lib/commercial/invoice-rules";
import type { InvoiceSnapshot } from "@/lib/commercial/types";
import { db, INVOICE_INCLUDE } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view", "invoices");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const where = invoicesWhere({
      kind: u.searchParams.get("kind"),
      status: u.searchParams.get("status"),
      orderId: u.searchParams.get("orderId"),
      from: u.searchParams.get("from"),
      to: u.searchParams.get("to"),
      q: u.searchParams.get("q"),
    });
    const { page, limit, skip, take } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    // The value must be the value OF THE ROWS COUNTED. Excluding cancelled
    // invoices unconditionally would make "status=DRAFT · 3 invoices" sit
    // beside a figure that also carried the issued ones — so the exclusion
    // only applies when the caller named no status of their own.
    const sumWhere = "status" in where ? where : { ...where, status: { not: "CANCELLED" } };
    const [rows, total, sum] = await Promise.all([
      db.commercialInvoice.findMany({
        where, include: INVOICE_INCLUDE,
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        skip, take,
      }),
      db.commercialInvoice.count({ where }),
      db.commercialInvoice.aggregate({ where: sumWhere, _sum: { grandTotal: true } }),
    ]);
    // The snapshot is a large JSON blob and the register never prints from it —
    // but it is the only place the EXACT figure survives. commercial_invoice.
    // grand_total is NUMERIC(16,2) while an export document carries three
    // decimals, so the column reads a USD 17,324.657 invoice back as 17,324.66
    // and the register printed 17,324.660 beside a PDF saying .657. Carry the
    // snapshot's own figures alongside the columns and let the screen show
    // those; the count of unpriced lines rides along so the register can flag
    // an invoice the packing list could not price.
    const items = (rows as Array<Record<string, unknown>>).map((r) => {
      const { snapshot, ...rest } = r;
      const s = (snapshot ?? null) as InvoiceSnapshot | null;
      return {
        ...rest,
        grandTotalExact: typeof s?.grandTotal === "number" ? s.grandTotal : null,
        subtotalExact: typeof s?.subtotal === "number" ? s.subtotal : null,
        unpricedLines: Array.isArray(s?.lines) ? unpricedLineNos(s.lines).length : 0,
      };
    });
    return json(plain({ items, total, page, limit, totalValue: sum?._sum?.grandTotal ?? 0 }));
  });
}
