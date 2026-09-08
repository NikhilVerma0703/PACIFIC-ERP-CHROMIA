// The export document workbook — WHERE EVERY VALUE GOES.
//
// PURE and import-free: this file is the map of templates/commercial/
// export-docs-template.xlsx (the real CIOT workbook, 14 sheets, 1,058 formulas)
// and nothing else. ./build.ts does the writing; tests/commercialExportWorkbook
// .test.ts checks this map against the actual template file.
//
// ─────────────────────────── what the workbook is ────────────────────────────
//
// The 14 sheets are one document, not fourteen. Almost everything is a formula
// chain hanging off ONE sheet, "Invoice":
//
//   Invoice  ──►  Packing List, Cust-PL, Cust-Inv, Cust-Inv -INR, Invoice (R),
//                 Gatepass, ANNEXURE –C1, ANNEX –D, VGM, SOP
//   Measmt List ──► Invoice (the goods lines read the measurement summary)
//   PL-852   ──►  Measmt List (per-slab detail, in the source workbook)
//
// So there are only two kinds of cell worth writing:
//
//   ROOT_CELLS   the literals the chain hangs off. Fill these and ten sheets
//                fill themselves. Most live on "Invoice"; the rest are header
//                literals somebody re-typed by hand on a sheet that does not
//                pull them (the customer code on Cust-Inv, the GSTIN on the
//                packing lists, the signatory list on ANNEXURE –C1).
//
//   the tables   the per-slab rows on "Measmt List" (SLAB_TABLE), the summary
//                block under them (SUMMARY_TABLE) and the goods lines on the
//                six invoice/packing sheets (PACKING_ROWS). These have a
//                variable number of rows, so build.ts lays them out.
//
// ──────────────────────── decisions taken here, and why ──────────────────────
//
// 1. The ERP writes SLAB DATA AS LITERALS into "Measmt List" rather than into
//    "PL-852". In the source workbook Measmt List column B..G is 300-odd
//    formulas of the form =+'PL-852'!B8, i.e. PL-852 is the typing sheet and
//    Measmt List is its transpose. The ERP already holds the slabs, so it
//    writes them once, into the sheet the invoice actually reads. PL-852 is
//    then rebuilt from the same slabs by ./build.ts writePl852 so the two
//    agree; nothing downstream depends on PL-852 any more.
//
// 2. Column H on Measmt List is AREA IN SQFT, not sqm — the sheet's own header
//    says "Area / SQFT" and the formula is =F*G/10000*10.764. Square metres
//    appear only in the summary block (H = F/10.764). The SLAB_TABLE key is
//    named `sqm` because the build contract names it that; `areaUnit` below
//    says what the cell really holds so nobody converts twice.
//
// 3. The summary block and everything under it MOVE when a shipment has more
//    slabs than the template's 60-row well. Rather than splicing rows (which
//    silently breaks merges, print areas and every cross-sheet reference),
//    build.ts writes the block at a computed row and re-points the handful of
//    cells that reference it. SUMMARY_LINKS is that handful, enumerated.
//
// 4. "Invoice (R)" is stale in the source: PESPL/1891, PI 00381, and six
//    formulas that read ='Measmt List'!#REF!. It is an OUTPUT sheet like any
//    other — build.ts fills it from the same roots and repairs the #REF!s.
//
// 5. The packing sheets print GSTIN 33AAFCP5374A1ZQ, which belongs to Pacific
//    Granites (India), while the invoice prints PESPL's 33AALCP2750N1Z3. The
//    owner settled it (answer 21): ONE registration per invoice, chosen from a
//    dropdown that defaults to PESPL's and stored in the invoice snapshot.
//    Every GSTIN cell here prints that one; an alternate prints with its
//    label beside it, where the old sheets carried the sister company's name.
//    The cells stay root cells, so the form can still override them.
//
// 6. The item code on every sheet is the design master's (answer 20,
//    commercial_design_code). Where the master has no code yet the DESIGN NAME
//    prints — never a placeholder, this is a customs document — and the
//    screen, not the paper, says a code is missing.

// ───────────────────────────── the root cell table ───────────────────────────

export type RootKind = "text" | "number" | "date";

export interface RootCell {
  /** Stable key. What commercial_export_doc_set.rootVariables is keyed by. */
  key: string;
  sheet: string;
  cell: string;
  label: string;
  kind: RootKind;
  /** Form section. The DocumentsTab renders one fieldset per group, in order. */
  group: string;
  /** Shown under the field when the cell needs explaining. */
  hint?: string;
}

export const ROOT_GROUPS: string[] = [
  "Invoice header",
  "Exporter",
  "Consignee",
  "Notify party",
  "Terms",
  "Routing",
  "Bank",
  "Goods",
  "Container & transport",
  "Amounts",
  "Weights & declarations",
  "Customer copies",
  "Packing list",
  "Slab sheet (PL-852)",
  "Annexure C1",
  "Annex D",
  "VGM",
  "SOP checklist",
];

