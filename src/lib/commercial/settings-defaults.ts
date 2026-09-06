// Module settings — the PURE defaults and the merge. The database row
// (commercial_setting id 'global') holds overrides only; loadSettings() in
// ./settings lays them over these. Every value here was read off a real
// document on 2026-09-05 (the 1404 PI, the JB Homes DTA invoice, the PGI
// delivery challan, the CIOT export workbook) or off the owner's answers.
import type { NumberingSpec } from "./numbering.ts";

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
  email: string;
  phone: string;
}

export interface CommercialSettings {
  holdDays: number;
  piValidityDays: number;
  numbering: {
    order: NumberingSpec;
    enquiry: NumberingSpec;
    exportInvoice: NumberingSpec;
    dtaInvoice: NumberingSpec;
    challan: NumberingSpec;
    packingList: NumberingSpec;
  };
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
  tax: { igstRate: number; cgstRate: number; sgstRate: number; supplierStateCode: string };
  notify: { telegram: boolean; mail: boolean; mailTo: string[] };
}

export const DEFAULT_SETTINGS: CommercialSettings = {
  holdDays: 5,                        // owner, 2026-09-05
  piValidityDays: 30,                 // open question 22
  numbering: {
    order:         { key: "SAL-ORD",   template: "SAL-ORD/{fy}/{seq:5}", perFy: false },
    enquiry:       { key: "ENQ",       template: "ENQ/{fy}/{seq:4}",     perFy: true },
    exportInvoice: { key: "PESPL-EXP", template: "PESPL/{seq:4}",        perFy: false },
    dtaInvoice:    { key: "PESPL-DTA", template: "PESPL/{seq:4}/{fy}",   perFy: true },
    challan:       { key: "PESPL-DC",  template: "PESPL/DC/{seq}/{yy}",  perFy: true },
    packingList:   { key: "PL",        template: "PL/{fy}/{seq:4}",      perFy: true },
  },
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
  tax: { igstRate: 18, cgstRate: 9, sgstRate: 9, supplierStateCode: "33" },
  notify: { telegram: false, mail: false, mailTo: [] },
};

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
export const NUMBERING_KINDS: NumberingKind[] = ["order", "enquiry", "exportInvoice", "dtaInvoice", "challan", "packingList"];
