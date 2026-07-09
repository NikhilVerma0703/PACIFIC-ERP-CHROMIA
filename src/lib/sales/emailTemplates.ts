/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Plain-text style email templates.
 * No coloured headers, no background gradients -- just clean, readable HTML.
 */

const FOOTER_TEXT = `Pacific Engineered Surfaces Pvt. Ltd.
Plot No 56, Sector 6, IIE, SIDCUL, Haridwar, Uttarakhand 249403
Tel: +91-7830008181 | Email: sales@pacific-surfaces.com`;

function plain(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:680px;margin:0 auto;padding:20px">
${body}
<p style="margin-top:32px;font-size:12px;color:#555;border-top:1px solid #ddd;padding-top:12px">${FOOTER_TEXT.replace(/\n/g,"<br>")}</p>
</body></html>`;
}

function tbl(rows: [string, string][]): string {
  return `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
${rows.map(([k, v]) => `  <tr>
    <td style="padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap;vertical-align:top">${k}</td>
    <td style="padding:6px 0">${v}</td>
  </tr>`).join("")}
</table>`;
}

// ── PI Email ─────────────────────────────────────────────────────────────────
export function piEmailHtml(pi: any, customBody?: string | null): string {
  if (customBody) return plain(customBody);
  const items: any[] = Array.isArray(pi.items) ? pi.items : [];
  const rows = items.map((item: any, i: number) => `  <tr>
    <td style="padding:6px 10px;border:1px solid #ddd">${i + 1}</td>
    <td style="padding:6px 10px;border:1px solid #ddd">${item.colour || item.description || item.desc || ""}</td>
    <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${Number(item.sqft ?? item.sqFt ?? item.sqm ?? 0).toFixed(2)}</td>
    <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${pi.currency} ${Number(item.unitPrice ?? item.unit_price ?? 0).toFixed(2)}</td>
    <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${pi.currency} ${Number(item.amount ?? 0).toFixed(2)}</td>
  </tr>`).join("");

  return plain(`
<p>Dear ${pi.client?.name || "Sir/Madam"},</p>
<p>Please find attached our Proforma Invoice <strong>${pi.piNumber}</strong> for your kind consideration.</p>
<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
  <thead><tr style="background:#f5f5f5">
    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">#</th>
    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Description</th>
    <th style="padding:6px 10px;border:1px solid #ddd;text-align:right">Qty</th>
    <th style="padding:6px 10px;border:1px solid #ddd;text-align:right">Unit Price</th>
    <th style="padding:6px 10px;border:1px solid #ddd;text-align:right">Amount</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr style="background:#f5f5f5">
    <td colspan="4" style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-weight:bold">Total</td>
    <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-weight:bold">${pi.currency} ${Number(pi.totalAmount).toFixed(2)}</td>
  </tr></tfoot>
</table>
${tbl([
  ["Delivery Terms:", pi.deliveryTerms || "---"],
  ["Payment Terms:", pi.paymentTermsSummary || "---"],
  ["Validity:", `${pi.validityDays || 30} days from date of issue`],
  ...(pi.portOfLoading ? [["Port of Loading:", pi.portOfLoading] as [string,string]] : []),
])}
<p>A PDF copy is attached. Please confirm your acceptance by replying to this email.</p>
<p>Regards,<br><strong>${pi.sp?.name || "Pacific Group"}</strong></p>`);
}

// ── PI Follow-up ─────────────────────────────────────────────────────────────
export function piFollowupHtml(pi: any, customBody?: string | null): string {
  if (customBody) return plain(customBody);
  return plain(`
<p>Dear ${pi.client?.name || "Sir/Madam"},</p>
<p>This is a gentle follow-up regarding our Proforma Invoice <strong>${pi.piNumber}</strong> dated ${new Date(pi.createdAt).toLocaleDateString("en-GB")} for <strong>${pi.currency} ${Number(pi.totalAmount).toFixed(2)}</strong>, which is awaiting your confirmation.</p>
<p>Kindly revert at your earliest convenience. Please feel free to reach out if you have any questions or require any modifications.</p>
<p>Regards,<br><strong>${pi.sp?.name || "Pacific Group"}</strong></p>`);
}

// ── BL Ready ─────────────────────────────────────────────────────────────────
export function blReadyHtml(order: any, customBody?: string | null): string {
  if (customBody) return plain(customBody);
  const shipDocs = order.shipmentDocs;
  const container = order.container;
  const pi = order.proformaInvoices?.[0];
  return plain(`
<p>Dear ${order.client?.name || "Sir/Madam"},</p>
<p>We are pleased to inform you that the Bill of Lading for your order <strong>${order.orderNumber}</strong> is now ready. Please find the shipping details below:</p>
${tbl([
  ["BL No:", shipDocs?.blNo || "---"],
  ...(shipDocs?.sbNo ? [["Shipping Bill No:", shipDocs.sbNo] as [string,string]] : []),
  ...(container?.containerNumber ? [["Container No:", container.containerNumber] as [string,string]] : []),
  ...(container?.vesselName ? [["Vessel Name:", container.vesselName] as [string,string]] : []),
  ...(pi?.portOfLoading ? [["Port of Loading:", pi.portOfLoading] as [string,string]] : []),
  ...(pi?.portOfDischarge ? [["Port of Discharge:", pi.portOfDischarge] as [string,string]] : []),
  ...(container?.etd ? [["ETD:", new Date(container.etd).toLocaleDateString("en-GB")] as [string,string]] : []),
  ...(container?.eta ? [["ETA:", new Date(container.eta).toLocaleDateString("en-GB")] as [string,string]] : []),
])}
<p>Shipping documents have been attached for your reference. Please arrange for customs clearance accordingly.</p>
<p>Regards,<br><strong>${order.sp?.name || "Pacific Group"}</strong></p>`);
}

// ── ETA Reminder ─────────────────────────────────────────────────────────────
export function etaReminderHtml(clientName: string, order: any, customBody?: string | null): string {
  if (customBody) return plain(customBody);
  const container = order.container;
  const eta = container?.eta ? new Date(container.eta) : null;
  const etaStr = eta
    ? `${String(eta.getDate()).padStart(2,"0")}.${String(eta.getMonth()+1).padStart(2,"0")}.${eta.getFullYear()}`
    : "---";
  const trackingLink = container?.trackingLink || container?.trackingUrl || null;
  return plain(`
<p>Hello Sir,</p>
<p>Please note that the shipment will arrive on <strong>${etaStr}</strong>.</p>
${trackingLink
  ? `<p>You can track the shipment using this link: <a href="${trackingLink}">${trackingLink}</a></p>`
  : `<p>Container No: <strong>${container?.containerNumber || "---"}</strong> &nbsp; Vessel: <strong>${container?.vesselName || "---"}</strong></p>`}
<p>Note: Kindly update the payment status to avoid delays.</p>
<p>Regards,<br><strong>${order.sp?.name || "Pacific Engineered Surfaces Pvt. Ltd."}</strong></p>`);
}

// ── Payment Reminder ─────────────────────────────────────────────────────────
export function paymentReminderHtml(order: any, division: any, threshold: string, dueDate: Date, customBody?: string | null): string {
  if (customBody) return plain(customBody);
  const currency = order.currency || "USD";
  const amount = Number(division.amount || 0).toFixed(2);
  const dueDateStr = dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const isDayBefore = threshold === "day_before";
  const typeLabel: Record<string, string> = {
    CAD: "CAD (Cash Against Documents)", INSPECTION: "Inspection Payment",
    RECEIVE_TO_PAY: "Receive to Pay", BL_TO_PAY: "BL to Pay", CREDIT: "Credit Term Payment",
  };
  return plain(`
<p>Dear ${order.client?.name || "Sir/Madam"},</p>
<p>${isDayBefore
  ? `This is an urgent reminder that your payment for order <strong>${order.orderNumber}</strong> is due <strong>tomorrow</strong>.`
  : `This is a payment reminder for order <strong>${order.orderNumber}</strong>. The due date is approaching.`}</p>
${tbl([
  ["Order No:", order.orderNumber],
  ["Payment Type:", typeLabel[division.type] || division.type],
  ["Amount Due:", `${currency} ${amount}`],
  ["Due Date:", dueDateStr],
])}
<p>Kindly arrange the payment of <strong>${currency} ${amount}</strong> by <strong>${dueDateStr}</strong> to avoid any delays.</p>
<p>Regards,<br><strong>${order.sp?.name || "Pacific Group"}</strong></p>`);
}

// ── Payment Overdue Alert (internal) ─────────────────────────────────────────
export function paymentOverdueAlertHtml(order: any, division: any, dueDate: Date, daysOverdue: number): string {
  const currency = order.currency || "USD";
  const amount = Number(division.amount || 0).toFixed(2);
  const dueDateStr = dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const typeLabel: Record<string, string> = {
    CAD: "CAD", INSPECTION: "Inspection", RECEIVE_TO_PAY: "Receive to Pay", BL_TO_PAY: "BL to Pay", CREDIT: "Credit",
  };
  return plain(`
<p><strong>PAYMENT OVERDUE -- ACTION REQUIRED</strong></p>
<p>The following payment is <strong>${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue</strong>. Immediate follow-up with the client is required.</p>
${tbl([
  ["Client:", order.client?.name || "---"],
  ["Client Email:", order.client?.email || "---"],
  ["Order No:", order.orderNumber],
  ["Salesperson:", order.sp?.name || "---"],
  ["Payment Type:", typeLabel[division.type] || division.type],
  ["Amount Overdue:", `${currency} ${amount}`],
  ["Was Due On:", dueDateStr],
  ["Days Overdue:", String(daysOverdue)],
])}`);
}

/** @deprecated Use paymentReminderHtml instead */
export function advanceOverdueHtml(order: any, customBody?: string | null): string {
  if (customBody) return plain(customBody);
  const pi = order.proformaInvoices?.[0];
  return plain(`
<p>Dear ${order.client?.name || "Sir/Madam"},</p>
<p>This is to bring to your attention that the advance payment for order <strong>${order.orderNumber}</strong> is now overdue.</p>
${tbl([
  ["Order No:", order.orderNumber],
  ["Order Date:", new Date(order.createdAt).toLocaleDateString("en-GB")],
  ["Total Amount:", `${order.currency || "USD"} ${Number(order.totalAmount || pi?.totalAmount || 0).toFixed(2)}`],
  ...(pi?.paymentTermsSummary ? [["Payment Terms:", pi.paymentTermsSummary] as [string,string]] : []),
])}
<p>Please arrange the advance payment at the earliest to avoid any delay in production and shipment.</p>
<p>Regards,<br><strong>${order.sp?.name || "Pacific Group"}</strong></p>`);
}

// ── CAD Scheduled Reminder ───────────────────────────────────────────────────
export function cadScheduledReminderHtml(order: any, daysUntilDue: number | null, dueDate: Date): string {
  const pi = order.proformaInvoices?.[0];
  const cadDiv = order.paymentDivisions?.find((d: any) => d.type === "CAD");
  const cadAmt = cadDiv ? Number(cadDiv.amount).toFixed(2) : Number(order.totalAmount || 0).toFixed(2);
  const dueDateStr = dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return plain(`
<p>Dear ${order.client?.name || "Sir/Madam"},</p>
<p>${daysUntilDue === null
  ? `Your shipment for order <strong>${order.orderNumber}</strong> has arrived at the destination port.`
  : `This is a reminder regarding the CAD payment for order <strong>${order.orderNumber}</strong>.`}</p>
${tbl([
  ["Order No:", order.orderNumber],
  ["Invoice Value:", `${order.currency || "USD"} ${Number(order.totalAmount || pi?.totalAmount || 0).toFixed(2)}`],
  ["Payment Due Date:", dueDateStr],
  ...(order.portArrival?.arrivalDate ? [["Port Arrival Date:", new Date(order.portArrival.arrivalDate).toLocaleDateString("en-GB")] as [string,string]] : []),
  ...(order.portArrival?.freeDaysExpiry ? [["Free Days Expiry:", new Date(order.portArrival.freeDaysExpiry).toLocaleDateString("en-GB")] as [string,string]] : []),
])}
<p>Please complete the CAD payment by <strong>${dueDateStr}</strong> to avoid demurrage charges and ensure timely release of your goods.</p>
<p>Regards,<br><strong>${order.sp?.name || "Pacific Group"}</strong></p>`);
}

// ── CAD Overdue ──────────────────────────────────────────────────────────────
export function cadOverdueHtml(order: any, daysOverdue: number, dueDate: Date): string {
  const pi = order.proformaInvoices?.[0];
  const cadDiv = order.paymentDivisions?.find((d: any) => d.type === "CAD");
  const cadAmt = cadDiv ? Number(cadDiv.amount).toFixed(2) : Number(order.totalAmount || 0).toFixed(2);
  return plain(`
<p>Dear ${order.client?.name || "Sir/Madam"},</p>
<p>The CAD payment for order <strong>${order.orderNumber}</strong> is now ${daysOverdue === 0 ? "due today" : `<strong>${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue</strong>`}.</p>
${tbl([
  ["Order No:", order.orderNumber],
  ["Invoice Value:", `${order.currency || "USD"} ${Number(order.totalAmount || pi?.totalAmount || 0).toFixed(2)}`],
  ["CAD Amount Overdue:", `${order.currency || "USD"} ${cadAmt}`],
  ["Was Due On:", dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })],
])}
<p>Immediate payment is required. Continued delay may result in additional storage and demurrage charges. Please arrange the payment immediately and share the remittance details by replying to this email.</p>
<p>Regards,<br><strong>${order.sp?.name || "Pacific Group"}</strong></p>`);
}

// ── Payment Milestone ────────────────────────────────────────────────────────
export function paymentMilestoneHtml(order: any, paidPct: number, remaining: number): string {
  const pi = order.proformaInvoices?.[0];
  const paidRound = Math.round(paidPct);
  const currency = order.currency || "USD";
  const total = Number(order.totalAmount || pi?.totalAmount || 0);
  const paid = total - remaining;
  return plain(`