export const ROOT_CELLS: RootCell[] = [
  // ── Invoice header ────────────────────────────────────────────────────────
  { key: "fyLabel",          sheet: "Invoice", cell: "A2",  label: "Financial year",            kind: "text", group: "Invoice header" },
  { key: "invoiceNo",        sheet: "Invoice", cell: "H4",  label: "Invoice No.",               kind: "text", group: "Invoice header" },
  { key: "invoiceDate",      sheet: "Invoice", cell: "J4",  label: "Invoice date",              kind: "date", group: "Invoice header" },
  { key: "buyerPoRef",       sheet: "Invoice", cell: "H5",  label: "Buyer's PO ref (with PI)",  kind: "text", group: "Invoice header", hint: "Printed as typed, e.g. PO-4068622 Dt: 03/07/2026 (PI-SAL-ORD/25-26/01477)" },
  { key: "iecCode",          sheet: "Invoice", cell: "H6",  label: "IEC code",                  kind: "text", group: "Invoice header" },
  { key: "salesPerson",      sheet: "Invoice", cell: "J7",  label: "Sales person",              kind: "text", group: "Invoice header" },
  { key: "exporterGstinText", sheet: "Invoice", cell: "J8", label: "Exporter GSTIN (as printed)", kind: "text", group: "Invoice header" },

  // ── Exporter block ────────────────────────────────────────────────────────
  { key: "exporterName",     sheet: "Invoice", cell: "A5",  label: "Exporter name",             kind: "text", group: "Exporter" },
  { key: "exporterLine1",    sheet: "Invoice", cell: "A6",  label: "Address line 1",            kind: "text", group: "Exporter" },
  { key: "exporterLine2",    sheet: "Invoice", cell: "A7",  label: "Address line 2",            kind: "text", group: "Exporter" },
  { key: "exporterLine3",    sheet: "Invoice", cell: "A8",  label: "Address line 3",            kind: "text", group: "Exporter" },
  { key: "exporterLine4",    sheet: "Invoice", cell: "A9",  label: "Address line 4",            kind: "text", group: "Exporter" },
  { key: "stateCodeText",    sheet: "Invoice", cell: "C8",  label: "State code",                kind: "text", group: "Exporter" },
  { key: "districtCodeText", sheet: "Invoice", cell: "C9",  label: "District code",             kind: "text", group: "Exporter" },
  { key: "customsOffice",    sheet: "Invoice", cell: "G11", label: "Jurisdictional customs office", kind: "text", group: "Exporter" },

  // ── Consignee (Invoice K8:K12 feeds the printed A12:A16) ──────────────────
  { key: "consigneeName",    sheet: "Invoice", cell: "K8",  label: "Consignee name",            kind: "text", group: "Consignee" },
  { key: "consigneeLine1",   sheet: "Invoice", cell: "K9",  label: "Address line 1",            kind: "text", group: "Consignee" },
  { key: "consigneeLine2",   sheet: "Invoice", cell: "K10", label: "Address line 2",            kind: "text", group: "Consignee" },
  { key: "consigneeCountry", sheet: "Invoice", cell: "K11", label: "Country",                   kind: "text", group: "Consignee" },
  { key: "consigneeTel",     sheet: "Invoice", cell: "K12", label: "Telephone",                 kind: "text", group: "Consignee" },

  // ── Notify party (K16 feeds A19; A20:A23 reuse the consignee lines) ───────
  { key: "notifyName",       sheet: "Invoice", cell: "K16", label: "Notify party name",         kind: "text", group: "Notify party" },
  { key: "notifyLine1",      sheet: "Invoice", cell: "K17", label: "Address line 1",            kind: "text", group: "Notify party" },
  { key: "notifyLine2",      sheet: "Invoice", cell: "K18", label: "Address line 2",            kind: "text", group: "Notify party" },
  { key: "notifyCountry",    sheet: "Invoice", cell: "K19", label: "Country",                   kind: "text", group: "Notify party" },
  { key: "notifyTel",        sheet: "Invoice", cell: "K20", label: "Telephone",                 kind: "text", group: "Notify party" },

  // ── Terms ─────────────────────────────────────────────────────────────────
  { key: "countryOfOrigin",      sheet: "Invoice", cell: "G19", label: "Country of origin",      kind: "text", group: "Terms" },
  { key: "countryOfDestination", sheet: "Invoice", cell: "I19", label: "Country of final destination", kind: "text", group: "Terms" },
  { key: "deliveryTerms",        sheet: "Invoice", cell: "H21", label: "Delivery terms",         kind: "text", group: "Terms" },
  { key: "deliveryTermsNote",    sheet: "Invoice", cell: "G22", label: "Delivery terms note",    kind: "text", group: "Terms", hint: "The long incoterm paragraph printed under Terms & Conditions." },
  { key: "paymentTerms",         sheet: "Invoice", cell: "H25", label: "Payment terms",          kind: "text", group: "Terms" },

  // ── Routing ───────────────────────────────────────────────────────────────
  { key: "preCarriageBy",    sheet: "Invoice", cell: "A29", label: "Pre-carriage by",           kind: "text", group: "Routing" },
  { key: "placeOfReceipt",   sheet: "Invoice", cell: "C29", label: "Place of receipt / port of loading", kind: "text", group: "Routing", hint: "Port of Loading (C31) and the packing lists copy this cell." },
  { key: "portOfDischarge",  sheet: "Invoice", cell: "A33", label: "Port of discharge",         kind: "text", group: "Routing", hint: "Final Destination (C33) copies this cell." },
  { key: "plPortOfDischarge", sheet: "Packing List", cell: "C26", label: "Packing list port of discharge", kind: "text", group: "Routing", hint: "The packing list carries its own value here (the template says Chennai Port, India)." },

  // ── Bank ──────────────────────────────────────────────────────────────────
  { key: "bankName",         sheet: "Invoice", cell: "G27", label: "Bank name",                 kind: "text", group: "Bank" },
  { key: "bankLine1",        sheet: "Invoice", cell: "G28", label: "Bank address line 1",       kind: "text", group: "Bank" },
  { key: "bankLine2",        sheet: "Invoice", cell: "G29", label: "Bank address line 2",       kind: "text", group: "Bank" },
  { key: "bankLine3",        sheet: "Invoice", cell: "G30", label: "Bank address line 3",       kind: "text", group: "Bank" },
  { key: "adCode",           sheet: "Invoice", cell: "I30", label: "AD code",                   kind: "text", group: "Bank" },
  { key: "bankAccountNo",    sheet: "Invoice", cell: "G31", label: "Account number",            kind: "text", group: "Bank" },
  { key: "bankSwift",        sheet: "Invoice", cell: "I31", label: "Swift code",                kind: "text", group: "Bank" },
  { key: "routingBankLine1", sheet: "Invoice", cell: "G32", label: "Routing bank line 1",       kind: "text", group: "Bank" },
  { key: "routingBankLine2", sheet: "Invoice", cell: "G33", label: "Routing bank line 2",       kind: "text", group: "Bank" },
  { key: "routingSwift",     sheet: "Invoice", cell: "I33", label: "Routing swift code",        kind: "text", group: "Bank" },

  // ── Goods ─────────────────────────────────────────────────────────────────
  { key: "hsnText",          sheet: "Invoice", cell: "A36", label: "HSN line",                  kind: "text", group: "Goods" },
  { key: "goodsDescription", sheet: "Invoice", cell: "C36", label: "Description of goods",      kind: "text", group: "Goods" },
  { key: "marksAndNos",      sheet: "Invoice", cell: "A38", label: "Marks & nos",               kind: "text", group: "Goods", hint: "e.g. 01 to 15" },
  { key: "packagesSummary",  sheet: "Invoice", cell: "B38", label: "No. of crates / boxes",     kind: "text", group: "Goods", hint: "e.g. 07 Wooden Crate(S) + 08 Sample Box" },
  // Line 1's rate. Rates for the other goods lines are not root cells — they
  // move with the line, and ./build.ts writes them from the invoice's own lines.
  { key: "ratePerSqft",      sheet: "Invoice", cell: "L38", label: "Rate per SQFT (USD)",       kind: "number", group: "Goods", hint: "The invoice rate per SQMT is this × 10.764." },

  // ── Container & transport ─────────────────────────────────────────────────
  { key: "containerNoText",  sheet: "Invoice", cell: "A51", label: "Container no.",             kind: "text", group: "Container & transport", hint: "Printed whole, e.g. Container No. TCLU 2787296" },
  { key: "linerOtlText",     sheet: "Invoice", cell: "A52", label: "Liner's OTL no.",           kind: "text", group: "Container & transport" },
  { key: "eSealText",        sheet: "Invoice", cell: "A53", label: "E-seal no.",                kind: "text", group: "Container & transport" },
  { key: "vehicleNoText",    sheet: "Invoice", cell: "A54", label: "Vehicle no.",               kind: "text", group: "Container & transport" },
  { key: "blNoText",         sheet: "Invoice", cell: "A55", label: "BL no.",                    kind: "text", group: "Container & transport" },
  { key: "sbNoText",         sheet: "Invoice", cell: "A56", label: "SB no.",                    kind: "text", group: "Container & transport" },

  // ── Amounts ───────────────────────────────────────────────────────────────
  { key: "currencyLabel",    sheet: "Invoice", cell: "D57", label: "Currency label",            kind: "text", group: "Amounts" },
  { key: "exchangeRate",     sheet: "Invoice", cell: "F57", label: "Exchange rate to INR",      kind: "number", group: "Amounts", hint: "Cust-Inv -INR multiplies every rate by this." },
  { key: "packingCharges",   sheet: "Invoice", cell: "I46", label: "Packing charges",           kind: "number", group: "Amounts" },
  { key: "insuranceCharges", sheet: "Invoice", cell: "I47", label: "Insurance to destination",  kind: "number", group: "Amounts" },
  { key: "advanceAuthText",  sheet: "Invoice", cell: "C49", label: "Advance authorisation",     kind: "text", group: "Amounts" },
  { key: "amountWordsPrefix", sheet: "Invoice", cell: "A59", label: "Amount in words — prefix", kind: "text", group: "Amounts", hint: "e.g. U.S.Dollars:" },
  { key: "amountInWords",    sheet: "Invoice", cell: "C59", label: "Amount in words",           kind: "text", group: "Amounts" },

  // ── Weights & declarations ────────────────────────────────────────────────
  { key: "grossWeightText",  sheet: "Invoice", cell: "B63", label: "Gross weight",              kind: "text", group: "Weights & declarations", hint: "e.g. 24.00 MT" },
  { key: "netWeightText",    sheet: "Invoice", cell: "B64", label: "Net weight",                kind: "text", group: "Weights & declarations" },
  { key: "signatoryLine",    sheet: "Invoice", cell: "H63", label: "Signature block",           kind: "text", group: "Weights & declarations" },
  { key: "lutText",          sheet: "Invoice", cell: "A60", label: "LUT declaration",           kind: "text", group: "Weights & declarations" },
  { key: "selfSealingText",  sheet: "Invoice", cell: "A61", label: "Self-sealing permission",   kind: "text", group: "Weights & declarations" },
  { key: "igstNote",         sheet: "Invoice", cell: "K59", label: "IGST alternative note",     kind: "text", group: "Weights & declarations", hint: "Off the print area; kept so the alternative wording is not lost." },
  { key: "declarationLine1", sheet: "Invoice", cell: "A66", label: "Declaration line 1",        kind: "text", group: "Weights & declarations" },
  { key: "declarationLine2", sheet: "Invoice", cell: "A67", label: "Declaration line 2",        kind: "text", group: "Weights & declarations" },

  // ── Customer copies (Cust-Inv / Cust-Inv -INR carry their own literals) ───
  { key: "customerCode",        sheet: "Cust-Inv",      cell: "A12", label: "Customer code",    kind: "text", group: "Customer copies", hint: "e.g. USA-041. Replaces the consignee name on the customer copies." },
  { key: "customerCountry",     sheet: "Cust-Inv",      cell: "A13", label: "Customer country", kind: "text", group: "Customer copies" },
  { key: "customerCodeInr",     sheet: "Cust-Inv -INR", cell: "A12", label: "Customer code (INR copy)", kind: "text", group: "Customer copies" },
  { key: "customerCountryInr",  sheet: "Cust-Inv -INR", cell: "A13", label: "Customer country (INR copy)", kind: "text", group: "Customer copies" },
  { key: "salesCommissionNote", sheet: "Cust-Inv",      cell: "A61", label: "Sales commission note", kind: "text", group: "Customer copies" },

  // ── Packing list header literals (typed by hand on both packing sheets) ───
  { key: "plStateCodeText",    sheet: "Packing List", cell: "C7", label: "State code",  kind: "text", group: "Packing list" },
  { key: "plDistrictCodeText", sheet: "Packing List", cell: "C8", label: "District code", kind: "text", group: "Packing list" },
  { key: "plTinNo",            sheet: "Packing List", cell: "H7", label: "TIN no.",     kind: "text", group: "Packing list" },
  { key: "plCstNo",            sheet: "Packing List", cell: "H8", label: "CST no.",     kind: "text", group: "Packing list" },
  { key: "plGstin",            sheet: "Packing List", cell: "J7", label: "GSTIN on packing list", kind: "text", group: "Packing list", hint: "Answer 21: the registration chosen on the invoice, labelled when it is not PESPL's own. The old template carried Pacific Granites' 33AAFCP5374A1ZQ here." },
  { key: "custPlTinNo",        sheet: "Cust-PL",      cell: "H7", label: "TIN no. (customer copy)",  kind: "text", group: "Packing list" },
  { key: "custPlCstNo",        sheet: "Cust-PL",      cell: "H8", label: "CST no. (customer copy)",  kind: "text", group: "Packing list" },
  { key: "custPlGstin",        sheet: "Cust-PL",      cell: "J7", label: "GSTIN (customer copy)",    kind: "text", group: "Packing list" },

  // ── PL-852 slab sheet header ──────────────────────────────────────────────
  { key: "pl852ConsigneeColour", sheet: "PL-852", cell: "C2",  label: "Consignee colour name",  kind: "text", group: "Slab sheet (PL-852)" },
  { key: "pl852PacificColour",   sheet: "PL-852", cell: "C3",  label: "Pacific colour name",    kind: "text", group: "Slab sheet (PL-852)" },
  { key: "pl852PoNo",            sheet: "PL-852", cell: "C4",  label: "PO no.",                 kind: "text", group: "Slab sheet (PL-852)" },
  { key: "pl852Ref",             sheet: "PL-852", cell: "J2",  label: "Packing list ref",       kind: "text", group: "Slab sheet (PL-852)", hint: "e.g. PL -135" },
  // PL-852's kilo columns are NOT root cells: the sheet's summary block moves
  // with the crate count, so there is no fixed cell to map. They are read off
  // the gross / net weight fields above (kgFromMt), which keeps one weight in
  // the form instead of two that can drift apart.

  // ── Annexure C1 (self-sealing examination report) ─────────────────────────
  { key: "c1CompanyName",   sheet: "ANNEXURE –C1", cell: "C8",  label: "Name of the unit",      kind: "text", group: "Annexure C1" },
  { key: "c1Iec",           sheet: "ANNEXURE –C1", cell: "C9",  label: "IEC no.",               kind: "text", group: "Annexure C1" },
  { key: "c1Gstin",         sheet: "ANNEXURE –C1", cell: "C12", label: "GSTIN",                 kind: "text", group: "Annexure C1" },
  { key: "c1FactoryLine1",  sheet: "ANNEXURE –C1", cell: "C13", label: "Factory address line 1", kind: "text", group: "Annexure C1" },
  { key: "c1FactoryLine2",  sheet: "ANNEXURE –C1", cell: "C14", label: "Factory address line 2", kind: "text", group: "Annexure C1" },
  { key: "c1FactoryLine3",  sheet: "ANNEXURE –C1", cell: "C15", label: "Factory address line 3", kind: "text", group: "Annexure C1" },
  { key: "c1FactoryLine4",  sheet: "ANNEXURE –C1", cell: "C16", label: "Factory address line 4", kind: "text", group: "Annexure C1" },
  { key: "c1ShippingBillNo", sheet: "ANNEXURE –C1", cell: "B6",  label: "Shipping bill no.",    kind: "text", group: "Annexure C1" },
  { key: "c1ShippingBillDate", sheet: "ANNEXURE –C1", cell: "D6", label: "Shipping bill date",  kind: "text", group: "Annexure C1" },
  { key: "c1BranchCode",    sheet: "ANNEXURE –C1", cell: "C10", label: "Branch code",           kind: "text", group: "Annexure C1" },
  { key: "c1Bin",           sheet: "ANNEXURE –C1", cell: "C11", label: "BIN",                   kind: "text", group: "Annexure C1" },
  { key: "c1StuffingStart", sheet: "ANNEXURE –C1", cell: "C19", label: "Stuffing — start time", kind: "text", group: "Annexure C1" },
  { key: "c1StuffingEnd",   sheet: "ANNEXURE –C1", cell: "C20", label: "Stuffing — completion time", kind: "text", group: "Annexure C1" },
  { key: "c1StuffingTaken", sheet: "ANNEXURE –C1", cell: "C21", label: "Stuffing — time taken", kind: "text", group: "Annexure C1" },
  { key: "c1ContainerSize", sheet: "ANNEXURE –C1", cell: "F39", label: "Container size",        kind: "text", group: "Annexure C1", hint: "e.g. 20 ft.in (Close Top)" },
  { key: "c1SealColourText", sheet: "ANNEXURE –C1", cell: "D43", label: "Seal colour sentence", kind: "text", group: "Annexure C1" },
  { key: "c1Signatory",     sheet: "ANNEXURE –C1", cell: "E51", label: "Signing officer",       kind: "text", group: "Annexure C1", hint: "This is the one C52 (and Annex D, VGM) picks up." },

  // ── Annex D (self-sealing intimation) ─────────────────────────────────────
  { key: "dDate",             sheet: "ANNEX –D", cell: "B7",  label: "Intimation date",         kind: "text", group: "Annex D" },
  { key: "dFacilityCircular", sheet: "ANNEX –D", cell: "A4",  label: "Facility intimation",     kind: "text", group: "Annex D" },
  { key: "dLossp",            sheet: "ANNEX –D", cell: "C18", label: "LOSSP no. and date",      kind: "text", group: "Annex D" },
  { key: "dPremisesName",     sheet: "ANNEX –D", cell: "C20", label: "Premises name",           kind: "text", group: "Annex D" },
  { key: "dPremisesLine1",    sheet: "ANNEX –D", cell: "C21", label: "Premises line 1",         kind: "text", group: "Annex D" },
  { key: "dPremisesLine2",    sheet: "ANNEX –D", cell: "C22", label: "Premises line 2",         kind: "text", group: "Annex D" },
  { key: "dPremisesLine3",    sheet: "ANNEX –D", cell: "C23", label: "Premises line 3",         kind: "text", group: "Annex D" },
  { key: "dPremisesLine4",    sheet: "ANNEX –D", cell: "C24", label: "Premises line 4",         kind: "text", group: "Annex D" },
  { key: "dIncentives",       sheet: "ANNEX –D", cell: "C33", label: "Incentives claimed",      kind: "text", group: "Annex D" },

  // ── VGM ───────────────────────────────────────────────────────────────────
  { key: "vgmCompanyName",   sheet: "VGM", cell: "B1",  label: "Shipper name",                  kind: "text", group: "VGM" },
  { key: "vgmAddressLine1",  sheet: "VGM", cell: "B3",  label: "Address line 1",                kind: "text", group: "VGM" },
  { key: "vgmAddressLine2",  sheet: "VGM", cell: "B4",  label: "Address line 2",                kind: "text", group: "VGM" },
  { key: "vgmContactLine",   sheet: "VGM", cell: "B5",  label: "Telephone and email",           kind: "text", group: "VGM" },
  { key: "vgmBookingNo",     sheet: "VGM", cell: "C10", label: "Booking no.",                   kind: "text", group: "VGM" },
  { key: "vgmSignatories",   sheet: "VGM", cell: "C13", label: "Authorised officials",          kind: "text", group: "VGM" },
  { key: "vgmDesignations",  sheet: "VGM", cell: "C14", label: "Their designations",            kind: "text", group: "VGM" },
  { key: "vgmContactNumbers", sheet: "VGM", cell: "C15", label: "24×7 contact numbers",         kind: "text", group: "VGM" },
  { key: "vgmContainerSize", sheet: "VGM", cell: "C17", label: "Container size",                kind: "text", group: "VGM" },
  { key: "vgmMaxWeight",     sheet: "VGM", cell: "C18", label: "Max permissible weight",        kind: "text", group: "VGM" },
  { key: "vgmWeighbridge",   sheet: "VGM", cell: "C19", label: "Weighbridge registration",      kind: "text", group: "VGM" },
  { key: "vgmMethod",        sheet: "VGM", cell: "C20", label: "Weighing method",               kind: "text", group: "VGM" },
  { key: "vgmCargoWeightKg", sheet: "VGM", cell: "G21", label: "Cargo weight (kg)",             kind: "number", group: "VGM" },
  { key: "vgmTareWeightKg",  sheet: "VGM", cell: "G22", label: "Container tare weight (kg)",    kind: "number", group: "VGM", hint: "VGM = cargo + tare." },
  { key: "vgmWeighingDate",  sheet: "VGM", cell: "C23", label: "Date and time of weighing",     kind: "text", group: "VGM" },
  { key: "vgmWeighingSlip",  sheet: "VGM", cell: "C24", label: "Weighing slip no.",             kind: "text", group: "VGM" },
  { key: "vgmCargoType",     sheet: "VGM", cell: "C25", label: "Cargo type",                    kind: "text", group: "VGM" },

  // ── SOP checklist (the hand-typed answers) ────────────────────────────────
  { key: "sopHasPo",           sheet: "SOP", cell: "C7",  label: "Customer purchase order",     kind: "text", group: "SOP checklist" },
  { key: "sopHasPiAck",        sheet: "SOP", cell: "C8",  label: "PI acknowledged by customer", kind: "text", group: "SOP checklist" },
  { key: "sopHasEmail",        sheet: "SOP", cell: "C9",  label: "Email communication",         kind: "text", group: "SOP checklist" },
  { key: "sopSamples",         sheet: "SOP", cell: "C16", label: "Sample quantities",           kind: "text", group: "SOP checklist" },
  { key: "sopDeliverySchedule", sheet: "SOP", cell: "C17", label: "Delivery schedule",          kind: "text", group: "SOP checklist" },
  { key: "sopSpecialPacking",  sheet: "SOP", cell: "C22", label: "Special packing / markings",  kind: "text", group: "SOP checklist" },
  { key: "sopForwarder",       sheet: "SOP", cell: "C25", label: "Nominated freight forwarder", kind: "text", group: "SOP checklist" },
  { key: "sopReceiver",        sheet: "SOP", cell: "C26", label: "Nominated receiver",          kind: "text", group: "SOP checklist" },
  { key: "sopCustomerContact", sheet: "SOP", cell: "C27", label: "Customer contact details",    kind: "text", group: "SOP checklist" },
];

