// Commercial dispatch: mark selected slabs DISPATCHED with PI + customer and an
// invoice file (stored in the DB). COMMERCIAL and ADMIN only. Multipart form:
// slabs (JSON array), pi, customer, invoice (file — required for Commercial).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";
import { changeSlabStatus } from "@/lib/inventory/finishedSlab";
import { getUnapprovedSlabNumbers } from "@/lib/inventory/searchWhere";
import { isAdmin as isAdminCheck } from "@/lib/rbac";

const db = prisma as any;
const MAX_FILE = 8 * 1024 * 1024;
const MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const role = String((g.user as any)?.role ?? "");
  if (role !== "ADMIN" && role !== "COMMERCIAL")
    return Response.json({ error: "Only Commercial or Admin can dispatch" }, { status: 403 });
  try {
    const fd = await request.formData();
    const slabs: number[] = (() => {
      try { return [...new Set((JSON.parse(String(fd.get("slabs") ?? "[]")) as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))]; }
      catch { return []; }
    })();
    const pi = String(fd.get("pi") ?? "").trim().slice(0, 120);
    const customer = String(fd.get("customer") ?? "").trim().slice(0, 200);
    const file = fd.get("invoice");
    if (slabs.length === 0) return Response.json({ error: "No slabs selected" }, { status: 400 });
    if (slabs.length > 500) return Response.json({ error: "Max 500 slabs per dispatch" }, { status: 400 });
    if (!(await isAdminCheck())) {
      const unapproved = new Set(await getUnapprovedSlabNumbers(true));
      const filtered = slabs.filter((n) => !unapproved.has(n));
      if (!filtered.length) return Response.json({ error: "Selected slabs are not available" }, { status: 400 });
      slabs.length = 0; slabs.push(...filtered);
    }
    if (!pi) return Response.json({ error: "PI number is required" }, { status: 400 });
    if (!customer) return Response.json({ error: "Customer name is required" }, { status: 400 });
    const hasFile = file instanceof File && file.size > 0;
    if (!hasFile && role === "COMMERCIAL") return Response.json({ error: "Attach the invoice file" }, { status: 400 });
    if (hasFile) {
      const f = file as File;
      if (f.size > MAX_FILE) return Response.json({ error: "Invoice file too large (max 8 MB)" }, { status: 400 });
      if (!MIMES.has(f.type)) return Response.json({ error: "Invoice must be a PDF or image" }, { status: 400 });
    }
    const by = (g.user as any)?.name ?? null;
    const res = await changeSlabStatus(slabs, "dispatch", { pi, customer, by, source: role === "COMMERCIAL" ? "Commercial dispatch" : "Dispatch" });
    // store the invoice only when something actually dispatched (no orphans)
    let invoiceId: string | null = null;
    if (hasFile && res.updated > 0) {
      const f = file as File;
      const buf = Buffer.from(await f.arrayBuffer());
      invoiceId = "inv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      const dispatched = slabs.filter((n) => !res.missing.includes(n) && !res.skipped.some((x) => x.slab === n));
      await db.$executeRaw`INSERT INTO fg_dispatch_invoice (id, pi, customer, filename, mime, data, slab_numbers, dispatched_by)
        VALUES (${invoiceId}, ${pi}, ${customer}, ${f.name.slice(0, 200)}, ${f.type}, ${buf}, ${dispatched}, ${by})`;
    }
    return Response.json({ ...res, invoiceId });
  } catch (e) {
    console.error("Dispatch error:", e);
    return Response.json({ error: "Dispatch failed" }, { status: 500 });
  }
}
