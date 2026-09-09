// The export document workbook, RUN against the real CIOT template.
//
// Nothing here matches source text. Every test either loads
// templates/commercial/export-docs-template.xlsx and checks the map against
// it, or builds a workbook, reads the bytes back with exceljs and asserts on
// what came out — formula counts per sheet, merged ranges, images, print
// areas, the values in the cells the map claims, and the shape of the three
// rebuilt tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  ROOT_CELLS, ROOT_KEYS, ROOT_GROUPS, groupedRoots, rootCell, TEMPLATE_BOILERPLATE,
  SLAB_TABLE, SUMMARY_TABLE, SUMMARY_LINKS, PACKING_ROWS, INVOICE_ROWS, PL852_TABLE,
  SHEET_NAMES, GENERATED_SHEETS, DEFAULT_ROOTS, goodsLinesFromSlabs, crateRowsFor, slabRowsFromPacking,
  printThickness, mtText, kgFromMt, labelled, fyOf, buyerPoRefText, isoDate,
  INVOICE_R_MIRRORS, INVOICE_R_LINKS, INVOICE_R_CLEARED, PARKED_ADDRESS_BLOCK,
  isCountUnit, SQFT_PER_SQM,
  GSTIN_INVOICE_ROOT_KEY, GSTIN_OTHER_SHEET_ROOT_KEYS,
  type SlabRow, type CrateRow,
} from "../src/lib/commercial/export-workbook/mapping.ts";
import {
  buildExportWorkbookWithLayout, loadTemplate, workbookFileName, crateGroups, slabWeightKg,
  TEMPLATE_RELATIVE_PATH,
} from "../src/lib/commercial/export-workbook/build.ts";
import { EXPORT_ROOT_GSTIN_KEY, EXPORT_ROOT_BANK_KEY, EXPORT_ROOT_SHEET_GSTIN_CELLS } from "../src/lib/commercial/invoice-rules.ts";

const TEMPLATE = path.join(process.cwd(), TEMPLATE_RELATIVE_PATH);

// ───────────────────────────── shared fixtures ───────────────────────────────

function makeSlabs(crates: number, perCrate: number): SlabRow[] {
  const out: SlabRow[] = [];
  let no = 150903;
  for (let c = 1; c <= crates; c++) {
    for (let i = 0; i < perCrate; i++) {
      out.push({
        sl: out.length + 1, sku: "OSWT10305A", batch: "1397", slabNo: String(no++),
        thick: "3CM", lengthCm: 347, widthCm: 201,
        sqm: Math.round((347 * 201 / 10000) * 10.764 * 10000) / 10000,
        crateNo: c,
      });
    }
  }
  return out;
}

const SNAPSHOT = {
  number: "PESPL/2780", date: "2026-08-06", currency: "USD", exchangeRate: 95.45,
  piNumber: "SAL-ORD/25-26/01477",
  consignee: { name: "Ciot Inc", lines: ["9225 Boul Saint-Laurent", "Montreal, QC H2N 1N2"], country: "Canada", tel: "514 389 6540", code: "USA-041" },
  notifyParty: { name: "Naturoc Division DE Ciot", lines: ["9225 Boul Saint-Laurent", "Montreal, QC H2N 1N2"], country: "Canada" },
  countryOfDestination: "Canada", deliveryTerms: "FREE ON BOARD-KATTUPALLI PORT",
  paymentTerms: "100% Cash Against Documents (CAD)",
  portOfLoading: "KATTUPALLI PORT, INDIA", portOfDischarge: "MONTREAL, QC, CANADA",
  containerNo: "TCLU 2787296", sealNo: "ESST 0112 6261", linerOtlNo: "LG 00923542",
  vehicleNo: "TN 04 AM 5520", amountInWords: "Eighteen Thousand Only",
  lines: [
    { itemCode: "OSWT10305A", description: "OASIS-Polish-3cm", rate: 5.2, isSample: false },
    { description: "Free Trade Samples", thickness: "2 cm", rate: 1, qty: 4.129, slabs: 400, isSample: true },
  ],
};

const PACKING = {
  number: "PL/26-27/0007", grossWeightKg: 24000, netWeightKg: 23500,
  packagesSummary: "07 Wooden Crate(S) + 08 Sample Box",
  crates: Array.from({ length: 7 }, (_, i) => ({ crateNo: i + 1 })),
};

const ORDER = {
  number: "SAL-ORD/26-27/01642", kind: "EXPORT",
  customerPoNumber: "PO-4068622", customerPoDate: "2026-07-03", poEvidence: "PO",
  client: { name: "Ciot Inc", commercialExt: { customerCode: "USA-041" } },
};

const SETTINGS = {
  company: {
    legalName: "Pacific Engineered Surfaces Private Limited",
    shortName: "Pacific Engineered Surfaces Pvt Ltd",
    addressLines: ["SY.NO.73/2B, Nallaganakotapalli Village, N.H.7,", "Hosur, Krishnagiri, Tamil Nadu - 635 117, India"],
    gstin: "33AALCP2750N1Z3", pan: "AALCP2750N", iec: "AALCP2750N", stateCode: "33", districtCode: "577",
    customsOffice: "OFFICE OF THE ASSISTANT COMMISSIONER OF CUSTOMS",
    hsnQuartz: "68101990", email: "customs@pacific-surfaces.com", phone: "+91 8870008798",
    lutText: "LUT text from settings",
  },
  banks: {
    export: {
      name: "Kotak Mahindra Bank Limited",
      address: "10/7, Umiya Landmark, Lavelle Road, Next to Chancery Hotel, Bangalore 560001, Karnataka, India",
      accountNo: "3214292773", swift: "KKBKINBBXXX", adCode: "0180038-8400009",
      routingBank: "The Bank of Newyork Mellon, No.1, Wall St., Newyork, NY 10015",
      routingSwift: "IRVTUS3NXXX",
    },
  },
  defaults: { countryOfOrigin: "India", preCarriageBy: "By Road" },
  texts: {},
};

function defaultRoots() {
  return DEFAULT_ROOTS(SNAPSHOT, PACKING, ORDER, SETTINGS);
}

interface SheetStats { formulas: number; literals: number; merges: number; images: number; printArea: string | undefined; state: string }

function statsOf(wb: ExcelJS.Workbook): Record<string, SheetStats> {
  const out: Record<string, SheetStats> = {};
  wb.eachSheet((ws) => {
    let formulas = 0, literals = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (c) => {
        const v = c.value as unknown;
        if (v && typeof v === "object" && ("formula" in (v as object) || "sharedFormula" in (v as object))) formulas += 1;
        else literals += 1;
      });
    });
    const merges = (ws.model as unknown as { merges?: string[] }).merges ?? [];
    out[ws.name] = {
      formulas, literals, merges: merges.length, images: ws.getImages().length,
      printArea: ws.pageSetup?.printArea, state: String(ws.state),
    };
  });
  return out;
}

function isFormula(cell: ExcelJS.Cell): boolean {
  const v = cell.value as unknown;
  return Boolean(v && typeof v === "object" && ("formula" in (v as object) || "sharedFormula" in (v as object)));
}

function formulaOf(cell: ExcelJS.Cell): string {
  const v = cell.value as { formula?: string; sharedFormula?: string } | null;
  return v?.formula ?? v?.sharedFormula ?? "";
}

// ───────────────────── a small Excel formula evaluator ───────────────────────
//
// The build writes formulas WITHOUT cached results (that is what
// fullCalcOnLoad is for), so "read the amounts back" means computing them.
// This resolves the subset of Excel the workbook actually uses — cell and
// range references across sheets, + - * / %, = comparison, SUM and SUMPRODUCT
// — following the chain from an invoice amount all the way down to the literal
// centimetres on the slab rows.
//
// It models Excel where it matters: text × number is #VALUE! (NaN here), not
// zero, and an empty cell is zero. It is cross-checked below against figures
// computed directly in JavaScript, so a broken evaluator cannot quietly pass a
// broken workbook.

type Scalar = number | string | boolean | null;
type Value = Scalar | Scalar[];

const REF_RE = /^\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?/;
const QUOTED_SHEET_RE = /^'([^']+)'!/;
const PLAIN_SHEET_RE = /^([A-Za-z_][A-Za-z0-9_.]*)!/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;
const NUM_RE = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const STR_RE = /^"((?:[^"]|"")*)"/;
const OPS = ["<>", "<=", ">=", "=", "<", ">", "+", "-", "*", "/", "^", "%", "(", ")", ","];

interface Tok { kind: "ref" | "sheet" | "name" | "num" | "str" | "op"; text: string }

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let s = src.trim();
  while (s.length) {
    if (/^\s/.test(s)) { s = s.replace(/^\s+/, ""); continue; }
    let m = QUOTED_SHEET_RE.exec(s) ?? PLAIN_SHEET_RE.exec(s);
    if (m && !REF_RE.test(s)) { out.push({ kind: "sheet", text: m[1] }); s = s.slice(m[0].length); continue; }
    m = REF_RE.exec(s);
    if (m) { out.push({ kind: "ref", text: m[0].replace(/\$/g, "").toUpperCase() }); s = s.slice(m[0].length); continue; }
    m = NAME_RE.exec(s);
    if (m) { out.push({ kind: "name", text: m[0].toUpperCase() }); s = s.slice(m[0].length); continue; }
    m = NUM_RE.exec(s);
    if (m) { out.push({ kind: "num", text: m[0] }); s = s.slice(m[0].length); continue; }
    m = STR_RE.exec(s);
    if (m) { out.push({ kind: "str", text: m[1].replace(/""/g, '"') }); s = s.slice(m[0].length); continue; }
    const op = OPS.find((o) => s.startsWith(o));
    if (!op) throw new Error(`cannot lex "${s}" (of "${src}")`);
    out.push({ kind: "op", text: op });
    s = s.slice(op.length);
  }
  return out;
}

function colNum(c: string): number {
  return c.toUpperCase().split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
}
function colName(n: number): string {
  let s = "", x = n;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = (x - m - 1) / 26; }
  return s;
}

