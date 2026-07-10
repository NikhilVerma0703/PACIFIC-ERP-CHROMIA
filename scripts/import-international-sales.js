// International Sales books import — PGI + PESPL Excel workbooks -> sales_* tables.
// One-shot + idempotent: every row gets a deterministic id (imp*_ prefix + sha1 of its
// natural key), so re-runs upsert instead of duplicating. Only sales tables are touched
// (sales_clients, proforma_invoices, sales_orders, sales_containers, sales_shipment_docs,
// sales_payment_divisions, sales_order_logs). No users are created or modified.
//
//   node scripts/import-international-sales.js "<path to PGI.xlsx>" "<path to PESPL.xlsx>" [--force]
//
// Refuses to run when sales_clients already has rows unless --force (same guard style
// as scripts/import-consumables.js).
//
// Conventions (module reality, see prisma/schema.prisma + src/app/api/sales/**):
// - Factory scoping lives on proforma_invoices.product_type (QUARTZ|GRANITE); routes
//   filter orders through their PI. PGI = GRANITE factory, PESPL = QUARTZ factory,
//   so every imported order gets a PI carrying that tag (synthetic IMP-* PI number
//   when the books have none).
// - sp_id / created_by_id / user_id are plain text (no FK). We do NOT invent users:
//   they get "import:<TAG>:<SALESPERSON NAME>" (or "import:<TAG>" when unknown) so the
//   book's salesperson survives as text and imported rows are greppable/removable.
// - Unmappable strings are preserved verbatim in notes fields, never dropped.
// - Imported payment divisions get reminders_sent pre-filled so the daily payment
//   reminder cron never auto-mails customers about historical book balances.
const fs = require("fs");
const path = require("path");
for (const l of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const crypto = require("crypto");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ---------- helpers ----------
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 24);
const S = (v) => (v === null || v === undefined ? "" : String(v).replace(/\0/g, "").trim()); // \0: Postgres 22021
const ci = (v) => S(v).toLowerCase();
const digitsKey = (v) => S(v).replace(/\D+/g, ""); // '12782/PG' & 12782 -> same invoice
const CURRENCY = { "$": "USD", "usd": "USD", "€": "EUR", "euro": "EUR", "eur": "EUR", "₹": "INR", "inr": "INR" };
const mapCurrency = (v) => { const t = ci(v); return t ? (CURRENCY[t] ?? S(v).toUpperCase()) : null; };
const isDate = (v) => v instanceof Date && !isNaN(v.getTime());
const asDate = (v) => {
  if (isDate(v)) return v;
  const t = S(v);
  if (!t) return null;
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
};
const money = (v) => { // "-", "", junk -> null; numbers/numeric strings -> number
  if (typeof v === "number" && isFinite(v)) return v;
  const t = S(v).replace(/[,$€₹\s]/g, "");
  if (!t || t === "-") return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
};
const parseQty = (v) => { // "450 sqm" -> {qty:450, unit:'sqm'}; keeps raw always
  const raw = S(v);
  if (!raw) return { raw: null, qty: null, unit: null };
  if (typeof v === "number") return { raw, qty: v, unit: null };
  const m = raw.match(/^([\d.,]+)\s*([a-zA-Z.]*)$/);
  if (!m) return { raw, qty: null, unit: null };
  const n = Number(m[1].replace(/,/g, ""));
  return isFinite(n) ? { raw, qty: n, unit: m[2] || null } : { raw, qty: null, unit: null };
};
const splitEmails = (v) =>
  S(v).split(/[\s,;\/\n\r]+/).map((x) => x.trim().replace(/^<|>$/g, "")).filter((x) => /@/.test(x));