/** Every key, in table order. */
export const ROOT_KEYS: string[] = ROOT_CELLS.map((r) => r.key);

const ROOT_BY_KEY: Record<string, RootCell> = (() => {
  const m: Record<string, RootCell> = {};
  for (const r of ROOT_CELLS) m[r.key] = r;
  return m;
})();

export function rootCell(key: string): RootCell | null {
  return ROOT_BY_KEY[key] ?? null;
}

/** ROOT_CELLS in the order the form should render: group by group. */
export function groupedRoots(): Array<{ group: string; cells: RootCell[] }> {
  const out: Array<{ group: string; cells: RootCell[] }> = [];
  for (const g of ROOT_GROUPS) {
    const cells = ROOT_CELLS.filter((r) => r.group === g);
    if (cells.length) out.push({ group: g, cells });
  }
  // A group added to ROOT_CELLS but forgotten in ROOT_GROUPS still shows.
  for (const r of ROOT_CELLS) {
    if (!ROOT_GROUPS.includes(r.group) && !out.some((o) => o.group === r.group)) {
      out.push({ group: r.group, cells: ROOT_CELLS.filter((x) => x.group === r.group) });
    }
  }
  return out;
}

// ───────────────────────── the per-slab measurement table ────────────────────

export interface SlabTableSpec {
  sheet: string;
  /** First slab row in the template (row 9). */
  firstRow: number;
  /** Last row of the slab well before the template's TOTAL row (row 68). */
  lastRowBudget: number;
  columns: {
    sl: string; sku: string; batch: string; slabNo: string; thick: string;
    lengthCm: string; widthCm: string; sqm: string; crateNo: string;
  };
  /** What column `sqm` actually holds. The sheet's header says SQFT. */
  areaUnit: "SQFT";
  /** =F{r}*G{r}/10000*10.764 — the company's own factor (lib/commercial/measure). */
  areaFormula: (row: number) => string;
  /** Style donors, captured before the well is cleared. */
  patternRows: { crateFirstSlab: number; slab: number; subtotal: number; blank: number; total: number };
  subtotalStyle: {
    /** The subtotal sits in the area column, one row under the crate's slabs. */
    column: string;
    formula: (firstRow: number, lastRow: number) => string;
    /** Rows between one crate's subtotal and the next crate's first slab. */
    gapRows: number;
  };
  totalRow: {
    labelColumn: string;
    label: string;
    column: string;
    /** SUM over slabs AND subtotals, halved — the template's own idiom. */
    formula: (firstRow: number, lastRow: number) => string;
    /** Blank rows between the last subtotal and the TOTAL row. */
    gapRows: number;
  };
}

export const SLAB_TABLE: SlabTableSpec = {
  sheet: "Measmt List",
  firstRow: 9,
  lastRowBudget: 68,
  columns: { sl: "A", sku: "B", batch: "C", slabNo: "D", thick: "E", lengthCm: "F", widthCm: "G", sqm: "H", crateNo: "I" },
  areaUnit: "SQFT",
  areaFormula: (row) => `F${row}*G${row}/10000*10.764`,
  patternRows: { crateFirstSlab: 9, slab: 10, subtotal: 16, blank: 17, total: 70 },
  subtotalStyle: {
    column: "H",
    formula: (first, last) => `SUM(H${first}:H${last})`,
    gapRows: 1,
  },
  totalRow: {
    labelColumn: "G",
    label: "TOTAL",
    column: "H",
    formula: (first, last) => `SUM(H${first}:H${last})/2`,
    gapRows: 1,
  },
};

// ────────────────────── the summary block under the slabs ────────────────────

export interface SummaryTableSpec {
  sheet: string;
  /** "Summary / Colours / Thick / …" header row in the template (72). */
  templateHeaderRow: number;
  /** First data row (73) and how many the template holds (73..77). */
  templateFirstRow: number;
  templateMaxRows: number;
  /** The "Total" row under the block (78). */
  templateTotalRow: number;
  /** The two container / vehicle note rows under it (79, 80). */
  templateFooterRows: number[];
  headers: Record<string, string>;
  columns: {
    sl: string; colour: string; thick: string; slabs: string; batch: string;
    sqft: string; netWeight: string; sqmt: string; crates: string;
  };
  /** Counts and sums over the slab well: two criteria, so SUMPRODUCT. */
  countFormula: (slabFirst: number, slabLast: number, row: number) => string;
  sqftFormula: (slabFirst: number, slabLast: number, row: number) => string;
  sqmtFormula: (row: number) => string;
  totalFormula: (column: string, first: number, last: number) => string;
  /** The two footer rows mirror the Invoice's container / vehicle lines. */
  footerFormulas: string[];
}