<p>Dear ${order.client?.name || "Sir/Madam"},</p>
<p>Thank you for your payments towards order <strong>${order.orderNumber}</strong>. We have received <strong>${paidRound}%</strong> of the invoice value.</p>
${tbl([
  ["Order No:", order.orderNumber],
  ["Total Invoice:", `${currency} ${total.toFixed(2)}`],
  ["Amount Received:", `${currency} ${paid.toFixed(2)} (${paidRound}%)`],
  ["Balance Outstanding:", `${currency} ${remaining.toFixed(2)}`],
])}
${remaining > 0.01
  ? `<p>Kindly arrange the remaining balance of <strong>${currency} ${remaining.toFixed(2)}</strong> at your earliest convenience.</p>`
  : `<p>Your account is fully settled. Thank you!</p>`}
<p>Regards,<br><strong>${order.sp?.name || "Pacific Group"}</strong></p>`);
}

// ── CEO Overdue Alert (internal) ─────────────────────────────────────────────
export function ceoOverdueAlertHtml(order: any, daysOutstanding: number, remaining: number): string {
  const pi = order.proformaInvoices?.[0];
  const currency = order.currency || "USD";
  const total = Number(order.totalAmount || pi?.totalAmount || 0);
  const paidPct = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0;
  return plain(`
