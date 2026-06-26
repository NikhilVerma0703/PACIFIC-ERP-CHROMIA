import { NextResponse } from "next/server";
import { canManageRm } from "@/lib/rbac";
import { getRmStock } from "@/lib/rmStock";

export const dynamic = "force-dynamic";

function esc(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;            // neutralize spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: unknown[]) => cells.map(esc).join(",");

/** Store Incharge / Admin: download current RM stock as CSV. */
export async function GET() {
  if (!(await canManageRm())) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const s = await getRmStock();
  const L: string[] = [];
  L.push(`RAW MATERIAL STOCK,${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
  L.push("");
  L.push("MATERIALS");
  L.push(row(["Type", "Size", "Grade", "Supplier", "Bags", "Kg", "Invoices (inv:bags)"]));
  for (const g of [...s.grit, ...s.filler, ...s.other])
    L.push(row([g.type, g.size, g.grade, g.supplier, g.bags, g.kg, g.invoices.map((i) => `${i.invNo}:${i.bags}`).join("; ")]));
  L.push("");
  L.push("RESIN - STORAGE TANKS");
  L.push(row(["Tank", "Supplier", "Invoice", "Remaining (kg)", "Quantity (kg)", "Active"]));
  for (const r of s.resin) L.push(row([r.tankNo, r.supplier, r.invNo, r.remaining, r.quantity, r.active ? "yes" : "no"]));
  L.push("");
  L.push("RESIN - DAILY TANKS");
  L.push(row(["Tank", "Remaining (kg)", "Quantity (kg)", "Silane", "Cobalt", "Incharge", "Status", "Deficit (kg)"]));
  for (const d of s.daily) L.push(row([d.tankNo, d.remaining, d.quantity, d.silane ?? "", d.cobalt ?? "", d.incharge ?? "", d.status ?? "", d.deficit]));

  const csv = "﻿" + L.join("\r\n");
  const fname = `rm-stock-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fname}"` },
  });
}
