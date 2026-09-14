// Invoice download — COMMERCIAL and ADMIN only. ?id=<invoice id>
//
// On the read gate because it reads, and still refused to a finished-goods view
// grant by the role check below — which is not an exception to "a viewer sees
// what a full office login sees". Finance and Accounts, who hold this module
// outright, cannot download a dispatch invoice either; it is Commercial's
// paperwork. A viewer is not being shown less than the office, so widening this
// line is its own decision with its own person to ask.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { isCommercialRole } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { inventoryReadGate } from "@/lib/inventory/access";

const db = prisma as any;

export async function GET(request: Request) {
  const g = await inventoryReadGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const role = String((g.user as any)?.role ?? "");
  if (role !== "ADMIN" && !isCommercialRole(role)) return Response.json({ error: "Not available" }, { status: 403 });
  try {
    const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    const rows: any[] = await db.$queryRaw`SELECT filename, mime, data FROM fg_dispatch_invoice WHERE id = ${id}`;
    if (!rows.length) return Response.json({ error: "Not found" }, { status: 404 });
    const r = rows[0];
    return new Response(new Uint8Array(r.data), {
      headers: {
        "Content-Type": r.mime,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="${String(r.filename).replace(/[^\w.\- ]/g, "_")}"`,
      },
    });
  } catch (e) {
    console.error("Invoice download error:", e);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
