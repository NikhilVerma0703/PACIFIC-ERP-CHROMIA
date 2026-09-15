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

/**
 * The ACH route into an American account, which is a DIFFERENT ROUTE with a
 * DIFFERENT ACCOUNT NUMBER from the wire route above it, not a second spelling
 * of the same one (Monolith's bank sheet, 2026-09-15).
 *
 * WHY IT IS ITS OWN SHAPE AND NOT THREE MORE FIELDS ON BankDetails. A payer
 * choosing ACH must use the nine-digit routing number and the ACH-only account
 * number TOGETHER; a payer wiring must use the SWIFT and the ordinary account
 * number together. Mixing one line from each is the whole failure mode this
 * group of fields exists to prevent — a wire sent to the ACH account number
 * bounces days later at the correspondent bank. Keeping the route in its own
 * object means the document can print it as its own labelled block and there
 * is nowhere for a line to be read out of the wrong route.
 *
 * Pacific's two accounts have no ACH route — there is no such thing on an
 * Indian account — so both simply leave it off.
 */
export interface AchRoute {
  /** The intermediary bank the ACH is routed through, as the sheet names it. */
  bank: string;
  /** The ABA routing number, as printed on the sheet (021-000-018). */
  routingNo: string;
  /** The account number ACH — and ONLY ACH — is sent to. */
  accountNo: string;
}

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
  /**
   * The beneficiary's own account AT the correspondent bank, which the wire
   * has to name as well as the correspondent's SWIFT. Kotak's sheet gives no
   * such number and Kotak's block therefore prints none; Monolith's does
   * (8900676973), and a wire that omits it is returned. Optional because the
   * two Indian accounts do not have one — not because it is decorative.
   */
  routingAccountNo?: string;
  /** The ACH route, on the accounts that have one. See AchRoute. */
  ach?: AchRoute;
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
 * WHICH OF THE GROUP'S COMPANIES IS SELLING — the named set the order's
 * seller_key chooses from (owner, 2026-09-15; scripts/0085).
 *
 * Until today the module knew one seller and never asked: Pacific Engineered
 * Surfaces Private Limited, an Indian exporter, whose identity is the company
 * master above and whose accounts are `banks` below. A second company now
 * sells — MONOLITH SURFACES INC, the group's US subsidiary, selling to a US
 * buyer inside the United States — and the owner asked for a genuine US
 * invoice rather than the Indian one with a different name at the top.
 *
 * PACIFIC HAS NO IDENTITY AND NO BANK OF ITS OWN ON THIS LIST, AND THAT IS
 * THE POINT. Its entry carries the label the dropdown shows and the one fact
 * that decides the layout, and nothing else: its legal name, its address, its
 * GSTIN, its RBI code, its customs office and its two accounts stay in the
 * company master and in `banks`, where they have always been and where there
 * is exactly ONE copy of each. Repeating them here would mean an admin
 * correcting the company address in Settings corrected it for every document
 * EXCEPT the proforma, which is precisely the bug a "seller" list invites. So
 * the default seller resolves to the company master by its KEY, in one place
 * (proforma-rules.sellerIdentity), and every Pacific PI — every one already
 * issued and every one issued from now on — is built from the same values it
 * always was.
 */
export interface SellingEntity {
  /** What the order header's seller dropdown says. A screen string: it prints
   *  on no document, so it may read however is clearest to the desk. */
  label: string;
  /**
   * THE ONE FACT THAT DECIDES THE LAYOUT. An Indian exporter's proforma prints
   * the Indian block — the GSTIN, the IEC, the RBI code number, the
   * jurisdictional customs office, the AD code on the bank, and the "goods of
   * Indian Origin" declaration. None of that is true of a US company selling
   * inside the US, so for a seller that is not an Indian exporter every one of
   * those is ABSENT from the printed paper — absent, not an empty labelled box
   * with nothing after the colon.
   */
  indianExporter: boolean;
  /** The identity it prints. Absent on the default seller, which prints the
   *  company master; present and complete on every other. */
  legalName?: string;
  addressLines?: string[];
  country?: string;
  /**
   * Blank, deliberately, where the owner has not given one: Monolith's bank
   * sheet carries no telephone and no EIN, and inventing either onto a
   * customer's invoice is worse than leaving it off. They are present as empty
   * strings rather than missing keys so that an admin can fill them in from
   * Settings the day they exist — mergeSettings only overrides keys the
   * defaults already carry — and the layout prints no box for a blank.
   */
  email?: string;
  phone?: string;
  /** The single account it is paid into. Absent on the default seller, which
   *  is paid into `banks` by the order's kind (answer 23). */
  bank?: BankDetails;
}

/** The seller the order's NULL seller_key means, and the one every proforma
 *  frozen before 2026-09-15 is. Named once; the code asks for it by this name
 *  rather than spelling "PESPL" at each decision. */
export const DEFAULT_SELLER_KEY = "PESPL";

/** The named set. A key not on this list is not a seller, and is read as the
 *  default rather than as an error — see sellerEntity. */