export const SUMMARY_TABLE: SummaryTableSpec = {
  sheet: "Measmt List",
  templateHeaderRow: 72,
  templateFirstRow: 73,
  templateMaxRows: 5,
  templateTotalRow: 78,
  templateFooterRows: [79, 80],
  headers: {
    A: "Summary", B: "Colours", C: "Thick", D: "Slabs/Pcs", E: "Batch No's",
    F: "SQFT", G: "Net Weight", H: "SQMT", I: "Crate(S)",
  },
  columns: { sl: "A", colour: "B", thick: "C", slabs: "D", batch: "E", sqft: "F", netWeight: "G", sqmt: "H", crates: "I" },
  // The template used COUNTIF/SUMIF on the batch column alone, which
  // miscounts the moment one colour arrives in two batches. Grouping here is
  // by colour AND thickness, so both criteria are in the formula.
  countFormula: (first, last, row) => `SUMPRODUCT(($B$${first}:$B$${last}=B${row})*($E$${first}:$E$${last}=C${row}))`,
  sqftFormula: (first, last, row) => `SUMPRODUCT(($B$${first}:$B$${last}=B${row})*($E$${first}:$E$${last}=C${row})*$H$${first}:$H$${last})`,
  sqmtFormula: (row) => `+F${row}/10.764`,
  totalFormula: (col, first, last) => `SUM(${col}${first}:${col}${last})`,
  footerFormulas: ["+Invoice!A51", "+Invoice!A54"],
};

/** Cells on other sheets that point INTO the summary block, and therefore have
 *  to be re-pointed when it moves. The item rows are handled by PACKING_ROWS;
 *  these are the strays. */
export interface SummaryLink {
  sheet: string;
  cell: string;
  /** Which row of the block: its header, or footer index 0 / 1. */
  target: "header" | "footer0" | "footer1";
  column: string;
  note: string;
}

export const SUMMARY_LINKS: SummaryLink[] = [
  { sheet: "Invoice", cell: "H38", target: "header", column: "H", note: "the unit label, 'SQMT'" },
  { sheet: "PL-852", cell: "A92", target: "footer0", column: "A", note: "container no. echo" },
  { sheet: "PL-852", cell: "A93", target: "footer1", column: "A", note: "vehicle no. echo" },
];

// ───────────────────── the goods lines on the six doc sheets ─────────────────
//
// One row per (colour, thickness) group plus one per sample line — NOT one per
// crate; the sheets summarise. "Invoice" reads the Measmt List summary block;
// the other five read "Invoice", which is how the template already works.

export interface PackingRowSpec {
  sheet: string;
  /** First goods row and the last one the block can use without moving a total. */
  firstRow: number;
  lastRow: number;
  /** The "Total - Slabs / Pcs" row under the block. Never moved. */
  totalRow: number;
  /** Where the values come from. */
  source: "summary" | "invoice";
  columns: {
    marks?: string; packages?: string; colour: string; thick: string;
    netWeight: string; slabs: string; qty: string; unit: string;
    rate?: string; amount?: string;
  };
  /**
   * The helper column beside the goods block that holds the rate PER SQFT,
   * which the rate column converts to a per-SQMT rate (`=+L38*10.764`).
   *
   * Only "Invoice" has one: its first row is the `ratePerSqft` ROOT CELL, and
   * ./build.ts parks each further line's own per-SQFT rate one row down. Every
   * other priced sheet reads the Invoice's finished rate instead, so a rate is
   * converted in exactly one place and lines 2..n cannot be priced per SQFT
   * against a quantity in SQMT.
   */
  ratePerSqftColumn?: string;
  /**
   * "Less Discount" — the row that subtracts the free sample lines from the
   * total. The template hard-codes the sample row it had (`=-J43`); the block
   * is rebuilt at a different height every time, so ./build.ts re-points it at
   * the sample rows actually written (0 when the shipment has none).
   */
  discountCell?: string;
  /** Cust-Inv -INR multiplies the USD rate by the invoice's exchange rate. */
  rateInInr?: boolean;
  /** The totals row's SUM ranges, rebuilt so they cover the rows written. */
  totals: Array<{ column: string; kind: "sum" | "firstRow" }>;
}

export const PACKING_ROWS: PackingRowSpec[] = [
  {
    sheet: "Invoice", firstRow: 38, lastRow: 43, totalRow: 45, source: "summary",
    columns: { marks: "A", packages: "B", colour: "C", thick: "D", netWeight: "E", slabs: "F", qty: "G", unit: "H", rate: "I", amount: "J" },
    ratePerSqftColumn: "L", discountCell: "J48",
    totals: [{ column: "E", kind: "sum" }, { column: "F", kind: "sum" }, { column: "G", kind: "sum" }, { column: "J", kind: "sum" }, { column: "H", kind: "firstRow" }],
  },
  {
    sheet: "Cust-Inv", firstRow: 38, lastRow: 45, totalRow: 46, source: "invoice",
    columns: { marks: "A", packages: "B", colour: "C", thick: "D", netWeight: "E", slabs: "F", qty: "G", unit: "H", rate: "I", amount: "J" },
    discountCell: "J49",
    totals: [{ column: "E", kind: "sum" }, { column: "F", kind: "sum" }, { column: "G", kind: "sum" }, { column: "J", kind: "sum" }],
  },
  {
    sheet: "Cust-Inv -INR", firstRow: 38, lastRow: 45, totalRow: 46, source: "invoice", rateInInr: true,
    columns: { marks: "A", packages: "B", colour: "C", thick: "D", netWeight: "E", slabs: "F", qty: "G", unit: "H", rate: "I", amount: "J" },
    discountCell: "J49",
    totals: [{ column: "E", kind: "sum" }, { column: "F", kind: "sum" }, { column: "G", kind: "sum" }, { column: "J", kind: "sum" }],
  },
  {
    sheet: "Packing List", firstRow: 32, lastRow: 39, totalRow: 40, source: "invoice",
    columns: { marks: "A", packages: "B", colour: "C", thick: "D", netWeight: "E", slabs: "F", qty: "G", unit: "H" },
    totals: [{ column: "E", kind: "sum" }, { column: "F", kind: "sum" }, { column: "G", kind: "sum" }],
  },
  {
    sheet: "Cust-PL", firstRow: 32, lastRow: 38, totalRow: 39, source: "invoice",
    columns: { marks: "A", packages: "B", colour: "C", thick: "D", netWeight: "E", slabs: "F", qty: "G", unit: "H" },
    totals: [{ column: "E", kind: "sum" }, { column: "F", kind: "sum" }, { column: "G", kind: "sum" }],
  },
  {
    // Stale in the source (PESPL/1891) and carrying six ='Measmt List'!#REF!
    // formulas. Rebuilt from the same summary block as "Invoice"; its header
    // comes from INVOICE_R_MIRRORS / INVOICE_R_LINKS / INVOICE_R_CLEARED below.
    // It has NO ratePerSqftColumn: its own column L is a leftover text formula
    // (='Measmt List'!B73), so a rate of +L38*10.764 there evaluates to nothing.
    // The rate is read off the Invoice instead.
    sheet: "Invoice (R)", firstRow: 38, lastRow: 43, totalRow: 44, source: "summary",
    columns: { marks: "A", packages: "B", colour: "C", thick: "D", netWeight: "E", slabs: "F", qty: "G", unit: "H", rate: "I", amount: "J" },
    discountCell: "J49",
    totals: [{ column: "E", kind: "sum" }, { column: "F", kind: "sum" }, { column: "G", kind: "sum" }, { column: "J", kind: "sum" }, { column: "H", kind: "firstRow" }],
  },
];

/** The Invoice's goods block — the one PACKING_ROWS' "invoice" sheets copy. */
export const INVOICE_ROWS: PackingRowSpec = PACKING_ROWS[0];

/** The company's own factor, the one `lib/commercial/measure` uses and the one
 *  written into every area formula in this workbook. */
export const SQFT_PER_SQM = 10.764;

// ───────────────────── "Invoice (R)": a second output sheet ──────────────────
//
// The sheet is a copy of "Invoice" that the source workbook left filled in from
// a DIFFERENT shipment: invoice PESPL/1891 of 04/09/2025 to Universal Stone LLC
// of Charlotte NC, against PI 00381, under an LUT that has since expired. Its
// header is hand-typed literals — nothing pulls them — so building for a new
// customer used to leave every one of them in place.
//
// DESIGN.md says Invoice (R) is another output sheet to FILL, not truth. These
// three tables are how it is filled, and they are why nothing of the previous
// customer can survive a build:
//
//   INVOICE_R_MIRRORS  header cells that hold the same value as an Invoice root
//                      cell. Written from the SAME root — no second form field,
//                      and a root the user left blank blanks the cell here too.
//   INVOICE_R_LINKS    header cells that should read the Invoice rather than
//                      hold a literal. Its consignee block pointed at
//                      Invoice!K14:K17 (two rows off — that is the notify
//                      party) and its notify block at its OWN stale K8:K11.
//   INVOICE_R_CLEARED  the previous shipment's numbers, with no ERP source:
//                      cleared, never reprinted. A wrong ocean freight or duty
//                      figure on a customs document is worse than a blank one.

/** Invoice (R) header cell ← the root key whose value belongs in it. */
export interface MirrorCell { cell: string; key: string }

export const INVOICE_R_MIRRORS: MirrorCell[] = [
  // Header
  { cell: "A2",  key: "fyLabel" },
  { cell: "H4",  key: "invoiceNo" },
  { cell: "J4",  key: "invoiceDate" },
  { cell: "H5",  key: "buyerPoRef" },
  { cell: "H6",  key: "iecCode" },
  { cell: "J7",  key: "salesPerson" },
  { cell: "J8",  key: "exporterGstinText" },
  // Exporter
  { cell: "A5",  key: "exporterName" },
  { cell: "A6",  key: "exporterLine1" },
  { cell: "A7",  key: "exporterLine2" },
  { cell: "A8",  key: "exporterLine3" },
  { cell: "A9",  key: "exporterLine4" },
  { cell: "C8",  key: "stateCodeText" },
  { cell: "C9",  key: "districtCodeText" },
  { cell: "G11", key: "customsOffice" },
  // Terms and routing
  { cell: "G19", key: "countryOfOrigin" },
  { cell: "I19", key: "countryOfDestination" },
  { cell: "H21", key: "deliveryTerms" },
  { cell: "G22", key: "deliveryTermsNote" },
  { cell: "H25", key: "paymentTerms" },
  { cell: "A29", key: "preCarriageBy" },
  { cell: "C29", key: "placeOfReceipt" },
  { cell: "A33", key: "portOfDischarge" },
  // Bank
  { cell: "G27", key: "bankName" },
  { cell: "G28", key: "bankLine1" },
  { cell: "G29", key: "bankLine2" },
  { cell: "G30", key: "bankLine3" },
  { cell: "I30", key: "adCode" },
  { cell: "G31", key: "bankAccountNo" },
  { cell: "I31", key: "bankSwift" },
  { cell: "G32", key: "routingBankLine1" },
  { cell: "G33", key: "routingBankLine2" },
  { cell: "I33", key: "routingSwift" },
  // Goods header
  { cell: "A36", key: "hsnText" },
  { cell: "C36", key: "goodsDescription" },
  // Footer — one row higher than the Invoice's, the totals row above it being
  // one row shorter.
  { cell: "A50", key: "containerNoText" },
  { cell: "A51", key: "linerOtlText" },
  { cell: "A52", key: "eSealText" },
  { cell: "A53", key: "vehicleNoText" },
  { cell: "A54", key: "blNoText" },
  { cell: "A55", key: "sbNoText" },
  { cell: "D56", key: "currencyLabel" },
  { cell: "F56", key: "exchangeRate" },
  { cell: "A58", key: "amountWordsPrefix" },
  { cell: "C58", key: "amountInWords" },
  // A63 printed `=+K58`, the IGST wording, while the Invoice prints the LUT
  // paragraph. Both sheets now print the LUT text and park the IGST
  // alternative beside it, exactly as the Invoice does.
  { cell: "A63", key: "lutText" },
  { cell: "K58", key: "igstNote" },
  { cell: "A64", key: "selfSealingText" },
  { cell: "B66", key: "grossWeightText" },
  { cell: "B67", key: "netWeightText" },
  { cell: "H66", key: "signatoryLine" },
  { cell: "A69", key: "declarationLine1" },
  { cell: "A70", key: "declarationLine2" },
];