// Production-status narrative -> SalesOrderStatus. Priority: packing > money received >
// PI accepted > PI sent. Anything else -> PENDING_PAYMENT (module default; raw kept in notes).
function mapOrderStatus(rawStatus) {
  const t = ci(rawStatus);
  if (!t) return { status: "PENDING_PAYMENT", mapped: false };
  if (/packing list/.test(t)) return { status: "PACKING", mapped: true };
  if (/advance (payment )?received|payment received|advance received/.test(t)) return { status: "PENDING_STOCK_CHECK", mapped: true };
  if (/sign copy|approved/.test(t)) return { status: "PENDING_PAYMENT", mapped: true };
  if (/sent for approval/.test(t)) return { status: "DRAFT", mapped: true };
  if (t === "planned") return { status: "PENDING_PRODUCTION", mapped: true };
  if (t === "pending") return { status: "PENDING_PAYMENT", mapped: true };
  return { status: "PENDING_PAYMENT", mapped: false };
}
// Payment-terms text -> PaymentDivisionType for the *balance* leg. Deterministic keyword
// scan; default CAD (dominant in these books). Original terms string preserved in notes.
function mapDivisionType(terms) {
  const t = ci(terms);
  if (/\bbl\b|b\/l|bill of lading|bl date/.test(t)) return "BL_TO_PAY";
  if (/inspection/.test(t)) return "INSPECTION";
  if (/cad|cash against/.test(t)) return "CAD";
  if (/credit/.test(t)) return "CREDIT";
  if (/advance/.test(t)) return "ADVANCE";
  return "CAD";
}
const pct = (part, whole) => (whole && whole > 0 && part != null ? Math.round((part / whole) * 10000) / 100 : 0);
const noteJoin = (parts) => parts.filter(Boolean).join(" | ");

function readSheets(file) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const get = (rx) => {
    const name = wb.SheetNames.find((n) => rx.test(ci(n)));
    if (!name) return null;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    const header = rows[0] || [];
    const data = rows.slice(1).filter((r) => r.some((c) => c !== null && S(c) !== ""));
    return { name, header, data };
  };
  return {
    customers: get(/customer list/),
    pending: get(/pending orders?/),
    intransit: get(/intransit/),
    outstanding: get(/outstanding/),
  };
}
const col = (sheet, rx) => sheet.header.findIndex((h) => rx.test(ci(h)));