/** Excel's coercion: empty is 0, TRUE is 1, non-numeric text is #VALUE!. */
function num(v: Scalar): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function makeEvaluator(wb: ExcelJS.Workbook) {
  const memo = new Map<string, Scalar>();
  const active = new Set<string>();

  function cellValue(sheet: string, addr: string): Scalar {
    const key = `${sheet}!${addr}`;
    if (memo.has(key)) return memo.get(key)!;
    if (active.has(key)) throw new Error(`circular reference at ${key}`);
    const ws = wb.getWorksheet(sheet);
    if (!ws) throw new Error(`no sheet "${sheet}" (asked for ${key})`);
    active.add(key);
    const raw = ws.getCell(addr).value as unknown;
    let out: Scalar;
    if (raw && typeof raw === "object") {
      const o = raw as { formula?: string; sharedFormula?: string; richText?: Array<{ text: string }>; error?: string };
      if (o.error) throw new Error(`${key} holds the error ${o.error}`);
      if (o.formula) out = toScalar(evaluate(sheet, o.formula));
      else if (o.sharedFormula) throw new Error(`${key} is a shared formula; this evaluator only reads explicit ones`);
      else if (o.richText) out = o.richText.map((t) => t.text).join("");
      else if (raw instanceof Date) out = raw.toISOString();
      else out = null;
    } else out = (raw === undefined ? null : raw as Scalar);
    active.delete(key);
    memo.set(key, out);
    return out;
  }

  function refValue(sheet: string, ref: string): Value {
    if (!ref.includes(":")) return cellValue(sheet, ref);
    const [a, b] = ref.split(":");
    const pa = /^([A-Z]{1,3})(\d+)$/.exec(a)!, pb = /^([A-Z]{1,3})(\d+)$/.exec(b)!;
    const c1 = Math.min(colNum(pa[1]), colNum(pb[1])), c2 = Math.max(colNum(pa[1]), colNum(pb[1]));
    const r1 = Math.min(+pa[2], +pb[2]), r2 = Math.max(+pa[2], +pb[2]);
    const out: Scalar[] = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(cellValue(sheet, `${colName(c)}${r}`));
    return out;
  }

  function toScalar(v: Value): Scalar {
    return Array.isArray(v) ? (v.length ? v[0] : null) : v;
  }

  function zip(a: Value, b: Value, f: (x: Scalar, y: Scalar) => Scalar): Value {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) throw new Error(`array sizes ${a.length} and ${b.length} do not match`);
      return a.map((x, i) => f(x, b[i]));
    }
    if (Array.isArray(a)) return a.map((x) => f(x, b as Scalar));
    if (Array.isArray(b)) return b.map((y) => f(a as Scalar, y));
    return f(a as Scalar, b as Scalar);
  }

  const eq = (x: Scalar, y: Scalar): boolean => {
    const blank = (v: Scalar) => v === null || v === undefined || v === "";
    if (blank(x) || blank(y)) return blank(x) && blank(y);
    if (typeof x === "string" || typeof y === "string") return String(x).toUpperCase() === String(y).toUpperCase();
    return num(x) === num(y);
  };

  /** SUMPRODUCT and SUM ignore text; a boolean counts as 1 or 0. */
  const summable = (v: Scalar): number => {
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number") return v;
    return 0;
  };

  function evaluate(sheet: string, src: string): Value {
    const toks = lex(src);
    let i = 0;
    const peek = () => toks[i];
    const eat = (t: string) => { if (toks[i]?.kind === "op" && toks[i].text === t) { i += 1; return true; } return false; };

    function primary(): Value {
      const t = toks[i];
      if (!t) throw new Error(`unexpected end of "${src}"`);
      if (t.kind === "op" && (t.text === "+" || t.text === "-")) { i += 1; const v = primary(); return t.text === "-" ? zip(v, 0, (x) => -num(x)) : v; }
      if (t.kind === "op" && t.text === "(") { i += 1; const v = expr(); if (!eat(")")) throw new Error(`missing ) in "${src}"`); return post(v); }
      if (t.kind === "num") { i += 1; return post(Number(t.text)); }
      if (t.kind === "str") { i += 1; return t.text; }
      if (t.kind === "sheet") {
        i += 1;
        const r = toks[i];
        if (!r || r.kind !== "ref") throw new Error(`"${t.text}!" is not followed by a reference in "${src}"`);
        i += 1;
        return post(refValue(t.text, r.text));
      }
      if (t.kind === "ref") { i += 1; return post(refValue(sheet, t.text)); }
      if (t.kind === "name") {
        const name = t.text; i += 1;
        if (!eat("(")) throw new Error(`unknown name ${name} in "${src}"`);
        const args: Value[] = [];
        if (!(peek()?.kind === "op" && peek()!.text === ")")) {
          do { args.push(expr()); } while (eat(","));
        }
        if (!eat(")")) throw new Error(`missing ) after ${name} in "${src}"`);
        return post(call(name, args));
      }
      throw new Error(`unexpected token "${t.text}" in "${src}"`);
    }

    function post(v: Value): Value {
      while (peek()?.kind === "op" && peek()!.text === "%") { i += 1; v = zip(v, 0, (x) => num(x) / 100); }
      return v;
    }

    function mul(): Value {
      let v = primary();
      for (;;) {
        if (eat("*")) v = zip(v, primary(), (x, y) => num(x) * num(y));
        else if (eat("/")) v = zip(v, primary(), (x, y) => num(x) / num(y));
        else return v;
      }
    }
    function add(): Value {
      let v = mul();
      for (;;) {
        if (eat("+")) v = zip(v, mul(), (x, y) => num(x) + num(y));
        else if (eat("-")) v = zip(v, mul(), (x, y) => num(x) - num(y));
        else return v;
      }
    }
    function expr(): Value {
      let v = add();
      for (;;) {
        if (eat("=")) v = zip(v, add(), (x, y) => eq(x, y));
        else if (eat("<>")) v = zip(v, add(), (x, y) => !eq(x, y));
        else return v;
      }
    }

    function call(name: string, args: Value[]): Value {
      const flat = args.flatMap((a) => (Array.isArray(a) ? a : [a]));
      if (name === "SUM") return flat.reduce((a: number, v) => a + summable(v), 0);
      if (name === "SUMPRODUCT") {
        const arrays = args.map((a) => (Array.isArray(a) ? a : [a]));
        const n = Math.max(...arrays.map((a) => a.length));
        let total = 0;
        for (let k = 0; k < n; k++) {
          let p = 1;
          for (const a of arrays) p *= summable(a.length === 1 ? a[0] : a[k]);
          total += p;
        }
        return total;
      }
      if (name === "ROUND") return Math.round(num(toScalar(args[0])) * 10 ** num(toScalar(args[1]))) / 10 ** num(toScalar(args[1]));
      throw new Error(`this evaluator does not implement ${name}()`);
    }

    const value = expr();
    if (i !== toks.length) throw new Error(`trailing "${toks[i].text}" in "${src}"`);
    return value;
  }

  return {
    /** The value Excel would show in that cell. */
    cell(sheet: string, addr: string): Scalar { return cellValue(sheet, addr); },
    /** …as a number, for the cells that hold money or area. */
    number(sheet: string, addr: string): number { return num(cellValue(sheet, addr)); },
  };
}

const round = (n: number, dp: number): number => Math.round(n * 10 ** dp) / 10 ** dp;

// Built once and reused: the build reads a 550 KB file and zips one back.
let built: Awaited<ReturnType<typeof buildExportWorkbookWithLayout>> | null = null;
let builtRead: ExcelJS.Workbook | null = null;
let template: ExcelJS.Workbook | null = null;

async function theBuild() {
  if (!built) {
    const slabs = makeSlabs(7, 7);
    const crateRows = crateRowsFor(slabs, {
      marks: "01 to 15", packages: "07 Wooden Crate(S) + 08 Sample Box",
      unit: "SQMT", netWeightTotalKg: 23100, invoiceLines: SNAPSHOT.lines,
    });
    built = await buildExportWorkbookWithLayout({ roots: defaultRoots(), slabs, crateRows });
    builtRead = new ExcelJS.Workbook();
    await builtRead.xlsx.load(built.buffer as unknown as ArrayBuffer);
  }
  if (!template) template = await loadTemplate();
  return { ...built!, read: builtRead!, template: template! };
}

// ───────────────────── 1. the map matches the real template ──────────────────

test("the template file is where the build expects it, with all 14 sheets", async () => {
  assert.ok(fs.existsSync(TEMPLATE), `template missing at ${TEMPLATE}`);
  const wb = await loadTemplate();
  const names = wb.worksheets.map((w) => w.name);
  assert.equal(names.length, 14);
  for (const n of SHEET_NAMES) assert.ok(names.includes(n), `template has no sheet "${n}"`);
  assert.deepEqual([...names].sort(), [...SHEET_NAMES].sort());
});

