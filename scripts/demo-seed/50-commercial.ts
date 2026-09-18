// scripts/demo-seed/50-commercial.ts
// ───────────────────────────────────────────────────────────────────────────
// THE COMMERCIAL DESK — invented end to end, for the DEMO database only.
//
// Every company, GSTIN, address, rate and slab number below is made up. None
// of it is Pacific's.
//
// "CommercialClient" is two tables: the commercial module SHARES the customer
// master by FK (sales_clients, scripts/0076) and keeps only what a tax invoice
// and the export workbook need — GSTIN, PAN, state code, printed address
// blocks — in commercial_client_ext. So both are seeded here, and the ids go
// onto ctx.clients for the modules that run after this one.
//
// This file imports NOTHING. `db` is the already-connected demo PrismaClient
// handed in by run.ts; @/lib/prisma is the PRODUCTION singleton and must never
// appear here. Every table is written inside its own try/catch, so a column
// this schema does not have costs one table and not the run.
// ───────────────────────────────────────────────────────────────────────────

/** The shared object run.ts builds — re-declared, not imported, so nothing is
 *  pulled in at runtime. Structurally identical to run.ts's Ctx. */
interface Ctx {
  designs: string[];
  batches: string[];
  users: { id: string; name: string; email: string; role: string }[];
  clients: { id: string; name: string }[];
  now: Date;
  daysAgo: (n: number) => Date;
}

interface DemoClient {
  id: string;
  name: string;
  country: string;
  city: string;
  email: string;
  phone: string;
  contact: string;
  /** Address as printed, one line per line. */
  lines: string[];
  currency: string;
  /** Customer code, e.g. USA-031. */
  code: string;
  sku: string;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  incoterm: string | null;
  port: string | null;
  payment: string;
}

// ── the customers ─────────────────────────────────────────────────────────
// Four Indian (a GSTIN, a state code, INR) and six export (a customer code,
// an incoterm, a port of discharge). All fictional.
const CLIENTS: DemoClient[] = [
  {
    id: "dm-cli-01", name: "Northwind Stone Ltd", country: "United Kingdom", city: "Manchester",
    email: "buying@northwindstone.example", phone: "+44 161 496 0142", contact: "Alan Frost",
    lines: ["Unit 14, Ashfield Trade Park", "Trafford Park", "Manchester M17 1WA"],
    currency: "GBP", code: "UK-018", sku: "NWS", gstin: null, pan: null, stateCode: null,
    incoterm: "CIF", port: "Felixstowe", payment: "30% advance, balance against scanned BL",
  },
  {
    id: "dm-cli-02", name: "Meridian Surfaces GmbH", country: "Germany", city: "Dortmund",
    email: "einkauf@meridian-surfaces.example", phone: "+49 231 5540 118", contact: "Katrin Bohm",
    lines: ["Industriestrasse 44", "44263 Dortmund"],
    currency: "EUR", code: "DE-042", sku: "MER", gstin: null, pan: null, stateCode: null,
    incoterm: "CIF", port: "Hamburg", payment: "25% advance, balance 30 days from BL",
  },
  {
    id: "dm-cli-03", name: "Harbourline Interiors Pvt Ltd", country: "India", city: "Chennai",
    email: "purchase@harbourline.example", phone: "+91 44 4285 6610", contact: "Ravi Menon",
    lines: ["No. 12, Second Avenue", "Anna Nagar", "Chennai 600040", "Tamil Nadu"],
    currency: "INR", code: "IND-007", sku: "HBL", gstin: "33AAGCH7412M1Z8", pan: "AAGCH7412M", stateCode: "33",
    incoterm: null, port: null, payment: "50% advance, balance before dispatch",
  },
  {
    id: "dm-cli-04", name: "Caldera Stoneworks LLC", country: "United States", city: "Houston",
    email: "orders@calderastoneworks.example", phone: "+1 713 555 0184", contact: "Dana Whitcomb",
    lines: ["4180 Greenbriar Industrial Drive", "Houston, TX 77098"],
    currency: "USD", code: "USA-031", sku: "CAL", gstin: null, pan: null, stateCode: null,
    incoterm: "FOB", port: "Houston", payment: "Clean credit, 45 days from BL",
  },
  {
    id: "dm-cli-05", name: "Vasanta Marbles & Granites", country: "India", city: "Hyderabad",
    email: "vasanta.purchase@vasantastone.example", phone: "+91 40 2311 7742", contact: "Sneha Iyer",
    lines: ["Plot 88, Kompally Trade Centre", "Medchal Road", "Hyderabad 500014", "Telangana"],
    currency: "INR", code: "IND-011", sku: "VAS", gstin: "36AABCV5310K1ZQ", pan: "AABCV5310K", stateCode: "36",
    incoterm: null, port: null, payment: "Immediate, against proforma",
  },
  {
    id: "dm-cli-06", name: "Blue Cedar Countertops Inc", country: "Canada", city: "Vancouver",
    email: "supply@bluecedarcounters.example", phone: "+1 604 555 0197", contact: "Ethan Roy",
    lines: ["2210 Burrard Industrial Way", "Vancouver, BC V6J 3H4"],
    currency: "USD", code: "CAN-009", sku: "BCC", gstin: null, pan: null, stateCode: null,
    incoterm: "CIF", port: "Vancouver", payment: "30% advance, balance against documents",
  },
  {
    id: "dm-cli-07", name: "Orion Facades SpA", country: "Italy", city: "Verona",
    email: "acquisti@orionfacades.example", phone: "+39 045 810 4472", contact: "Luca Ferretti",
    lines: ["Via delle Cave 27", "37135 Verona VR"],
    currency: "EUR", code: "ITA-024", sku: "ORI", gstin: null, pan: null, stateCode: null,
    incoterm: "FOB", port: "Genoa", payment: "LC at sight",
  },
  {
    id: "dm-cli-08", name: "Kestrel Kitchens Pty Ltd", country: "Australia", city: "Melbourne",
    email: "procurement@kestrelkitchens.example", phone: "+61 3 9042 1180", contact: "Brett Lawson",
    lines: ["36 Fairbank Road", "Clayton South VIC 3169"],
    currency: "AUD", code: "AUS-016", sku: "KKP", gstin: null, pan: null, stateCode: null,
    incoterm: "CIF", port: "Melbourne", payment: "50% advance, balance before shipment",
  },
  {
    id: "dm-cli-09", name: "Sandhurst Surfaces Pvt Ltd", country: "India", city: "Bengaluru",
    email: "buying@sandhurstsurfaces.example", phone: "+91 80 4117 9023", contact: "Prakash Nair",
    lines: ["Survey No. 41/2, Hoskote Industrial Area", "Bengaluru 562114", "Karnataka"],
    currency: "INR", code: "IND-019", sku: "SSP", gstin: "29AADCS9042L1ZR", pan: "AADCS9042L", stateCode: "29",
    incoterm: null, port: null, payment: "30 days from delivery",
  },
  {
    id: "dm-cli-10", name: "Altamira Piedra S.A. de C.V.", country: "Mexico", city: "Monterrey",
    email: "compras@altamirapiedra.example", phone: "+52 81 8340 2216", contact: "Isabel Ruiz",
    lines: ["Av. Constitucion 1420", "Col. Centro", "64000 Monterrey, N.L."],
    currency: "USD", code: "MEX-005", sku: "ALT", gstin: null, pan: null, stateCode: null,
    incoterm: "CIF", port: "Veracruz", payment: "40% advance, balance against documents",
  },
];

