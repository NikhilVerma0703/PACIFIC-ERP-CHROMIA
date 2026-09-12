// Module settings — the PURE defaults and the merge. The database row
// (commercial_setting id 'global') holds overrides only; loadSettings() in
// ./settings lays them over these. Every value here was read off a real
// document on 2026-09-05 (the 1404 PI, the JB Homes DTA invoice, the PGI
// delivery challan, the CIOT export workbook) or off the owner's answers.
import type { NumberingSpec } from "./numbering.ts";
import {
  EAN13_LABEL_MAGNIFICATION, EDGE_LABEL_CLEARANCE_MM, EDGE_LABEL_MARGIN_MM,
  EDGE_LABEL_DIGITS_MM, EDGE_LABEL_MIN_BAR_MM,
} from "./barcode.ts";

export interface BankDetails {
  name: string;
  branch: string;
  address: string;
  accountNo: string;
  ifsc: string;
  swift: string;
  adCode?: string;
  routingBank?: string;
  routingSwift?: string;
}

export interface CompanyMaster {
  legalName: string;          // as on the PI
  shortName: string;          // as on the DTA / challan
  addressLines: string[];
  gstin: string;
  pan: string;
  iec: string;
  tan: string;
  stateCode: string;
  districtCode: string;
  rbiCode: string;
  locationCode: string;
  customsOffice: string;      // "Jurisdictional Central Excise Division Office Address"
  commissionerate: string;
  division: string;
  range: string;
  lutText: string;
  hsnQuartz: string;
  hsnStand: string;
  /** Other registrations the export documents may be issued under, chosen
   *  from a dropdown that defaults to `gstin` (answer 21). One line each,
   *  "Label | GSTIN", because the settings screen and its validator handle
   *  lists of lines and nothing richer; gstinChoices() below parses them. */
  alternateGstins: string[];
  email: string;
  phone: string;
}

/**
 * The four numbers the barcode label pasted on the EDGE of a piece is laid out
 * from (round four, answer 3), plus the magnification it is drawn at.
 *
 * WHY THESE ARE SETTINGS AND THE REST OF THE GEOMETRY IS NOT. Everything else
 * about an EAN-13 — the 95 modules, the 0.33 mm nominal, the quiet zones, the
 * 22.85 mm nominal bar height — is the standard and is not ours to move; it
 * lives in lib/commercial/barcode.ts as constants. These five are OURS: how
 * much stone we leave bare above and below the sticker, how much white paper
 * sits inside it, how tall the human-readable line is, and how short a bar we
 * are willing to print before refusing. They are the ones a fussy scanner or a
 * different glue actually changes, and changing them should not need a deploy.
 *
 * The defaults ARE barcode.ts's constants, imported rather than retyped, so
 * the shipped label is exactly the one edgeLabelLayout lays out and the two
 * cannot drift apart.
 */
export interface EdgeLabelSettings {
  /** Of the 0.33 mm nominal module. The symbol is only specified between 0.80
   *  and 2.00 and the label's LENGTH is free, so there is nothing to be bought
   *  by going below 1.50 — the height is what gets cut instead. */
  magnification: number;
  /** Stone left bare above and below the label on a 20 mm edge. */
  clearanceMm: number;
  /** White paper between the edge of the label and anything printed on it. */
  marginMm: number;
  /** The band the thirteen human-readable digits get. */
  digitsMm: number;
  /** Bars shorter than this are refused rather than printed. */
  minBarMm: number;
}