test("every ROOT_CELLS entry names a real sheet and a cell that is NOT a formula", async () => {
  const wb = await loadTemplate();
  const problems: string[] = [];
  for (const rc of ROOT_CELLS) {
    const ws = wb.getWorksheet(rc.sheet);
    if (!ws) { problems.push(`${rc.key}: no sheet "${rc.sheet}"`); continue; }
    if (!/^[A-Z]{1,2}\d{1,4}$/.test(rc.cell)) { problems.push(`${rc.key}: "${rc.cell}" is not a cell address`); continue; }
    if (isFormula(ws.getCell(rc.cell))) problems.push(`${rc.key}: ${rc.sheet}!${rc.cell} holds a formula — writing it would destroy the chain`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
  assert.ok(ROOT_CELLS.length >= 130, `only ${ROOT_CELLS.length} root cells mapped`);
});

test("the registration cells the order screen watches are still on the map", () => {
  // invoice-rules.exportRootOverrides names these keys as text (the order
  // screen must not import 1,500 lines of cell map into the browser bundle) and
  // tells the clerk which of them the SAVED form overrode. Rename a key here
  // and that warning would go quietly silent, so it is pinned from both ends.
  assert.equal(rootCell(EXPORT_ROOT_GSTIN_KEY)?.cell, "J8", "the exporter GSTIN line the invoice's registration lands on");
  assert.equal(rootCell(EXPORT_ROOT_BANK_KEY)?.cell, "G27", "the bank name the invoice's chosen account lands on");
  assert.ok(ROOT_KEYS.includes(EXPORT_ROOT_GSTIN_KEY));
  assert.ok(ROOT_KEYS.includes(EXPORT_ROOT_BANK_KEY));
  // Round two, answer 19: the three cells the SCOPE decides are watched too —
  // a saved form that types over one of them is what the workbook prints, so
  // the tab's "applied to every sheet" sentence is checked against them. The
  // screen's list and the map's must stay the same three keys.
  assert.equal(EXPORT_ROOT_GSTIN_KEY, GSTIN_INVOICE_ROOT_KEY);
  assert.deepEqual(EXPORT_ROOT_SHEET_GSTIN_CELLS.map((c) => c.key), [...GSTIN_OTHER_SHEET_ROOT_KEYS]);
  for (const c of EXPORT_ROOT_SHEET_GSTIN_CELLS) {
    assert.ok(rootCell(c.key), `${c.key} is not a root cell`);
    assert.ok(c.sheet.trim().length > 0, `${c.key} has no name to show the clerk`);
  }
});

test("root keys are unique, and so is every (sheet, cell) pair", () => {
  assert.equal(new Set(ROOT_KEYS).size, ROOT_KEYS.length, "duplicate root key");
  const addrs = ROOT_CELLS.map((r) => `${r.sheet}!${r.cell}`);
  assert.equal(new Set(addrs).size, addrs.length, "two keys write the same cell");
});

test("every root belongs to a declared group, and groupedRoots covers them all", () => {
  for (const rc of ROOT_CELLS) assert.ok(ROOT_GROUPS.includes(rc.group), `${rc.key} is in unknown group "${rc.group}"`);
  const grouped = groupedRoots();
  assert.equal(grouped.reduce((a, g) => a + g.cells.length, 0), ROOT_CELLS.length);
  assert.equal(rootCell("invoiceNo")?.cell, "H4");
  assert.equal(rootCell("nope"), null);
});

test("the boilerplate fallbacks are only for company constants, never customer data", () => {
  const forbidden = [
    "invoiceNo", "invoiceDate", "buyerPoRef", "consigneeName", "consigneeLine1", "consigneeCountry",
    "notifyName", "customerCode", "customerCountry", "marksAndNos", "packagesSummary",
    "containerNoText", "vehicleNoText", "eSealText", "grossWeightText", "netWeightText",
    "amountInWords", "exchangeRate", "ratePerSqft", "portOfDischarge", "pl852Ref", "salesPerson",
  ];
  for (const k of forbidden) {
    assert.ok(!(k in TEMPLATE_BOILERPLATE), `${k} must not fall back to the template — that prints the last shipment's data`);
  }
  for (const k of Object.keys(TEMPLATE_BOILERPLATE)) {
    assert.ok(ROOT_KEYS.includes(k), `TEMPLATE_BOILERPLATE has "${k}", which is not a root key`);
  }
});

test("SLAB_TABLE, SUMMARY_TABLE and PL852_TABLE describe rows that exist in the template", async () => {
  const wb = await loadTemplate();
  const ml = wb.getWorksheet(SLAB_TABLE.sheet)!;
  assert.ok(ml, "no Measmt List sheet");
  // The first slab row really is a slab row: the area column is the sheet's
  // own =L*W/10000*10.764 formula.
  assert.match(formulaOf(ml.getCell(`${SLAB_TABLE.columns.sqm}${SLAB_TABLE.firstRow}`)), /10000\*10\.764/);
  // The subtotal pattern row really holds a SUM over the crate above it.
  assert.match(formulaOf(ml.getCell(`H${SLAB_TABLE.patternRows.subtotal}`)), /^SUM\(H\d+:H\d+\)$/);
  assert.match(formulaOf(ml.getCell(`H${SLAB_TABLE.patternRows.total}`)), /^SUM\(H\d+:H\d+\)\/2$/);
  // The summary header row carries the labels the build rewrites.
  assert.equal(ml.getCell(`A${SUMMARY_TABLE.templateHeaderRow}`).value, "Summary");
  assert.equal(ml.getCell(`I${SUMMARY_TABLE.templateHeaderRow}`).value, "Crate(S)");

  const pl = wb.getWorksheet(PL852_TABLE.sheet)!;
  assert.equal(String(pl.getCell(`A${PL852_TABLE.patternRows.crateLabel}`).value).trim(), "CRATE  # 1");
  assert.equal(pl.getCell(`A${PL852_TABLE.patternRows.header1}`).value, "SL.NO");
  assert.match(formulaOf(pl.getCell(`H${PL852_TABLE.patternRows.total}`)), /^SUM\(H\d+:H\d+\)$/);
});

test("every PACKING_ROWS sheet exists, its block sits above its totals row, and its columns are single letters", async () => {
  const wb = await loadTemplate();
  for (const spec of PACKING_ROWS) {
    assert.ok(wb.getWorksheet(spec.sheet), `no sheet "${spec.sheet}"`);
    assert.ok(spec.firstRow < spec.lastRow, `${spec.sheet}: block is empty`);
    assert.ok(spec.lastRow < spec.totalRow, `${spec.sheet}: totals row is inside the block`);
    for (const [name, col] of Object.entries(spec.columns)) {
      if (col === undefined) continue;
      assert.match(col, /^[A-Z]{1,2}$/, `${spec.sheet}.${name} is not a column`);
    }
    for (const t of spec.totals) assert.match(t.column, /^[A-Z]{1,2}$/);
  }
  assert.equal(INVOICE_ROWS.sheet, "Invoice");
  // Every sheet the workbook lists as generated is really in the template.
  for (const g of GENERATED_SHEETS) assert.ok(wb.getWorksheet(g.sheet), `GENERATED_SHEETS names "${g.sheet}", which does not exist`);
});

test("SUMMARY_LINKS point at cells that currently reference the Measmt List", async () => {
  const wb = await loadTemplate();
  for (const link of SUMMARY_LINKS) {
    const ws = wb.getWorksheet(link.sheet)!;
    assert.ok(ws, `no sheet ${link.sheet}`);
    assert.match(formulaOf(ws.getCell(link.cell)), /Measmt List/, `${link.sheet}!${link.cell} does not reference the Measmt List`);
  }
});

// ─────────────────────── 2. the pure derivations ─────────────────────────────

test("fyOf rolls the financial year on 1 April", () => {
  assert.equal(fyOf("2026-08-06"), "FY 2026-27");
  assert.equal(fyOf("2026-04-01"), "FY 2026-27");
  assert.equal(fyOf("2026-03-31"), "FY 2025-26");
  assert.equal(fyOf(""), "");
  assert.equal(fyOf(null), "");
});

test("mtText and kgFromMt are inverses, so the invoice's MT and PL-852's kilos agree", () => {
  assert.equal(mtText(24000), "24.00 MT");
  assert.equal(mtText(23500), "23.50 MT");
  assert.equal(mtText(0), "");
  assert.equal(mtText(null), "");
  assert.equal(kgFromMt("24.00 MT"), 24000);
  assert.equal(kgFromMt("23.50 MT"), 23500);
  assert.equal(kgFromMt(mtText(23500)), 23500);
  // A bare number is what somebody typing kilos means.
  assert.equal(kgFromMt("23500 Kgs"), 23500);
  assert.equal(kgFromMt(""), 0);
  assert.equal(kgFromMt("not a weight"), 0);
});

test("labelled adds the printed label once and never twice", () => {
  assert.equal(labelled("Container No.", "TCLU 2787296"), "Container No. TCLU 2787296");
  assert.equal(labelled("Container No.", "Container No. TCLU 2787296"), "Container No. TCLU 2787296");
  assert.equal(labelled("Vehicle No.", ""), "Vehicle No.");
});

test("printThickness turns the stored '3 cm' into the sheet's '3CM'", () => {
  assert.equal(printThickness("3 cm"), "3CM");
  assert.equal(printThickness("2 cm"), "2CM");
  assert.equal(printThickness("3CM"), "3CM");
  assert.equal(printThickness("20mm"), "20MM");
  assert.equal(printThickness(null), "");
});

test("isoDate reads both an ISO string and the Date Prisma hands back", () => {
  assert.equal(isoDate("2026-07-03"), "2026-07-03");
  assert.equal(isoDate("2026-07-03T00:00:00.000Z"), "2026-07-03");
  assert.equal(isoDate(new Date(Date.UTC(2026, 6, 3))), "2026-07-03");
  assert.equal(isoDate(new Date("nonsense")), "");
  assert.equal(isoDate(null), "");
  assert.equal(isoDate("03/07/2026"), "");
});

test("buyerPoRefText builds the PO + PI reference the invoice prints", () => {
  assert.equal(
    buyerPoRefText({ piNumber: "SAL-ORD/25-26/01477" }, { customerPoNumber: "PO-4068622", customerPoDate: "2026-07-03" }),
    "PO-4068622 Dt: 03/07/2026 (PI-SAL-ORD/25-26/01477)",
  );
  // A @db.Date column arrives as a Date, not a string — the PO date is lost
  // without isoDate, and the customs reference goes out incomplete.
  assert.equal(
    buyerPoRefText({ piNumber: "SAL-ORD/25-26/01477" }, { customerPoNumber: "PO-4068622", customerPoDate: new Date(Date.UTC(2026, 6, 3)) }),
    "PO-4068622 Dt: 03/07/2026 (PI-SAL-ORD/25-26/01477)",
  );
  assert.equal(buyerPoRefText({ buyerPoRef: "typed by hand" }, null), "typed by hand");
  assert.equal(buyerPoRefText({}, null), "");
});

test("DEFAULT_ROOTS accepts the Date objects Prisma returns for date columns", () => {
  const roots = DEFAULT_ROOTS(
    { ...SNAPSHOT, date: new Date(Date.UTC(2026, 7, 6)) },
    PACKING,
    { ...ORDER, customerPoDate: new Date(Date.UTC(2026, 6, 3)) },
    SETTINGS,
  );
  assert.equal(roots.invoiceDate, "2026-08-06");
  assert.equal(roots.fyLabel, "FY 2026-27");
  assert.equal(roots.buyerPoRef, "PO-4068622 Dt: 03/07/2026 (PI-SAL-ORD/25-26/01477)");
  assert.equal(roots.dDate, "2026-08-06");
});

test("DEFAULT_ROOTS returns exactly one value per root cell, derived from the ERP", () => {
  const roots = defaultRoots();
  assert.deepEqual(Object.keys(roots).sort(), [...ROOT_KEYS].sort());
  assert.equal(roots.invoiceNo, "PESPL/2780");
  assert.equal(roots.invoiceDate, "2026-08-06");
  assert.equal(roots.fyLabel, "FY 2026-27");
  assert.equal(roots.buyerPoRef, "PO-4068622 Dt: 03/07/2026 (PI-SAL-ORD/25-26/01477)");
  assert.equal(roots.consigneeName, "Ciot Inc");
  assert.equal(roots.consigneeTel, "Tel: 514 389 6540");
  assert.equal(roots.customerCode, "USA-041");
  assert.equal(roots.customerCountry, "CANADA");
  assert.equal(roots.containerNoText, "Container No. TCLU 2787296");
  assert.equal(roots.grossWeightText, "24.00 MT");
  assert.equal(roots.netWeightText, "23.50 MT");
  assert.equal(roots.exchangeRate, 95.45);
  assert.equal(roots.ratePerSqft, 5.2);
  assert.equal(roots.exporterGstinText, "GSTIN NO: 33AALCP2750N1Z3");
  assert.equal(roots.hsnText, "HSN NO: 68101990");
  // OPEN-QUESTIONS §21: PESPL's GSTIN by default, not the sister company's.
  assert.equal(roots.plGstin, "GSTIN NO: 33AALCP2750N1Z3");
  assert.equal(roots.lutText, "LUT text from settings");
  assert.equal(roots.pl852ConsigneeColour, "OASIS");
  assert.equal(roots.pl852PacificColour, "OSWT10305A");
  assert.equal(roots.sopHasPo, "YES");
  assert.equal(roots.sopHasEmail, "N/A");
});

test("DEFAULT_ROOTS prints the GSTIN the invoice chose (answer 21), labelled when it is not PESPL's", () => {
  // No choice recorded (a snapshot frozen before the dropdown existed) → the company's own, unlabelled.
  const own = defaultRoots();
  assert.equal(own.exporterGstinText, "GSTIN NO: 33AALCP2750N1Z3");
  assert.equal(own.plGstin, "GSTIN NO: 33AALCP2750N1Z3");
  assert.equal(own.custPlGstin, "GSTIN NO: 33AALCP2750N1Z3");
  assert.equal(own.c1Gstin, "33AALCP2750N1Z3");

  // The sister company's, chosen on the invoice, on a snapshot with no answer
  // to round two's question 19 — i.e. one frozen before it was asked, which is
  // the reading snapshotExtras gives such a row: every GSTIN heading carries
  // it WITH its label, where the old sheets carried PGI's name; the Annexure
  // C1 form field takes the bare registration.
  const pgi = DEFAULT_ROOTS({ ...SNAPSHOT, gstin: "33AAFCP5374A1ZQ", gstinLabel: "Pacific Granites (India) Pvt Ltd" }, PACKING, ORDER, SETTINGS);
  assert.equal(pgi.exporterGstinText, "GSTIN NO: 33AAFCP5374A1ZQ (Pacific Granites (India) Pvt Ltd)");
  assert.equal(pgi.plGstin, "GSTIN NO: 33AAFCP5374A1ZQ (Pacific Granites (India) Pvt Ltd)");
  assert.equal(pgi.custPlGstin, "GSTIN NO: 33AAFCP5374A1ZQ (Pacific Granites (India) Pvt Ltd)");
  assert.equal(pgi.c1Gstin, "33AAFCP5374A1ZQ");
  assert.equal(pgi.exporterName, "Pacific Engineered Surfaces Private Limited", "the exporter's name does not change — only the registration under it");

  // The snapshot's company block, when that is all a stored row has.
  const viaCompany = DEFAULT_ROOTS({ ...SNAPSHOT, company: { gstin: "33AAFCP5374A1ZQ" } }, PACKING, ORDER, SETTINGS);
  assert.equal(viaCompany.exporterGstinText, "GSTIN NO: 33AAFCP5374A1ZQ");
  assert.equal(viaCompany.c1Gstin, "33AAFCP5374A1ZQ");
});

test("DEFAULT_ROOTS prints the bank the invoice chose (answer 23)", () => {
  const withDomestic = {
    ...SETTINGS,
    banks: { ...SETTINGS.banks, domestic: { name: "ICICI Bank", address: "5, PT Colony, R.T Nagar Main Road, Bangalore - 560032", accountNo: "020405012473", swift: "ICICINBBCTS" } },
  };
  // Default: Kotak, the export account.
  const kotak = DEFAULT_ROOTS(SNAPSHOT, PACKING, ORDER, withDomestic);
  assert.equal(kotak.bankName, "Kotak Mahindra Bank Limited");
  assert.equal(kotak.bankAccountNo, "A/c No. 3214292773");
  assert.equal(kotak.adCode, "AD Code: 0180038-8400009");

  // The key alone (a snapshot with no bank block) picks the settings' block.
  const icici = DEFAULT_ROOTS({ ...SNAPSHOT, bankKey: "domestic" }, PACKING, ORDER, withDomestic);
  assert.equal(icici.bankName, "ICICI Bank");
  assert.equal(icici.bankAccountNo, "A/c No. 020405012473");
  assert.equal(icici.bankSwift, "Swift Code - ICICINBBCTS");
  assert.equal(icici.adCode, "", "the domestic account has no AD code");
  assert.equal(icici.routingBankLine1, "");

  // The snapshot's own bank block is what the PDF printed, so it wins over the
  // settings even when the settings have since changed.
  const frozen = DEFAULT_ROOTS({ ...SNAPSHOT, bankKey: "export", bank: { name: "Kotak (old branch)", address: "Old Address, Bangalore", accountNo: "111", swift: "KKBKOLD" } }, PACKING, ORDER, withDomestic);
  assert.equal(frozen.bankName, "Kotak (old branch)");
  assert.equal(frozen.bankAccountNo, "A/c No. 111");
  assert.equal(frozen.bankSwift, "Swift Code - KKBKOLD");

  // A nonsense key falls to the export account rather than to nothing.
  assert.equal(DEFAULT_ROOTS({ ...SNAPSHOT, bankKey: "hdfc" }, PACKING, ORDER, withDomestic).bankName, "Kotak Mahindra Bank Limited");
});

test("the item code is the design master's (answer 20): code, else the design's name, never a marker", () => {
  const codeFor = (design: string | null | undefined): string | null =>
    ({ OASIS: "PES-OA-01" } as Record<string, string>)[String(design ?? "").toUpperCase()] ?? null;
  const rows = slabRowsFromPacking({
    crates: [{ id: "c1", crateNo: 1 }],
    slabs: [
      { crateId: "c1", slabNumber: 1, design: "Oasis", customerSku: "OSWT10305A", thickness: "3 cm", lengthCm: 347, widthCm: 201, sortOrder: 1 },
      { crateId: "c1", slabNumber: 2, design: "Vega", customerSku: "VGWT10301A", thickness: "3 cm", lengthCm: 347, widthCm: 201, sortOrder: 2 },
      { crateId: "c1", slabNumber: 3, customerSku: "NO-DESIGN", thickness: "3 cm", lengthCm: 347, widthCm: 201, sortOrder: 3 },
    ],
  }, codeFor);
  assert.equal(rows[0].sku, "PES-OA-01", "the master's code, whatever the case the floor typed");
  assert.equal(rows[1].sku, "Vega", "no code in the master → the design's name, not the customer's SKU and not a placeholder");
  assert.equal(rows[2].sku, "NO-DESIGN", "a slab with no design at all falls to the customer's SKU rather than to a blank row");

  // The goods lines take each invoice line's own rate whether the line is
  // found by its code or, where the master has none, by its design.
  const lines = [
    { itemCode: "PES-OA-01", description: "OSWT10305A", design: "Oasis", rate: 5.2, isSample: false },
    { itemCode: null, description: "VGWT10301A", design: "VEGA", rate: 6.4, isSample: false },
  ];
  const crateRows = crateRowsFor(rows, { netWeightTotalKg: 3000, invoiceLines: lines });
  assert.deepEqual(crateRows.map((r) => [r.description, r.rate]), [["PES-OA-01", 5.2], ["Vega", 6.4], ["NO-DESIGN", 5.2]]);

  // PL-852's "Pacific colour" is the first goods line's code, else its design.
  assert.equal(DEFAULT_ROOTS({ ...SNAPSHOT, lines }, PACKING, ORDER, SETTINGS).pl852PacificColour, "PES-OA-01");
  assert.equal(DEFAULT_ROOTS({ ...SNAPSHOT, lines: [lines[1]] }, PACKING, ORDER, SETTINGS).pl852PacificColour, "VEGA");
});

test("DEFAULT_ROOTS keeps company boilerplate but never invents customer data", () => {
  const bare = DEFAULT_ROOTS(null, null, null, null);
  assert.deepEqual(Object.keys(bare).sort(), [...ROOT_KEYS].sort());
  // Boilerplate survives — a customs document with a blank self-sealing
  // paragraph is a rejected document.
  assert.equal(bare.selfSealingText, TEMPLATE_BOILERPLATE.selfSealingText);
  assert.equal(bare.c1Signatory, TEMPLATE_BOILERPLATE.c1Signatory);
  assert.equal(bare.vgmContainerSize, "20 ft Close Top");
  assert.equal(bare.declarationLine1, TEMPLATE_BOILERPLATE.declarationLine1);
  // Customer and shipment data does NOT.
  assert.equal(bare.invoiceNo, "");
  assert.equal(bare.consigneeName, "");
  assert.equal(bare.customerCode, "");
  assert.equal(bare.marksAndNos, "");
  assert.equal(bare.amountInWords, "");
  assert.equal(bare.exchangeRate, 0);
});

test("goodsLinesFromSlabs groups by SKU and thickness and converts SQFT to SQMT", () => {
  const slabs = makeSlabs(2, 3);
  slabs.push({ sl: 7, sku: "VGWT10301A", batch: "1402", slabNo: "160001", thick: "2CM", lengthCm: 300, widthCm: 150, sqm: 48.438, crateNo: 3 });
  const lines = goodsLinesFromSlabs(slabs, { marks: "01 to 03", packages: "03 Crates", rate: 5.2, netWeightTotalKg: 3500 });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].description, "OSWT10305A");
  assert.equal(lines[0].slabs, 6);
  assert.equal(lines[0].crates, 2);
  assert.equal(lines[0].batch, "1397");
  assert.equal(lines[0].unit, "SQMT");
  // 6 slabs × 75.0757 sqft = 450.4544 sqft → /10.764 = 41.848 sqm
  assert.ok(Math.abs(lines[0].qty - (6 * 75.0757) / 10.764) < 0.01, `qty was ${lines[0].qty}`);
  assert.equal(lines[1].description, "VGWT10301A");
  assert.equal(lines[1].slabs, 1);
  // Net weight is split by slab count, so the parts add back to the whole.
  assert.equal(lines[0].netWeight + lines[1].netWeight, 3500);
});