const FINISHES = ["Polish", "Leather", "Polish", "Honed", "Polish", "Suede"];
const SIZES = ["Jumbo", "Super Jumbo", "Jumbo", "Super Jumbo"];
const GRADES = ["Premium", "Standard", "Premium", "Commercial"];
const THICKNESS = ["2 cm", "3 cm"];

/** The stage ladder: status, the column it stamps, the label the log prints. */
const STEPS: Array<[string, string, string]> = [
  ["CONFIRMED", "confirmedAt", "Confirmed"],
  ["STOCK_CHECKED", "stockCheckedAt", "Stock checked"],
  ["PI_ISSUED", "piIssuedAt", "PI issued"],
  ["PACKING", "packingAt", "Packing"],
  ["DISPATCH_CHECK", "dispatchCheckedAt", "Dispatch check"],
  ["READY", "readyAt", "Ready"],
  ["INVOICED", "invoicedAt", "Invoiced"],
  ["DISPATCHED", "dispatchedAt", "Dispatched"],
  ["CLOSED", "closedAt", "Closed"],
];

interface EnqSpec {
  n: number; client: string | null; prospect?: string; contact: string; email: string;
  phone?: string; days: number; source: string; subject: string; body: string;
  status: string; lost?: string; order?: string;
  items: Array<{ d: number; t: string; f: string; slabs: number; sqft: number }>;
}

