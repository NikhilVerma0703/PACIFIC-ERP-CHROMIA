import * as XLSX from "xlsx";
import { canonicalMachineName } from "@/lib/robo/utils";

/* ── Header matching ──────────────────────────────────────────
   Headers are normalised to lowercase alphanumerics, so
   "RoyMix Body Weight (kg)" and "Roymix body weight kg" both match. */
function norm(h: unknown): string {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const RECORD_ALIASES: Record<string, string[]> = {
  serialNumber: ["sno", "sn", "serial", "serialno", "serialnumber", "srno"],
  date:         ["productiondate", "date", "proddate", "shiftdate"],
  shiftNumber:  ["shift", "shiftno", "shiftnumber"],
  operatorName: ["operator", "operatorname"],
  designName:   ["designname", "design"],
  thickness:    ["thicknesscm", "thickness", "slabthicknesscm"],
  slabNumber:   ["slabnumber", "slabno", "slab"],
  inTime:       ["intime", "in"],
  outTime:      ["outtime", "out"],
  // "robo2*" first: after the Robo1..Robo4 rename a freshly written register
  // headers these columns by the name the operator now sees, and the old
  // "roymix*" spellings still arrive from every workbook made before it. Both
  // have to match, or the body weight and cycle time import as blank.
  bodyWeight:   ["robo2bodyweightkg", "roymixbodyweightkg", "bodyweightkg", "bodyweight"],
  cycleTime:    ["robo2cycletimesec", "roymixcycletimesec", "cycletimesec", "roymixcycletime"],
  status:       ["status"],
  remarks:      ["remarks", "remark", "note", "notes"],
};

const SETUP_ALIASES: Record<string, string[]> = {
  date:            ["productiondate", "date"],
  shiftNumber:     ["shift", "shiftno", "shiftnumber"],
  designName:      ["designname", "design"],
  machine:         ["machine", "machinename"],
  programName:     ["programname", "program"],
  toolName:        ["toolname", "tool"],
  targetCycleTime: ["targetcycletimesec", "targetcycletime"],
  liquidName:      ["liquidname", "liquid"],
  powderName:      ["powdername", "powder"],
  rollerHeight:    ["rollerheightmm", "rollerheight"],
};

/** Maps our field names to the column index each one was found at. */
function mapColumns(header: unknown[], aliases: Record<string, string[]>) {
  const normalised = header.map(norm);
  const index: Record<string, number> = {};
  for (const [field, names] of Object.entries(aliases)) {
    const at = normalised.findIndex(h => h && names.includes(h));
    if (at >= 0) index[field] = at;
  }
  return index;
}

/* ── Cell coercion ───────────────────────────────────────────── */
function pad(n: number) { return String(n).padStart(2, "0"); }

function excelSerialToDate(serial: number): Date {
  // Excel epoch 1899-12-30, in whole days
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

/** Any reasonable date cell → "YYYY-MM-DD", or null. */
export function parseDateCell(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === "number" && isFinite(v)) {
    const d = excelSerialToDate(v);
    if (!isNaN(d.getTime())) return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return null;
  }
  const s = String(v).trim();
  if (!s || s === "-") return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  // DD/MM/YYYY (the format this module displays and exports)
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }
  return null;
}

