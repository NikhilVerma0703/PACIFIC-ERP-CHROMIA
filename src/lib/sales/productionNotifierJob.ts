/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Notifies production admins (SALES_ADMIN / ERP ADMIN) when an order moves to PENDING_PRODUCTION.
 * Plain async function — no Inngest dependency.
 */
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/sales/mailer";
import { getSp } from "@/lib/sales/spLookup";

const db = prisma as any;

function pendingProductionHtml(order: any, pi: any): string {
  const fmt = (v: any) => v || "---";
  const items = (pi?.items as any[] | null) ?? [];
  const itemRows = items.map((it: any, i: number) => `
    <tr style="background:${i % 2 === 0 ? "#f8fafc" : "#fff"}">
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${it.color || it.description || "---"}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">${it.thickness || "---"}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">${it.sqft || it.sqm || "---"} ${it.unit || "SQFT"}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">${it.noOfSlabs || "---"}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right">USD ${Number(it.amount || 0).toFixed(2)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:700px;margin:0 auto">
<div style="background:#7c3aed;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
  <h2 style="margin:0;font-size:18px">New Order Pending Production</h2>
  <p style="margin:4px 0 0;font-size:13px;opacity:.85">Action required — please review and confirm production schedule</p>
</div>
<div style="padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
  <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
    <tr><td style="padding:6px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:160px">Order No.</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0"><strong>${fmt(order.orderNumber || order.invoiceNumber)}</strong></td></tr>
    <tr><td style="padding:6px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600">Customer</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0">${fmt(order.client?.name)}</td></tr>
    <tr><td style="padding:6px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600">PI No.</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0">${fmt(pi?.piNumber)}</td></tr>
    <tr><td style="padding:6px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600">Total Value</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0">USD ${Number(order.totalAmount || pi?.totalAmount || 0).toFixed(2)}</td></tr>
    <tr><td style="padding:6px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600">SP</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0">${fmt(order.sp?.name)}</td></tr>
  </table>
  ${items.length > 0 ? `
  <p style="font-size:13px;font-weight:600;margin-bottom:8px">Order Items</p>
  <table style="border-collapse:collapse;width:100%;font-size:12px;margin-bottom:16px">
    <thead><tr style="background:#7c3aed;color:#fff">
      <th style="padding:8px 10px;border:1px solid #6d28d9;text-align:left">Color / Description</th>
      <th style="padding:8px 10px;border:1px solid #6d28d9;text-align:center">Thickness</th>
      <th style="padding:8px 10px;border:1px solid #6d28d9;text-align:center">Quantity</th>
      <th style="padding:8px 10px;border:1px solid #6d28d9;text-align:center">Slabs</th>
      <th style="padding:8px 10px;border:1px solid #6d28d9;text-align:right">Amount</th>
    </tr></thead>
    <tbody>${itemRows}</tbody>
  </table>` : ""}
  <p style="font-size:13px;color:#374151;margin-top:12px">Please log in to the ERP to update the production status and assign production dates.</p>
</div></body></html>`;
}

export async function notifyProductionManagers(orderId: string): Promise<void> {
  try {
    const order = await db.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        client: true,
        proformaInvoices: { where: { status: "ACCEPTED" }, take: 1, orderBy: { acceptedAt: "desc" } },
      },
    });
    if (!order) return;

    // spId has no Prisma relation (no hard FK) — resolve separately
    order.sp = await getSp(order.spId);

    const managers = await db.user.findMany({
      where: { OR: [{ salesRole: "SALES_ADMIN" }, { role: "ADMIN" }] }, // PM retired -> admins
      select: { id: true, email: true, name: true },
    });
    if (!managers.length) return;

    const pi = order.proformaInvoices?.[0] ?? null;
    const html = pendingProductionHtml(order, pi);
    const subject = `Pending Production: ${order.orderNumber || order.invoiceNumber} — ${order.client?.name}`;
    const emails = managers.map((m: any) => m.email).filter(Boolean) as string[];
    if (!emails.length) return;

    await sendMail({
      spId: order.spId,
      to:   emails[0],
      cc:   emails.slice(1).join(",") || undefined,
      subject,
      html,
    } as any);
  } catch (e) {
    // Non-fatal — log and continue
    console.error("[notifyProductionManagers]", e);
  }
}