const ENQUIRIES: EnqSpec[] = [
  {
    n: 1, client: "dm-cli-03", contact: "Ravi Menon", email: "purchase@harbourline.example",
    phone: "+91 44 4285 6610", days: 88, source: "EMAIL",
    subject: "Quartz for the Whitefield show flat — 2 cm",
    body: "Need 2 cm polished for a show flat handover in six weeks. Two designs, one light and one mid grey. Please quote landed Chennai.",
    status: "ORDERED", order: "dm-ord-01",
    items: [{ d: 0, t: "2 cm", f: "Polish", slabs: 22, sqft: 1620 }, { d: 4, t: "2 cm", f: "Polish", slabs: 10, sqft: 738 }],
  },
  {
    n: 2, client: "dm-cli-01", contact: "Alan Frost", email: "buying@northwindstone.example",
    phone: "+44 161 496 0142", days: 82, source: "EMAIL",
    subject: "Q4 programme — 20 mm jumbo, four containers",
    body: "Our Q4 kitchen programme needs four containers spread over the quarter. Send your best CIF Felixstowe with lead times.",
    status: "ORDERED", order: "dm-ord-02",
    items: [{ d: 1, t: "2 cm", f: "Polish", slabs: 60, sqft: 4380 }, { d: 7, t: "2 cm", f: "Leather", slabs: 24, sqft: 1752 }],
  },
  {
    n: 3, client: "dm-cli-04", contact: "Dana Whitcomb", email: "orders@calderastoneworks.example",
    phone: "+1 713 555 0184", days: 76, source: "PHONE",
    subject: "Samples plus price on 3 cm",
    body: "Called in: wants A4 samples of the three cream ranges and a price on 3 cm FOB Houston. Samples couriered the same week.",
    status: "ORDERED", order: "dm-ord-03",
    items: [{ d: 5, t: "3 cm", f: "Polish", slabs: 38, sqft: 2812 }],
  },
  {
    n: 4, client: null, prospect: "Lakeview Stone Co", contact: "Marcus Reed",
    email: "marcus@lakeviewstone.example", days: 70, source: "WEBSITE",
    subject: "Website form — 3 cm quartz, mixed designs",
    body: "Form submission from the website. Small fabricator, one container of mixed 3 cm, no prior history with us.",
    status: "LOST", lost: "Went with a local supplier on price — 11% under our quote.",
    items: [{ d: 2, t: "3 cm", f: "Polish", slabs: 30, sqft: 2220 }],
  },
  {
    n: 5, client: "dm-cli-05", contact: "Sneha Iyer", email: "vasanta.purchase@vasantastone.example",
    phone: "+91 40 2311 7742", days: 64, source: "EMAIL",
    subject: "Repeat order — same two designs as last time",
    body: "Repeat of the July lot, same two designs and the same sizes. Asks whether the rate holds.",
    status: "ORDERED", order: "dm-ord-04",
    items: [{ d: 3, t: "2 cm", f: "Polish", slabs: 26, sqft: 1898 }, { d: 9, t: "2 cm", f: "Honed", slabs: 14, sqft: 1022 }],
  },
  {
    n: 6, client: "dm-cli-02", contact: "Katrin Bohm", email: "einkauf@meridian-surfaces.example",
    phone: "+49 231 5540 118", days: 57, source: "VISIT",
    subject: "Follow-up from the Verona stand",
    body: "Met at the stand. Wants the two veined whites in 2 cm and one dark in 3 cm, CIF Hamburg, staged over two months.",
    status: "ORDERED", order: "dm-ord-05",
    items: [{ d: 3, t: "2 cm", f: "Polish", slabs: 44, sqft: 3212 }, { d: 6, t: "3 cm", f: "Polish", slabs: 18, sqft: 1332 }],
  },
  {
    n: 7, client: "dm-cli-07", contact: "Luca Ferretti", email: "acquisti@orionfacades.example",
    phone: "+39 045 810 4472", days: 50, source: "EMAIL",
    subject: "Facade panels — 3 cm, calibrated",
    body: "Facade job in Verona. Calibrated 3 cm only, wants the tolerance in writing before he raises the PO.",
    status: "ORDERED", order: "dm-ord-06",
    items: [{ d: 12, t: "3 cm", f: "Honed", slabs: 52, sqft: 3848 }],
  },
  {
    n: 8, client: null, prospect: "Copperfield Kitchens Ltd", contact: "Helen Marsh",
    email: "helen@copperfieldkitchens.example", days: 44, source: "REFERRAL",
    subject: "Referred by Northwind — small trial order",
    body: "Referred by Alan at Northwind. Asked for a trial pallet, then went quiet — closed after the second follow-up went unanswered, without a quote ever going out.",
    status: "CLOSED",
    items: [{ d: 10, t: "2 cm", f: "Polish", slabs: 8, sqft: 584 }],
  },
  {
    n: 9, client: "dm-cli-09", contact: "Prakash Nair", email: "buying@sandhurstsurfaces.example",
    phone: "+91 80 4117 9023", days: 40, source: "EMAIL",
    subject: "Hoskote warehouse stock-up",
    body: "Stocking three designs for the Bengaluru warehouse. Wants delivery in two lots.",
    status: "ORDERED", order: "dm-ord-07",
    items: [{ d: 8, t: "2 cm", f: "Polish", slabs: 34, sqft: 2482 }, { d: 14, t: "2 cm", f: "Leather", slabs: 12, sqft: 876 }],
  },
  {
    n: 10, client: "dm-cli-06", contact: "Ethan Roy", email: "supply@bluecedarcounters.example",
    phone: "+1 604 555 0197", days: 33, source: "EMAIL",
    subject: "First container — countertop programme",
    body: "New account. One container to start, CIF Vancouver, with a view to monthly if the first lands clean.",
    status: "ORDERED", order: "dm-ord-08",
    items: [{ d: 11, t: "3 cm", f: "Polish", slabs: 40, sqft: 2960 }],
  },
  {
    n: 11, client: "dm-cli-10", contact: "Isabel Ruiz", email: "compras@altamirapiedra.example",
    phone: "+52 81 8340 2216", days: 25, source: "EMAIL",
    subject: "Quotation request — two designs, 2 cm",
    body: "Asks for a formal quotation valid 30 days, CIF Veracruz, with a hold on the stock while she takes it to her board.",
    status: "QUOTED",
    items: [{ d: 15, t: "2 cm", f: "Polish", slabs: 28, sqft: 2044 }, { d: 18, t: "2 cm", f: "Suede", slabs: 16, sqft: 1168 }],
  },
  {
    n: 12, client: "dm-cli-08", contact: "Brett Lawson", email: "procurement@kestrelkitchens.example",
    phone: "+61 3 9042 1180", days: 18, source: "EMAIL",
    subject: "Price on the darker range",
    body: "Wants the dark range priced CIF Melbourne. Says the last quote was close but the freight killed it.",
    status: "QUOTED",
    items: [{ d: 16, t: "2 cm", f: "Polish", slabs: 20, sqft: 1460 }],
  },
  {
    n: 13, client: "dm-cli-03", contact: "Ravi Menon", email: "purchase@harbourline.example",
    phone: "+91 44 4285 6610", days: 9, source: "PHONE",
    subject: "Second phase — same designs, more quantity",
    body: "Phase two of the same project. Wants to know whether the two designs are still running before he puts numbers to it.",
    status: "NEW",
    items: [{ d: 0, t: "2 cm", f: "Polish", slabs: 30, sqft: 2190 }],
  },
  {
    n: 14, client: null, prospect: "Stonebridge Developers LLP", contact: "Ananya Kulkarni",
    email: "ananya@stonebridgedev.example", days: 3, source: "WEBSITE",
    subject: "Bulk enquiry — 240 flats, Pune",
    body: "Developer enquiry off the website: 240 flats, kitchen tops and vanity, wants a budget number this week.",
    status: "NEW",
    items: [{ d: 19, t: "2 cm", f: "Polish", slabs: 90, sqft: 6570 }, { d: 21, t: "2 cm", f: "Honed", slabs: 45, sqft: 3285 }],
  },
];

interface OrdSpec {
  id: string; n: number; client: string; kind: "DOMESTIC" | "EXPORT"; status: string;
  days: number; enq?: string; enqNo?: number; po?: string; advance?: number;
  lines: number; salesperson: string; cancel?: string; waived?: boolean;
}