export interface CommercialSettings {
  holdDays: number;
  /** 0 = a PI never expires (answer 24). Kept for the day that changes. */
  piValidityDays: number;
  numbering: {
    /** The order's own, internal number. */
    order: NumberingSpec;
    /** The customer-facing PI number — its OWN counter since answer 24: a
     *  revision is a new number and the old one is cancelled, so it cannot be
     *  the order number any more. */
    proforma: NumberingSpec;
    enquiry: NumberingSpec;
    exportInvoice: NumberingSpec;
    dtaInvoice: NumberingSpec;
    challan: NumberingSpec;
    packingList: NumberingSpec;
  };
  /** The unit a new packing list prints in (answer 17). */
  measurementUnitDefault: "cm" | "in";
  /** Cleaning between production runs (answer 13). `abruptDropL` is answer
   *  14 in numbers: a changeover counts as abrupt when the previous design
   *  is at or below `darkMaxL` and the next is at or above `lightMinL` —
   *  "sudden very dark like Alabaster Noir, to super white". */
  planning: { cleaningHoursDefault: number; cleaningHoursAbrupt: number; darkMaxL: number; lightMinL: number };
  /** Answer 11: the truck leaves when the advance RECEIVED reaches this share
   *  of the order, unless the order carries its own percentage or the manager
   *  waives it (answer 12). Two defaults because the two trades differ: the
   *  domestic terms on file read "100% Advance Payment". */
  dispatch: { advancePctDomestic: number; advancePctExport: number };
  company: CompanyMaster;
  banks: { export: BankDetails; domestic: BankDetails };
  defaults: {
    portOfLoading: string;
    preCarriageBy: string;
    countryOfOrigin: string;
    exportPaymentTerms: string;
    domesticDeliveryTerms: string;
    domesticPaymentTerms: string;
    unitExport: string;         // Square Foot
    unitDomestic: string;       // SQFT
  };
  texts: {
    piDeclaration: string;
    dtaDeclaration: string;
    noReturn: string;
    eoe: string;
    challanNote: string;
    challanApprox: string;
  };
  /** The barcode labels. Only the EDGE label is tunable: the 100 × 70 mm crate
   *  label is cut to a sleeve on a wooden crate and is not a size anybody here
   *  chooses. */
  labels: { edge: EdgeLabelSettings };
  /** alwaysIgst (answer 22): domestic is IGST whatever the buyer's state. */
  tax: { igstRate: number; cgstRate: number; sgstRate: number; supplierStateCode: string; alwaysIgst: boolean };
  /** telegramPrivate: send to TELEGRAM_COMMERCIAL_CHAT_ID (one person) rather
   *  than the plant group. mailFromCommercialLogin: send as the Commercial
   *  login's own SMTP when it has one. Both answer 13. */
  notify: { telegram: boolean; telegramPrivate: boolean; mail: boolean; mailFromCommercialLogin: boolean; mailTo: string[] };
}