/** Invoice (R) cell → the formula that makes it read the Invoice sheet. */
export const INVOICE_R_LINKS: Array<{ cell: string; formula: string; note: string }> = [
  { cell: "A12", formula: "+Invoice!K8",  note: "consignee name — pointed at Invoice!K14, which is blank" },
  { cell: "A13", formula: "+Invoice!K9",  note: "consignee address line 1" },
  { cell: "A14", formula: "+Invoice!K10", note: "consignee address line 2 — read the notify NAME before" },
  { cell: "A15", formula: "+Invoice!K11", note: "consignee country" },
  { cell: "A19", formula: "+Invoice!K16", note: "notify name — read this sheet's own stale K8" },
  { cell: "A20", formula: "+Invoice!K17", note: "notify address line 1" },
  { cell: "A21", formula: "+Invoice!K18", note: "notify address line 2" },
  { cell: "A22", formula: "+Invoice!K19", note: "notify country" },
  { cell: "C33", formula: "+A33",         note: "final destination — a second stale literal beside the port" },
];

/** Invoice (R) cells carrying the previous shipment's figures. Cleared. */
export const INVOICE_R_CLEARED: string[] = [
  "K8", "K9", "K10", "K11",       // Universal Stone LLC, Charlotte NC
  "K38", "L38",                   // helper cells the goods block no longer uses
  "K40", "L40",                   // ='Measmt List'!#REF!
  "J45", "K45",                   // ocean freight 2000
  "J46", "K46",                   // ISF & clearance 1000
  "J47", "K47",                   // duty @ 2.67% of the OLD invoice's value
  "J48", "K48",                   // tariff @ 50% of the OLD invoice's value
  "K49", "K53", "K57", "L57",     // the C&F cost cross-check block
  "L50", "L51", "L52",
  "C59", "G60",                   // GST input opening balance, entry serial
  "K59",                          // the LUT that expired on 31.03.2024
];

/**
 * "Invoice" columns K..O rows 13..39: an address book of OTHER Ciot and
 * Pacific-USA entities the template's author parked outside the print area
 * (Ciot Detroit LP, CIOT NEW YORK INC, Ciot Inc - Toronto …). Nothing reads
 * them except the notify-party cells K16:K20, which are root cells and are
 * skipped. They never print, but they travel inside every .xlsx the ERP hands
 * a customer, so the build wipes the block and leaves the roots.
 */
export const PARKED_ADDRESS_BLOCK = {
  sheet: "Invoice",
  columns: ["K", "L", "M", "N", "O"],
  firstRow: 13,
  lastRow: 39,
};

// ───────────────────────── the PL-852 per-crate blocks ───────────────────────
//
// One block per crate: a "CRATE  # n" row, two header rows (merged in pairs),
// one row per slab, and a TOTAL row. The template holds seven such blocks in
// rows 5..79, then the quantity lines, the summary and the sample block.

export interface Pl852Spec {
  sheet: string;
  firstBlockRow: number;
  /** Last row a block may occupy before the footer in the template (79). */
  lastBlockRowBudget: number;
  columns: {
    sl: string; colour: string; batch: string; slabNo: string; thick: string;
    lengthCm: string; widthCm: string; sqft: string; weightKg: string; note: string;
  };
  patternRows: { crateLabel: number; header1: number; header2: number; slab: number; total: number };
  /** Columns merged vertically across the two header rows. */
  headerMergeColumns: string[];
  headerTexts: { row1: Record<string, string>; row2: Record<string, string> };
  areaFormula: (row: number) => string;
  totalFormula: (first: number, last: number) => string;
  /** Rows after the last block: quantity SQM / SFT, then the summary block. */
  footer: {
    templateQtySqmRow: number;
    templateQtySftRow: number;
    templateSummaryHeaderRow: number;
    templateSummaryFirstRow: number;
    templateSummaryTotalRow: number;
    templateSampleHeaderRow: number;
    templateEchoRows: number[];
  };
}

export const PL852_TABLE: Pl852Spec = {
  sheet: "PL-852",
  firstBlockRow: 5,
  lastBlockRowBudget: 79,
  columns: { sl: "A", colour: "B", batch: "C", slabNo: "D", thick: "E", lengthCm: "F", widthCm: "G", sqft: "H", weightKg: "I", note: "J" },
  patternRows: { crateLabel: 5, header1: 6, header2: 7, slab: 8, total: 15 },
  headerMergeColumns: ["A", "B", "C", "D", "E", "H", "I"],
  headerTexts: {
    row1: { A: "SL.NO", B: "COLOR", C: "BATCH NO.", D: "SLAB NO.", E: "THICK", F: "NET (CM)", H: "QTY IN SQFT", I: "WEIGHT    (Kgs)" },
    row2: { F: "LENGTH", G: "HEIGHT" },
  },
  areaFormula: (row) => `F${row}*G${row}/10000*10.764`,
  totalFormula: (first, last) => `SUM(H${first}:H${last})`,
  footer: {
    templateQtySqmRow: 81,
    templateQtySftRow: 82,
    templateSummaryHeaderRow: 85,
    templateSummaryFirstRow: 86,
    templateSummaryTotalRow: 87,
    templateSampleHeaderRow: 88,
    templateEchoRows: [92, 93],
  },
};

/** Every sheet the workbook holds, in tab order — what the UI lists. */
export const SHEET_NAMES: string[] = [
  "Invoice (R)", "Cust-Inv -INR", "Cust-Inv", "Cust-PL", "Invoice", "Packing List",
  "Measmt List", "PL-852", "Gatepass", "ANNEXURE –C1", "ANNEX –D", "VGM", "PI", "SOP",
];

/** Sheets ./build.ts writes into, with one line on what each is for. */
export const GENERATED_SHEETS: Array<{ sheet: string; what: string }> = [
  { sheet: "Invoice", what: "Commercial invoice — the sheet every other one reads" },
  { sheet: "Packing List", what: "Packing list (Rule 46 CGST)" },
  { sheet: "Cust-Inv", what: "Customer copy of the invoice, consignee shown as the customer code" },
  { sheet: "Cust-Inv -INR", what: "Customer invoice copy priced in rupees at the invoice's exchange rate" },
  { sheet: "Cust-PL", what: "Customer copy of the packing list" },
  { sheet: "Invoice (R)", what: "Revised-invoice sheet (stale in the source template; rebuilt)" },
  { sheet: "Measmt List", what: "Detailed measurement list — one row per slab, subtotal per crate" },
  { sheet: "PL-852", what: "Per-crate slab sheet with weights and the summary block" },
  { sheet: "Gatepass", what: "Factory gate pass, two copies — derived from the invoice" },
  { sheet: "ANNEXURE –C1", what: "Self-sealing examination report — derived, plus its own signatory list" },
  { sheet: "ANNEX –D", what: "Self-sealing shipment intimation — derived" },
  { sheet: "VGM", what: "Verified gross mass declaration" },
  { sheet: "SOP", what: "Internal sales order checklist — derived from the invoice" },
  { sheet: "PI", what: "Blank proforma sheet, left as the template has it" },
];

// ─────────────────────────── deriving the roots ──────────────────────────────
//
// DEFAULT_ROOTS turns what the ERP already knows into the root cell values, so
// a user opening the Documents tab sees a filled form rather than an empty one.
// Structural (not nominal) input types: this module imports nothing, and the
// caller passes plain()-ed Prisma rows.

export interface PartyLike {
  name?: string | null;
  lines?: string[] | null;
  country?: string | null;
  tel?: string | null;
  code?: string | null;
  gstin?: string | null;
}

export interface InvoiceSnapshotLike {
  kind?: string | null;
  number?: string | null;
  date?: string | Date | null;
  buyerPoRef?: string | null;
  piNumber?: string | null;
  piDate?: string | null;
  salesPerson?: string | null;
  currency?: string | null;
  exchangeRate?: number | null;
  exporter?: PartyLike | null;
  consignee?: PartyLike | null;
  notifyParty?: PartyLike | null;
  buyer?: PartyLike | null;
  countryOfOrigin?: string | null;
  countryOfDestination?: string | null;
  deliveryTerms?: string | null;
  paymentTerms?: string | null;
  preCarriageBy?: string | null;
  placeOfReceipt?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  finalDestination?: string | null;
  marksAndNos?: string | null;
  packages?: string | null;
  grossWeight?: string | null;
  netWeight?: string | null;
  containerNo?: string | null;
  sealNo?: string | null;
  linerOtlNo?: string | null;
  vehicleNo?: string | null;
  lutText?: string | null;
  amountInWords?: string | null;
  commodity?: string | null;
  lines?: Array<{ rate?: number | null; hsn?: string | null; itemCode?: string | null; description?: string | null; design?: string | null; qty?: number | null; unit?: string | null; isSample?: boolean | null }> | null;
  company?: Record<string, unknown> | null;
  bank?: Record<string, unknown> | null;
  /** Answers 21 and 23, carried by invoice-rules' InvoiceSnapshotExtras: the
   *  registration the invoice is issued under, the label printed beside it
   *  when it is not the company's own, and which bank block `bank` holds. */
  gstin?: string | null;
  gstinLabel?: string | null;
  bankKey?: string | null;
}

export interface PackingListLike {
  number?: string | null;
  containerNo?: string | null;
  sealNo?: string | null;
  linerOtlNo?: string | null;
  vehicleNo?: string | null;
  grossWeightKg?: number | null;
  netWeightKg?: number | null;
  packagesSummary?: string | null;
  crates?: Array<{ crateNo?: number | null; kind?: string | null; netKg?: number | null; grossKg?: number | null }> | null;
  slabs?: Array<Record<string, unknown>> | null;
}