// Twelve orders, one at every stage of the pipeline (CLOSED twice), spread
// back over the last ninety days so the board and the age column have a shape.
const ORDERS: OrdSpec[] = [
  { id: "dm-ord-01", n: 1, client: "dm-cli-03", kind: "DOMESTIC", status: "CLOSED", days: 86, enq: "dm-enq-01", enqNo: 1, po: "HBL/PO/2026/0411", advance: 50, lines: 2, salesperson: "Nikhil Raut" },
  { id: "dm-ord-02", n: 2, client: "dm-cli-01", kind: "EXPORT", status: "DISPATCHED", days: 79, enq: "dm-enq-02", enqNo: 2, po: "NWS-4471", advance: 30, lines: 3, salesperson: "Farida Sheikh" },
  { id: "dm-ord-03", n: 3, client: "dm-cli-04", kind: "EXPORT", status: "INVOICED", days: 72, enq: "dm-enq-03", enqNo: 3, po: "CSW-PO-88120", advance: 0, lines: 2, salesperson: "Farida Sheikh" },
  { id: "dm-ord-04", n: 4, client: "dm-cli-05", kind: "DOMESTIC", status: "CLOSED", days: 66, enq: "dm-enq-05", enqNo: 5, po: "VMG/2026/1187", advance: 50, lines: 2, salesperson: "Nikhil Raut" },
  { id: "dm-ord-05", n: 5, client: "dm-cli-02", kind: "EXPORT", status: "READY", days: 58, enq: "dm-enq-06", enqNo: 6, po: "MS-2026-0642", advance: 25, lines: 3, salesperson: "Farida Sheikh" },
  { id: "dm-ord-06", n: 6, client: "dm-cli-07", kind: "EXPORT", status: "DISPATCH_CHECK", days: 51, enq: "dm-enq-07", enqNo: 7, po: "OF/ACQ/7712", advance: 30, lines: 2, salesperson: "Dev Anand Pillai" },
  { id: "dm-ord-07", n: 7, client: "dm-cli-09", kind: "DOMESTIC", status: "PACKING", days: 44, enq: "dm-enq-09", enqNo: 9, po: "SSP/PO/0309", advance: 30, lines: 3, salesperson: "Nikhil Raut", waived: true },
  { id: "dm-ord-08", n: 8, client: "dm-cli-06", kind: "EXPORT", status: "PI_ISSUED", days: 37, enq: "dm-enq-10", enqNo: 10, advance: 30, lines: 2, salesperson: "Dev Anand Pillai" },
  { id: "dm-ord-09", n: 9, client: "dm-cli-08", kind: "EXPORT", status: "CANCELLED", days: 30, advance: 50, lines: 2, salesperson: "Dev Anand Pillai", cancel: "Customer withdrew — their end client changed the specification." },
  { id: "dm-ord-10", n: 10, client: "dm-cli-10", kind: "EXPORT", status: "STOCK_CHECKED", days: 23, advance: 40, lines: 3, salesperson: "Farida Sheikh" },
  { id: "dm-ord-11", n: 11, client: "dm-cli-03", kind: "DOMESTIC", status: "CONFIRMED", days: 14, po: "HBL/PO/2026/0498", advance: 50, lines: 2, salesperson: "Nikhil Raut" },
  { id: "dm-ord-12", n: 12, client: "dm-cli-01", kind: "EXPORT", status: "DRAFT", days: 6, advance: 30, lines: 2, salesperson: "Farida Sheikh" },
];

/** The first few SOP points, filled in — enough that the checklist tab reads
 *  as a real sheet rather than an empty one. */
const CHECK_POINTS: Array<[string, string, string]> = [
  ["poReference", "1", "Customer Purchase Order Number & date from:"],
  ["itemDescription", "2", "Description of each Item"],
  ["uom", "3", "Unit of Measurement (UOM): SqFt / SqM / etc"],
  ["quantity", "4", "Quantity of each item"],
  ["rate", "6", "Price / Rate of each item per UOM"],
  ["incoterm", "10", "Incoterms: Ex-Works / FOB / C&F / CIF / DDP"],
  ["paymentTerms", "15", "Payment Terms: credit period — Immediate / __ days from BL"],
];