/** Any reasonable time cell → "HH:MM", or null. */
export function parseTimeCell(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === "number" && isFinite(v)) {
    const frac = v - Math.floor(v);
    const mins = Math.round(frac * 24 * 60);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const s = String(v).trim();
  if (!s || s === "-") return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

function parseNumberCell(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s === "-" ? "" : s;
}

/* ── Result shapes ───────────────────────────────────────────── */
export interface ParsedRow {
  rowNumber: number;
  serialNumber: number | null;
  date: string;
  shiftNumber: number;
  operatorName: string;
  designName: string;
  thickness: number | null;
  slabNumber: string;
  inTime: string | null;
  outTime: string | null;
  bodyWeight: number | null;
  cycleTime: number | null;
  status: string;
  remarks: string | null;
}
export interface ParsedSetupEntry {
  machineName: string;
  programName: string | null;
  toolName: string | null;
  targetCycleTime: number | null;
  liquidName: string | null;
  powderName: string | null;
  rollerHeight: string | null;
}
export interface RowIssue { rowNumber: number; message: string }
export interface ParseResult {
  sheetName: string;
  detectedColumns: string[];
  missingColumns: string[];
  totalRows: number;
  rows: ParsedRow[];
  issues: RowIssue[];
  setups: Record<string, ParsedSetupEntry[]>;
  fatal: string | null;
}

export function setupKey(date: string, shiftNumber: number, designName: string): string {
  return `${date}|${shiftNumber}|${designName.trim().toUpperCase()}`;
}

const REQUIRED = ["date", "slabNumber"];

/** Parses a Complete Production style workbook. Never throws — fatal errors come back on the result. */
export function parseRegister(buf: Buffer): ParseResult {
  const empty: ParseResult = {
    sheetName: "", detectedColumns: [], missingColumns: [], totalRows: 0,
    rows: [], issues: [], setups: {}, fatal: null,
  };

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  } catch {
    return { ...empty, fatal: "The file could not be read as an .xlsx workbook." };
  }
  if (!wb.SheetNames.length) return { ...empty, fatal: "The workbook has no sheets." };

  const recordSheetName =
    wb.SheetNames.find(n => norm(n) === "productionrecords") ?? wb.SheetNames[0];
  const ws = wb.Sheets[recordSheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  if (aoa.length < 2) return { ...empty, sheetName: recordSheetName, fatal: "The sheet has no data rows." };

  const header = aoa[0] ?? [];
  const col = mapColumns(header, RECORD_ALIASES);
  const detectedColumns = Object.keys(col);
  const missingColumns = REQUIRED.filter(f => !(f in col));
  if (missingColumns.length > 0) {
    return {
      ...empty,
      sheetName: recordSheetName,
      detectedColumns,
      missingColumns,
      fatal: `Required column(s) not found: ${missingColumns.join(", ")}. Expected a "Complete Production" style sheet.`,
    };
  }

  const at = (row: unknown[], field: string): unknown =>
    field in col ? row[col[field]] : null;

  const rows: ParsedRow[] = [];
  const issues: RowIssue[] = [];
  let totalRows = 0;

  for (let i = 1; i < aoa.length; i++) {
    const raw = aoa[i] ?? [];
    const rowNumber = i + 1;

    // Blank spacer rows and the exported TOTAL row are not data
    const nonEmpty = raw.some(c => c !== null && c !== undefined && String(c).trim() !== "");
    if (!nonEmpty) continue;
    const slabNumber = text(at(raw, "slabNumber"));
    if (slabNumber.toUpperCase() === "TOTAL") continue;

    totalRows++;

    const date = parseDateCell(at(raw, "date"));
    if (!slabNumber) { issues.push({ rowNumber, message: "Slab Number is empty" }); continue; }
    if (!date) { issues.push({ rowNumber, message: "Production Date is missing or unreadable" }); continue; }

    const shiftRaw = parseNumberCell(at(raw, "shiftNumber"));
    const shiftNumber = shiftRaw && shiftRaw >= 1 && shiftRaw <= 3 ? Math.trunc(shiftRaw) : 1;

    const statusText = text(at(raw, "status")).toLowerCase().replace(/[^a-z]/g, "");
    const outTime = parseTimeCell(at(raw, "outTime"));
    const status =
      statusText.startsWith("inprocess") ? "IN_PROCESSING"
      : statusText.startsWith("complet") ? "COMPLETED"
      : outTime ? "COMPLETED" : "IN_PROCESSING";

    rows.push({
      rowNumber,
      serialNumber: parseNumberCell(at(raw, "serialNumber")),
      date,
      shiftNumber,
      operatorName: text(at(raw, "operatorName")),
      designName: text(at(raw, "designName")),
      thickness: parseNumberCell(at(raw, "thickness")),
      slabNumber,
      inTime: parseTimeCell(at(raw, "inTime")),
      outTime,
      bodyWeight: parseNumberCell(at(raw, "bodyWeight")),
      cycleTime: parseNumberCell(at(raw, "cycleTime")),
      status,
      remarks: text(at(raw, "remarks")) || null,
    });
  }

  /* Optional second sheet — rebuilds machine configuration on import */
  const setups: Record<string, ParsedSetupEntry[]> = {};
  const setupSheetName = wb.SheetNames.find(n => norm(n) === "productionsetup");
  if (setupSheetName) {
    const sAoa = XLSX.utils.sheet_to_json(wb.Sheets[setupSheetName], { header: 1, defval: null }) as unknown[][];
    if (sAoa.length >= 2) {
      const sCol = mapColumns(sAoa[0] ?? [], SETUP_ALIASES);
      const sAt = (row: unknown[], field: string): unknown => (field in sCol ? row[sCol[field]] : null);
      for (let i = 1; i < sAoa.length; i++) {
        const raw = sAoa[i] ?? [];
        // Fold "Robo2" back to the stored "Roymix" before it is handed on. The
        // consumer looks this up in a map keyed by stored name and DROPS what
        // it cannot find, so an un-canonicalised display name loses the row in
        // silence. See canonicalMachineName.
        const machineName = canonicalMachineName(text(sAt(raw, "machine")));
        const date = parseDateCell(sAt(raw, "date"));
        if (!machineName || !date) continue;
        const shiftRaw = parseNumberCell(sAt(raw, "shiftNumber"));
        const shiftNumber = shiftRaw && shiftRaw >= 1 && shiftRaw <= 3 ? Math.trunc(shiftRaw) : 1;
        const key = setupKey(date, shiftNumber, text(sAt(raw, "designName")));
        (setups[key] ||= []).push({
          machineName,
          programName: text(sAt(raw, "programName")) || null,
          toolName: text(sAt(raw, "toolName")) || null,
          targetCycleTime: parseNumberCell(sAt(raw, "targetCycleTime")),
          liquidName: text(sAt(raw, "liquidName")) || null,
          powderName: text(sAt(raw, "powderName")) || null,
          rollerHeight: text(sAt(raw, "rollerHeight")) || null,
        });
      }
    }
  }

  return {
    sheetName: recordSheetName,
    detectedColumns,
    missingColumns: [],
    totalRows,
    rows,
    issues,
    setups,
    fatal: null,
  };
}