test("crateRowsFor appends the invoice's sample lines and takes each line's own rate", () => {
  const rows = crateRowsFor(makeSlabs(1, 4), { netWeightTotalKg: 2000, invoiceLines: SNAPSHOT.lines });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].isSample, false);
  assert.equal(rows[0].rate, 5.2);
  assert.equal(rows[1].isSample, true);
  assert.equal(rows[1].description, "Free Trade Samples");
  assert.equal(rows[1].thick, "2CM");
  assert.equal(rows[1].slabs, 400);
  assert.equal(rows[1].rate, 1);
});

test("slabRowsFromPacking prints the customer's numbering when they wanted their own", () => {
  const rows = slabRowsFromPacking({
    crates: [{ id: "c1", crateNo: 1 }, { id: "c2", crateNo: 2 }],
    slabs: [
      // Out of order on purpose: crate 2 before crate 1, and sortOrder reversed.
      { crateId: "c2", slabNumber: 150910, design: "OASIS", customerSku: "OSWT10305A",
        thickness: "3 cm", batchNumber: "1397", lengthCm: 347, widthCm: 201, sortOrder: 2 },
      { crateId: "c1", slabNumber: 150903, design: "OASIS", thickness: "3 cm",
        batchKey: "B-1397", lengthCm: 347, widthCm: 201, sortOrder: 1,
        customerSlabNo: "CI-0001", customerBatchNo: "CIOT-77" },
      // No crate: a packing mistake, and it must stay visible rather than vanish.
      { slabNumber: 150999, design: "OASIS", thickness: "3 cm", lengthCm: 300, widthCm: 150, sortOrder: 9 },
    ],
  });
  assert.deepEqual(rows.map((r) => r.crateNo), [0, 1, 2]);
  // The customer's number and batch win where they were filled in.
  assert.equal(rows[1].slabNo, "CI-0001");
  assert.equal(rows[1].batch, "CIOT-77");
  assert.equal(rows[1].sku, "OASIS");
  // Ours where they were not.
  assert.equal(rows[2].slabNo, "150910");
  assert.equal(rows[2].batch, "1397");
  // Answer 20: with no design master the DESIGN NAME is the item code, even
  // where the order line carried a customer SKU — that SKU is the old stopgap
  // the owner's per-design codes replace.
  assert.equal(rows[2].sku, "OASIS");
  assert.equal(rows[2].thick, "3CM");
  // Area comes from the centimetres, exactly as the sheet's own formula does.
  assert.equal(rows[1].sqm, Math.round((347 * 201 / 10000) * 10.764 * 10000) / 10000);
  assert.deepEqual(slabRowsFromPacking(null), []);
  assert.deepEqual(slabRowsFromPacking({ crates: [], slabs: [] }), []);
});