export const DEFAULT_SETTINGS: CommercialSettings = {
  holdDays: 5,                        // owner, 2026-09-05
  piValidityDays: 0,                  // answer 24: valid forever
  // EVERY series carries an N (2026-09-07 answer 8: "definitively different
  // and identifiable" from the old Tally numbers) and FOUR digits of zero
  // padding: the owner chose N0001 over N1 on 2026-09-08 (round two, answer
  // 7). Counters start at 1 by design; nothing is aligned with Tally (answer
  // 4). The PI resets each financial year (answer 5); the export invoice runs
  // on across years and everything else resets (round two, answer 9).
  numbering: {
    order:         { key: "ORD",       template: "ORD/{fy}/N{seq:4}",       perFy: true },
    proforma:      { key: "SAL-ORD",   template: "SAL-ORD/{fy}/N{seq:4}",   perFy: true },
    enquiry:       { key: "ENQ",       template: "ENQ/{fy}/N{seq:4}",       perFy: true },
    exportInvoice: { key: "PESPL-EXP", template: "PESPL/N{seq:4}",          perFy: false },
    dtaInvoice:    { key: "PESPL-DTA", template: "PESPL/N{seq:4}/{fy}",     perFy: true },
    challan:       { key: "PESPL-DC",  template: "PESPL/DC/N{seq:4}/{yy}",  perFy: true },
    packingList:   { key: "PL",        template: "PL/{fy}/N{seq:4}",        perFy: true },
  },
  measurementUnitDefault: "cm",       // answer 17, reading recorded in DECISIONS.md
  planning: { cleaningHoursDefault: 3, cleaningHoursAbrupt: 6, darkMaxL: 30, lightMinL: 75 },   // answers 13, 14
  dispatch: { advancePctDomestic: 100, advancePctExport: 30 },     // answer 11
  company: {
    legalName: "Pacific Engineered Surfaces Private Limited",
    shortName: "Pacific Engineered Surfaces Pvt Ltd",
    addressLines: [
      "SY.NO.73/2B, Nallaganakotapalli Village, N.H.7,",
      "Hosur, Krishnagiri, Tamil Nadu - 635 117, India",
    ],
    gstin: "33AALCP2750N1Z3",
    pan: "AALCP2750N",
    iec: "AALCP2750N",
    tan: "BLRP25273D",
    stateCode: "33",
    districtCode: "577",
    rbiCode: "678",
    locationCode: "XP0605",
    customsOffice: "OFFICE OF THE ASSISTANT COMMISSIONER OF CUSTOMS, CUSTOMS PREVENTIVE UNIT, 21B, RAAGAVIS CENTER, I-FLOOR, NETHAJI NAGAR, NANJUNDAPURAM MAIN ROAD, RAMANATHAPURAM, COIMBATORE-641045.",
    commissionerate: "COMMISSIONER OF CUSTOMS (PREVENTIVE), TRICHY",
    division: "CBE - COIMBATORE",
    range: "N/A",
    lutText: "\"Supply Meant For Export Under LUT\", No AD330326017058D/2026-27 dated 06/03/2026 Vide File No. LUT Furnished Under Rule 96A Of CGST Rules, 2017 For Export Of Goods Without Payment Of IGST.",
    hsnQuartz: "68101990",
    hsnStand: "73089050",
    // The sister company's registration, which the old export template carried
    // under the PESPL name. Offered in the dropdown; never the default.
    alternateGstins: ["Pacific Granites (India) Pvt Ltd | 33AAFCP5374A1ZQ"],
    email: "customs@pacific-surfaces.com",
    phone: "+91 8870008798",
  },
  banks: {
    export: {
      name: "Kotak Mahindra Bank Limited",
      branch: "Lavelle Road, Bangalore",
      address: "10/7, Umiya Landmark, Lavelle Road, Next to Chancery Hotel, Bangalore 560001 Karnataka, India",
      accountNo: "3214292773",
      ifsc: "KKBK0000422",
      swift: "KKBKINBBXXX",
      adCode: "0180038-8400009",
      routingBank: "The Bank of Newyork Mellon, No.1, Wall St. Newyork, NY 10015",
      routingSwift: "IRVTUS3NXXX",
    },
    domestic: {
      name: "ICICI Bank",
      branch: "R.T Nagar Main Road",
      address: "5, PT Colony, R.T Nagar Main Road, Bangalore - 560032",
      accountNo: "020405012473",
      ifsc: "ICIC0000204",
      swift: "ICICINBBCTS",
    },
  },
  defaults: {
    portOfLoading: "CHENNAI",
    preCarriageBy: "By Road",
    countryOfOrigin: "India",
    exportPaymentTerms: "",
    domesticDeliveryTerms: "Ex-Factory Without Packing",
    domesticPaymentTerms: "100% Advance Payment",
    unitExport: "Square Foot",
    unitDomestic: "SQFT",
  },
  texts: {
    piDeclaration: "We certify that the above goods are of Indian Origin and we also declare that this invoice shows the actual price of the Goods dispatched that all particulars are true and correct.",
    dtaDeclaration: "Certified that the particulars given above are true and correct and amount indicated in the Invoice are the price actually charged and thus there is no flow of additional consideration directly from the buyer.",
    noReturn: "Goods once sold will not be taken back or exchanged.",
    eoe: "E. & O. E",
    challanNote: "Note: Please note that these items are for display purposes only and not for sale",
    challanApprox: "Amount Declared is approximate value of the goods",
  },
  // Round four, answer 3: the arithmetic of these five is in barcode.ts and
  // the reasoning in DECISIONS-4.md. On a 20 mm edge they come to a label
  // 18.0 mm tall — 1.0 margin, 13.4 of bars, 2.6 of digits, 1.0 margin — and
  // 58.0 mm long, with the bars at 59% of their nominal height, deliberately.
  labels: {
    edge: {
      magnification: EAN13_LABEL_MAGNIFICATION,
      clearanceMm: EDGE_LABEL_CLEARANCE_MM,
      marginMm: EDGE_LABEL_MARGIN_MM,
      digitsMm: EDGE_LABEL_DIGITS_MM,
      minBarMm: EDGE_LABEL_MIN_BAR_MM,
    },
  },
  tax: { igstRate: 18, cgstRate: 9, sgstRate: 9, supplierStateCode: "33", alwaysIgst: true },   // answer 22
  // 2026-09-07 answer 13 asked for a mail from Santosh's ID and a private
  // Telegram; round two settles both. Telegram is OFF — "let's leave Telegram
  // for now" (answer 5). Mail is ON to a plain recipient (answer 4) and will
  // leave from the ERP's own account until Santosh's SMTP is entered on his
  // user, which the owner is doing at the end (answer 3). Until then the send
  // degrades silently and the request row records notifiedVia = planning-page.
  notify: { telegram: false, telegramPrivate: true, mail: true, mailFromCommercialLogin: true, mailTo: ["vmundra@thepacific.group"] },
};