export interface OrderLike {
  number?: string | null;
  kind?: string | null;
  customerPoNumber?: string | null;
  customerPoDate?: string | Date | null;
  currency?: string | null;
  exchangeRate?: number | null;
  specialPacking?: string | null;
  deliverySchedule?: string | null;
  forwarderDetails?: string | null;
  receiverDetails?: string | null;
  customerContact?: string | null;
  poEvidence?: string | null;
  client?: { name?: string | null; commercialExt?: { customerCode?: string | null } | null } | null;
}

export interface SettingsLike {
  company?: Record<string, unknown> | null;
  banks?: { export?: Record<string, unknown> | null; domestic?: Record<string, unknown> | null } | null;
  defaults?: Record<string, unknown> | null;
  texts?: Record<string, unknown> | null;
}

/**
 * The template's own wording for the cells that are COMPANY BOILERPLATE, not
 * shipment data: permission-letter numbers, signatory names, factory address,
 * the VGM contact block, the declaration lines.
 *
 * These are fallbacks. DEFAULT_ROOTS prefers what the ERP knows and drops back
 * to these only when it knows nothing — otherwise every new order would print
 * an empty self-sealing paragraph, which is a customs document with a hole in
 * it. What is deliberately NOT here is anything belonging to a shipment or a
 * customer — invoice number, consignee, marks, weights, container, the SOP
 * answers. Falling back on those would print the last customer's details on
 * this customer's invoice, which is far worse than a blank.
 */
export const TEMPLATE_BOILERPLATE: Record<string, string | number> = {
  exporterName: "Pacific Engineered Surfaces Private Limited",
  exporterLine1: "SY.NO.73/2B, NALLAGANAKOTAPALLI VILLAGE, N.H.7,",
  exporterLine2: "HOSUR, Krishnagiri, ",
  exporterLine3: "Hosur - 635 117",
  exporterLine4: "Tamilnadu, India",
  stateCodeText: "State Code - 33",
  districtCodeText: "Disctrict Code - 577",
  iecCode: "IEC AALCP2750N",
  exporterGstinText: "GSTIN NO: 33AALCP2750N1Z3",
  customsOffice: "OFFICE OF THE ASSISTANT COMMISSIONER OF CUSTOMS, CUSTOMS PREVENTIVE UNIT, 21B, RAAGAVIS CENTER, I-FLOOR, NETHAJI NAGAR, NANJUNDAPURAM MAIN ROAD, RAMANATHAPURAM, COIMBATORE-641045. ",
  deliveryTermsNote: "FOB - KATTUPALLI PORT (Insurance covered up to India port & Insurance from POL to destination port or customer warehouse is to customers account)",
  bankName: "Kotak Mahindra Bank Limited",
  bankLine1: "10/7, Umiya Landmark, Lavelle Road,",
  bankLine2: "Next to Chancery Hotel, Bangalore 560001",
  bankLine3: "Karnataka, India",
  adCode: "AD Code: 0180038-8400009",
  bankAccountNo: "A/c No. 3214292773",
  bankSwift: "Swift Code - KKBKINBBXXX",
  routingBankLine1: "Routing Bank: The Bank of Newyork Mellon, No.1, Wall St.",
  routingBankLine2: "Newyork, NY 10015",
  routingSwift: "Swift Code - IRVTUS3NXXX",
  hsnText: "HSN NO: 68101990",
  goodsDescription: "Artificial Quartz Slabs",
  blNoText: "BL No.",
  sbNoText: "SB No.",
  amountWordsPrefix: "U.S.Dollars:  ",
  signatoryLine: "For Pacific Engineered Surfaces Pvt Ltd",
  lutText: "\"Supply Meant For Export Under LUT\", No AD330326017058D/2026-27 dated 06/03/2026 Vide File No. LUT Furnished Under Rule 96A Of CGST Rules, 2017 For Export Of  Goods Without Payment Of IGST.",
  selfSealingText: "Container despatched under Self Sealing permission letter - Commissioner's office letter NO. :VIII/16/97/2024-CPU/CBE/138 Dated 08.08.2024 And Self Sealing done as per Circular no. 09/2025-Customs Dated 27.06.2025 Enclosed the letter of SSP No-79/TRY/2024, And Self Sealining Permn letter no. CUS/EPF/SSP/16/2025-Docks-Admn and Dated: 19.08.2025. The ARN No.AD330326017058D/2026-27 dated 06/03/2026",
  igstNote: "\"Supply Meant For Export Under Payment Of IGST.",
  declarationLine1: "We declare that this invoice shows the actual price of the goods",
  declarationLine2: "described and that all particulars are true and correct",
  salesCommissionNote: "(Note: 2% Sales Commisssion On Fob Value)",
  plTinNo: "33463324368",
  plCstNo: "1046169/20.09.2010",
  custPlTinNo: "33463324368",
  custPlCstNo: "1046169/20.09.2010",
  c1CompanyName: "Pacific Engineered Surfaces Private Limited",
  c1Iec: "IEC AALCP2750N",
  c1Gstin: "33AALCP2750N1Z3",
  c1FactoryLine1: "SY.NO.73/2B, NALLAGANAKOTAPALLI VILLAGE, N.H.7,",
  c1FactoryLine2: "HOSUR, Krishnagiri,",
  c1FactoryLine3: "Hosur - 635 117",
  c1FactoryLine4: "Tamilnadu, India",
  c1ContainerSize: " 20 ft.in (Close Top)",
  c1SealColourText: "  and the colour of the seal is WHITE. I undertake full responsibility for any difference in description, quality or quantity of the goods.",
  c1Signatory: "Name of Sigantory: MURALI.C - Commercial Manager",
  dFacilityCircular: "FACILITY  INTIMATION NO. 09/2025 DATED 27.06.2025 ",
  dLossp: "CUS/EPF/SSP/16/2025-Docks-Admn Dated: 19-08-2025",
  dPremisesName: "Pacific Engineered Surfaces Private Limited",
  dPremisesLine1: "SY.NO.73/2B, NALLAGANAKOTAPALLI VILLAGE, N.H.7,",
  dPremisesLine2: "HOSUR, Krishnagiri, ",
  dPremisesLine3: "Hosur - 635 117",
  dPremisesLine4: "Tamilnadu, India",
  dIncentives: "N/A",
  vgmCompanyName: "Pacific Engineered Surfaces Pvt Ltd",
  vgmAddressLine1: "SY.NO.73/2B, NALLAGANAKOTAPALLI VILLAGE, N.H.7,",
  vgmAddressLine2: "Hosur taluk, Hosur - 635117. Tamil Nadu",
  vgmContactLine: "Tel.: +91 8870008798, Email ID : customs@pacific-surfaces.com",
  vgmSignatories: "VARUN MUNDRA/MURALI.C/ANANTHA.L",
  vgmDesignations: "DIRECTOR/MANAGER-COMMERCIAL/AGM",
  vgmContactNumbers: "9874691177/8870008498/8123514050",
  vgmContainerSize: "20 ft Close Top",
  vgmMaxWeight: "30480 Kgs",
  vgmMethod: "Method -2",
  vgmCargoType: "NORMAL",
  vgmTareWeightKg: 2230,
};

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** YYYY-MM-DD from either an ISO string or a Date. Prisma hands @db.Date
 *  columns back as Date objects, and String(new Date()) is "Fri Jul 03 2026",
 *  which is how the PO date silently vanished from the invoice's PO reference
 *  the first time this ran against real rows. */
export function isoDate(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}
const line = (p: PartyLike | null | undefined, i: number): string => {
  const ls = p?.lines;
  return Array.isArray(ls) && ls[i] !== undefined && ls[i] !== null ? String(ls[i]) : "";
};

/** "24.00 MT" from 24000 kg; "" when there is no weight. */
export function mtText(kg: unknown): string {
  const n = typeof kg === "number" ? kg : Number(kg);
  if (!Number.isFinite(n) || n === 0) return "";
  return `${(n / 1000).toFixed(2)} MT`;
}

/** The inverse: "23.50 MT" → 23500. A plain number is read as kilos already,
 *  which is what somebody typing 23500 into the weight field means. */
export function kgFromMt(text: unknown): number {
  const t = String(text ?? "").trim();
  if (!t) return 0;
  const m = t.match(/^([\d,]+(?:\.\d+)?)\s*(MT|T|KGS?|KG)?$/i);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] ?? "MT").toUpperCase();
  return unit === "MT" || unit === "T" ? Math.round(n * 1000) : Math.round(n);
}

/** "Container No. TCLU 2787296" — the template prints label and value in one
 *  cell, and the user may type either form. A value that already carries the
 *  label is left alone. */
export function labelled(label: string, value: unknown): string {
  const v = s(value).trim();
  if (!v) return label;
  return v.toLowerCase().startsWith(label.toLowerCase().replace(/\.$/, "").slice(0, 6).toLowerCase()) ? v : `${label} ${v}`;
}