test("slabRowsFromPacking feeds the build: its rows land on the measurement list", async () => {
  const rows = slabRowsFromPacking({
    crates: [{ id: "c1", crateNo: 1 }],
    slabs: [{ crateId: "c1", slabNumber: 150903, design: "OASIS", thickness: "3 cm",
      batchNumber: "1397", lengthCm: 347, widthCm: 201, sortOrder: 1 }],
  });
  const { buffer } = await buildExportWorkbookWithLayout({
    roots: defaultRoots(), slabs: rows, crateRows: crateRowsFor(rows, { netWeightTotalKg: 500 }),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Measmt List")!;
  assert.equal(ws.getCell(`B${SLAB_TABLE.firstRow}`).value, "OASIS");
  assert.equal(ws.getCell(`D${SLAB_TABLE.firstRow}`).value, "150903");
  assert.equal(ws.getCell(`E${SLAB_TABLE.firstRow}`).value, "3CM");
  assert.equal(ws.getCell(`I${SLAB_TABLE.firstRow}`).value, "01");
});

test("crateGroups keeps crates in the order they first appear", () => {
  const groups = crateGroups(makeSlabs(3, 2));
  assert.deepEqual(groups.map((g) => g.crateNo), [1, 2, 3]);
  assert.deepEqual(groups.map((g) => g.slabs.length), [2, 2, 2]);
  assert.deepEqual(crateGroups([]), []);
});

test("slabWeightKg ignores sample lines, which are counted in pieces not slabs", () => {
  const rows: CrateRow[] = [
    { marks: "", packages: "", description: "A", thick: "3CM", netWeight: 2350, slabs: 47, qty: 0, unit: "SQMT" },
    { marks: "", packages: "", description: "Samples", thick: "2CM", netWeight: 400, slabs: 400, qty: 0, unit: "SQMT", isSample: true },
  ];
  assert.equal(slabWeightKg(rows), 50);
  assert.equal(slabWeightKg([]), null);
});

test("workbookFileName turns the invoice number's slashes into dashes", () => {
  assert.equal(workbookFileName("PESPL/2780"), "PESPL-2780-export-docs.xlsx");
  assert.equal(workbookFileName("PESPL/0137/26-27"), "PESPL-0137-26-27-export-docs.xlsx");
  assert.equal(workbookFileName(null), "export-export-docs.xlsx");
});

// ─────────────── 3. the built workbook, read back from its bytes ─────────────

test("the build produces a workbook exceljs can re-open, with all 14 sheets", async () => {
  const { buffer, read } = await theBuild();
  assert.ok(buffer.length > 50_000, `only ${buffer.length} bytes`);
  // PK zip magic — a real xlsx, not an error page.
  assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK");
  assert.deepEqual(read.worksheets.map((w) => w.name), SHEET_NAMES);
});

test("nothing is lost: images, merged ranges, print areas and sheet visibility survive", async () => {
  const { read, template: tpl } = await theBuild();
  const before = statsOf(tpl);
  const after = statsOf(read);

  // Both embedded images come through.
  const imagesBefore = Object.values(before).reduce((a, s) => a + s.images, 0);
  const imagesAfter = Object.values(after).reduce((a, s) => a + s.images, 0);
  assert.equal(imagesAfter, imagesBefore, "an embedded image was dropped");
  assert.ok(imagesBefore >= 2, "the template should carry at least two images");

  for (const name of SHEET_NAMES) {
    // The three rebuilt sheets legitimately change shape; everything else must
    // come out byte-for-byte comparable in structure.
    const rebuilt = name === "Measmt List" || name === "PL-852";
    assert.equal(after[name].state, before[name].state, `${name}: visibility changed`);
    assert.equal(after[name].images, before[name].images, `${name}: image count changed`);
    if (!rebuilt) {
      assert.equal(after[name].merges, before[name].merges, `${name}: merged ranges changed`);
      assert.equal(after[name].printArea, before[name].printArea, `${name}: print area changed`);
    }
  }
});

test("sheets the build does not touch keep every formula they had", async () => {
  const { read, template: tpl } = await theBuild();
  const before = statsOf(tpl);
  const after = statsOf(read);
  // Gatepass, PI and SOP are pure derivations — nothing is written to them, so
  // not one formula may go missing.
  for (const name of ["Gatepass", "PI", "SOP", "VGM", "ANNEX –D", "ANNEXURE –C1"]) {
    assert.equal(after[name].formulas, before[name].formulas, `${name}: formula count changed`);
  }
});

test("the invoice sheets keep their formula chain: at most the goods rows are rewritten", async () => {
  const { read, template: tpl } = await theBuild();
  const before = statsOf(tpl);
  const after = statsOf(read);
  for (const spec of PACKING_ROWS) {
    const replaced = spec.lastRow - spec.firstRow + 1 + spec.totals.length;
    assert.ok(
      after[spec.sheet].formulas >= before[spec.sheet].formulas - replaced,
      `${spec.sheet}: ${before[spec.sheet].formulas} formulas became ${after[spec.sheet].formulas}, more than the ${replaced} rewritten`,
    );
  }
});

test("the root values landed in the cells the map names", async () => {
  const { read } = await theBuild();
  const roots = defaultRoots();
  const checked: string[] = [];
  for (const rc of ROOT_CELLS) {
    const v = roots[rc.key];
    if (v === "" || v === 0) continue;                    // blanks are cleared, nothing to check
    const cell = read.getWorksheet(rc.sheet)!.getCell(rc.cell);
    assert.ok(!isFormula(cell), `${rc.key}: ${rc.sheet}!${rc.cell} came out as a formula`);
    if (rc.kind === "number") {
      assert.equal(cell.value, v, `${rc.key} at ${rc.sheet}!${rc.cell}`);
    } else if (rc.kind === "date") {
      assert.ok(cell.value instanceof Date, `${rc.key}: expected a real date cell`);
      assert.equal((cell.value as Date).toISOString().slice(0, 10), v);
    } else {
      // A cell whose only content was rich text comes back as plain text.
      const got = typeof cell.value === "object" && cell.value !== null && "richText" in (cell.value as object)
        ? String((cell.value as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join(""))
        : String(cell.value ?? "");
      assert.equal(got, String(v), `${rc.key} at ${rc.sheet}!${rc.cell}`);
    }
    checked.push(rc.key);
  }
  assert.ok(checked.length > 80, `only ${checked.length} root values were non-blank enough to verify`);
});

test("the measurement list holds one row per slab, a subtotal per crate, and a grand total", async () => {
  const { read, layout } = await theBuild();
  const ws = read.getWorksheet("Measmt List")!;
  const c = SLAB_TABLE.columns;

  assert.equal(layout.crateSubtotalRows.length, 7, "one subtotal per crate");
  assert.equal(layout.slabFirstRow, SLAB_TABLE.firstRow);

  // Every slab row: literal data, a live area formula, the crate number.
  let counted = 0;
  let sl = 1;
  for (const sub of layout.crateSubtotalRows) {
    const first = counted === 0 ? layout.slabFirstRow : layout.crateSubtotalRows[layout.crateSubtotalRows.indexOf(sub) - 1] + 2;
    for (let r = first; r < sub; r++) {
      assert.equal(ws.getCell(`${c.sl}${r}`).value, sl, `row ${r}: serial out of order`);
      assert.equal(ws.getCell(`${c.sku}${r}`).value, "OSWT10305A");
      assert.equal(ws.getCell(`${c.lengthCm}${r}`).value, 347);
      assert.equal(ws.getCell(`${c.widthCm}${r}`).value, 201);
      assert.equal(formulaOf(ws.getCell(`${c.sqm}${r}`)), `F${r}*G${r}/10000*10.764`);
      sl += 1;
      counted += 1;
    }
    assert.match(formulaOf(ws.getCell(`H${sub}`)), /^SUM\(H\d+:H\d+\)$/, `row ${sub}: not a subtotal`);
  }
  assert.equal(counted, 49, "49 slabs written");

  assert.equal(ws.getCell(`G${layout.measmtTotalRow}`).value, "TOTAL");
  assert.equal(
    formulaOf(ws.getCell(`H${layout.measmtTotalRow}`)),
    `SUM(H${layout.slabFirstRow}:H${layout.slabLastRow})/2`,
  );
  // Nothing is left below the workbook's own last row.
  assert.equal(ws.getCell(`A${layout.measmtLastRow + 1}`).value, null);
  assert.equal(ws.pageSetup?.printArea, `A1:I${layout.measmtLastRow}`);
});

test("crate numbers run 01..07 and every slab carries its own crate", async () => {
  const { read, layout } = await theBuild();
  const ws = read.getWorksheet("Measmt List")!;
  const seen = new Set<string>();
  for (let r = layout.slabFirstRow; r <= layout.slabLastRow; r++) {
    const v = ws.getCell(`${SLAB_TABLE.columns.crateNo}${r}`).value;
    if (v !== null && v !== undefined) seen.add(String(v));
  }
  assert.deepEqual([...seen].sort(), ["01", "02", "03", "04", "05", "06", "07"]);
});

test("the summary block sums the slab rows and the invoice's goods lines read it", async () => {
  const { read, layout } = await theBuild();
  const ws = read.getWorksheet("Measmt List")!;
  const sc = SUMMARY_TABLE.columns;

  assert.equal(ws.getCell(`A${layout.summaryHeaderRow}`).value, "Summary");
  assert.equal(layout.summaryRowCount, 2, "one slab line plus one sample line");

  const r1 = layout.summaryFirstRow;
  assert.equal(ws.getCell(`${sc.colour}${r1}`).value, "OSWT10305A");
  assert.equal(ws.getCell(`${sc.thick}${r1}`).value, "3CM");
  // Counted and summed over the slab rows, on colour AND thickness.
  assert.equal(formulaOf(ws.getCell(`${sc.slabs}${r1}`)),
    SUMMARY_TABLE.countFormula(layout.slabFirstRow, layout.slabLastRow, r1));
  assert.equal(formulaOf(ws.getCell(`${sc.sqft}${r1}`)),
    SUMMARY_TABLE.sqftFormula(layout.slabFirstRow, layout.slabLastRow, r1));
  assert.equal(formulaOf(ws.getCell(`${sc.sqmt}${r1}`)), `+F${r1}/10.764`);

  // The sample line has no slab rows to sum, so its figures are literal.
  const r2 = layout.summaryFirstRow + 1;
  assert.equal(ws.getCell(`${sc.colour}${r2}`).value, "Free Trade Samples");
  assert.equal(ws.getCell(`${sc.slabs}${r2}`).value, 400);
  assert.equal(typeof ws.getCell(`${sc.sqmt}${r2}`).value, "number");

  // The totals row spans exactly the lines written.
  assert.equal(formulaOf(ws.getCell(`${sc.slabs}${layout.summaryTotalRow}`)),
    `SUM(${sc.slabs}${layout.summaryFirstRow}:${sc.slabs}${r2})`);

  // And the Invoice's goods rows point at those summary rows, wherever they landed.
  const inv = read.getWorksheet("Invoice")!;
  const ic = INVOICE_ROWS.columns;
  assert.equal(formulaOf(inv.getCell(`${ic.colour}${INVOICE_ROWS.firstRow}`)), `+'Measmt List'!${sc.colour}${r1}`);
  assert.equal(formulaOf(inv.getCell(`${ic.qty}${INVOICE_ROWS.firstRow}`)), `+'Measmt List'!${sc.sqmt}${r1}`);
  assert.equal(formulaOf(inv.getCell(`${ic.unit}${INVOICE_ROWS.firstRow}`)), `+'Measmt List'!${sc.sqmt}${layout.summaryHeaderRow}`);
  assert.equal(formulaOf(inv.getCell(`${ic.colour}${INVOICE_ROWS.firstRow + 1}`)), `+'Measmt List'!${sc.colour}${r2}`);
  // Line 1's rate is the rate-per-SQFT root beside it, converted to SQMT.
  assert.equal(formulaOf(inv.getCell(`${ic.rate!}${INVOICE_ROWS.firstRow}`)), `+L${INVOICE_ROWS.firstRow}*10.764`);
  assert.equal(inv.getCell(`L${INVOICE_ROWS.firstRow}`).value, 5.2);
  assert.equal(formulaOf(inv.getCell(`${ic.amount!}${INVOICE_ROWS.firstRow}`)),
    `+${ic.qty}${INVOICE_ROWS.firstRow}*${ic.rate}${INVOICE_ROWS.firstRow}`);
});

test("every other document sheet's goods rows read the Invoice's", async () => {
  const { read } = await theBuild();
  const ic = INVOICE_ROWS.columns;
  for (const spec of PACKING_ROWS) {
    if (spec.source !== "invoice") continue;
    const ws = read.getWorksheet(spec.sheet)!;
    for (let k = 0; k < 2; k++) {
      const r = spec.firstRow + k;
      const ir = INVOICE_ROWS.firstRow + k;
      assert.equal(formulaOf(ws.getCell(`${spec.columns.colour}${r}`)), `+Invoice!${ic.colour}${ir}`, `${spec.sheet} row ${r}`);
      assert.equal(formulaOf(ws.getCell(`${spec.columns.qty}${r}`)), `+Invoice!${ic.qty}${ir}`, `${spec.sheet} row ${r}`);
    }
    // The totals row sums only the rows that were written.
    for (const t of spec.totals.filter((x) => x.kind === "sum")) {
      assert.equal(formulaOf(ws.getCell(`${t.column}${spec.totalRow}`)),
        `SUM(${t.column}${spec.firstRow}:${t.column}${spec.firstRow + 1})`, `${spec.sheet} total ${t.column}`);
    }
  }
});

test("the rupee copy prices every line at the invoice's exchange rate", async () => {
  const { read } = await theBuild();
  const spec = PACKING_ROWS.find((s) => s.sheet === "Cust-Inv -INR")!;
  const ws = read.getWorksheet(spec.sheet)!;
  assert.equal(spec.rateInInr, true);
  assert.match(formulaOf(ws.getCell(`${spec.columns.rate!}${spec.firstRow}`)), /Invoice!F57$/);
  assert.equal(read.getWorksheet("Invoice")!.getCell("F57").value, 95.45);
});

test("the stale Invoice (R) sheet is rebuilt and its #REF! formulas are gone", async () => {
  const { read, template: tpl } = await theBuild();
  const before = tpl.getWorksheet("Invoice (R)")!;
  const after = read.getWorksheet("Invoice (R)")!;

  // The template really is broken and stale — that is why this sheet is rebuilt.
  let refsBefore = 0;
  before.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
    if (isFormula(c) && formulaOf(c).includes("#REF!")) refsBefore += 1;
  }));
  assert.ok(refsBefore > 0, "the template's Invoice (R) was expected to carry #REF! formulas");
  assert.equal(before.getCell("H4").value, "PESPL/1891");

  let refsAfter = 0;
  after.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
    if (isFormula(c) && formulaOf(c).includes("#REF!")) refsAfter += 1;
  }));
  assert.equal(refsAfter, 0, "Invoice (R) still has #REF! formulas");
  // Its goods rows now read this shipment's summary block.
  const spec = PACKING_ROWS.find((s) => s.sheet === "Invoice (R)")!;
  assert.match(formulaOf(after.getCell(`${spec.columns.colour}${spec.firstRow}`)), /^\+'Measmt List'!B\d+$/);
  // And the previous shipment's freight and duty numbers are cleared.
  assert.equal(after.getCell("J45").value, null);
  assert.equal(after.getCell("K48").value, null);
});