/** One registration the documents may be issued under. */
export interface GstinChoice { label: string; gstin: string }

/** "Label | GSTIN" → a choice; a bare GSTIN is labelled by itself. Null when
 *  the line carries nothing shaped like a GSTIN, which the settings validator
 *  refuses (leafIssue) so the dropdown never offers a typo. */
export function parseGstinLine(line: unknown): GstinChoice | null {
  const s = String(line ?? "").trim();
  if (!s) return null;
  const bar = s.lastIndexOf("|");
  const label = (bar === -1 ? "" : s.slice(0, bar)).trim();
  const gstin = (bar === -1 ? s : s.slice(bar + 1)).trim().toUpperCase();
  if (!/^\d{2}[A-Z0-9]{13}$/.test(gstin)) return null;
  return { label: label || gstin, gstin };
}

/** The GSTIN dropdown (answer 21): the company's own registration first and
 *  by default, then every well-formed alternate line, duplicates dropped. */
export function gstinChoices(company: Pick<CompanyMaster, "legalName" | "gstin" | "alternateGstins">): GstinChoice[] {
  const out: GstinChoice[] = [{ label: company.legalName, gstin: company.gstin }];
  for (const line of company.alternateGstins ?? []) {
    const c = parseGstinLine(line);
    if (c && !out.some((x) => x.gstin === c.gstin)) out.push(c);
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Overrides over defaults, section by section, any depth. Arrays replace
 *  wholesale (an address is edited as a block, not line by line); scalars of
 *  the wrong type are ignored so a bad row cannot turn holdDays into "five". */
export function mergeSettings(base: CommercialSettings, overrides: unknown): CommercialSettings {
  if (!isPlainObject(overrides)) return base;
  const walk = (b: unknown, o: unknown): unknown => {
    if (isPlainObject(b) && isPlainObject(o)) {
      const out: Record<string, unknown> = { ...b };
      for (const k of Object.keys(o)) {
        if (k in b) out[k] = walk((b as Record<string, unknown>)[k], o[k]);
      }
      return out;
    }
    if (Array.isArray(b)) return Array.isArray(o) ? o : b;
    if (typeof b === "number") return typeof o === "number" && Number.isFinite(o) ? o : b;
    if (typeof b === "boolean") return typeof o === "boolean" ? o : b;
    if (typeof b === "string") return typeof o === "string" ? o : b;
    return b;
  };
  return walk(base, overrides) as CommercialSettings;
}

export type NumberingKind = keyof CommercialSettings["numbering"];
export const NUMBERING_KINDS: NumberingKind[] = ["order", "proforma", "enquiry", "exportInvoice", "dtaInvoice", "challan", "packingList"];
