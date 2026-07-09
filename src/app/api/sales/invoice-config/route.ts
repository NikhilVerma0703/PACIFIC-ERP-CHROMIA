/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET  /api/sales/invoice-config?type=QUARTZ|GRANITE
 *   → Returns latest saved invoice config for that factory.
 *     If never saved, returns built-in defaults for that factory.
 *
 * POST /api/sales/invoice-config
 *   Body: { type: "QUARTZ"|"GRANITE", config: {...} }
 *   → Saves config as the new default. Next order pre-fills from this.
 *   → Accessible to COMMERCIAL and SALES_ADMIN only.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

// ── Defaults ─────────────────────────────────────────────────────────────────
// These are the first-time seeds — once saved they get replaced by user edits.

export const QUARTZ_DEFAULTS = {
  // Company header
  companyName:        "Pacific Engineered Surfaces Private Limited",
  companyAddress:     "SY.NO.73/2B, NALLAGANAKOTAPALLI VILLAGE, N.H.7,\nHOSUR, Krishnagiri,\nHosur - 635 117\nTamilnadu, India",
  iecCode:            "IEC AALCP2750N",
  gstin:              "33AALCP2750N1Z3",
  stateCode:          "33",
  districtCode:       "577",
  tinNo:              "",
  cstNo:              "",
  is100EOU:           false,
  religiousHeader:    "Sree Hari Om",
  hsnCode:            "68101990",
  productDescription: "Artificial Quartz Slabs",
  unit:               "SQFT",
  signatureLine:      "For Pacific Engineered Surfaces Pvt Ltd",
  // Jurisdictional office
  jurisdictionalOfficeAddress: "OFFICE OF THE ASSISTANT COMMISSIONER OF CUSTOMS, CUSTOMS PREVENTIVE UNIT,\n21B, RAAGAVIS CENTER, I-FLOOR, NETHAJI NAGAR, NANJUNDAPURAM MAIN ROAD,\nRAMANATHAPURAM, COIMBATORE-641045.",
  // Bank details
  bankName:           "Kotak Mahindra Bank Limited",
  bankAddress:        "10/7, Umiya Landmark, Lavelle Road,\nNext to Chancery Hotel, Bangalore 560001\nKarnataka, India",
  adCode:             "0180038-8400009",
  accountNo:          "3214292773",
  swiftCode:          "KKBKINBBXXX",
  // Routing bank
  routingBankName:    "The Bank of New York Mellon",
  routingBankAddress: "No.1, Wall St. New York, NY 10015",
  routingBankSwift:   "IRVTUS3NXXX",
  routingBankNostro:  "",
  // Legal footer (Quartz has none beyond standard declaration)
  legalFooter:        "",
  // Per-order charge defaults (pre-fill from last used)
  oceanFreight:       "",
  packingCharges:     "",
  insurancePct:       "0.00",
  discountAmount:     "",
};

export const GRANITE_DEFAULTS = {
  companyName:        "Pacific Granites (India) Pvt. Ltd.",
  companyAddress:     "Sy. No. 293/2, Nallaganakothapalli Village,\nKonerupalli Union, Shoolagiri Block, Krishnagiri Dist.\nHosur - 635 117\nTamilnadu, India",
  iecCode:            "IEC 3811000012",
  gstin:              "33AAFCP5374A1ZQ",
  stateCode:          "33",
  districtCode:       "577",
  tinNo:              "33463324368",
  cstNo:              "1046169/20.09.2010",
  is100EOU:           true,
  religiousHeader:    "Sree Hari Om",
  hsnCode:            "68022390",
  productDescription: "Polished & River Finish Granite Random Slabs",
  unit:               "SQM",
  signatureLine:      "For Pacific Granites (India) Pvt Ltd.",
  jurisdictionalOfficeAddress: "OFFICE OF THE ASSISTANT COMMISSIONER OF CUSTOMS, CUSTOMS PREVENTIVE UNIT,\n21B, RAAGAVIS CENTER, I-FLOOR, NETHAJI NAGAR, NANJUNDAPURAM MAIN ROAD,\nRAMANATHAPURAM, COIMBATORE-641045.",
  bankName:           "Kotak Mahindra Bank Limited",
  bankAddress:        "10/7, Umiya Landmark, Lavelle Road,\nNext to Chancery Hotel, Bangalore 560001\nKarnataka, India",
  adCode:             "0180038-8400009",
  accountNo:          "8711541164",
  swiftCode:          "KKBKINBBXXX",
  routingBankName:    "Standard Chartered Bank, Frankfurt, Germany",
  routingBankAddress: "",
  routingBankSwift:   "SCBLDEFXXXX",
  routingBankNostro:  "500006901",
  legalFooter:        `The Exporter - INREX3811000012EC033 Dated 02.08.2018 of the Products Covered by this document declares that, except where otherwise clearly Indicated, these products are of Indian preferential Origin according to rules of Origin of the Generalised System of Preferences of the European Union and that the Origin Criterion met is "P"

"Supply Meant For Export Under LUT", No 95/2017-18 dated 03.08.2017 Vide File No. IV/16/19/2017-LUT-Part-I LUT Furnished Under Rule 96A Of CGST Rules, 2017 For Export Of Goods Without Payment Of IGST.

Container despatched under Self Sealing permission letter - Commissioner's office letter NO. :VIII/48/11/2017-CUS.Pol Dated 17.11.2017 And Self Sealing done as per Circular no. 026/2017-Customs Dated 36/2017 (Customs)/28.08.2017, 41/2017 / 30.10.2017 & 44/2017 / 18.11.2017. The ARN No.AD330326066221H Dt:23/03/2026`,
  oceanFreight:       "",
  packingCharges:     "",
  insurancePct:       "0.00",
  discountAmount:     "",
};

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const type = new URL(req.url).searchParams.get("type") ?? "QUARTZ";
  const col  = type === "GRANITE" ? "invoice_config_granite" : "invoice_config_quartz";

  const rows = await db.$queryRawUnsafe(
    `SELECT ${col} AS config FROM sales_config WHERE id = 'global'`
  ) as any[];

  const saved = rows[0]?.config;
  const defaults = type === "GRANITE" ? GRANITE_DEFAULTS : QUARTZ_DEFAULTS;

  // Merge: saved values override defaults (so new keys added to defaults still appear)
  const config = saved && Object.keys(saved).length > 0
    ? { ...defaults, ...saved }
    : defaults;

  return NextResponse.json({ type, config });
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  if (salesRole !== "SALES_ADMIN" && salesRole !== "COMMERCIAL") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { type, config } = await req.json() as { type: string; config: Record<string, any> };
  if (type !== "QUARTZ" && type !== "GRANITE") {
    return NextResponse.json({ error: "type must be QUARTZ or GRANITE" }, { status: 400 });
  }

  const col = type === "GRANITE" ? "invoice_config_granite" : "invoice_config_quartz";

  // Upsert global sales_config row, updating the right column
  await db.$queryRawUnsafe(
    `INSERT INTO sales_config (id, ${col})
     VALUES ('global', $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET ${col} = $1::jsonb`,
    JSON.stringify(config)
  );

  return NextResponse.json({ ok: true, type });
}