export async function seed(db: any, ctx: Ctx): Promise<void> {
  const daysAgo = ctx.daysAgo;
  const ahead = (n: number) => new Date(ctx.now.getTime() + n * 86_400_000);
  const round = (v: number, p = 2) => Math.round(v * 10 ** p) / 10 ** p;

  const DESIGNS = ctx.designs?.length ? ctx.designs : ["Aurora Mist", "Verona Grey", "Lunar Quartz", "Cascade White"];
  const design = (i: number) => DESIGNS[Math.abs(i) % DESIGNS.length];
  const BATCHES = ctx.batches?.length ? ctx.batches : ["DEM.0101", "DEM.0102", "DEM.0103"];
  const batch = (i: number) => BATCHES[Math.abs(i) % BATCHES.length];

  // Whoever the users module made; a literal stands in if it made nobody.
  // These columns are plain users.id with no FK, so a stand-in cannot break a
  // write — it only shows a name on the log.
  const FALLBACK = { id: "dm-user-commercial", name: "Demo Commercial Desk", email: "commercial@demo.invalid", role: "COMMERCIAL_EXEC" };
  const preferred = (ctx.users ?? []).filter((u) => /COMMERCIAL|SALES|ADMIN/i.test(u.role ?? ""));
  const staff = preferred.length ? preferred : ctx.users?.length ? ctx.users : [FALLBACK];
  const who = (i: number) => staff[Math.abs(i) % staff.length];

  // Financial year label, April start — the same rule as lib/commercial/numbering.ts.
  const y = ctx.now.getFullYear();
  const fyStart = ctx.now.getMonth() >= 3 ? y : y - 1;
  const FY = `${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
  const enqNo = (n: number) => `ENQ/${FY}/N${String(n).padStart(4, "0")}`;
  const ordNo = (n: number) => `ORD/${FY}/N${String(n).padStart(4, "0")}`;

  const byId = (id: string) => CLIENTS.find((c) => c.id === id) ?? CLIENTS[0];
  const fx = (cur: string) => (cur === "INR" ? null : cur === "EUR" ? 95.4 : cur === "GBP" ? 111.2 : cur === "AUD" ? 57.8 : 88.6);
  const party = (c: DemoClient) => ({
    name: c.name, lines: c.lines, country: c.country, tel: c.phone, email: c.email,
    gstin: c.gstin, stateCode: c.stateCode, code: c.code,
  });

  // ── 1. the customer master ───────────────────────────────────────────────
  const creator = who(0).id;
  const clientRows = CLIENTS.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    isActive: true,
    phone: c.phone,
    address: c.lines.join(", "),
    city: c.city,
    country: c.country,
    contactPerson: c.contact,
    createdById: creator,
    defaultCurrency: c.currency,
    defaultUnit: "SQFT",
    defaultPortOfDischarge: c.port,
    defaultDeliveryTerms: c.incoterm,
    defaultPaymentTerms: c.payment,
    ccEmails: [],
    createdAt: daysAgo(90),
  }));

  let clientsIn = false;
  try {
    await db.salesClient.createMany({ data: clientRows, skipDuplicates: true });
    clientsIn = true;
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }

  // THE HANDOFF. Later modules read ctx.clients; only publish ids that are
  // actually in the database, or their foreign keys point at nothing.
  if (clientsIn) {
    if (!Array.isArray(ctx.clients)) ctx.clients = [];
    for (const c of CLIENTS) {
      if (!ctx.clients.some((x) => x.id === c.id)) ctx.clients.push({ id: c.id, name: c.name });
    }
  }

  // ── 2. what a tax invoice needs about them ───────────────────────────────
  try {
    await db.commercialClientExt.createMany({
      data: CLIENTS.map((c) => ({
        clientId: c.id,
        customerCode: c.code,
        gstin: c.gstin,
        pan: c.pan,
        stateCode: c.stateCode,
        billingAddress: party(c),
        shippingAddress: party(c),
        notifyParty: c.gstin ? null : { name: `${c.name} — Notify`, lines: c.lines, country: c.country, code: c.code },
        defaultIncoterm: c.incoterm,
        defaultCurrency: c.currency,
        notes: c.gstin ? "Domestic — DTA invoice." : "Export — commercial invoice and packing list.",
        createdAt: daysAgo(90),
      })),
      skipDuplicates: true,
    });
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }

  // ── 3. enquiries ─────────────────────────────────────────────────────────
  const enquiryRows: any[] = [];
  const enquiryItemRows: any[] = [];
  ENQUIRIES.forEach((q, qi) => {
    const id = `dm-enq-${String(q.n).padStart(2, "0")}`;
    const u = who(qi);
    enquiryRows.push({
      id,
      number: enqNo(q.n),
      clientId: q.client,
      prospectName: q.prospect ?? null,
      contactName: q.contact,
      contactEmail: q.email,
      contactPhone: q.phone ?? null,
      receivedAt: daysAgo(q.days),
      source: q.source,
      subject: q.subject,
      body: q.body,
      status: q.status,
      assignedToId: u.id,
      orderId: q.order ?? null,
      lostReason: q.lost ?? null,
      createdById: u.id,
      createdAt: daysAgo(q.days),
    });
    q.items.forEach((it, li) => {
      const c = q.client ? byId(q.client) : null;
      enquiryItemRows.push({
        id: `${id}-it-${li + 1}`,
        enquiryId: id,
        lineNo: li + 1,
        design: design(it.d),
        customerSku: c ? `${c.sku}${1040 + q.n * 7 + li}A` : null,
        thickness: it.t,
        finish: it.f,
        qtySlabs: it.slabs,
        qtySqft: it.sqft,
        notes: li === 0 ? null : "Second design — same lot if possible.",
        createdAt: daysAgo(q.days),
      });
    });
  });

  try {
    await db.commercialEnquiry.createMany({ data: enquiryRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }
  try {
    await db.commercialEnquiryItem.createMany({ data: enquiryItemRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }

  // ── 4. orders, their lines and their log ─────────────────────────────────
  const orderRows: any[] = [];
  const orderItemRows: any[] = [];
  const eventRows: any[] = [];

  ORDERS.forEach((o, oi) => {
    const c = byId(o.client);
    const u = who(oi);
    const approver = who(oi + 1);
    const createdAt = daysAgo(o.days);
    const idx = STEPS.findIndex(([s]) => s === o.status);

    const row: any = {
      id: o.id,
      number: ordNo(o.n),
      kind: o.kind,
      status: o.status,
      clientId: c.id,
      enquiryId: o.enq ?? null,
      customerPoNumber: o.po ?? null,
      customerPoDate: o.po ? daysAgo(o.days + 1) : null,
      poEvidence: o.po ? "PO" : o.status === "DRAFT" ? null : "EMAIL",
      currency: c.currency,
      exchangeRate: fx(c.currency),
      incoterm: c.incoterm,
      deliveryTerms: o.kind === "EXPORT" ? `${c.incoterm} ${c.port}` : "Ex-works, our lorry",
      paymentTerms: c.payment,
      paymentMode: o.kind === "EXPORT" ? (c.code === "ITA-024" ? "LC" : "CAD") : "Clean Credit",
      advancePct: o.advance ?? null,
      billTo: party(c),
      consignee: party(c),
      notifyParty: o.kind === "EXPORT" ? party(c) : null,
      portOfLoading: o.kind === "EXPORT" ? "Chennai (INMAA)" : null,
      portOfDischarge: o.kind === "EXPORT" ? c.port : null,
      finalDestination: o.kind === "EXPORT" ? `${c.city}, ${c.country}` : c.city,
      countryOfOrigin: "India",
      countryOfDestination: c.country,
      deliverySchedule: oi % 3 === 0 ? "Single lot" : "Two lots, four weeks apart",
      specialPacking: oi % 4 === 0 ? "Fumigated wooden crates, customer marking on two faces." : null,
      customerContact: `${c.contact} — ${c.email}`,
      salespersonName: o.salesperson,
      notes: o.status === "DRAFT" ? "Typed up from the customer's mail; not confirmed yet." : null,
      createdById: u.id,
      createdByName: u.name,
      createdAt,
    };

    eventRows.push({
      id: `${o.id}-ev-00`,
      orderId: o.id,
      kind: "created",
      note: o.enqNo ? `Raised from ${enqNo(o.enqNo)}` : "Raised on the desk from the customer's mail",
      byId: u.id,
      byName: u.name,
      at: createdAt,
    });

    if (o.status === "CANCELLED") {
      row.confirmedAt = daysAgo(Math.max(1, o.days - 2));
      row.cancelledAt = daysAgo(Math.max(1, o.days - 6));
      row.cancelReason = o.cancel ?? "Customer withdrew the order.";
      eventRows.push({ id: `${o.id}-ev-01`, orderId: o.id, kind: "stage", note: "Moved to Confirmed", byId: u.id, byName: u.name, at: row.confirmedAt });
      eventRows.push({ id: `${o.id}-ev-02`, orderId: o.id, kind: "cancelled", note: row.cancelReason, byId: approver.id, byName: approver.name, at: row.cancelledAt });
    } else if (idx >= 0) {
      for (let j = 0; j <= idx; j++) {
        const at = daysAgo(Math.max(1, o.days - 2 * (j + 1)));
        row[STEPS[j][1]] = at;
        eventRows.push({
          id: `${o.id}-ev-${String(j + 1).padStart(2, "0")}`,
          orderId: o.id,
          kind: "stage",
          note: `Moved to ${STEPS[j][2]}`,
          byId: u.id,
          byName: u.name,
          at,
        });
      }
    }

    // Checked and approved once the PI has gone out.
    if (idx >= 2) {
      const at = daysAgo(Math.max(1, o.days - 3));
      row.checklist = CHECK_POINTS.map(([key, no, label], k) => ({
        key,
        no,
        label,
        value:
          key === "poReference" ? o.po ?? "Confirmed by email"
            : key === "uom" ? "SQFT"
            : key === "incoterm" ? c.incoterm ?? "Ex-works"
            : key === "paymentTerms" ? c.payment
            : "Checked against the customer's mail",
        ok: k < CHECK_POINTS.length - 1,
      }));
      row.checkedById = u.id;
      row.checkedByName = u.name;
      row.checkedAt = at;
      row.approvedById = approver.id;
      row.approvedByName = approver.name;
      row.approvedAt = at;
      eventRows.push({ id: `${o.id}-ev-90`, orderId: o.id, kind: "approved", note: "SOP checklist approved", byId: approver.id, byName: approver.name, at });
    }

    // Answer 12: one truck that went without the advance.
    if (o.waived) {
      const at = daysAgo(Math.max(1, o.days - 5));
      row.advanceWaivedAt = at;
      row.advanceWaivedById = approver.id;
      row.advanceWaivedByName = approver.name;
      row.advanceWaivedReason = "Long-standing account, balance cleared within the week the last three times.";
      eventRows.push({ id: `${o.id}-ev-91`, orderId: o.id, kind: "advance_waived", note: row.advanceWaivedReason, byId: approver.id, byName: approver.name, at });
    }

    orderRows.push(row);

    for (let li = 0; li < o.lines; li++) {
      const i = oi * 3 + li;
      const dsg = design(i + 2);
      const th = THICKNESS[li % THICKNESS.length];
      const fin = FINISHES[i % FINISHES.length];
      const size = SIZES[i % SIZES.length];
      const grade = GRADES[i % GRADES.length];
      const slabs = 12 + ((i * 7) % 44);
      const qty = round(slabs * (72 + (i % 5)), 2);
      const unitRate = o.kind === "EXPORT" ? round(11.5 + (i % 7), 2) : round(240 + (i % 6) * 20, 2);
      const mm = th === "3 cm" ? "30mm" : "20mm";
      orderItemRows.push({
        id: `${o.id}-it-${li + 1}`,
        orderId: o.id,
        lineNo: li + 1,
        design: dsg,
        customerSku: `${c.sku}${1040 + o.n * 7 + li}A`,
        description: `${dsg.toUpperCase()}-${fin}-${size}-${mm}-${grade}`,
        thickness: th,
        finish: fin,
        sizeLabel: size,
        gradeLabel: grade,
        qtySlabs: slabs,
        qty,
        uom: "SQFT",
        rate: unitRate,
        amount: round(qty * unitRate, 2),
        hsn: "68101990",
        isSample: false,
        createdAt,
      });
    }

    // A free sample line, on a couple of the export orders.
    if (o.kind === "EXPORT" && oi % 5 === 2) {
      orderItemRows.push({
        id: `${o.id}-it-99`,
        orderId: o.id,
        lineNo: 99,
        design: design(oi + 9),
        customerSku: null,
        description: "A4 samples — no charge",
        thickness: "2 cm",
        finish: "Polish",
        sizeLabel: "Sample",
        gradeLabel: "Premium",
        qtySlabs: null,
        qty: 6,
        uom: "NOS",
        rate: 0,
        amount: 0,
        hsn: "68101990",
        isSample: true,
        createdAt,
      });
    }
  });

  try {
    await db.commercialOrder.createMany({ data: orderRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }
  try {
    await db.commercialOrderItem.createMany({ data: orderItemRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }

  // ── 5. holds ─────────────────────────────────────────────────────────────
  // A hold is really fg_finished_slab.status = RESERVED; this table says who
  // placed it and against what, and survives the release. Where the inventory
  // module has already put slabs in the demo database the holds are placed on
  // REAL demo slabs; where it has not, the snapshot columns carry invented
  // ones (slab_number here is a snapshot, not a foreign key).
  let stock: any[] = [];
  try {
    stock = await db.finishedSlab.findMany({
      where: { status: "AVAILABLE" },
      select: { slabNumber: true, design: true, slabThickness: true, batchKey: true, batchNumber: true, grade: true, lengthIn: true, widthIn: true },
      orderBy: { slabNumber: "asc" },
      take: 30,
    });
  } catch {
    stock = [];
  }

  let cursor = 0;
  const takeSlabs = (n: number, seed: number) => {
    const out: Array<{
      real: boolean; slabNumber: number; design: string | null; thickness: string | null;
      batchKey: string | null; batchNumber: string | null; grade: string | null;
      lengthIn: number; widthIn: number; sqft: number;
    }> = [];
    for (let i = 0; i < n; i++) {
      const s = stock[cursor++];
      const L = Number(s?.lengthIn ?? 137);
      const W = Number(s?.widthIn ?? 79);
      out.push({
        real: Boolean(s),
        slabNumber: s ? Number(s.slabNumber) : 240100 + seed * 10 + i,
        design: s?.design ?? design(seed + i),
        thickness: s?.slabThickness ?? THICKNESS[(seed + i) % 2],
        batchKey: s?.batchKey ?? null,
        batchNumber: s?.batchNumber ?? batch(seed + i),
        grade: s?.grade ?? "A",
        lengthIn: L,
        widthIn: W,
        sqft: round((L * W) / 144, 3),
      });
    }
    return out;
  };

  const HOLDS = [
    { id: "dm-hold-01", orderId: "dm-ord-05", enquiryId: null as string | null, ref: ordNo(5), client: "dm-cli-02", status: "ACTIVE", placed: 40, expires: ahead(11), n: 5, note: "Held against the first lot; the second lot is held when the PI is accepted." },
    { id: "dm-hold-02", orderId: "dm-ord-07", enquiryId: null as string | null, ref: ordNo(7), client: "dm-cli-09", status: "CONSUMED", placed: 32, expires: ahead(2), n: 4, note: "Packed into the first lorry." },
    { id: "dm-hold-03", orderId: null as string | null, enquiryId: "dm-enq-11", ref: enqNo(11), client: "dm-cli-10", status: "ACTIVE", placed: 12, expires: ahead(4), n: 3, note: "Held while the quotation sits with their board." },
    { id: "dm-hold-04", orderId: "dm-ord-09", enquiryId: null as string | null, ref: ordNo(9), client: "dm-cli-08", status: "RELEASED", placed: 28, expires: daysAgo(10), n: 3, note: null as string | null },
    { id: "dm-hold-05", orderId: null as string | null, enquiryId: "dm-enq-12", ref: enqNo(12), client: "dm-cli-08", status: "EXPIRED", placed: 20, expires: daysAgo(3), n: 2, note: "Ran out before the customer came back." },
  ].map((h, hi) => ({ ...h, slabs: takeSlabs(h.n, hi + 1), by: who(hi + 2) }));

  try {
    await db.commercialStockHold.createMany({
      data: HOLDS.map((h) => ({
        id: h.id,
        orderId: h.orderId,
        enquiryId: h.enquiryId,
        reference: h.ref,
        customer: byId(h.client).name,
        status: h.status,
        placedById: h.by.id,
        placedByName: h.by.name,
        placedAt: daysAgo(h.placed),
        expiresAt: h.expires,
        releasedAt: h.status === "RELEASED" ? daysAgo(Math.max(1, h.placed - 6)) : null,
        releasedById: h.status === "RELEASED" ? h.by.id : null,
        releaseReason: h.status === "RELEASED" ? "Order cancelled — slabs back to stock." : null,
        notes: h.note,
        createdAt: daysAgo(h.placed),
      })),
      skipDuplicates: true,
    });
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }

  try {
    await db.commercialStockHoldSlab.createMany({
      data: HOLDS.flatMap((h) =>
        h.slabs.map((s) => ({
          id: `${h.id}-sl-${s.slabNumber}`,
          holdId: h.id,
          slabNumber: s.slabNumber,
          design: s.design,
          thickness: s.thickness,
          batchKey: s.batchKey,
          batchNumber: s.batchNumber,
          grade: s.grade,
          lengthIn: s.lengthIn,
          widthIn: s.widthIn,
          sqft: s.sqft,
          releasedAt: h.status === "RELEASED" ? daysAgo(Math.max(1, h.placed - 6)) : null,
          packedAt: h.status === "CONSUMED" ? daysAgo(Math.max(1, h.placed - 20)) : null,
          createdAt: daysAgo(h.placed),
        })),
      ),
      skipDuplicates: true,
    });
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }

  // The hold itself, on the slab. Only for holds that landed on real demo
  // slabs — an invented slab number has nothing to update.
  try {
    for (const h of HOLDS) {
      if (h.status !== "ACTIVE" && h.status !== "CONSUMED") continue;
      const nums = h.slabs.filter((s) => s.real).map((s) => s.slabNumber);
      if (!nums.length) continue;
      await db.finishedSlab.updateMany({
        where: { slabNumber: { in: nums } },
        data: {
          status: h.status === "CONSUMED" ? "PACKED" : "RESERVED",
          reservedForPi: h.ref,
          customer: byId(h.client).name,
          reservedAt: daysAgo(h.placed),
          reservationExpiresAt: h.expires,
        },
      });
    }
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }

  HOLDS.forEach((h, hi) => {
    if (!h.orderId) return;
    eventRows.push({
      id: `${h.orderId}-ev-h${hi}`,
      orderId: h.orderId,
      kind: h.status === "RELEASED" ? "hold_released" : h.status === "EXPIRED" ? "hold_expired" : "hold_placed",
      note: `${h.slabs.length} slabs against ${h.ref}`,
      byId: h.by.id,
      byName: h.by.name,
      at: daysAgo(h.placed),
    });
  });

  // ── 6. the production queue ──────────────────────────────────────────────
  const REQUESTS = [
    { id: "dm-prq-01", order: "dm-ord-05" as string | null, item: "dm-ord-05-it-1" as string | null, enq: null as string | null, d: 3, t: "2 cm", f: "Polish", req: 44, avail: 30, pri: 1, status: "PRODUCED", shade: "LIGHT", days: 50, clean: null as string | null, hours: 9.5, cleanH: 3 },
    { id: "dm-prq-02", order: "dm-ord-06" as string | null, item: "dm-ord-06-it-1" as string | null, enq: null as string | null, d: 12, t: "3 cm", f: "Honed", req: 52, avail: 18, pri: 2, status: "IN_PRODUCTION", shade: "DARK", days: 42, clean: "Dark straight after a light run — six hours of cleaning, not three.", hours: 16.0, cleanH: 6 },
    { id: "dm-prq-03", order: "dm-ord-07" as string | null, item: "dm-ord-07-it-2" as string | null, enq: null as string | null, d: 14, t: "2 cm", f: "Leather", req: 12, avail: 4, pri: 3, status: "SCHEDULED", shade: "MEDIUM", days: 30, clean: null as string | null, hours: 6.0, cleanH: 3 },
    { id: "dm-prq-04", order: "dm-ord-10" as string | null, item: "dm-ord-10-it-2" as string | null, enq: null as string | null, d: 18, t: "2 cm", f: "Suede", req: 28, avail: 9, pri: 4, status: "QUEUED", shade: "LIGHT", days: 18, clean: null as string | null, hours: 12.5, cleanH: 3 },
    { id: "dm-prq-05", order: null as string | null, item: null as string | null, enq: "dm-enq-12" as string | null, d: 16, t: "2 cm", f: "Polish", req: 20, avail: 6, pri: 5, status: "QUEUED", shade: "DARK", days: 12, clean: null as string | null, hours: 10.0, cleanH: 3 },
    { id: "dm-prq-06", order: "dm-ord-09" as string | null, item: "dm-ord-09-it-1" as string | null, enq: null as string | null, d: 16, t: "3 cm", f: "Polish", req: 24, avail: 11, pri: 6, status: "CANCELLED", shade: "MEDIUM", days: 26, clean: null as string | null, hours: 9.0, cleanH: 3 },
  ];

  try {
    await db.commercialProductionRequest.createMany({
      data: REQUESTS.map((r, ri) => {
        const u = who(ri + 1);
        const short = r.req - r.avail;
        const done = r.status === "PRODUCED";
        return {
          id: r.id,
          orderId: r.order,
          orderItemId: r.item,
          enquiryId: r.enq,
          design: design(r.d),
          thickness: r.t,
          finish: r.f,
          qtyRequired: r.req,
          qtyAvailable: r.avail,
          qtyShort: short,
          priority: r.pri,
          status: r.status,
          cleaningNote: r.clean,
          plannedBatch: r.status === "QUEUED" ? null : batch(ri + 2),
          notes: r.status === "CANCELLED" ? "Dropped with the order." : null,
          raisedById: u.id,
          raisedByName: u.name,
          raisedAt: daysAgo(r.days),
          scheduledAt: ["SCHEDULED", "IN_PRODUCTION", "PRODUCED"].includes(r.status) ? daysAgo(Math.max(1, r.days - 4)) : null,
          startedAt: ["IN_PRODUCTION", "PRODUCED"].includes(r.status) ? daysAgo(Math.max(1, r.days - 8)) : null,
          producedAt: done ? daysAgo(Math.max(1, r.days - 14)) : null,
          producedById: done ? u.id : null,
          producedBatchKeys: done ? [batch(ri + 2)] : [],
          notifiedAt: done ? daysAgo(Math.max(1, r.days - 14)) : null,
          notifiedVia: done ? "EMAIL" : null,
          cancelledAt: r.status === "CANCELLED" ? daysAgo(Math.max(1, r.days - 5)) : null,
          plannedSlabs: short,
          plannedHours: r.hours,
          cleaningHours: r.cleanH,
          shade: r.shade,
          createdAt: daysAgo(r.days),
        };
      }),
      skipDuplicates: true,
    });
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }

  REQUESTS.forEach((r, ri) => {
    if (!r.order) return;
    const u = who(ri + 1);
    eventRows.push({
      id: `${r.order}-ev-p${ri}`,
      orderId: r.order,
      kind: r.status === "PRODUCED" ? "production_produced" : "production_requested",
      note: `${design(r.d)} ${r.t} — ${r.req - r.avail} slabs short`,
      byId: u.id,
      byName: u.name,
      at: daysAgo(r.days),
    });
  });

  // ── 7. the log (written last: holds and requests add to it) ──────────────
  try {
    await db.commercialOrderEvent.createMany({ data: eventRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }

  // ── 8. the counters, so the next document carries on from here ───────────
  try {
    await db.commercialSequence.createMany({
      data: [
        { key: `ORD:${FY}`, nextValue: BigInt(ORDERS.length + 1), updatedAt: daysAgo(1) },
        { key: `ENQ:${FY}`, nextValue: BigInt(ENQUIRIES.length + 1), updatedAt: daysAgo(1) },
      ],
      skipDuplicates: true,
    });
  } catch (e) {
    console.warn("  [commercial] skipped:", (e as Error).message);
  }
}