test("PL-852 is rebuilt from the same slabs, one block per crate", async () => {
  const { read, layout } = await theBuild();
  const ws = read.getWorksheet("PL-852")!;
  const c = PL852_TABLE.columns;

  assert.equal(String(ws.getCell(`${c.sl}${PL852_TABLE.firstBlockRow}`).value).trim(), "CRATE  # 1");
  assert.equal(ws.getCell(`${c.sl}${PL852_TABLE.firstBlockRow + 1}`).value, "SL.NO");
  const firstSlabRow = PL852_TABLE.firstBlockRow + 3;
  assert.equal(ws.getCell(`${c.colour}${firstSlabRow}`).value, "OSWT10305A");
  assert.equal(ws.getCell(`${c.slabNo}${firstSlabRow}`).value, "150903");
  assert.equal(formulaOf(ws.getCell(`${c.sqft}${firstSlabRow}`)), `F${firstSlabRow}*G${firstSlabRow}/10000*10.764`);
  // 23100 kg over 49 slabs.
  assert.equal(ws.getCell(`${c.weightKg}${firstSlabRow}`).value, 471);

  // Seven crate blocks, each ending in a TOTAL row.
  let blocks = 0;
  for (let r = PL852_TABLE.firstBlockRow; r <= layout.pl852LastRow; r++) {
    if (String(ws.getCell(`${c.sl}${r}`).value ?? "").startsWith("CRATE  #")) blocks += 1;
  }
  assert.equal(blocks, 7);
  assert.equal(ws.pageSetup?.printArea, `A1:J${layout.pl852LastRow}`);
  // Its two footer echoes follow the Measmt List wherever the block landed.
  assert.equal(formulaOf(ws.getCell(`A${layout.pl852LastRow}`)), `+'Measmt List'!A${layout.summaryFooterRows[1]}`);
});

test("the workbook is told to recalculate on open — formulas are written without cached results", async () => {
  // exceljs writes calcPr but does not read it back, so this is checked in the
  // file itself: without fullCalcOnLoad Excel shows the template's old numbers
  // until somebody presses F9.
  const { buffer } = await theBuild();
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("xl/workbook.xml")!.async("string");
  assert.match(xml, /<calcPr[^>]*fullCalcOnLoad="1"/);
  // And the formulas really do go out without cached values.
  const sheetXml = await zip.file("xl/worksheets/sheet7.xml")!.async("string");
  assert.match(sheetXml, /<f>/, "the measurement list should still carry formulas");
});

// ────────────────── 4. shapes the well was not sized for ─────────────────────

test("a shipment larger than the template's 60-row well pushes everything down, links and all", async () => {
  const slabs = makeSlabs(12, 8);            // 96 slabs, 12 crates → 108 rows needed
  const crateRows = crateRowsFor(slabs, { netWeightTotalKg: 40000, invoiceLines: SNAPSHOT.lines });
  const { buffer, layout } = await buildExportWorkbookWithLayout({ roots: defaultRoots(), slabs, crateRows });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  assert.ok(layout.measmtTotalRow > SLAB_TABLE.lastRowBudget, "the total row should have moved past the template's well");
  assert.equal(layout.crateSubtotalRows.length, 12);

  const ws = wb.getWorksheet("Measmt List")!;
  assert.equal(ws.getCell(`G${layout.measmtTotalRow}`).value, "TOTAL");
  assert.equal(ws.getCell(`A${layout.summaryHeaderRow}`).value, "Summary");
  assert.equal(ws.pageSetup?.printArea, `A1:I${layout.measmtLastRow}`);

  // The Invoice follows the block instead of pointing at the template's row 73.
  const inv = wb.getWorksheet("Invoice")!;
  assert.equal(
    formulaOf(inv.getCell(`${INVOICE_ROWS.columns.colour}${INVOICE_ROWS.firstRow}`)),
    `+'Measmt List'!B${layout.summaryFirstRow}`,
  );
  assert.notEqual(layout.summaryFirstRow, SUMMARY_TABLE.templateFirstRow);
  // And so does PL-852's echo of the container line.
  const pl = wb.getWorksheet("PL-852")!;
  assert.equal(formulaOf(pl.getCell(`A${layout.pl852LastRow - 1}`)), `+'Measmt List'!A${layout.summaryFooterRows[0]}`);
});

test("an invoice with no packing list still builds, with an empty measurement list", async () => {
  const { buffer, layout } = await buildExportWorkbookWithLayout({ roots: defaultRoots(), slabs: [], crateRows: [] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  assert.equal(layout.crateSubtotalRows.length, 0);
  const ws = wb.getWorksheet("Measmt List")!;
  assert.equal(ws.getCell(`A${SLAB_TABLE.firstRow}`).value, null, "no slab rows");
  assert.equal(ws.getCell(`G${layout.measmtTotalRow}`).value, "TOTAL");
  // The invoice number still landed, so the sheet is usable as a header-only draft.
  assert.equal(wb.getWorksheet("Invoice")!.getCell("H4").value, "PESPL/2780");
});

test("more goods lines than a sheet's block holds is refused by name, not silently truncated", async () => {
  const slabs: SlabRow[] = [];
  for (let i = 0; i < 9; i++) {
    slabs.push({ sl: i + 1, sku: `SKU-${i}`, batch: "1", slabNo: String(1000 + i), thick: "3CM", lengthCm: 300, widthCm: 150, sqm: 48.4, crateNo: 1 });
  }
  const crateRows = goodsLinesFromSlabs(slabs, {});
  assert.equal(crateRows.length, 9);
  await assert.rejects(
    () => buildExportWorkbookWithLayout({ roots: defaultRoots(), slabs, crateRows }),
    /room for 6 goods lines and this invoice has 9/,
  );
});

// ───────── 5. the money: two designs, two rates, one sample line ────────────
//
// The probe from the review: one export shipment carrying two designs at
// different rates and a box of free samples counted in pieces.

const SQM_PER_SLAB = (347 * 201) / 10000;                    // 6.9747 m² a slab
const SQFT_PER_SLAB = round(SQM_PER_SLAB * SQFT_PER_SQM, 10); // 75.0757… ft²
const LINE_SQM = round(SQM_PER_SLAB * 10, 3);                 // 69.747 m² a design

const TWO_LINE_SNAPSHOT = {
  ...SNAPSHOT,
  lines: [
    { itemCode: "OSWT10305A", description: "OASIS-Polish-3cm", rate: 5.2, isSample: false },
    { itemCode: "VGWT10301A", description: "VEGA-Polish-3cm", rate: 6.4, isSample: false },
    { description: "Free Trade Sample Boxes", qty: 8, unit: "NOS", slabs: 8, rate: 0, isSample: true },
  ],
};

function twoDesignSlabs(): SlabRow[] {
  const out: SlabRow[] = [];
  let no = 150903;
  for (const [sku, crate] of [["OSWT10305A", 1], ["VGWT10301A", 2]] as Array<[string, number]>) {
    for (let i = 0; i < 10; i++) {
      out.push({
        sl: out.length + 1, sku, batch: "1397", slabNo: String(no++), thick: "3CM",
        lengthCm: 347, widthCm: 201, sqm: round(SQFT_PER_SLAB, 4), crateNo: crate,
      });
    }
  }
  return out;
}

let twoLine: { read: ExcelJS.Workbook; layout: Awaited<ReturnType<typeof buildExportWorkbookWithLayout>>["layout"]; buffer: Buffer } | null = null;

async function theTwoLineBuild() {
  if (!twoLine) {
    const slabs = twoDesignSlabs();
    const crateRows = crateRowsFor(slabs, {
      marks: "01 to 02", packages: "02 Wooden Crate(S) + 01 Sample Box",
      unit: "SQMT", netWeightTotalKg: 12000, invoiceLines: TWO_LINE_SNAPSHOT.lines,
    });
    const roots = DEFAULT_ROOTS(TWO_LINE_SNAPSHOT, PACKING, ORDER, SETTINGS);
    const { buffer, layout } = await buildExportWorkbookWithLayout({ roots, slabs, crateRows });
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(buffer as unknown as ArrayBuffer);
    twoLine = { read, layout, buffer };
  }
  return twoLine;
}

test("the evaluator agrees with the arithmetic done outside it", async () => {
  const { read, layout } = await theTwoLineBuild();
  const ev = makeEvaluator(read);
  const sc = SUMMARY_TABLE.columns;
  const r1 = layout.summaryFirstRow;

  // One slab's area, straight off its own centimetres.
  assert.equal(round(ev.number("Measmt List", `H${SLAB_TABLE.firstRow}`), 6), round(SQFT_PER_SLAB, 6));
  // The summary block's SUMPRODUCT over ten of them, and its SQMT conversion.
  assert.equal(ev.number("Measmt List", `${sc.slabs}${r1}`), 10);
  assert.equal(round(ev.number("Measmt List", `${sc.sqft}${r1}`), 4), round(SQFT_PER_SLAB * 10, 4));
  assert.equal(round(ev.number("Measmt List", `${sc.sqmt}${r1}`), 3), LINE_SQM);
  // And the grand total's SUM-over-slabs-and-subtotals-halved idiom.
  assert.equal(round(ev.number("Measmt List", `H${layout.measmtTotalRow}`), 4), round(SQFT_PER_SLAB * 20, 4));
});

test("goods line 2 is priced per SQMT like line 1, not per SQFT against a SQMT quantity", async () => {
  const { read } = await theTwoLineBuild();
  const ev = makeEvaluator(read);
  const ic = INVOICE_ROWS.columns;
  const row1 = INVOICE_ROWS.firstRow, row2 = INVOICE_ROWS.firstRow + 1;

  // Both lines carry the same quantity, in square metres.
  assert.equal(round(ev.number("Invoice", `${ic.qty}${row1}`), 3), LINE_SQM);
  assert.equal(round(ev.number("Invoice", `${ic.qty}${row2}`), 3), LINE_SQM);

  // Line 1 has always converted: USD 5.20 per SQFT is USD 55.9728 per SQMT.
  assert.equal(round(ev.number("Invoice", `${ic.rate!}${row1}`), 4), round(5.2 * SQFT_PER_SQM, 4));
  assert.equal(round(ev.number("Invoice", `${ic.amount!}${row1}`), 2), round(LINE_SQM * 5.2 * SQFT_PER_SQM, 2));

  // Line 2 now does too. USD 6.40 per SQFT is USD 68.8896 per SQMT, so the
  // line is USD 4,804.84 — not the USD 446.38 a raw per-SQFT rate gave, which
  // under-invoiced the design by a factor of 10.764.
  const perSqftAgainstSqm = round(LINE_SQM * 6.4, 2);
  const converted = round(LINE_SQM * 6.4 * SQFT_PER_SQM, 2);
  assert.equal(perSqftAgainstSqm, 446.38);
  assert.equal(converted, 4804.84);
  assert.equal(round(ev.number("Invoice", `${ic.rate!}${row2}`), 4), round(6.4 * SQFT_PER_SQM, 4));
  assert.equal(round(ev.number("Invoice", `${ic.amount!}${row2}`), 2), converted);

  // The per-SQFT rate is parked in the same helper column line 1 uses, so a
  // user can still correct the rate the business actually quotes.
  const helper = INVOICE_ROWS.ratePerSqftColumn!;
  assert.equal(read.getWorksheet("Invoice")!.getCell(`${helper}${row1}`).value, 5.2);
  assert.equal(read.getWorksheet("Invoice")!.getCell(`${helper}${row2}`).value, 6.4);
  assert.equal(formulaOf(read.getWorksheet("Invoice")!.getCell(`${ic.rate!}${row2}`)), `+${helper}${row2}*${SQFT_PER_SQM}`);

  // …and the invoice total is the two lines, both converted (the sample line
  // beneath them is free).
  assert.equal(
    round(ev.number("Invoice", `${ic.amount!}${INVOICE_ROWS.totalRow}`), 2),
    round(LINE_SQM * 5.2 * SQFT_PER_SQM + LINE_SQM * 6.4 * SQFT_PER_SQM, 2),
  );
});

test("the copies of the invoice charge exactly what the invoice charges", async () => {
  const { read } = await theTwoLineBuild();
  const ev = makeEvaluator(read);
  const ic = INVOICE_ROWS.columns;
  for (const spec of PACKING_ROWS) {
    if (!spec.columns.rate || !spec.columns.amount) continue;
    const inr = spec.rateInInr ? 95.45 : 1;
    for (let k = 0; k < 2; k++) {
      const r = spec.firstRow + k;
      const ir = INVOICE_ROWS.firstRow + k;
      assert.equal(
        round(ev.number(spec.sheet, `${spec.columns.rate}${r}`), 4),
        round(ev.number("Invoice", `${ic.rate!}${ir}`) * inr, 4),
        `${spec.sheet}!${spec.columns.rate}${r}`,
      );
      assert.equal(
        round(ev.number(spec.sheet, `${spec.columns.amount}${r}`), 2),
        round(ev.number("Invoice", `${ic.amount!}${ir}`) * inr, 2),
        `${spec.sheet}!${spec.columns.amount}${r}`,
      );
    }
  }
});

test("Invoice (R) line 1 has a real rate and a real amount, not a zero from a text cell", async () => {
  const { read } = await theTwoLineBuild();
  const ev = makeEvaluator(read);
  const spec = PACKING_ROWS.find((s) => s.sheet === "Invoice (R)")!;
  const c = spec.columns;
  const row1 = spec.firstRow;

  // The sheet used to price line 1 off its own column L, which holds a text
  // formula (='Measmt List'!B73) — rate 0, amount 0, and a totals row summing
  // the zero. It reads the Invoice's finished rate instead.
  const rate = ev.number("Invoice (R)", `${c.rate!}${row1}`);
  const amount = ev.number("Invoice (R)", `${c.amount!}${row1}`);
  assert.ok(Number.isFinite(rate) && rate > 0, `Invoice (R) line 1 rate came out as ${rate}`);
  assert.ok(Number.isFinite(amount) && amount > 0, `Invoice (R) line 1 amount came out as ${amount}`);
  assert.equal(round(rate, 4), round(ev.number("Invoice", `${INVOICE_ROWS.columns.rate!}${INVOICE_ROWS.firstRow}`), 4));
  assert.equal(round(amount, 2), round(LINE_SQM * 5.2 * SQFT_PER_SQM, 2));

  // …and the totals row under it is the sum of two real amounts.
  const total = ev.number("Invoice (R)", `${c.amount!}${spec.totalRow}`);
  assert.ok(total > 0, `Invoice (R) total came out as ${total}`);
  assert.equal(round(total, 2), round(ev.number("Invoice", `${INVOICE_ROWS.columns.amount!}${INVOICE_ROWS.totalRow}`), 2));
});

test("no other customer's identifiers survive anywhere in a built workbook", async () => {
  const { read } = await theTwoLineBuild();
  // Everything the source template carried from the shipment it was last used
  // for: invoice PESPL/1891 of 04/09/2025 to Universal Stone LLC of Charlotte
  // against PI 00381, its container and seal, its expired LUT — plus the
  // address book of other Ciot and Pacific-USA entities parked off the
  // Invoice's print area.
  const stale = [
    "PESPL/1891", "00381", "Universal Stone", "Rozzelles", "Charlotte NC",
    "AD3309230441095", "WHSU 299119", "ESST 0099 6601", "S.R--MANISH",
    "CIOT NEW YORK", "Ciot Detroit", "Graniteridge", "8899 Jane Street",
    "1020 Lawrence", "pacificgranitesusa",
  ];
  const found: string[] = [];
  read.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value as unknown;
        let text: string;
        if (v && typeof v === "object") {
          const o = v as { formula?: string; sharedFormula?: string; richText?: Array<{ text: string }>; text?: string };
          text = o.formula ?? o.sharedFormula ?? o.text ??
            (o.richText ? o.richText.map((t) => t.text).join("") : JSON.stringify(v));
        } else text = String(v ?? "");
        for (const s of stale) {
          if (text.includes(s)) found.push(`${ws.name}!${cell.address} carries "${s}": ${text.slice(0, 60)}`);
        }
      });
    });
  });
  assert.deepEqual(found, [], found.join("\n"));
});

