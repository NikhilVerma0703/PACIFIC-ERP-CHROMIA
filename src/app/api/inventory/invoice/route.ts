// Invoice download — COMMERCIAL and ADMIN only. ?id=<invoice id>
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";

const db = prisma as any;

export async function GET(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const role = String((g.user as any)?.role ?? "");
  if (role !== "ADMIN" && role !== "COMMERCIAL") return Response.json({ error: "Not available" }, { status: 403 });
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