// ---------- per-factory import ----------
async function importFactory(file, TAG, stats) {
  const productType = TAG === "PGI" ? "GRANITE" : "QUARTZ";
  const sheets = readSheets(file);
  if (!sheets.customers) throw new Error(`${TAG}: customer list sheet not found in ${file}`);
  const spBase = `import:${TAG}`;
  const spFor = (name) => (S(name) ? `${spBase}:${S(name)}` : spBase);
  const st = (stats[TAG] = {
    clients: { created: 0, deduped: 0, autoCreated: [], skipped: [] },
    pending: { orders: 0, pis: 0, rows: 0, skippedRows: [] },
    intransit: { orders: 0, pis: 0, containers: 0, shipmentDocs: 0, divisions: 0, rows: 0, divSkipped: 0 },
    outstanding: { ordersCreated: 0, attached: 0, divisions: 0, rows: 0, skipped: [] },
    enum: { orderStatus: {}, divType: {}, unmappedStatus: {} },
  });
  const bump = (obj, k) => (obj[k] = (obj[k] || 0) + 1);

  // ---- clients (Customer list) ----
  const c = sheets.customers;
  const I = {
    sp: col(c, /sales person/), name: col(c, /customer name/), country: col(c, /country/),
    addr: col(c, /address/), curr: col(c, /currency/), unit: col(c, /^unit/),
    email1: col(c, /email id/), email2: col(c, /emails to be sent/), phone: col(c, /ph\.? ?no/),
    pod: col(c, /port of discharge/), del: col(c, /delivery terms/), pay: col(c, /payment terms/),
  };
  const clientByName = new Map(); // ci(name) -> {id, sp, currency}
  // preload previously imported clients for this factory (idempotent re-run)
  for (const row of await prisma.$queryRawUnsafe(
    `SELECT id, name, created_by_id, default_currency FROM sales_clients WHERE created_by_id LIKE $1`, `${spBase}%`)) {
    clientByName.set(ci(row.name), { id: row.id, sp: row.created_by_id.split(":")[2] || "", currency: row.default_currency });
  }
  for (const r of c.data) {
    const name = S(r[I.name]);
    if (!name) { st.clients.skipped.push("row without customer name"); continue; }
    if (clientByName.has(ci(name))) { st.clients.deduped++; continue; } // first occurrence wins
    const emails = splitEmails(r[I.email1]);
    const cc = [...new Set([...emails.slice(1), ...(I.email2 >= 0 ? splitEmails(r[I.email2]) : [])])]
      .filter((e) => e !== emails[0]);
    const sp = S(r[I.sp]);
    const id = `impc_${sha(`${TAG}|client|${ci(name)}`)}`;
    await prisma.salesClient.upsert({
      where: { id },
      update: {},
      create: {
        id, name, country: S(r[I.country]) || "Unknown",
        email: emails[0] ?? null,
        ccEmails: cc,
        phone: S(r[I.phone]) || null,
        address: S(r[I.addr]) || null,
        createdById: spFor(sp), // salesperson name kept as text inside the import tag (no user created)
        defaultCurrency: mapCurrency(r[I.curr]),
        defaultUnit: S(r[I.unit]) || null,
        defaultPortOfDischarge: S(r[I.pod]) || null,
        defaultDeliveryTerms: S(r[I.del]) || null,
        defaultPaymentTerms: S(r[I.pay]) || null,
      },
    });
    clientByName.set(ci(name), { id, sp, currency: mapCurrency(r[I.curr]) });
    st.clients.created++;
  }

  // client lookup with auto-create for names appearing only in order sheets
  async function clientFor(name, country, sheetLabel) {
    const key = ci(name);
    if (clientByName.has(key)) return clientByName.get(key);
    const id = `impc_${sha(`${TAG}|client|${key}`)}`;
    await prisma.salesClient.upsert({
      where: { id }, update: {},
      create: { id, name: S(name), country: S(country) || "Unknown", ccEmails: [], createdById: spBase },
    });
    const entry = { id, sp: "", currency: null };
    clientByName.set(key, entry);
    st.clients.autoCreated.push(`${S(name)} (${sheetLabel})`);
    return entry;
  }

  const usedPiNumbers = new Set(
    (await prisma.$queryRawUnsafe(`SELECT pi_number FROM proforma_invoices`)).map((r) => ci(r.pi_number))
  );
  async function createPI(piNumber, opts) {
    // unique pi_number: reuse the existing record when the books repeat a number
    if (usedPiNumbers.has(ci(piNumber))) {
      const ex = await prisma.proformaInvoice.findFirst({ where: { piNumber: { equals: piNumber, mode: "insensitive" } } });
      return { pi: ex, reused: true };
    }
    const pi = await prisma.proformaInvoice.upsert({
      where: { id: opts.id }, update: {},
      create: {
        id: opts.id, piNumber, spId: opts.spId, clientId: opts.clientId, orderId: opts.orderId,
        status: opts.status, productType, items: opts.items, totalAmount: opts.totalAmount ?? 0,
        currency: opts.currency ?? "USD", deliveryTerms: opts.deliveryTerms ?? null,
        paymentTermsSummary: opts.paymentTermsSummary ?? null, portOfDischarge: opts.portOfDischarge ?? null,
        notes: opts.notes, acceptedAt: opts.status === "ACCEPTED" ? opts.baseDate ?? null : null,
        ...(opts.baseDate ? { createdAt: opts.baseDate } : {}),
      },
    });
    usedPiNumbers.add(ci(piNumber));
    return { pi, reused: false };
  }
  const addLog = (orderId, note) =>
    prisma.salesOrderLog.upsert({
      where: { id: `implg_${sha(orderId)}` }, update: {},
      create: { id: `implg_${sha(orderId)}`, orderId, userId: spBase, action: "IMPORTED", note },
    });

  // ---- Pending orders -> SalesOrder + skeleton PI ----
  if (sheets.pending) {
    const p = sheets.pending;
    const P = {
      date: col(p, /order date/), cust: col(p, /customer/), pi: col(p, /pi no/),
      mat: col(p, /material/), fin: col(p, /finish/), slabs: col(p, /no\.? of slabs/),
      thk: col(p, /thickness/), qty: col(p, /^qty/), status: col(p, /production status/),
    };
    // group item rows: by PI number, else by customer+date (forward-fill merged cells)
    const groups = new Map();
    let prev = null;
    for (const r of p.data) {
      st.pending.rows++;
      const cust = S(r[P.cust]) || (prev ? prev.cust : "");
      const piNo = S(r[P.pi]) || (S(r[P.cust]) ? "" : prev ? prev.piNo : "");
      const date = asDate(r[P.date]) || (prev && cust === prev.cust ? prev.date : null);
      if (!cust) { st.pending.skippedRows.push("row without customer (nothing to attach to)"); continue; }
      const key = piNo ? `pi:${ci(piNo)}` : `nopi:${ci(cust)}|${date ? date.toISOString().slice(0, 10) : "nodate"}`;
      if (!groups.has(key)) groups.set(key, { cust, piNo, date, rows: [] });
      groups.get(key).rows.push(r);
      prev = { cust, piNo, date };
    }
    let seq = 0;
    for (const g of groups.values()) {
      seq++;
      const client = await clientFor(g.cust, null, "Pending");
      const statusRaw = g.rows.map((r) => S(r[P.status])).find(Boolean) || "";
      const { status, mapped } = mapOrderStatus(statusRaw);
      bump(st.enum.orderStatus, status);
      if (statusRaw && !mapped) bump(st.enum.unmappedStatus, statusRaw);
      const items = g.rows.map((r) => {
        const q = parseQty(r[P.qty]);
        return {
          description: S(r[P.mat]) || null, finish: S(r[P.fin]) || null, thickness: S(r[P.thk]) || null,
          noOfSlabs: money(r[P.slabs]), qty: q.qty, unit: q.unit, qtyRaw: q.raw,
        };
      });
      const orderId = `impo_${sha(`${TAG}|pend|${g.piNo ? ci(g.piNo) : `${ci(g.cust)}|${g.date ? g.date.toISOString().slice(0, 10) : "nodate"}`}`)}`;
      const note = noteJoin([
        `[${TAG} import] Pending orders sheet (${g.rows.length} line${g.rows.length > 1 ? "s" : ""})`,
        g.date ? `Order date (books): ${g.date.toISOString().slice(0, 10)}` : "Order date missing in books",
        statusRaw ? `Production status (books): "${statusRaw}"` : "No production status in books",
        client.sp ? `Salesperson (books): ${client.sp}` : null,
        !g.piNo ? "No PI number in books - synthetic PI attached for factory tagging" : null,
      ]);
      await prisma.salesOrder.upsert({
        where: { id: orderId }, update: {},
        create: {
          id: orderId, orderNumber: `IMP-${TAG}-P-${String(seq).padStart(4, "0")}`,
          clientId: client.id, spId: spFor(client.sp), status,
          currency: client.currency ?? "USD", notes: note,
          ...(g.date ? { createdAt: g.date } : {}),
        },
      });
      const piNumber = g.piNo || `IMP-${TAG}-P${String(seq).padStart(4, "0")}`;
      const { reused } = await createPI(piNumber, {
        id: `impp_${sha(`${TAG}|pendpi|${ci(piNumber)}`)}`, spId: spFor(client.sp), clientId: client.id,
        orderId, status: status === "DRAFT" ? "SENT" : "ACCEPTED", items, totalAmount: 0,
        currency: client.currency ?? "USD", baseDate: g.date,
        notes: `[${TAG} import] Skeleton PI from Pending orders sheet (amounts not in books).`,
      });
      if (!reused) st.pending.pis++;
      await addLog(orderId, `Imported from ${TAG} Pending orders sheet`);
      st.pending.orders++;
    }
  }

  // ---- Intransit -> IN_TRANSIT orders + PI + container + shipment docs (+ divisions) ----
  const orderByInvKey = new Map(); // digitsKey(invoice) -> orderId (for Outstanding attach)
  for (const row of await prisma.$queryRawUnsafe(
    `SELECT id, invoice_number FROM sales_orders WHERE sp_id LIKE $1 AND invoice_number IS NOT NULL`, `${spBase}%`)) {
    orderByInvKey.set(digitsKey(row.invoice_number) || ci(row.invoice_number), row.id);
  }
  let outstandingKeys = new Set();
  if (sheets.outstanding) {
    const o = sheets.outstanding;
    const invIx = col(o, /inv no/);
    outstandingKeys = new Set(o.data.map((r) => digitsKey(r[invIx])).filter(Boolean));
  }
  if (sheets.intransit) {
    const t = sheets.intransit;
    const T = {
      sp: col(t, /^sp$/), month: col(t, /month/), country: col(t, /country/), inv: col(t, /invoice no/),
      invDate: col(t, /invoice date/), pi: col(t, /pi no/), cust: col(t, /customer name/),
      curr: col(t, /currency/), colors: col(t, /colors/), thk: col(t, /thickness/),
      slabs: col(t, /no of slabs/), unit: col(t, /^unit/), price: col(t, /^price/),
      del: col(t, /delivery terms/), pay: col(t, /payment terms/), recd: col(t, /payment received/),
      bal: col(t, /balance to receive/), val: col(t, /invoice value/), pod: col(t, /port of discharge/),
      cont: col(t, /container no/), eta: col(t, /^eta/),
    };
    const groups = new Map(); // digitsKey(invoice) -> rows
    for (const r of t.data) {
      st.intransit.rows++;
      const key = digitsKey(r[T.inv]) || ci(r[T.inv]);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    let seq = 0;
    for (const [key, rows] of groups) {
      seq++;
      const first = (ix) => rows.map((r) => r[ix]).find((v) => v !== null && S(v) !== "");
      const invRaw = S(first(T.inv));
      const cust = S(first(T.cust));
      const client = await clientFor(cust, S(first(T.country)), "Intransit");
      const spName = S(first(T.sp)) || client.sp;
      const currency = mapCurrency(first(T.curr)) ?? client.currency ?? "USD";
      const total = money(first(T.val));
      const recd = money(first(T.recd));
      const bal = T.bal >= 0 ? money(first(T.bal)) : (total != null ? total - (recd ?? 0) : null);
      const invDate = asDate(first(T.invDate));
      const eta = asDate(first(T.eta));
      const payTerms = S(first(T.pay));
      const orderId = `impo_${sha(`${TAG}|intr|${key}`)}`;
      const note = noteJoin([
        `[${TAG} import] Intransit sheet (${rows.length} line${rows.length > 1 ? "s" : ""})`,
        spName ? `Salesperson (books): ${spName}` : null,
        S(first(T.month)) ? `Month (books): ${S(first(T.month))}` : null,
        `Payment received (books): ${recd ?? (S(first(T.recd)) || "-")}`,
        `Balance to receive (books): ${bal ?? "-"}`,
        payTerms ? `Payment terms (books): ${payTerms}` : null,
        outstandingKeys.has(key) ? "Payment tracked via Outstanding Payments sheet" : null,
      ]);
      await prisma.salesOrder.upsert({
        where: { id: orderId }, update: {},
        create: {
          id: orderId, orderNumber: `IMP-${TAG}-I-${String(seq).padStart(4, "0")}`,
          clientId: client.id, spId: spFor(spName), status: "IN_TRANSIT",
          totalAmount: total, currency, deliveryTerms: S(first(T.del)) || null,
          invoiceNumber: invRaw || null, notes: note,
          ...(invDate ? { createdAt: invDate } : {}),
        },
      });
      orderByInvKey.set(key, orderId);
      const items = rows.map((r) => ({
        colour: S(r[T.colors]) || null, thickness: S(r[T.thk]) || null, noOfSlabs: money(r[T.slabs]),
        unit: S(r[T.unit]) || null, unitPrice: money(r[T.price]),
      }));
      const piRaw = S(first(T.pi));
      const piNumber = piRaw || `IMP-${TAG}-I${String(seq).padStart(4, "0")}`;
      const { reused } = await createPI(piNumber, {
        id: `impp_${sha(`${TAG}|intrpi|${ci(piNumber)}`)}`, spId: spFor(spName), clientId: client.id,
        orderId, status: "ACCEPTED", items, totalAmount: total ?? 0, currency,
        deliveryTerms: S(first(T.del)) || null, paymentTermsSummary: payTerms || null,
        portOfDischarge: S(first(T.pod)) || null, baseDate: invDate,
        notes: `[${TAG} import] PI reconstructed from Intransit sheet.`,
      });
      if (!reused) st.intransit.pis++;
      await prisma.salesContainer.upsert({
        where: { orderId }, update: {},
        create: { id: `impct_${sha(orderId)}`, orderId, containerNumber: S(first(T.cont)) || null, eta },
      });
      st.intransit.containers++;
      await prisma.salesShipmentDocs.upsert({
        where: { orderId }, update: {},
        create: {
          id: `impsd_${sha(orderId)}`, orderId, commercialInvoiceNo: invRaw || null,
          commercialInvoiceDate: invDate, containerNo: S(first(T.cont)) || null,
          portOfDischarge: S(first(T.pod)) || null, etaDate: eta,
        },
      });
      st.intransit.shipmentDocs++;
      // payment divisions from intransit money columns — unless the Outstanding sheet
      // owns this invoice (it is the authoritative receivables book)
      if (!outstandingKeys.has(key)) {
        if (recd != null && recd > 0 && total) {
          await prisma.salesPaymentDivision.upsert({
            where: { id: `impd_${sha(`${TAG}|intr|${key}|recd`)}` }, update: {},
            create: {
              id: `impd_${sha(`${TAG}|intr|${key}|recd`)}`, orderId, type: "ADVANCE",
              percentage: pct(recd, total), amount: recd, status: "PAID", paidAt: new Date(),
              notes: `[${TAG} import] Received per Intransit sheet (actual payment date not in books). Terms: ${payTerms || "-"}`,
            },
          });
          bump(st.enum.divType, "ADVANCE"); st.intransit.divisions++;
        }
        if (bal != null && bal > 0) {
          const type = mapDivisionType(payTerms);
          await prisma.salesPaymentDivision.upsert({
            where: { id: `impd_${sha(`${TAG}|intr|${key}|bal`)}` }, update: {},
            create: {
              id: `impd_${sha(`${TAG}|intr|${key}|bal`)}`, orderId, type,
              percentage: pct(bal, total), amount: bal, status: "PENDING",
              notes: `[${TAG} import] Balance to receive per Intransit sheet. Terms: ${payTerms || "-"}`,
            },
          });
          bump(st.enum.divType, type); st.intransit.divisions++;
        }
      } else st.intransit.divSkipped++;
      await addLog(orderId, `Imported from ${TAG} Intransit sheet (invoice ${invRaw})`);
      st.intransit.orders++;
    }
  }

  // ---- Outstanding Payments -> payment divisions (attach to existing order or create one) ----
  if (sheets.outstanding) {
    const o = sheets.outstanding;
    const O = {
      inv: col(o, /inv no/), date: col(o, /^date/), cust: col(o, /customer/), country: col(o, /country/),
      curr: col(o, /^curr/), due: col(o, /due date/), pay: col(o, /payment terms/),
      pstatus: col(o, /payment status/), recd: col(o, /total recd/), bal: col(o, /balance to recv/),
      full: col(o, /full invoice value/),
    };
    let seq = 0; let rowIdx = 0;
    for (const r of o.data) {
      rowIdx++; st.outstanding.rows++;
      const invRaw = S(r[O.inv]);
      if (!invRaw) { st.outstanding.skipped.push(`row ${rowIdx}: no invoice number (summary/total row)`); continue; }
      const key = digitsKey(invRaw) || ci(invRaw);
      const full = money(r[O.full]);
      const recd = money(r[O.recd]);
      const bal = money(r[O.bal]);
      const due = asDate(r[O.due]);
      const invDate = asDate(r[O.date]);
      const payTerms = S(r[O.pay]);
      const pstatusRaw = S(r[O.pstatus]);
      let orderId = orderByInvKey.get(key);
      if (!orderId) {
        seq++;
        const client = await clientFor(S(r[O.cust]), S(r[O.country]), "Outstanding");
        orderId = `impo_${sha(`${TAG}|out|${key}`)}`;
        await prisma.salesOrder.upsert({
          where: { id: orderId }, update: {},
          create: {
            id: orderId, orderNumber: `IMP-${TAG}-O-${String(seq).padStart(4, "0")}`,
            clientId: client.id, spId: spFor(client.sp), status: "DELIVERED",
            totalAmount: full, currency: mapCurrency(r[O.curr]) ?? "USD", invoiceNumber: invRaw,
            notes: noteJoin([
              `[${TAG} import] Order reconstructed from Outstanding Payments sheet (invoice not on Intransit sheet; assumed delivered)`,
              client.sp ? `Salesperson (books): ${client.sp}` : null,
              pstatusRaw ? `Payment status (books): "${pstatusRaw}"` : null,
              payTerms ? `Payment terms (books): ${payTerms}` : null,
            ]),
            ...(invDate ? { createdAt: invDate } : {}),
          },
        });
        await createPI(`IMP-${TAG}-O${String(seq).padStart(4, "0")}`, {
          id: `impp_${sha(`${TAG}|outpi|${key}`)}`, spId: spFor(client.sp), clientId: client.id,
          orderId, status: "ACCEPTED", items: [], totalAmount: full ?? 0,
          currency: mapCurrency(r[O.curr]) ?? "USD", paymentTermsSummary: payTerms || null, baseDate: invDate,
          notes: `[${TAG} import] Synthetic PI (factory tag) for Outstanding-only invoice ${invRaw}.`,
        });
        await addLog(orderId, `Imported from ${TAG} Outstanding Payments sheet (invoice ${invRaw})`);
        orderByInvKey.set(key, orderId);
        st.outstanding.ordersCreated++;
      } else st.outstanding.attached++;
      const divNote = noteJoin([
        `[${TAG} import] Outstanding Payments sheet row ${rowIdx}`,
        pstatusRaw ? `Payment status (books): "${pstatusRaw}"` : "No payment status in books",
        payTerms ? `Terms (books): ${payTerms}` : null,
        `Full invoice value: ${full ?? "-"} / received: ${recd ?? (S(r[O.recd]) || "-")} / balance: ${bal ?? "-"}`,
      ]);
      if (recd != null && recd > 0) {
        await prisma.salesPaymentDivision.upsert({
          where: { id: `impd_${sha(`${TAG}|out|${key}|${rowIdx}|recd`)}` }, update: {},
          create: {
            id: `impd_${sha(`${TAG}|out|${key}|${rowIdx}|recd`)}`, orderId, type: "ADVANCE",
            percentage: pct(recd, full), amount: recd, status: "PAID", paidAt: new Date(), notes: divNote,
          },
        });
        bump(st.enum.divType, "ADVANCE"); st.outstanding.divisions++;
      }
      if (bal != null && bal > 0) {
        const type = mapDivisionType(payTerms);
        const overdue = due && due.getTime() < Date.now();
        await prisma.salesPaymentDivision.upsert({
          where: { id: `impd_${sha(`${TAG}|out|${key}|${rowIdx}|bal`)}` }, update: {},
          create: {
            id: `impd_${sha(`${TAG}|out|${key}|${rowIdx}|bal`)}`, orderId, type,
            percentage: pct(bal, full), amount: bal, dueDate: due,
            status: overdue ? "OVERDUE" : "PENDING", notes: divNote,
          },
        });
        bump(st.enum.divType, type); st.outstanding.divisions++;
      } else if (bal == null) st.outstanding.skipped.push(`row ${rowIdx} (inv ${invRaw}): balance not numeric`);
    }
  }
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--force");
  const force = process.argv.includes("--force");
  if (args.length < 1) {
    console.error('Usage: node scripts/import-international-sales.js "<PGI.xlsx>" "<PESPL.xlsx>" [--force]');
    process.exit(1);
  }
  const files = args.map((f) => {
    const base = ci(path.basename(f));
    const tag = base.includes("pespl") ? "PESPL" : base.includes("pgi") ? "PGI" : null;
    if (!tag) { console.error(`Cannot infer factory tag (PGI/PESPL) from filename: ${f}`); process.exit(1); }
    if (!fs.existsSync(f)) { console.error(`File not found: ${f}`); process.exit(1); }
    return { f, tag };
  });
  // One-shot guard (same pattern as import-consumables.js)
  const existing = await prisma.salesClient.count().catch(() => 0);
  if (existing > 0 && !force) {
    console.error(`Refusing to import: sales_clients already has ${existing} rows. Re-run with --force if you really mean it.`);
    process.exit(1);
  }
  const stats = {};
  for (const { f, tag } of files) {
    console.log(`\n=== Importing ${tag} from ${f} ===`);
    await importFactory(f, tag, stats);
  }
  // Defuse the daily payment-reminder cron for imported historical divisions:
  // mark every milestone as already sent so no customer gets auto-mailed about old balances.
  await prisma.$executeRawUnsafe(
    `UPDATE sales_payment_divisions SET reminders_sent = '["50","80","95","day_before","due_day"]'::jsonb WHERE id LIKE 'impd_%'`
  );
  for (const [tag, st] of Object.entries(stats)) {
    console.log(`\n--- ${tag} summary ---`);
    console.log(`clients: created ${st.clients.created}, deduped ${st.clients.deduped}, auto-created from order sheets ${st.clients.autoCreated.length}`);
    if (st.clients.autoCreated.length) console.log(`  auto-created: ${st.clients.autoCreated.join("; ")}`);
    if (st.clients.skipped.length) console.log(`  skipped: ${st.clients.skipped.join("; ")}`);
    console.log(`pending: ${st.pending.rows} rows -> ${st.pending.orders} orders, ${st.pending.pis} PIs; skipped rows: ${st.pending.skippedRows.length}`);
    if (st.pending.skippedRows.length) console.log(`  ${st.pending.skippedRows.join("; ")}`);
    console.log(`intransit: ${st.intransit.rows} rows -> ${st.intransit.orders} orders, ${st.intransit.pis} PIs, ${st.intransit.containers} containers, ${st.intransit.shipmentDocs} shipment docs, ${st.intransit.divisions} divisions (skipped for ${st.intransit.divSkipped} invoices tracked in Outstanding)`);
    console.log(`outstanding: ${st.outstanding.rows} rows -> ${st.outstanding.attached} attached to existing orders, ${st.outstanding.ordersCreated} orders created, ${st.outstanding.divisions} divisions`);
    if (st.outstanding.skipped.length) console.log(`  skipped: ${st.outstanding.skipped.join("; ")}`);
    console.log(`order status mapping: ${JSON.stringify(st.enum.orderStatus)}`);
    if (Object.keys(st.enum.unmappedStatus).length) console.log(`  statuses defaulted to PENDING_PAYMENT (raw kept in notes): ${JSON.stringify(st.enum.unmappedStatus)}`);
    console.log(`division type mapping: ${JSON.stringify(st.enum.divType)}`);
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());
// EOF
