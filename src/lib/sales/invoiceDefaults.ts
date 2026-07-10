// Default invoice configs (moved out of the route file - Next.js routes may
// only export HTTP methods; other files import these too).
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