/** Financial year label from a YYYY-MM-DD date: April starts the year. */
export function fyOf(dateIso: unknown): string {
  const m = s(dateIso).match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = mo >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "PO-4068622 Dt: 03/07/2026 (PI-SAL-ORD/25-26/01477)". */
export function buyerPoRefText(inv: InvoiceSnapshotLike, order: OrderLike | null): string {
  if (s(inv.buyerPoRef).trim()) return s(inv.buyerPoRef).trim();
  const parts: string[] = [];
  const po = s(order?.customerPoNumber).trim();
  if (po) {
    const d = isoDate(order?.customerPoDate);
    const dm = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    parts.push(dm ? `${po} Dt: ${dm[3]}/${dm[2]}/${dm[1]}` : po);
  }
  const pi = s(inv.piNumber).trim();
  if (pi) parts.push(`(PI-${pi})`);
  return parts.join(" ");
}

/**
 * Every root cell's default value, derived from the ERP.
 *
 * PURE. Missing inputs give "" or 0 rather than throwing — a half-filled order
 * still opens a usable form, and the user fills the rest in by hand.
 */
export function DEFAULT_ROOTS(
  invoiceSnapshot: InvoiceSnapshotLike | null | undefined,
  packingList: PackingListLike | null | undefined,
  order: OrderLike | null | undefined,
  settings: SettingsLike | null | undefined,
): Record<string, string | number> {
  const inv = invoiceSnapshot ?? {};
  const pl = packingList ?? null;
  const ord = order ?? null;
  const set = settings ?? {};
  const company = (set.company ?? {}) as Record<string, unknown>;
  // Answer 23: the bank the invoice chose. The snapshot's own block is the
  // truth once an invoice exists (it is what the PDF prints); the settings'
  // block by key stands in for a snapshot frozen before the choice existed.
  const snapBank = (inv.bank ?? null) as Record<string, unknown> | null;
  const bankKey = s(inv.bankKey) === "domestic" ? "domestic" : "export";
  const bank = (snapBank && s(snapBank.name) ? snapBank : (set.banks?.[bankKey] ?? set.banks?.export ?? {})) as Record<string, unknown>;
  // Answer 21: the registration the invoice was issued under, with the
  // sister company's name beside it when it is not PESPL's own.
  const gstin = s(inv.gstin) || s((inv.company ?? {})["gstin"]) || s(company.gstin);
  const gstinLabel = s(inv.gstinLabel);
  const gstinPrinted = gstin && gstinLabel ? `${gstin} (${gstinLabel})` : gstin;
  const texts = (set.texts ?? {}) as Record<string, unknown>;

  const exporter = inv.exporter ?? null;
  const consignee = inv.consignee ?? null;
  const notify = inv.notifyParty ?? null;
  const addr = Array.isArray(company.addressLines) ? (company.addressLines as unknown[]).map(s) : [];

  const custCode = s(consignee?.code) || s(ord?.client?.commercialExt?.customerCode);
  const custCountry = s(consignee?.country) || s(inv.countryOfDestination);

  const crates = Array.isArray(pl?.crates) ? pl!.crates! : [];
  const packages = s(inv.packages) || s(pl?.packagesSummary) ||
    (crates.length ? `${String(crates.length).padStart(2, "0")} ${crates.length === 1 ? "Wooden Crate" : "Wooden Crate(S)"}` : "");
  const marks = s(inv.marksAndNos) || (crates.length ? `01 to ${String(crates.length).padStart(2, "0")}` : "");

  const goodsLines = Array.isArray(inv.lines) ? inv.lines! : [];
  const firstGoods = goodsLines.find((l) => !l?.isSample) ?? goodsLines[0] ?? null;
  const sampleLine = goodsLines.find((l) => l?.isSample) ?? null;

  const gross = s(inv.grossWeight) || mtText(pl?.grossWeightKg);
  const net = s(inv.netWeight) || mtText(pl?.netWeightKg);
  const grossKg = typeof pl?.grossWeightKg === "number" ? pl!.grossWeightKg! : 0;
  const netKg = typeof pl?.netWeightKg === "number" ? pl!.netWeightKg! : 0;

  const legalName = s(exporter?.name) || s(company.legalName);
  const factory = addr.length ? addr : [line(exporter, 0), line(exporter, 1), line(exporter, 2), line(exporter, 3)].filter(Boolean);

  const roots: Record<string, string | number> = {
    // Invoice header
    fyLabel: fyOf(isoDate(inv.date)),
    invoiceNo: s(inv.number),
    invoiceDate: isoDate(inv.date),
    buyerPoRef: buyerPoRefText(inv, ord),
    iecCode: s(company.iec) ? `IEC ${s(company.iec)}` : "",
    salesPerson: s(inv.salesPerson),
    exporterGstinText: gstinPrinted ? `GSTIN NO: ${gstinPrinted}` : "",

    // Exporter
    exporterName: legalName,
    exporterLine1: line(exporter, 0) || s(factory[0]),
    exporterLine2: line(exporter, 1) || s(factory[1]),
    exporterLine3: line(exporter, 2) || s(factory[2]),
    exporterLine4: line(exporter, 3) || s(factory[3]),
    stateCodeText: s(company.stateCode) ? `State Code - ${s(company.stateCode)}` : "",
    districtCodeText: s(company.districtCode) ? `Disctrict Code - ${s(company.districtCode)}` : "",
    customsOffice: s(company.customsOffice),

    // Consignee
    consigneeName: s(consignee?.name),
    consigneeLine1: line(consignee, 0),
    consigneeLine2: line(consignee, 1),
    consigneeCountry: s(consignee?.country),
    consigneeTel: s(consignee?.tel) ? `Tel: ${s(consignee?.tel)}` : "",

    // Notify party
    notifyName: s(notify?.name),
    notifyLine1: line(notify, 0),
    notifyLine2: line(notify, 1),
    notifyCountry: s(notify?.country),
    notifyTel: s(notify?.tel) ? `Tel: ${s(notify?.tel)}` : "",

    // Terms
    countryOfOrigin: (s(inv.countryOfOrigin) || s((set.defaults ?? {})["countryOfOrigin"])).toUpperCase(),
    countryOfDestination: s(inv.countryOfDestination).toUpperCase(),
    deliveryTerms: s(inv.deliveryTerms),
    deliveryTermsNote: "",
    paymentTerms: s(inv.paymentTerms),

    // Routing
    preCarriageBy: s(inv.preCarriageBy) || s((set.defaults ?? {})["preCarriageBy"]),
    placeOfReceipt: s(inv.placeOfReceipt) || s(inv.portOfLoading),
    portOfDischarge: s(inv.portOfDischarge) || s(inv.finalDestination),
    plPortOfDischarge: s(inv.portOfLoading) || s(inv.placeOfReceipt),

    // Bank
    bankName: s(bank.name),
    bankLine1: s(bank.address).split(",").slice(0, 2).join(",").trim(),
    bankLine2: s(bank.address).split(",").slice(2, 4).join(",").trim(),
    bankLine3: s(bank.address).split(",").slice(4).join(",").trim(),
    adCode: s(bank.adCode) ? `AD Code: ${s(bank.adCode)}` : "",
    bankAccountNo: s(bank.accountNo) ? `A/c No. ${s(bank.accountNo)}` : "",
    bankSwift: s(bank.swift) ? `Swift Code - ${s(bank.swift)}` : "",
    routingBankLine1: s(bank.routingBank) ? `Routing Bank: ${s(bank.routingBank).split(",").slice(0, 3).join(",")}` : "",
    routingBankLine2: s(bank.routingBank).split(",").slice(3).join(",").trim(),
    routingSwift: s(bank.routingSwift) ? `Swift Code - ${s(bank.routingSwift)}` : "",

    // Goods
    hsnText: s(company.hsnQuartz) ? `HSN NO: ${s(company.hsnQuartz)}` : "",
    goodsDescription: s(inv.commodity) || s(firstGoods?.description) || "Artificial Quartz Slabs",
    marksAndNos: marks,
    packagesSummary: packages,
    ratePerSqft: typeof firstGoods?.rate === "number" ? firstGoods.rate : 0,

    // Container & transport
    containerNoText: labelled("Container No.", s(inv.containerNo) || s(pl?.containerNo)),
    linerOtlText: labelled("Liner's OTL No.", s(inv.linerOtlNo) || s(pl?.linerOtlNo)),
    eSealText: labelled("E- Seal No.", s(inv.sealNo) || s(pl?.sealNo)),
    vehicleNoText: labelled("Vehicle No.", s(inv.vehicleNo) || s(pl?.vehicleNo)),
    blNoText: "BL No.",
    sbNoText: "SB No.",

    // Amounts
    currencyLabel: ` ${s(inv.currency) || "USD"}`,
    exchangeRate: typeof inv.exchangeRate === "number" ? inv.exchangeRate : (typeof ord?.exchangeRate === "number" ? ord.exchangeRate : 0),
    packingCharges: 0,
    insuranceCharges: 0,
    advanceAuthText: "",
    amountWordsPrefix: `${s(inv.currency) === "USD" ? "U.S.Dollars" : s(inv.currency)}:  `,
    amountInWords: s(inv.amountInWords),

    // Weights & declarations
    grossWeightText: gross,
    netWeightText: net,
    signatoryLine: `For ${s(company.shortName) || legalName}`,
    lutText: s(inv.lutText) || s(company.lutText),
    selfSealingText: "",
    igstNote: "\"Supply Meant For Export Under Payment Of IGST.",
    declarationLine1: "We declare that this invoice shows the actual price of the goods",
    declarationLine2: "described and that all particulars are true and correct",

    // Customer copies
    customerCode: custCode,
    customerCountry: custCountry.toUpperCase(),
    customerCodeInr: custCode,
    customerCountryInr: custCountry.toUpperCase(),
    salesCommissionNote: "",

    // Packing list literals
    plStateCodeText: s(company.stateCode) ? `State Code - ${s(company.stateCode)}` : "",
    plDistrictCodeText: s(company.districtCode) ? `Disctrict Code - ${s(company.districtCode)}` : "",
    plTinNo: "",
    plCstNo: "",
    // Answer 21: the invoice's chosen registration, labelled when it is an
    // alternate — the packing sheets are where the old template carried PGI's.
    plGstin: gstinPrinted ? `GSTIN NO: ${gstinPrinted}` : "",
    custPlTinNo: "",
    custPlCstNo: "",
    custPlGstin: gstinPrinted ? `GSTIN NO: ${gstinPrinted}` : "",

    // PL-852
    // The sheet's two colour names: what the customer calls it, and our code —
    // the design master's (answer 20), the design's name until it has one.
    pl852ConsigneeColour: s(firstGoods?.description).split("-")[0] || "",
    pl852PacificColour: s(firstGoods?.itemCode) || s(firstGoods?.design),
    pl852PoNo: s(ord?.customerPoNumber),
    pl852Ref: s(pl?.number),

    // Annexure C1
    c1CompanyName: legalName,
    c1Iec: s(company.iec) ? `IEC ${s(company.iec)}` : "",
    // A form field, not a heading: the bare registration, no label.
    c1Gstin: gstin,
    c1FactoryLine1: s(factory[0]),
    c1FactoryLine2: s(factory[1]),
    c1FactoryLine3: s(factory[2]),
    c1FactoryLine4: s(factory[3]),
    c1ShippingBillNo: "",
    c1ShippingBillDate: "",
    c1BranchCode: "",
    c1Bin: s(company.pan),
    c1StuffingStart: "",
    c1StuffingEnd: "",
    c1StuffingTaken: "",
    c1ContainerSize: "",
    c1SealColourText: "",
    c1Signatory: "",

    // Annex D
    dDate: isoDate(inv.date),
    dFacilityCircular: "",
    dLossp: "",
    dPremisesName: legalName,
    dPremisesLine1: s(factory[0]),
    dPremisesLine2: s(factory[1]),
    dPremisesLine3: s(factory[2]),
    dPremisesLine4: s(factory[3]),
    dIncentives: "N/A",

    // VGM
    vgmCompanyName: s(company.shortName) || legalName,
    vgmAddressLine1: s(factory[0]),
    vgmAddressLine2: s(factory[1]),
    vgmContactLine: `Tel.: ${s(company.phone)}, Email ID : ${s(company.email)}`,
    vgmBookingNo: "",
    vgmSignatories: "",
    vgmDesignations: "",
    vgmContactNumbers: "",
    vgmContainerSize: "",
    vgmMaxWeight: "",
    vgmWeighbridge: "",
    vgmMethod: "",
    vgmCargoWeightKg: grossKg,
    vgmTareWeightKg: 0,
    vgmWeighingDate: "",
    vgmWeighingSlip: "",
    vgmCargoType: "",

    // SOP
    sopHasPo: s(ord?.poEvidence) === "PO" ? "YES" : "N/A",
    sopHasPiAck: s(ord?.poEvidence) === "PI_ACKNOWLEDGED" ? "YES" : "N/A",
    sopHasEmail: s(ord?.poEvidence) === "EMAIL" ? "YES" : "N/A",
    sopSamples: sampleLine ? s(sampleLine.qty) : "N/A",
    sopDeliverySchedule: s(ord?.deliverySchedule) || "N/A",
    sopSpecialPacking: s(ord?.specialPacking) || "N/A",
    sopForwarder: s(ord?.forwarderDetails) || "N/A",
    sopReceiver: s(ord?.receiverDetails) || "N/A",
    sopCustomerContact: s(ord?.customerContact),
  };

  // Never hand back a key the map does not know, and never miss one it does.
  // An empty derived value falls back to the template's boilerplate where the
  // cell is company boilerplate; where it is shipment data it stays empty.
  // The Bank group is the exception once a bank is KNOWN: its boilerplate is
  // Kotak's, and an invoice issued on ICICI (answer 23) must not print Kotak's
  // AD code and routing bank under ICICI's name because ICICI has none.
  const bankKnown = s(bank.name) !== "";
  const out: Record<string, string | number> = {};
  for (const rc of ROOT_CELLS) {
    const v = roots[rc.key];
    const empty = v === undefined || v === null || v === "" || (rc.kind === "number" && v === 0);
    if (empty && rc.key in TEMPLATE_BOILERPLATE && !(bankKnown && rc.group === "Bank")) { out[rc.key] = TEMPLATE_BOILERPLATE[rc.key]; continue; }
    out[rc.key] = v === undefined || v === null ? (rc.kind === "number" ? 0 : "") : v;
  }
  // texts.piDeclaration is unused here on purpose: the export invoice carries
  // its own two-line declaration, not the PI's paragraph.
  void texts;
  return out;
}

// ─────────────────── the goods lines and slabs the build takes ───────────────

export interface SlabRow {
  sl: number;
  sku: string;
  batch: string;
  slabNo: string;
  thick: string;
  lengthCm: number;
  widthCm: number;
  sqm: number;
  crateNo: number;
}

export interface CrateRow {
  marks: string;
  packages: string;
  description: string;
  thick: string;
  netWeight: number;
  slabs: number;
  qty: number;
  unit: string;
  /** Extras the invoice needs but the packing sheets do not. */
  rate?: number;
  batch?: string;
  crates?: number;
  isSample?: boolean;
  /** Sample lines only — PL-852's SAMPLES block prints size and box count. */
  size?: string;
  boxes?: string;
}

/**
 * Is this line's quantity a COUNT rather than an area?
 *
 * "Free Trade Sample Boxes, 8 NOS" carries a quantity of 8 pieces. Written into
 * the sheets' area columns it becomes 8 SQMT and 86.112 SQFT — eight cardboard
 * boxes declared to customs as eight square metres, and added to the shipment's
 * area totals. A count-unit line therefore keeps its piece count in the
 * Slabs/Pcs column and leaves the area columns empty.
 *
 * A sample line quoted in SQMT is NOT a count line: the reference shipment's
 * "400 pcs of 4in x 4in" really is 4.129 SQMT and prints as such.
 */
export function isCountUnit(unit: string | null | undefined): boolean {
  const u = s(unit).trim().toUpperCase().replace(/[.\s]+$/, "");
  if (!u) return false;
  return ["NO", "NOS", "PC", "PCS", "PIECE", "PIECES", "BOX", "BOXES", "SET", "SETS", "EA", "EACH", "UNIT", "UNITS", "BDL", "BDLS"].includes(u);
}

/** '3 cm' (how the ERP stores it) → '3CM' (how these sheets print it). A value
 *  that is already in sheet form is left alone. */
export function printThickness(canon: string | null | undefined): string {
  const t = s(canon).trim();
  if (!t) return "";
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(cm|mm)?$/i);
  if (!m) return t.toUpperCase();
  return `${m[1]}${(m[2] ?? "cm").toUpperCase()}`;
}