export const SELLER_KEYS = ["PESPL", "MONOLITH"] as const;
export type SellerKey = (typeof SELLER_KEYS)[number];

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
    /** THE SAME DOCUMENT FROM THE OTHER COMPANY. A Monolith proforma is a US
     *  company's own paper, so it cannot take a number out of Pacific's series:
     *  two legal entities sharing one run of invoice numbers leaves each set of
     *  books with gaps it cannot explain. Plain and without a financial year,
     *  which is how a US company numbers (the owner, 2026-09-15), and starting
     *  at 1001 because a first invoice numbered 0001 tells a customer exactly
     *  how much business the seller has done. */
    monolithProforma: NumberingSpec;
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
  /** The group companies that may sell an order (owner, 2026-09-15;
   *  scripts/0085). Keyed by commercial_order.seller_key; SELLER_KEYS is the
   *  whole set and DEFAULT_SELLER_KEY is what a NULL column means. */
  sellers: Record<SellerKey, SellingEntity>;
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
    monolithProforma: { key: "MSI-INV", template: "INV-{seq}",               perFy: false },
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
  // THE SELLING ENTITIES (owner, 2026-09-15). Pacific carries a label and the
  // Indian-exporter flag and NOTHING ELSE, on purpose: see SellingEntity.
  sellers: {
    PESPL: {
      label: "Pacific Engineered Surfaces Private Limited (India)",
      indianExporter: true,
    },
    // MONOLITH SURFACES INC, the group's US subsidiary, selling to a US buyer
    // inside the United States: "Nothing related to pacific surfaces. We are
    // selling it to monolith (which is our company) then they are selling it
    // to someone in US." Every value below is off the owner's own bank sheet
    // and his address answer of 2026-09-15. No EIN and no telephone were
    // given; they are blank rather than guessed, and nothing prints a box for
    // a blank.
    MONOLITH: {
      label: "Monolith Surfaces Inc (USA)",
      indianExporter: false,
      legalName: "MONOLITH SURFACES INC",
      addressLines: [
        "25298 FM 2978 Rd, Unit A,",
        "Tomball, TX 77375, USA",
      ],
      country: "USA",
      email: "",
      phone: "",
      bank: {
        // The branch is part of the name a payer must write, so it is in the
        // name: the PI prints the bank's name and its address and nothing
        // else, and "ICICI Bank Limited" alone would send a wire to the wrong
        // ICICI. `branch` is kept beside it for any document that wants the
        // two apart.
        name: "ICICI Bank Limited, New York Branch",
        branch: "New York Branch",
        address: "575 Fifth Avenue, Suite 2600, New York, NY 10017, USA",
        accountNo: "840000004202",
        // An IFSC is an Indian code and a US account has none. Blank, and the
        // proforma prints no IFSC cell at all rather than an empty one.
        ifsc: "",
        swift: "ICICUS3N",
        // The WIRE route: through Bank of New York Mellon, naming both the
        // correspondent's SWIFT and the beneficiary's account with it.
        routingBank: "Bank of New York Mellon, New York",
        routingSwift: "IRVTUS3N",
        routingAccountNo: "8900676973",
        // The ACH route: the same intermediary, its own routing number, and an
        // account number that is NOT the one above and is for ACH only.
        ach: {
          bank: "Bank of New York Mellon",
          routingNo: "021-000-018",
          accountNo: "30000840000004202",
        },
      },
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

/**
 * A seller key off an order row or a request body, or null when it names no
 * seller. Null is not a failure: the column is nullable and NULL is the
 * default seller (scripts/0085), so a caller that sends nothing, sends a
 * blank, or sends a key this build does not know gets Pacific — which is what
 * every order raised before today gets, and what the whole module did before
 * there was a second company at all.
 */
export function parseSellerKey(raw: unknown): SellerKey | null {
  const s = String(raw ?? "").trim().toUpperCase();
  return (SELLER_KEYS as readonly string[]).includes(s) ? (s as SellerKey) : null;
}

/**
 * The entity a key names, and the key it actually resolved to — always a real
 * one, so callers never carry a "maybe this key exists" doubt into the
 * document. An unknown key falls back to the default seller rather than
 * throwing, for the same reason gstinChoiceFor does: a PI must print.
 *
 * The record itself can never go missing — mergeSettings copies the defaults
 * and only overwrites keys they already carry, so a settings row can correct
 * Monolith's address or its account number but can neither delete the entity
 * nor invent one. That is why nothing downstream has to handle a hole here.
 */
export function sellerEntity(settings: CommercialSettings, key: unknown): { key: SellerKey; entity: SellingEntity } {
  const k = parseSellerKey(key) ?? (DEFAULT_SELLER_KEY as SellerKey);
  // THE WHOLE MAP IS RESOLVED ONCE, and that is the fix for a guard that used
  // to contradict itself: the lookup optional-chained `settings.sellers?.[k]`,
  // declaring the map might be absent, and then read
  // `settings.sellers[DEFAULT_SELLER_KEY]` for its fallback without the same
  // guard — so a settings object without `sellers` threw on precisely the case
  // the `?.` was there for. Today nothing reaches it that way (loadSettings
  // merges over DEFAULT_SETTINGS, which has the map), but a hand-built
  // settings object in a test or a stale row from an older deploy would, and a
  // guard that only works when it is not needed is worse than no guard.
  const sellers = settings.sellers ?? DEFAULT_SETTINGS.sellers;
  const entity = sellers[k] ?? sellers[DEFAULT_SELLER_KEY as SellerKey];
  return { key: k, entity };
}

/** The seller dropdown on the order header: every entity, the default first. */
export function sellerChoices(settings: CommercialSettings): Array<{ key: SellerKey; label: string }> {
  return SELLER_KEYS.map((key) => ({ key, label: sellerEntity(settings, key).entity.label }));
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
export const NUMBERING_KINDS: NumberingKind[] = ["order", "proforma", "monolithProforma", "enquiry", "exportInvoice", "dtaInvoice", "challan", "packingList"];

/** Which counter a proforma draws on: the seller's own, so Pacific's series and
 *  Monolith's never interleave. Absent or unknown seller means Pacific, the
 *  same default every other seller-aware rule takes. */
export function proformaNumberingKind(sellerKey: unknown): NumberingKind {
  return parseSellerKey(sellerKey) === "MONOLITH" ? "monolithProforma" : "proforma";
}