test("Invoice (R) is filled from this shipment's roots, header and all", async () => {
  const { read } = await theTwoLineBuild();
  const roots = DEFAULT_ROOTS(TWO_LINE_SNAPSHOT, PACKING, ORDER, SETTINGS);
  const ws = read.getWorksheet("Invoice (R)")!;

  // Every mirrored header cell holds the same value the Invoice's own root cell
  // holds — one field in the form, two sheets that cannot disagree.
  const problems: string[] = [];
  for (const m of INVOICE_R_MIRRORS) {
    const rc = rootCell(m.key)!;
    const want = roots[m.key];
    const cell = ws.getCell(m.cell);
    // An empty root CLEARS its mirror: a blank beats the last customer's
    // details on this customer's invoice.
    if (want === "" || want === null || want === undefined) {
      if (cell.value !== null) problems.push(`${m.cell} (${m.key}) should be blank, holds ${JSON.stringify(cell.value)}`);
      continue;
    }
    const got = rc.kind === "date" && cell.value instanceof Date
      ? (cell.value as Date).toISOString().slice(0, 10)
      : typeof cell.value === "object" && cell.value !== null && "richText" in (cell.value as object)
        ? (cell.value as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join("")
        : cell.value;
    if (String(got) !== String(want)) problems.push(`${m.cell} (${m.key}): ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));

  // Spot-check the three the review named.
  assert.equal(ws.getCell("H4").value, "PESPL/2780");
  assert.equal((ws.getCell("J4").value as Date).toISOString().slice(0, 10), "2026-08-06");
  assert.equal(ws.getCell("H5").value, "PO-4068622 Dt: 03/07/2026 (PI-SAL-ORD/25-26/01477)");

  // The consignee and notify blocks read the Invoice rather than this sheet's
  // own stale literals — its consignee used to point two rows off, at the
  // Invoice's notify party, and its notify block at Universal Stone LLC.
  for (const l of INVOICE_R_LINKS) assert.equal(formulaOf(ws.getCell(l.cell)), l.formula, `${l.cell}: ${l.note}`);
  const ev = makeEvaluator(read);
  assert.equal(ev.cell("Invoice (R)", "A12"), "Ciot Inc");
  assert.equal(ev.cell("Invoice (R)", "A19"), "Naturoc Division DE Ciot");

  // The previous shipment's freight, duty and tariff are cleared, not recomputed
  // against this invoice's value.
  for (const cell of INVOICE_R_CLEARED) assert.equal(ws.getCell(cell).value, null, `Invoice (R)!${cell} was not cleared`);
});

test("a line counted in pieces carries a piece count, never an area", async () => {
  const { read, layout } = await theTwoLineBuild();
  const ev = makeEvaluator(read);
  const ml = read.getWorksheet("Measmt List")!;
  const sc = SUMMARY_TABLE.columns;
  const sample = layout.summaryFirstRow + 2;

  assert.equal(layout.summaryRowCount, 3, "two designs and one sample line");
  assert.equal(ml.getCell(`${sc.colour}${sample}`).value, "Free Trade Sample Boxes");
  // The count stays…
  assert.equal(ml.getCell(`${sc.slabs}${sample}`).value, 8);
  // …and the area columns are empty. They used to read 8 SQMT and 86.112 SQFT
  // — eight cardboard boxes declared as eight square metres.
  assert.equal(ml.getCell(`${sc.sqft}${sample}`).value, null, "the sample line was given an area in SQFT");
  assert.equal(ml.getCell(`${sc.sqmt}${sample}`).value, null, "the sample line was given an area in SQMT");
  assert.notEqual(ml.getCell(`${sc.sqft}${sample}`).value, round(8 * SQFT_PER_SQM, 3));

  // So the shipment's own totals are the two slab lines and nothing else.
  const twoLinesSqm = round(LINE_SQM * 2, 3);
  assert.equal(round(ev.number("Measmt List", `${sc.sqmt}${layout.summaryTotalRow}`), 3), twoLinesSqm);
  assert.equal(round(ev.number("Measmt List", `${sc.sqft}${layout.summaryTotalRow}`), 3), round(SQFT_PER_SLAB * 20, 3));
  // But the pieces DO count in the Slabs/Pcs total, as the reference sheet does.
  assert.equal(ev.number("Measmt List", `${sc.slabs}${layout.summaryTotalRow}`), 28);

  // On the invoice the line reads "8 NOS" with no quantity, and the shipment's
  // quantity total is the two designs.
  const ic = INVOICE_ROWS.columns;
  const invRow = INVOICE_ROWS.firstRow + 2;
  assert.equal(read.getWorksheet("Invoice")!.getCell(`${ic.unit}${invRow}`).value, "NOS");
  assert.equal(ev.number("Invoice", `${ic.slabs}${invRow}`), 8);
  assert.equal(ev.number("Invoice", `${ic.qty}${invRow}`), 0);
  assert.equal(round(ev.number("Invoice", `${ic.qty}${INVOICE_ROWS.totalRow}`), 3), twoLinesSqm);
});

test("isCountUnit tells a piece count from an area", () => {
  for (const u of ["NOS", "nos.", " NOS ", "PCS", "Box", "boxes", "SET", "EA", "units"]) {
    assert.equal(isCountUnit(u), true, `${u} should be a count`);
  }
  for (const u of ["SQMT", "SQFT", "sqm", "MT", "KGS", "", null, undefined]) {
    assert.equal(isCountUnit(u), false, `${u} should not be a count`);
  }
});

test("Less Discount takes back the sample lines the block actually holds", async () => {
  // The reference invoice discounts its free-sample line out of the total with
  // =-J43, the row that line happened to sit on. The rebuilt block is a
  // different height every time, so the cell has to follow the samples: left
  // pointing at row 43 it discounts a blank row and the customer is invoiced
  // for the free samples.
  const slabs = twoDesignSlabs();
  const lines = [
    { itemCode: "OSWT10305A", rate: 5.2, isSample: false },
    { itemCode: "VGWT10301A", rate: 6.4, isSample: false },
    // Priced, like the reference shipment's 400 pieces of 4in x 4in.
    { description: "Free Trade Samples", thickness: "2 cm", qty: 4.129, slabs: 400, rate: 1, isSample: true },
  ];
  const crateRows = crateRowsFor(slabs, { netWeightTotalKg: 12000, invoiceLines: lines });
  const { buffer } = await buildExportWorkbookWithLayout({
    roots: DEFAULT_ROOTS({ ...SNAPSHOT, lines }, PACKING, ORDER, SETTINGS), slabs, crateRows,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ev = makeEvaluator(wb);

  const sampleRow = INVOICE_ROWS.firstRow + 2;
  const ic = INVOICE_ROWS.columns;
  assert.equal(
    formulaOf(wb.getWorksheet("Invoice")!.getCell(INVOICE_ROWS.discountCell!)),
    `-SUM(${ic.amount}${sampleRow}:${ic.amount}${sampleRow})`,
  );
  const sampleAmount = ev.number("Invoice", `${ic.amount!}${sampleRow}`);
  assert.equal(round(sampleAmount, 3), 4.129);
  assert.equal(round(ev.number("Invoice", INVOICE_ROWS.discountCell!), 3), -4.129);

  // With no sample line at all the cell is a plain zero, not a stale reference.
  const plain = await buildExportWorkbookWithLayout({
    roots: defaultRoots(), slabs, crateRows: crateRowsFor(slabs, { netWeightTotalKg: 12000, invoiceLines: lines.slice(0, 2) }),
  });
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(plain.buffer as unknown as ArrayBuffer);
  assert.equal(wb2.getWorksheet("Invoice")!.getCell(INVOICE_ROWS.discountCell!).value, 0);
});

test("the Invoice (R) and parked-address maps name cells that exist in the template", async () => {
  const wb = await loadTemplate();
  const ws = wb.getWorksheet("Invoice (R)")!;
  assert.ok(ws, "no Invoice (R) sheet");
  const addr = /^[A-Z]{1,2}\d{1,4}$/;
  const seen = new Set<string>();
  for (const m of INVOICE_R_MIRRORS) {
    assert.match(m.cell, addr, `${m.cell} is not a cell address`);
    assert.ok(rootCell(m.key), `INVOICE_R_MIRRORS maps "${m.key}", which is not a root key`);
    assert.ok(!seen.has(m.cell), `${m.cell} is mirrored twice`);
    seen.add(m.cell);
  }
  for (const l of INVOICE_R_LINKS) {
    assert.match(l.cell, addr);
    assert.ok(!seen.has(l.cell), `${l.cell} is both mirrored and linked`);
    seen.add(l.cell);
  }
  for (const c of INVOICE_R_CLEARED) {
    assert.match(c, addr);
    assert.ok(!seen.has(c), `${c} is both written and cleared`);
    seen.add(c);
  }
  // The four the review found really are literals in the source template.
  assert.equal(ws.getCell("H4").value, "PESPL/1891");
  assert.equal(ws.getCell("K8").value, "Universal Stone LLC");
  assert.match(String(ws.getCell("H5").value), /00381/);
  assert.match(String(ws.getCell("K59").value), /AD3309230441095/);

  // The parked block covers the address book without touching a root cell.
  const inv = wb.getWorksheet("Invoice")!;
  assert.equal(inv.getCell("K36").value, "CIOT NEW YORK INC,");
  const roots = ROOT_CELLS.filter((rc) => rc.sheet === PARKED_ADDRESS_BLOCK.sheet).map((rc) => rc.cell);
  assert.ok(roots.includes("K16"), "the notify party is a root cell inside the parked block and must survive");
  assert.ok(roots.includes(`${INVOICE_ROWS.ratePerSqftColumn}${INVOICE_ROWS.firstRow}`), "line 1's per-SQFT rate is a root cell inside the parked block");
});

test("a saved root value overrides the derived one, including blanking a cell", async () => {
  const roots = { ...defaultRoots(), invoiceNo: "PESPL/9999", advanceAuthText: "", grossWeightText: "31.20 MT" };
  const slabs = makeSlabs(2, 3);
  const { buffer } = await buildExportWorkbookWithLayout({
    roots, slabs, crateRows: crateRowsFor(slabs, { netWeightTotalKg: 3000 }),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const inv = wb.getWorksheet("Invoice")!;
  assert.equal(inv.getCell("H4").value, "PESPL/9999");
  assert.equal(inv.getCell("C49").value, null, "a blanked root must clear its cell");
  assert.equal(inv.getCell("B63").value, "31.20 MT");
});

// ── round two, answer 19: how far an alternate registration reaches ──────────
//
// "Prompt, then apply. Yes applies it to every sheet; no applies it to that
// document alone." The document the choice is made ON is the export commercial
// invoice, so Invoice!J8 always carries the choice; the three cells a hand
// re-typed elsewhere in the workbook — the packing list, the customer's copy of
// it and the Annexure C1 form — follow only on a yes. This is the mapping
// decision the workbook is built from, pinned here.

const PGI = { gstin: "33AAFCP5374A1ZQ", gstinLabel: "Pacific Granites (India) Pvt Ltd" };
const PGI_HEADING = "GSTIN NO: 33AAFCP5374A1ZQ (Pacific Granites (India) Pvt Ltd)";
const OWN_HEADING = "GSTIN NO: 33AALCP2750N1Z3";

test("answer 19: the GSTIN cells split into the invoice's own and the other sheets'", () => {
  // The split is enumerated, not guessed by name, and every key in it is a
  // real root cell — a GSTIN cell added to another sheet has to be classified.
  assert.equal(GSTIN_INVOICE_ROOT_KEY, "exporterGstinText");
  assert.deepEqual([...GSTIN_OTHER_SHEET_ROOT_KEYS], ["plGstin", "custPlGstin", "c1Gstin"]);
  for (const key of [GSTIN_INVOICE_ROOT_KEY, ...GSTIN_OTHER_SHEET_ROOT_KEYS]) {
    assert.ok(rootCell(key), `${key} is not a root cell`);
  }
  // and between them they are ALL the GSTIN cells the map knows
  const named = ROOT_CELLS.filter((rc) => /gstin/i.test(rc.key)).map((rc) => rc.key).sort();
  assert.deepEqual(named, [GSTIN_INVOICE_ROOT_KEY, ...GSTIN_OTHER_SHEET_ROOT_KEYS].sort());
  // they really are on four different sheets — that is what "every sheet" means
  const sheets = named.map((k) => rootCell(k)!.sheet);
  assert.deepEqual([...new Set(sheets)].sort(), ["ANNEXURE –C1", "Cust-PL", "Invoice", "Packing List"]);
});

test("answer 19 = YES: the chosen registration lands in every sheet's GSTIN cell", () => {
  const roots = DEFAULT_ROOTS({ ...SNAPSHOT, ...PGI, gstinApplyAll: true }, PACKING, ORDER, SETTINGS);
  assert.equal(roots.exporterGstinText, PGI_HEADING);
  assert.equal(roots.plGstin, PGI_HEADING);
  assert.equal(roots.custPlGstin, PGI_HEADING);
  assert.equal(roots.c1Gstin, "33AAFCP5374A1ZQ", "the C1 form field is the bare registration, label and all headings aside");
});

test("answer 19 = NO: the choice stays on the invoice and the other sheets keep the company's own", () => {
  const roots = DEFAULT_ROOTS({ ...SNAPSHOT, ...PGI, gstinApplyAll: false }, PACKING, ORDER, SETTINGS);
  assert.equal(roots.exporterGstinText, PGI_HEADING, "the invoice IS the document the choice was made for");
  assert.equal(roots.plGstin, OWN_HEADING);
  assert.equal(roots.custPlGstin, OWN_HEADING);
  assert.equal(roots.c1Gstin, "33AALCP2750N1Z3");
  assert.equal(roots.exporterName, "Pacific Engineered Surfaces Private Limited", "and nothing else about the exporter moves");
});

test("answer 19: the company's own registration reads the same whatever the answer", () => {
  // The question is only asked for an alternate, so a stored false on the
  // company's own must not blank or split anything.
  const yes = DEFAULT_ROOTS({ ...SNAPSHOT, gstinApplyAll: true }, PACKING, ORDER, SETTINGS);
  const no = DEFAULT_ROOTS({ ...SNAPSHOT, gstinApplyAll: false }, PACKING, ORDER, SETTINGS);
  for (const key of [GSTIN_INVOICE_ROOT_KEY, ...GSTIN_OTHER_SHEET_ROOT_KEYS]) {
    assert.equal(yes[key], no[key], `${key} differs on a company-own registration`);
  }
  assert.equal(no.plGstin, OWN_HEADING);
  assert.equal(no.c1Gstin, "33AALCP2750N1Z3");

  // The company's own is read from SETTINGS, never from the snapshot's company
  // block: buildInvoiceSnapshot overwrites that block's GSTIN with the CHOSEN
  // one, so reading it there would put the alternate on every sheet and make
  // the answer do nothing at all.
  const withStamped = DEFAULT_ROOTS(
    { ...SNAPSHOT, ...PGI, gstinApplyAll: false, company: { gstin: "33AAFCP5374A1ZQ" } },
    PACKING, ORDER, SETTINGS,
  );
  assert.equal(withStamped.exporterGstinText, PGI_HEADING);
  assert.equal(withStamped.plGstin, OWN_HEADING, "the stamped company block must not leak the alternate onto the packing list");
});

test("answer 19: the built workbook carries the split in the actual cells", async () => {
  const slabs = makeSlabs(2, 3);
  const crateRows = crateRowsFor(slabs, { netWeightTotalKg: 3000 });
  const roots = DEFAULT_ROOTS({ ...SNAPSHOT, ...PGI, gstinApplyAll: false }, PACKING, ORDER, SETTINGS);
  const { buffer } = await buildExportWorkbookWithLayout({ roots, slabs, crateRows });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const at = (key: string) => {
    const rc = rootCell(key)!;
    return wb.getWorksheet(rc.sheet)!.getCell(rc.cell).value;
  };
  assert.equal(at(GSTIN_INVOICE_ROOT_KEY), PGI_HEADING);
  assert.equal(at("plGstin"), OWN_HEADING);
  assert.equal(at("custPlGstin"), OWN_HEADING);
  assert.equal(at("c1Gstin"), "33AALCP2750N1Z3");

  // and on a yes, the same four cells all carry the alternate
  const wide = DEFAULT_ROOTS({ ...SNAPSHOT, ...PGI, gstinApplyAll: true }, PACKING, ORDER, SETTINGS);
  const out2 = await buildExportWorkbookWithLayout({ roots: wide, slabs, crateRows });
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(out2.buffer as unknown as ArrayBuffer);
  const at2 = (key: string) => {
    const rc = rootCell(key)!;
    return wb2.getWorksheet(rc.sheet)!.getCell(rc.cell).value;
  };
  assert.equal(at2(GSTIN_INVOICE_ROOT_KEY), PGI_HEADING);
  assert.equal(at2("plGstin"), PGI_HEADING);
  assert.equal(at2("custPlGstin"), PGI_HEADING);
  assert.equal(at2("c1Gstin"), "33AAFCP5374A1ZQ");
});

test("answer 19: the answer is prefill, and a saved form still overrides the cell", async () => {
  // The scope decides what the FORM is prefilled with; the saved form is what
  // the file carries (invoice-rules exportRootOverrides says so on the screen).
  const slabs = makeSlabs(1, 2);
  const roots = {
    ...DEFAULT_ROOTS({ ...SNAPSHOT, ...PGI, gstinApplyAll: false }, PACKING, ORDER, SETTINGS),
    plGstin: "GSTIN NO: 33AAFCP5374A1ZQ",
  };
  const { buffer } = await buildExportWorkbookWithLayout({
    roots, slabs, crateRows: crateRowsFor(slabs, { netWeightTotalKg: 1000 }),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const rc = rootCell("plGstin")!;
  assert.equal(wb.getWorksheet(rc.sheet)!.getCell(rc.cell).value, "GSTIN NO: 33AAFCP5374A1ZQ");
});