/** Group packed slabs into the goods lines the documents print: one per
 *  (design/SKU, thickness). PURE — the same grouping the summary block's
 *  SUMPRODUCT formulas reproduce inside Excel. */
export function goodsLinesFromSlabs(
  slabs: SlabRow[],
  opts: { marks?: string; packages?: string; unit?: string; rate?: number; netWeightTotalKg?: number } = {},
): CrateRow[] {
  const order: string[] = [];
  const byKey: Record<string, { sku: string; thick: string; batches: string[]; crates: number[]; slabs: number; sqft: number }> = {};
  for (const sl of slabs) {
    const key = `${sl.sku} ${sl.thick}`;
    if (!byKey[key]) { byKey[key] = { sku: sl.sku, thick: sl.thick, batches: [], crates: [], slabs: 0, sqft: 0 }; order.push(key); }
    const g = byKey[key];
    g.slabs += 1;
    g.sqft += Number.isFinite(sl.sqm) ? sl.sqm : 0;
    if (sl.batch && !g.batches.includes(sl.batch)) g.batches.push(sl.batch);
    if (Number.isFinite(sl.crateNo) && !g.crates.includes(sl.crateNo)) g.crates.push(sl.crateNo);
  }
  const totalSlabs = slabs.length || 1;
  const totalNet = opts.netWeightTotalKg ?? 0;
  return order.map((k) => {
    const g = byKey[k];
    return {
      marks: opts.marks ?? "",
      packages: opts.packages ?? "",
      description: g.sku,
      thick: g.thick,
      // Net weight split by slab count — the sheets carry one weight per line.
      netWeight: Math.round((totalNet * g.slabs) / totalSlabs),
      slabs: g.slabs,
      // The sheets quote SQMT; column H on the slab table is SQFT.
      qty: Math.round((g.sqft / 10.764) * 10000) / 10000,
      unit: opts.unit ?? "SQMT",
      rate: opts.rate,
      batch: g.batches.join(", "),
      crates: g.crates.length,
      isSample: false,
    };
  });
}

/**
 * The goods lines for one invoice: the packed slabs grouped by SKU and
 * thickness, then whatever sample lines the invoice carries appended.
 *
 * PURE, and the one place the shipment turns into printed lines — the Measmt
 * List summary block, the invoice's item rows and PL-852's summary all render
 * this same array, so the three cannot disagree.
 */
export function crateRowsFor(
  slabs: SlabRow[],
  opts: {
    marks?: string;
    packages?: string;
    unit?: string;
    netWeightTotalKg?: number;
    invoiceLines?: Array<{
      description?: string | null; itemCode?: string | null; design?: string | null; thickness?: string | null;
      rate?: number | null; qty?: number | null; unit?: string | null;
      slabs?: number | null; isSample?: boolean | null;
    }> | null;
  } = {},
): CrateRow[] {
  const invLines = Array.isArray(opts.invoiceLines) ? opts.invoiceLines : [];
  const goodsInv = invLines.filter((l) => !l?.isSample);
  const fallbackRate = typeof goodsInv[0]?.rate === "number" ? goodsInv[0]!.rate! : 0;
  const same = (a: unknown, b: string): boolean => { const x = s(a).trim().toUpperCase(); return x !== "" && x === b.trim().toUpperCase(); };

  const rows = goodsLinesFromSlabs(slabs, {
    marks: opts.marks, packages: opts.packages, unit: opts.unit,
    rate: fallbackRate, netWeightTotalKg: opts.netWeightTotalKg,
  }).map((row) => {
    // Prefer the rate the invoice actually quoted for this line. The row is
    // keyed by the design master's code when there is one and by the design
    // name when there is not (answer 20), so the line is found by whichever
    // of its code, description or design the row carries.
    const match = goodsInv.find((l) => same(l.itemCode, row.description) || same(l.description, row.description) || same(l.design, row.description));
    return typeof match?.rate === "number" ? { ...row, rate: match.rate } : row;
  });

  for (const l of invLines) {
    if (!l?.isSample) continue;
    rows.push({
      marks: "", packages: "",
      description: s(l.description) || s(l.itemCode) || "Free Trade Samples",
      thick: printThickness(l.thickness),
      netWeight: 0,
      slabs: typeof l.slabs === "number" ? l.slabs : (typeof l.qty === "number" ? Math.round(l.qty) : 0),
      qty: typeof l.qty === "number" ? l.qty : 0,
      unit: s(l.unit) || opts.unit || "SQMT",
      rate: typeof l.rate === "number" ? l.rate : 0,
      batch: "",
      crates: 0,
      isSample: true,
    });
  }
  return rows;
}

/**
 * A packing list's slabs as measurement-list rows, in crate then pack order.
 *
 * PURE, and it is where three decisions live, so they are tested rather than
 * buried in a route:
 *
 *  · The CUSTOMER's slab number and batch print when they asked for their own
 *    numbering, ours otherwise (OPEN-QUESTIONS §16). Both columns exist on
 *    commercial_packed_slab; only one prints per slab.
 *  · Area is recomputed from the centimetres rather than read from the stored
 *    sqft, so the figure in the goods line is exactly the one the sheet's own
 *    =L*W/10000*10.764 produces. A stored sqft that came from inches would
 *    differ in the third decimal and make the sheet look wrong.
 *  · Slabs with no crate sort first as crate 0 rather than being dropped — an
 *    unassigned slab is a packing mistake, and it has to be VISIBLE.
 *  · The SKU column is the design master's code (answer 20), looked up by
 *    `codeFor`; a design the master has no code for prints its NAME, and the
 *    customer's SKU is the last resort for a slab with no design at all. The
 *    printed sheet never carries a "no code" marker — the screen does.
 */
export function slabRowsFromPacking(packingList: {
  crates?: Array<{ id?: string | null; crateNo?: number | null }> | null;
  slabs?: Array<{
    crateId?: string | null; slabNumber?: number | string | null;
    customerSlabNo?: string | null; customerBatchNo?: string | null;
    design?: string | null; customerSku?: string | null; thickness?: string | null;
    batchKey?: string | null; batchNumber?: string | null;
    lengthCm?: number | string | null; widthCm?: number | string | null;
    sortOrder?: number | null;
  }> | null;
} | null | undefined, codeFor?: ((design: string | null | undefined) => string | null) | null): SlabRow[] {
  if (!packingList) return [];
  const crateNoById = new Map<string, number>();
  for (const c of packingList.crates ?? []) {
    if (c?.id !== null && c?.id !== undefined) crateNoById.set(String(c.id), Number(c.crateNo) || 0);
  }
  const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const crateOf = (slab: { crateId?: string | null }): number =>
    slab.crateId ? (crateNoById.get(String(slab.crateId)) ?? 0) : 0;

  return (packingList.slabs ?? []).slice()
    .sort((a, b) => (crateOf(a) - crateOf(b)) || (n(a.sortOrder) - n(b.sortOrder)))
    .map((slab, i) => {
      const lengthCm = n(slab.lengthCm);
      const widthCm = n(slab.widthCm);
      return {
        sl: i + 1,
        sku: s(codeFor?.(slab.design)) || s(slab.design) || s(slab.customerSku),
        batch: s(slab.customerBatchNo) || s(slab.batchNumber) || s(slab.batchKey),
        slabNo: s(slab.customerSlabNo) || s(slab.slabNumber),
        thick: printThickness(slab.thickness),
        lengthCm,
        widthCm,
        // The field is named `sqm` by the build contract; the column it feeds
        // is the sheet's SQFT area column. See SLAB_TABLE.areaUnit.
        sqm: Math.round((lengthCm * widthCm / 10000) * 10.764 * 10000) / 10000,
        crateNo: crateOf(slab),
      };
    });
}