<p><strong>ESCALATION -- Accounts Receivable Outstanding</strong></p>
<p>The balance for order <strong>${order.orderNumber}</strong> has been outstanding for <strong>${daysOutstanding} days</strong> since the 99% milestone.</p>
${tbl([
  ["Client:", order.client?.name || "---"],
  ["Client Email:", order.client?.email || "---"],
  ["Order No:", order.orderNumber],
  ["SP:", order.sp?.name || "---"],
  ["Total Invoice:", `${currency} ${total.toFixed(2)}`],
  ["Paid:", `${paidPct}%`],
  ["Outstanding:", `${currency} ${remaining.toFixed(2)}`],
  ["Days Outstanding:", String(daysOutstanding)],
])}
<p>Please review and take appropriate action. A final reminder has also been sent to the client.</p>`);
}

// ── CAD Reminder (legacy alias) ───────────────────────────────────────────────
export function cadReminderHtml(order: any, customBody?: string | null): string {
  if (customBody) return plain(customBody);
  const pi = order.proformaInvoices?.[0];
  const portArrival = order.portArrival;
  return plain(`
<p>Dear ${order.client?.name || "Sir/Madam"},</p>
<p>Your shipment for order <strong>${order.orderNumber}</strong> has arrived at the port. As per the agreed payment terms, the CAD (Cash Against Documents) payment is now due.</p>
${tbl([
  ["Order No:", order.orderNumber],
  ...(portArrival?.arrivalDate ? [["Arrival Date:", new Date(portArrival.arrivalDate).toLocaleDateString("en-GB")] as [string,string]] : []),
  ...(portArrival?.freeDaysExpiry ? [["Free Days Expiry:", new Date(portArrival.freeDaysExpiry).toLocaleDateString("en-GB")] as [string,string]] : []),
  ["Total Amount:", `${order.currency || "USD"} ${Number(order.totalAmount || pi?.totalAmount || 0).toFixed(2)}`],
])}
<p>Please complete the CAD payment immediately to avoid storage/demurrage charges.</p>
<p>Regards,<br><strong>${order.sp?.name || "Pacific Group"}</strong></p>`);
}

// ── Payment Deadline Reminder ────────────────────────────────────────────────
export function paymentDeadlineHtml(
  order: any, div: any, milestone: string, dueDate: Date, daysLeft: number
): string {
  const label = div.type.replace(/_/g, " ");
  const pct = Math.round(div.percentage);
  const urgency =
    daysLeft <= 0 ? "OVERDUE" :
    daysLeft === 1 ? "Due Tomorrow" :
    milestone === "95" ? "Final Reminder" :
    milestone === "80" ? "Approaching Deadline" :
    "Payment Reminder";
  return plain(`
<p>Dear ${order.client?.name || "Sir/Madam"},</p>
<p>${urgency}: Your <strong>${label}</strong> payment for order <strong>${order.orderNumber}</strong> 
${daysLeft <= 0
  ? `was due on ${dueDate.toLocaleDateString("en-GB")} and is now ${Math.abs(daysLeft)} day(s) overdue.`
  : `is due on <strong>${dueDate.toLocaleDateString("en-GB")}</strong> (${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining).`}
</p>
${tbl([
  ["Order", order.orderNumber],
  ["Payment Type", label],
  ["Amount Due", `${order.currency || "USD"} ${Number(div.amount).toFixed(2)} (${pct}% of total)`],
  ["Due Date", dueDate.toLocaleDateString("en-GB")],
  ["Status", daysLeft <= 0 ? "OVERDUE" : `${daysLeft} days remaining`],
])}
<p>Please arrange payment at your earliest convenience to avoid any delays in future orders.</p>
<p>If you have already made the payment, please share the transaction details with your sales representative.</p>
`);
}
