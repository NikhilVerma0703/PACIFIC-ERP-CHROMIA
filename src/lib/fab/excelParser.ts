// ============================================================
// lib/optimizer/excelParser.ts
//
// Parses the manager's Excel upload into PieceRequirement[].
// Supports the format your team uses: one row per piece type
// with columns: SlabCode, Length, Width, Thickness, Qty, Shape,
// Colour, Material, EdgePolish, Sink, SinkL, SinkW, Fabrication
// ============================================================

import * as XLSX from "xlsx";

export interface ExcelRow {
  drawingNumber: string;

  unitType?: string;
  units?: number;
  areaName?: string;

  pieceLabel?: string;
  description?: string;

  length: number;
  width: number;
  thickness?: number;

  sinkModel?: string;
  sinkCuts?: number;
  faucets?: number;

  depLength?: number;

  joints?: number;
  jointDepLength?: number;

  radiusCorners?: number;

  sqftPerPiece?: number;
  quantity: number;
  totalSqft?: number;

  notes?: string;
}

/** Column header aliases – flexible matching for different Excel templates */
const HEADER_MAP: Record<string, keyof ExcelRow> = {

  // Drawing Info
  "dwg#": "drawingNumber",
  "unit type": "unitType",
  "units": "units",
  "area": "areaName",

  // Piece Info
  "piece": "pieceLabel",
  "description": "description",

  // Dimensions
  "width (in)": "length",
  "depth (in)": "width",
  "thick": "thickness",

  // Sink
  "sink model": "sinkModel",
  "sink cuts": "sinkCuts",

  // Faucets
  "faucets": "faucets",

  // Edge Polish
  "de&p (in)": "depLength",

  // Joints
  "joints": "joints",
  "joint de&p (in)": "jointDepLength",

  // Radius Corners
  "r-corners": "radiusCorners",

  // Area Calculations
  "sqft/pc": "sqftPerPiece",
  "total pcs": "quantity",
  "total sqft": "totalSqft",

  // Notes
  "notes": "notes",
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-]/g, " ").trim();
}



function parseNum(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}


export interface ParseResult {
  rows: ExcelRow[];
  errors: string[];
  warnings: string[];
}

export function parseExcelBuffer(buffer: Buffer): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: ExcelRow[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
    console.log(
  "ALL SHEETS:",
  workbook.SheetNames
);
  } catch {
    return { rows, errors: ["Could not read Excel file. Make sure it is .xlsx or .xls format."], warnings };
  }

  if (workbook.SheetNames.length === 0) {
    return {
      rows,
      errors: ["Excel file has no sheets."],
      warnings,
    };
  }

  // Scan every sheet for the one that actually contains the "Dwg#" header
  // row, instead of assuming a fixed sheet index — files vary in how many
  // tabs/cover sheets they have before the real data sheet.
  let rawRows: any[][] = [];
  let headerRowIndex = -1;
  let matchedSheetName = "";

  for (const candidateName of workbook.SheetNames) {
    const candidateSheet = workbook.Sheets[candidateName];
    const candidateRows = XLSX.utils.sheet_to_json(
      candidateSheet,
      {
        header: 1,
        defval: "",
        raw: false,
      }
    ) as any[][];

    const idx = candidateRows.findIndex(
      (row) =>
        row.some(
          (cell) =>
            String(cell)
              .trim()
              .toLowerCase() === "dwg#"
        )
    );

    if (idx !== -1) {
      rawRows = candidateRows;
      headerRowIndex = idx;
      matchedSheetName = candidateName;
      break;
    }
  }

  console.log("MATCHED SHEET:", matchedSheetName || "(none)");

  if (headerRowIndex === -1) {
    return {
      rows,
      errors: [
        "Could not find Drawing Summary header row in any sheet.",
      ],
      warnings,
    };
  }

// Extract headers and data rows
const headers = rawRows[headerRowIndex];

const raw = rawRows
  .slice(headerRowIndex + 1)
  .map((row) => {
    const obj: Record<string, unknown> = {};

    headers.forEach((header, idx) => {
      obj[String(header).trim()] =
        row[idx] ?? "";
    });

    return obj;
  });

console.log(
  "DETECTED HEADER ROW:",
  headers
);

if (raw.length === 0) {
  return {
    rows,
    errors: [
      "No data rows found after header row.",
    ],
    warnings,
  };
}

  // Map original headers → normalized keys
  const firstRow = raw[0];
  const headerMapping = new Map<string, keyof ExcelRow>();
  for (const origKey of Object.keys(firstRow)) {
    const normalized = normalizeHeader(origKey);
    const mapped = HEADER_MAP[normalized];
    if (mapped) headerMapping.set(origKey, mapped);
  }

  if (!headerMapping.size) {
    warnings.push("No recognized column headers found. Trying positional mapping.");
  }

  // Required columns check
  const mappedFields = new Set(headerMapping.values());
  if (!mappedFields.has("drawingNumber")) {
  errors.push("Drawing Number (Dwg#) column not found.");
  return { rows, errors, warnings };
}
  if (!mappedFields.has("length") || !mappedFields.has("width")) {
    errors.push("Required columns 'Length' and 'Width' not found.");
    return { rows, errors, warnings };
  }
  if (!mappedFields.has("quantity")) {
    warnings.push("No 'Qty' column found. Defaulting to 1 piece per row.");
  }

  // Parse rows
  for (let rowIdx = 0; rowIdx < raw.length; rowIdx++) {
    const raw_row = raw[rowIdx];
    const mapped: Partial<ExcelRow> = {};

    for (const [origKey, field] of headerMapping.entries()) {
      const val = raw_row[origKey];
      switch (field) {
       case "length":
case "width":
case "thickness":
case "quantity":

case "units":

case "sinkCuts":

case "faucets":

case "depLength":

case "joints":

case "jointDepLength":

case "radiusCorners":

case "sqftPerPiece":

case "totalSqft":
  (mapped as any)[field] = parseNum(val);
  break;
        default:
          (mapped as any)[field] = String(val ?? "").trim();
      }
    }

    const length = mapped.length ?? 0;
    const width = mapped.width ?? 0;

    if (length <= 0 || width <= 0) {
      warnings.push(`Row ${rowIdx + 2}: Skipped — invalid dimensions (${length} × ${width})`);
      continue;
    }

    const row: ExcelRow = {
  drawingNumber:
    String(mapped.drawingNumber || ""),

  unitType:
    mapped.unitType,

  units:
    mapped.units,

  areaName:
    mapped.areaName,

  pieceLabel:
    mapped.pieceLabel,

  description:
    mapped.description,

  length,

  width,

  thickness:
    mapped.thickness,

  sinkModel:
    mapped.sinkModel,

  sinkCuts:
    mapped.sinkCuts,

  faucets:
    mapped.faucets,

  depLength:
    mapped.depLength,

  joints:
    mapped.joints,

  jointDepLength:
    mapped.jointDepLength,

  radiusCorners:
    mapped.radiusCorners,

  sqftPerPiece:
    mapped.sqftPerPiece,

  quantity:
    mapped.quantity || 1,

  totalSqft:
    mapped.totalSqft,

  notes:
    mapped.notes,
};

    rows.push(row);
  }

  if (rows.length === 0) {
    errors.push("No valid rows found after parsing.");
  }
console.log(
  "PARSED ROW COUNT:",
  rows.length
);
console.log(
  "UNIQUE DRAWINGS",
  [...new Set(rows.map(r => r.drawingNumber))]
);

console.log(
  "FIRST ROW:",
  rows[0]
);
  return { rows, errors, warnings };
}
