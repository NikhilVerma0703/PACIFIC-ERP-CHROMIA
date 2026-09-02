// The daily production report, as the two-page A4 PDF the owner reads.
//
//     node scripts/make-daily-report-pdf.mjs [YYYY-MM-DD] [out.pdf]
//
// Defaults to yesterday, which is the day this is normally run for.
//
// FONTS: THE ORIGINAL IS CALIBRI + GEORGIA AND THIS TRIES THAT FIRST.
// The report was first built on the Windows machine, where both are system
// fonts, and that pairing is the design. On a machine without Calibri the
// nearest available substitute is used and the point size is scaled so the
// LINE WIDTHS still match — the columns keep their geometry and only the
// letterforms differ. Trebuchet was measured against the original PDF's own
// text widths (6.1% spread, the closest of the four candidates) rather than
// picked by eye. Run this on Windows and you get the original document back.
//
// Every number comes from scripts/dailyReportData.mjs. Nothing is typed here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PdfPrinter from "pdfmake/src/printer.js";
import { collect } from "./dailyReportData.mjs";
import { vendoredFontDirs } from "./vendoredFontDirs.mjs";

/* ------------------------------------------------------------------ fonts */
// WHERE THE BUNDLED FALLBACK LIVES - and the one line of this file that has to
// survive being put through a bundler.
//
// It used to be a single path built from import.meta.url, on the reasoning
// (correct as far as it went) that a serverless function does not run with the
// repo root as its working directory. Next bundles this .mjs into the route's
// lambda, and webpack REPLACES import.meta.url with a build-time string
// literal. The shipped bundle contained, verbatim:
//
//     fileURLToPath("file:///C:/Users/user/Desktop/ERP/scripts/make-daily-report-pdf.mjs")
//
// On Vercel that literal freezes to the BUILD container's path, /vercel/path0/
// scripts/..., so the fonts directory resolved to /vercel/path0/node_modules/...
// while the lambda runs from /var/task. Every candidate missed, the module
// threw "No usable fonts found" at import time, and the 09:00 report answered
// 500 before it ever reached the database or the mail server. The .ttf files
// were IN the lambda the whole time; nothing ever looked where they were.
//
// So the fallback is a LIST now, and it asks the runtime rather than the
// build. Each root is tried in turn and the first that actually holds the
// files wins, which also means a wrong guess costs nothing.
const HERE = path.dirname(fileURLToPath(import.meta.url));

// The candidates live in their own import-free module so a test can reach
// them; see the note there for what webpack does to import.meta.url. HERE is
// passed in and is allowed to be a path on a machine that no longer exists.
export const VENDORED_FONT_DIRS = vendoredFontDirs(HERE);


const FONT_DIRS = [
  "C:/Windows/Fonts",                            // the original pairing
  "/System/Library/Fonts/Supplemental",          // macOS
  "/usr/share/fonts/truetype/msttcorefonts",     // linux, if installed
  // LAST RESORT, and the one a SERVER actually hits. Liberation Sans ships
  // inside pdfjs-dist, already a dependency - so the scheduled run needs no
  // fonts installed on the box and no binaries committed here.
  //
  // BE CLEAR WHAT THIS COSTS: Liberation is metric-compatible with ARIAL, not
  // Calibri, so the column geometry this file exists to preserve is only exact
  // on a machine that has Calibri. The emailed copy is a faithful REPORT, not
  // a pixel-faithful reproduction of the original document. Run it on Windows
  // when the document itself is what matters.
  ...VENDORED_FONT_DIRS,
];
const find = (...names) => {
  for (const d of FONT_DIRS) for (const n of names) {
    const p = path.join(d, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
};
const family = (r, b, i, bi) => {
  const normal = find(...r);
  if (!normal) return null;
  return { normal, bold: find(...b) ?? normal, italics: find(...i) ?? normal,
           bolditalics: find(...bi) ?? find(...b) ?? normal };
};

const BODY_ORIGINAL = family(["calibri.ttf", "Calibri.ttf"], ["calibrib.ttf", "Calibri Bold.ttf"],
                             ["calibrii.ttf", "Calibri Italic.ttf"], ["calibriz.ttf", "Calibri Bold Italic.ttf"]);
const BODY_SUBSTITUTE = family(["Trebuchet MS.ttf", "trebuc.ttf"], ["Trebuchet MS Bold.ttf", "trebucbd.ttf"],
                               ["Trebuchet MS Italic.ttf", "trebucit.ttf"], ["Trebuchet MS Bold Italic.ttf", "trebucbi.ttf"]);
const DISPLAY = family(["Georgia.ttf", "georgia.ttf"], ["Georgia Bold.ttf", "georgiab.ttf"],
                       ["Georgia Italic.ttf", "georgiai.ttf"], ["Georgia Bold Italic.ttf", "georgiaz.ttf"]);

const BODY_SERVER = family(["LiberationSans-Regular.ttf"], ["LiberationSans-Bold.ttf"],
                           ["LiberationSans-Italic.ttf"], ["LiberationSans-BoldItalic.ttf"]);

const body = BODY_ORIGINAL ?? BODY_SUBSTITUTE ?? BODY_SERVER;
// Georgia has no bundled stand-in, so the display face falls back to the body
// one rather than failing outright: a report that reads is worth more than a
// heading in exactly the right serif.
const display = DISPLAY ?? body;
if (!body) {
  // THROW, do not process.exit. This module is imported by the scheduled job
  // as well as run from a shell, and exiting the process there would kill the
  // request with no error anybody could read.
  throw new Error("No usable fonts found. Looked in: " + FONT_DIRS.join(", "));
}

/** Which of the three tiers is in force. Reported by the CLI and logged by the
 *  scheduled job, so a PDF that looks different from the original is
 *  explainable rather than mysterious. */
export const FONT_TIER = BODY_ORIGINAL ? "Calibri (original)"
  : BODY_SUBSTITUTE ? "Trebuchet MS substitute"
  : "Liberation Sans (server fallback - column widths approximate)";
// Trebuchet sets ~3.6% wider than Calibri at the same nominal size; scaling the
// point size back keeps every column the width it was designed to be.
const S = BODY_ORIGINAL ? 1 : 0.964;
const printer = new PdfPrinter({ Body: body, Display: display });

/* --------------------------------------------------------------- palette */
// Sampled from the original PDF's own colour operators, not chosen again.
const INK = "#16191D", SLATE = "#232A33", GREY = "#5C6570",
      RULE = "#E4E7EA", SHADE = "#F2F3F5", PAPER = "#FFFFFF",
      HEAD = "#232A33", TOTAL = "#E4E7EA";

/* ----------------------------------------------------------------- helpers */
const pt = (n) => +(n * S).toFixed(2);
const hm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const hmWords = (m) => `${Math.floor(m / 60)} hours ${m % 60} minutes`;
const pct1 = (n) => (n == null ? "\u2014" : `${n.toFixed(1)}%`);
const pctI = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "\u2014");
const share = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "\u2014");
const TRACK = 1.15;                                   // the spaced section headings
const DASH = "\u2014", NDASH = "\u2013";
const WORDS = ["Zero","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve",
  "Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen","Twenty","Twenty-one","Twenty-two",
  "Twenty-three","Twenty-four","Twenty-five","Twenty-six","Twenty-seven","Twenty-eight","Twenty-nine","Thirty"];
const opens = (n) => WORDS[n] ?? String(n);

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const longDate = (d) => { const x = new Date(`${d}T12:00:00Z`);
  return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
const fileDate = (d) => { const x = new Date(`${d}T12:00:00Z`);
  return `${x.getUTCDate()}-${MONTHS[x.getUTCMonth()].slice(0,3)}-${x.getUTCFullYear()}`; };

const heading = (text, note) => ({
  columns: [
    { text: text, font: "Body", fontSize: pt(7.6), bold: true, color: INK, characterSpacing: TRACK, width: "auto" },
    note ? { text: note, font: "Body", fontSize: pt(6.9), color: GREY, margin: [10, 1.6, 0, 0] } : {},
  ],
  margin: [0, 5, 0, 2.5],
});

// One table look for the whole document: a hairline under the header row and
// between rows, nothing vertical, and a shaded header. Anything heavier turns
// a page of small numbers into a grid the eye cannot cross.
const LAYOUT = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.35),
  vLineWidth: () => 0,
  hLineColor: () => RULE,
  paddingTop: () => 1.65, paddingBottom: () => 1.65, paddingLeft: () => 4, paddingRight: () => 4,
  // Header dark, body striped, total shaded. The stripe is what lets the eye
  // cross a wide row of small numbers without losing the line.
  fillColor: (i, node) => (i === 0 ? HEAD
    : i === node.table.body.length - 1 ? TOTAL
    : i % 2 === 0 ? SHADE : null),
};
const th = (t, alignment) => ({ text: t, font: "Body", fontSize: pt(6.9), bold: true, color: PAPER, alignment });
const tdKey = (t) => ({ text: t, font: "Body", fontSize: pt(7.4), bold: true, color: INK });
const td = (t, alignment, o = {}) => ({ text: t, font: "Body", fontSize: pt(7.4), color: SLATE, alignment, ...o });
const tdMuted = (t, alignment) => ({ text: t, font: "Body", fontSize: pt(7.4), color: GREY, alignment });
const tdTotal = (t, alignment) => ({ text: t, font: "Body", fontSize: pt(7.4), bold: true, color: INK, alignment });
const note = (t) => ({ text: t, font: "Body", fontSize: pt(6.7), italics: true, color: GREY, margin: [0, 4, 0, 0], lineHeight: 1.2 });

/* ------------------------------------------------------------------ build */
function bandHeader(title, dateLong) {
  return {
    margin: [0, 0, 0, 0],
    columns: [
      { width: "*", stack: [
        { text: "PACIFIC SURFACES", font: "Display", bold: true, fontSize: 19, color: INK },
        { text: "QUARTZ SURFACES   \u00b7   PRODUCTION PLANT",
          font: "Body", fontSize: pt(6.9), color: GREY, characterSpacing: TRACK, margin: [1, 3, 0, 0] },
      ]},
      { width: "auto", stack: [
        { text: title, font: "Display", bold: true, fontSize: 12.5, color: INK, alignment: "right" },
        { text: `${dateLong}  \u00b7  06:00 to 06:00`, font: "Body", fontSize: pt(8.4), color: GREY,
          alignment: "right", margin: [0, 3, 0, 0] },
      ]},
    ],
  };
}

const headRule = () => ({ margin: [0, 6, 0, 8], canvas: [{ type: "line", x1: 0, y1: 0, x2: 523.28, y2: 0, lineWidth: 1, lineColor: INK }] });

const kpis = (tiles) => ({
  margin: [0, 0, 0, 9],
  table: { widths: tiles.map(() => "*"), body: [tiles.map(([value, label]) => ({
    stack: [
      { text: value, font: "Display", bold: true, fontSize: 16.2, color: INK },
      { text: label, font: "Body", fontSize: pt(6.2), color: GREY, characterSpacing: 0.7, margin: [0, 2.5, 0, 0] },
    ],
    margin: [0, 3, 0, 1],
  }))] },
  layout: {
    hLineWidth: () => 0.9, vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0 : 0.35),
    hLineColor: () => "#C9CFD6", vLineColor: () => RULE,
    paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: (i) => (i === 0 ? 0 : 8), paddingRight: () => 6,
  },
});

const prose = (spans) => ({
  text: spans, font: "Body", fontSize: pt(7.6), color: SLATE, lineHeight: 1.35, margin: [0, 0, 0, 2],
});
const strong = (t) => ({ text: t, bold: true, color: INK });

export function buildDoc(d) {
  const dateLong = longDate(d.date);
  const q = d.quality;
  const foot = (page) => ({
    margin: [36, 14, 36, 0],
    columns: [
      { text: `Pacific Surfaces  \u00b7  Daily Report  \u00b7  ${dateLong}`, font: "Body", fontSize: pt(6.9), color: GREY },
      { text: `Page ${page} of 3`, font: "Body", fontSize: pt(6.9), color: GREY, alignment: "right" },
    ],
  });

  return {
    pageSize: "A4",
    pageMargins: [36, 32, 36, 34],
    info: { title: `Pacific Surfaces Daily Report ${fileDate(d.date)}`, author: "Pacific Surfaces" },
    footer: (currentPage) => foot(currentPage),
    content: [
      ...pageOne(d, dateLong),
      { text: "", pageBreak: "before" },
      ...pageTwo(d, q, dateLong),
      { text: "", pageBreak: "before" },
      ...pageThree(d, d.maintenance, dateLong),
    ],
    defaultStyle: { font: "Body", fontSize: pt(7.6), color: SLATE },
  };
}

/* --------------------------------------------------------------- narrative */
// The "what happened" columns are the in-charges' own words, tidied — never
// invented here. `details` is what the man on the shift typed; the reason
// codes and the area of problem fill in when he typed nothing. An hour that
// lost no time and met its number says so, and an hour that lost time with no
// reason recorded says THAT, because a blank is a fact about the log.
const tidy = (s) => s.replace(/\s*\n+\s*/g, "; ").replace(/\s{2,}/g, " ").replace(/[.;]\s*$/, "").trim();
const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function hourNarrative(x) {
  if (x.details) return sentence(tidy(x.details));
  const reasons = x.reasons.filter((r) => !/^NO DEVIATION$/i.test(r));
  if (reasons.length) return sentence(tidy(reasons.join("; ")).toLowerCase());
  if (x.lost === 0 && x.made != null && x.std != null && x.made >= x.std) return "Ran to target";
  if (x.lost === 0) return "No delay recorded";
  const where = x.area.length ? `${x.area.join(" and ")} stop` : "Stoppage";
  return `${where}; reason not logged`;
}

function shiftNarrative(s) {
  const c = { cleaning: 0, power: 0, process: 0, breakdown: 0 };
  const areas = new Map();
  for (const x of s.rows) {
    const isPower = x.reasons.some((r) => /POWER/i.test(r));
    c.cleaning += x.delay.cleaning; c.process += x.delay.process;
    c.power += x.delay.power + (isPower ? x.delay.breakdown : 0);
    c.breakdown += isPower ? 0 : x.delay.breakdown;
    for (const a of x.area) areas.set(a, (areas.get(a) ?? 0) + x.lost);
  }
  if (s.lost === 0) return "Ran clean, no time lost";
  const [top] = Object.entries(c).sort((a, b) => b[1] - a[1]);
  const worstArea = [...areas].sort((a, b) => b[1] - a[1])[0]?.[0];
  const clean = c.cleaning >= s.lost * 0.5;
  if (top[0] === "power") return "Grid power cuts through the shift";
  if (top[0] === "cleaning") return clean ? "Ran clean; time went on planned cleaning" : "Cleaning and changeover took the time";
  if (top[0] === "breakdown") return worstArea ? `${worstArea} faults` : "Machine and electrical faults";
  return worstArea ? `Process delays at the ${worstArea.toLowerCase()}` : "Process delays";
}

/* ------------------------------------------------------------------ page 1 */
function pageOne(d, dateLong) {
  const { day, shifts, hours, cause } = d;
  // The standard is set on each hour's MIS entry from that hour's cycle time,
  // so it can change through the day. The old flat derivation ("the first
  // hour's std") had the PDF assert "Target is 14 slabs an hour" beside a
  // summed target its own arithmetic never used — and printed "Target is null"
  // on a day with no standards at all. KEEP IN STEP with the same block in
  // src/app/report/ceo/page.tsx (SheetProduction).
  const r2 = (v) => Math.round(v * 100) / 100;
  const stdGroups = (() => {
    const m = new Map();
    for (const x of hours) if (x.shift != null && x.made != null && x.std != null && x.std > 0) m.set(r2(x.std), (m.get(r2(x.std)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  })();
  const declaredNoStd = hours.filter((x) => x.shift != null && x.made != null && !(x.std != null && x.std > 0)).length;
  const stdRange = stdGroups.length === 0 ? null
    : stdGroups.length === 1 ? `${stdGroups[0][0]}`
    : `${stdGroups[stdGroups.length - 1][0]}–${stdGroups[0][0]}`;
  const stdNote =
    (stdGroups.length > 1
      ? `Each hour carries its own target (${stdRange} an hour this day)`
      : `Target is ${stdRange ?? DASH} slabs an hour`) +
    (declaredNoStd > 0
      ? `; ${declaredNoStd} declared hour${declaredNoStd === 1 ? "" : "s"} carr${declaredNoStd === 1 ? "ies" : "y"} no standard and count${declaredNoStd === 1 ? "s" : ""} zero`
      : "");
  const designs = [...new Set(hours.map((x) => (x.batch && x.design ? `${x.batch}, ${x.design}` : null)).filter(Boolean))];
  const blank = hours.filter((x) => x.made == null).length;
  const best = [...shifts].filter((s) => s.pct != null).sort((a, b) => b.pct - a.pct)[0];
  const worst = [...shifts].filter((s) => s.pct != null).sort((a, b) => a.pct - b.pct)[0];
  const causeRows = [
    ["Cleaning and batch changeover", cause.cleaning, "Dry and full cleans, and the clean into the next batch"],
    ["Power cuts from the grid", cause.power, "Supply lost from the grid; the shift's own notes place this time here"],
    ["Process delays", cause.process, "Holds at the press, oven and rubber line, and waiting on material from the mixer"],
    ["Machine and electrical breakdowns", cause.breakdown, "Distributor, oven and electrical faults"],
  ].sort((a, b) => b[1] - a[1]).filter((r) => r[1] > 0);
  const noReason = hours.filter((x) => x.lost > 0 && x.reasons.filter((r) => !/NO DEVIATION/i.test(r)).length === 0);

  return [
    bandHeader("Daily Production Report", dateLong), headRule(),
    kpis([
      [String(day.made), "SLABS PRODUCED"],
      [String(day.target), "TARGET FOR THE DAY"],
      [pct1(day.pct), "ACHIEVEMENT"],
      [hm(day.lost), "TIME LOST"],
      [`${day.hoursRun} of ${day.hoursTotal}`, "HOURS THE LINE RAN"],
    ]),
    prose([
      "The plant produced ", strong(`${day.made} slabs against a target of ${day.target}`),
      `, ${day.pct.toFixed(1)} per cent of standard rate, and lost `, strong(`${day.lost} minutes`),
      ` ${DASH} ${hmWords(day.lost)} of the twenty-four ${DASH} to stoppages. The line ran `,
      strong(designs.join(" and ")),
      `. ${blank ? `${blank === 1 ? "One hour" : `${blank} hours`} carried no output at all and ${blank === 1 ? "is" : "are"} shown as such; ${blank === 1 ? "it is" : "they are"} left out of the target rather than counted as misses. ` : ""}`,
      `${best.letter} shift ran best at ${best.pct.toFixed(1)} per cent; ${worst.letter} shift ran worst at ${worst.pct.toFixed(1)} per cent.`,
    ]),
    heading("SHIFT BY SHIFT"),
    { table: {
        headerRows: 1, widths: [22, 52, 62, 30, 32, 40, 32, "*"],
        body: [
          [th("SHIFT"), th("HOURS (IST)"), th("IN-CHARGE"), th("SLABS", "right"), th("TARGET", "right"),
           th("ACHIEVED", "right"), th("LOST", "right"), th("WHAT SHAPED THE SHIFT")],
          ...shifts.map((s) => [
            td(s.letter), td(s.label), td(s.incharge ?? DASH), td(String(s.made), "right"),
            td(String(s.target), "right"), td(pct1(s.pct), "right"), td(`${s.lost} m`, "right"),
            tdMuted(shiftNarrative(s)),
          ]),
          [tdTotal("DAY"), tdTotal("24 hours"), tdTotal("All three"), tdTotal(String(day.made), "right"),
           tdTotal(String(day.target), "right"), tdTotal(pct1(day.pct), "right"), tdTotal(`${day.lost} m`, "right"),
           tdTotal(`Time lost equals ${((100 * day.lost) / 1440).toFixed(1)}% of the day`)],
        ],
      }, layout: LAYOUT },
    heading("HOUR BY HOUR", `${stdNote}. A dash means the line produced nothing that hour.`),
    { table: {
        headerRows: 1, widths: [38, 96, 30, 32, 32, "*"],
        body: [
          [th("HOUR"), th("BATCH AND DESIGN"), th("MADE", "right"), th("TARGET", "right"), th("LOST", "right"), th("WHAT HAPPENED")],
          ...hours.map((x) => [
            td(x.hour), td([x.batch, x.design].filter(Boolean).join("  ")),
            td(x.made == null ? DASH : String(x.made), "right"),
            td(x.made == null ? DASH : String(x.std ?? DASH), "right"),
            td(x.lost ? `${x.lost} m` : NDASH, "right"),
            tdMuted(hourNarrative(x)),
          ]),
          [tdTotal("DAY"), tdTotal(designs.map((s) => s.split(",")[0]).join(" / ")),
           tdTotal(String(day.made), "right"), tdTotal(String(day.target), "right"),
           tdTotal(`${day.lost} m`, "right"),
           tdTotal(`${day.onTarget} hours ran to target with no time lost`)],
        ],
      }, layout: LAYOUT },
    heading("WHERE THE TIME WENT", `${day.lost} minutes lost, ranked by cost`),
    { table: {
        headerRows: 1, widths: [170, 42, 40, "*"],
        body: [
          [th("CAUSE"), th("MINUTES", "right"), th("SHARE", "right"), th("WHAT IT WAS")],
          ...causeRows.map(([name, m, what]) => [td(name), td(String(m), "right"), td(pctI(m, day.lost), "right"), tdMuted(what)]),
          [tdTotal("TOTAL TIME LOST"), tdTotal(String(day.lost), "right"), tdTotal("100%", "right"),
           tdTotal(`${hmWords(day.lost)}, or ${((100 * day.lost) / 1440).toFixed(1)}% of the twenty-four hour day`)],
        ],
      }, layout: LAYOUT },
    d.reclassified
      ? note(`${d.reclassified} minutes booked to machine breakdown on the log are shown above under power cuts, where the shift's own written notes place them.` +
             (noReason.length ? ` ${noReason.reduce((a, x) => a + x.lost, 0)} minutes across ${noReason.length} hours were logged with no reason given.` : ""))
      : {},
    note("The figures on this page come from the hourly shift log signed by the production in-charges; the press station's own entries for this day have not been entered into the system."),
  ];
}

/* ------------------------------------------------------------------ page 2 */
// Labels the floor uses, mapped to words the reader does. The raw values are
// Airtable single-selects and are not shown as-is anywhere on the page.
const gradeMeaning = (g, n, dispatched) => {
  if (g === "A") return "First quality, passed";
  if (g === "C (Reject)") return "Rejected";
  if (g === "Not graded yet") return "Still in process, grade pending";
  if (g === "A2") return `Passed at the second tier; ${dispatched} of the ${n} cleared for dispatch`;
  if (g === "B") return `Downgraded and held back; ${dispatched === 0 ? "none" : dispatched} cleared for dispatch`;
  return "No grade on the record";
};

const REWORK_LABEL = {
  "Direct Ok": "Passed straight through",
  "RW Required and ongoing": "Rework in progress",
  "Can't be Reworked": "Cannot be reworked",
  "RW Done Ok": "Rework completed",
  "Not recorded": "Not recorded",
};

/** A two-column block of the same small table, side by side. */
const pair = (left, right) => ({ columns: [{ width: "*", ...left }, { width: "*", ...right }], columnGap: 16 });

const miniTable = (headers, rows, widths) => ({
  table: { headerRows: 1, widths, body: [headers, ...rows] }, layout: LAYOUT,
});

function pageTwo(d, q, dateLong) {
  const ungraded = q.inspected - q.graded;
  const held = q.graded - q.passed;

  // AFTER POLISHING. "Direct Ok" and "Polish Ok" both mean the slab passed —
  // one needed no polish, the other passed once polished — so they are one
  // row. Splitting them put two rows on the page that both read "passed".
  const passedPolishing = (q.repolish.find(([k]) => k === "Direct Ok")?.[1] ?? 0)
                        + (q.repolish.find(([k]) => k === "Polish Ok")?.[1] ?? 0);
  const polishRows = [
    ["Passed", passedPolishing],
    ["Needs repolishing", q.repolish.find(([k]) => k === "Repolish Required")?.[1] ?? 0],
    ["Repolish done", q.repolish.find(([k]) => k === "Repolish Done")?.[1] ?? 0],
    ["Not recorded", q.repolish.find(([k]) => k === "Not recorded")?.[1] ?? 0],
  ].filter(([, n]) => n > 0);

  const reworkRows = q.rework.map(([k, n]) => [REWORK_LABEL[k] ?? k, n]);

  const faultRow = (total) => ([f, n]) => [tdKey(f), td(String(n), "right"), tdMuted(share(n, total))];

  return [
    bandHeader("Polishing and Quality", dateLong), headRule(),
    kpis([
      [String(q.polished), "SLABS POLISHED"],
      [String(q.inspected), "SLABS INSPECTED"],
      [String(q.passed), "PASSED INSPECTION"],
      [pct1(q.passRate), "PASS RATE, GRADED SLABS"],
      [String(q.openForRework), "OPEN FOR REWORK"],
    ]),
    prose([
      `${q.polished} slabs went through the polishing line and ${q.inspected} were inspected. Of the ${q.graded} slabs that carry a final grade, `,
      strong(`${q.passed} passed`), ` ${DASH} a pass rate of ${q.passRate.toFixed(1)} per cent. `,
      `${opens(held)} ${held === 1 ? "was" : "were"} downgraded or rejected. A further ${ungraded} are still being graded and are not counted either way. `,
      `${opens(q.openForRework)} slabs remain open for repolishing or rework, and ${q.toDispatch} of the ${q.inspected} are already flagged to go to dispatch, all of them grade A or A2.`,
    ]),

    heading("QUALITY GRADES", `all ${q.inspected} slabs inspected during the day`),
    { table: { headerRows: 1, widths: [96, 40, 44, "*"],
        body: [
          [th("GRADE"), th("SLABS", "right"), th("SHARE", "right"), th("WHAT IT MEANS")],
          ...q.grades.map(([g, n]) => [tdKey(g), td(String(n), "right"), td(share(n, q.inspected), "right"),
                                      tdMuted(gradeMeaning(g, n, q.dispatchByGrade[g] ?? 0))]),
          [tdTotal("TOTAL INSPECTED"), tdTotal(String(q.inspected), "right"), tdTotal("100%", "right"),
           tdTotal(`${q.passed} passed, ${held} held or rejected, ${ungraded} still to be graded`)],
        ] }, layout: LAYOUT },

    heading("WHAT STILL NEEDS WORK"),
    pair(
      { stack: [
        { text: "AFTER POLISHING", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
        miniTable([th("STATUS"), th("SLABS", "right"), th("SHARE", "right")],
          [...polishRows.map(([k, n]) => [tdKey(k), td(String(n), "right"), tdMuted(share(n, q.inspected))]),
           [tdTotal("Total"), tdTotal(String(q.inspected), "right"), tdTotal("100%", "right")]],
          ["*", 38, 44]),
      ]},
      { stack: [
        { text: "REWORK", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
        miniTable([th("STATUS"), th("SLABS", "right"), th("SHARE", "right")],
          [...reworkRows.map(([k, n]) => [tdKey(k), td(String(n), "right"), tdMuted(share(n, q.inspected))]),
           [tdTotal("Total"), tdTotal(String(q.inspected), "right"), tdTotal("100%", "right")]],
          ["*", 38, 44]),
      ]},
    ),

    // TWO FAULT TABLES, DELIBERATELY ON DIFFERENT DENOMINATORS.
    // Left is every fault recorded anywhere on the day, so nothing is hidden
    // by a top-N cut. Right is only the faults on slabs that actually lost a
    // grade, which is the list worth acting on — the same fault name can be
    // common overall and never once cost a grade.
    // The full fault list is 15 kinds where the old top-five-plus-a-bucket was
    // ten rows. Run it as two columns of one ranked list so the section keeps
    // the height it had — nothing is dropped and the page still holds.
    heading("THE FAULTS THAT CAUSED IT", "left, every fault recorded; right, only those on downgraded and rejected slabs"),
    (() => {
      const half = Math.ceil(q.faultsAll.length / 2);
      const col = (rows, tail) => miniTable(
        [th("FAULT"), th("RECORDED", "right"), th("SHARE", "right")],
        [...rows.map(faultRow(q.faultTotal)), ...(tail ? [[tdTotal("Total"), tdTotal(String(q.faultTotal), "right"), tdTotal("100%", "right")]] : [])],
        ["*", 44, 34]);
      return {
        columns: [
          { width: "*", stack: [
            { text: "ALL FAULTS", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
            { columns: [
                { width: "*", ...col(q.faultsAll.slice(0, half), false) },
                { width: "*", ...col(q.faultsAll.slice(half), true) },
              ], columnGap: 12 },
          ]},
          { width: 166, stack: [
            { text: "B AND C GRADES ONLY", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
            miniTable([th("FAULT"), th("RECORDED", "right"), th("SHARE", "right")],
              [...q.faultsBC.map(faultRow(q.bcFaultTotal)),
               [tdTotal("Total"), tdTotal(String(q.bcFaultTotal), "right"), tdTotal("100%", "right")]],
              ["*", 44, 34]),
          ]},
        ], columnGap: 16 };
    })(),
    note(`${q.faultTotal} faults across ${q.faultSlabs} of the ${q.inspected} slabs inspected, ${q.faultSlabsMulti} of them carrying more than one; the other ${q.inspected - q.faultSlabs} were logged with no fault at all. ` +
         `On the right, the ${q.bcFaultTotal} faults on the ${q.bcSlabs} slabs graded B or C.`),

    heading("WHO DID THE WORK"),
    pair(
      { stack: [
        { text: "POLISHING OPERATOR", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
        miniTable([th("OPERATOR"), th("SLABS", "right"), th("SHARE", "right"), th("SHIFT")],
          [...q.operators.map(([k, n, sh]) => [tdKey(k), td(String(n), "right"), td(share(n, q.polished), "right"), tdMuted(sh)]),
           [tdTotal("Total"), tdTotal(String(q.polished), "right"), tdTotal("100%", "right"), tdTotal("")]],
          [64, 32, 38, "*"]),
      ]},
      { stack: [
        { text: "QUALITY INSPECTOR", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
        miniTable([th("INSPECTOR"), th("SLABS", "right"), th("SHARE", "right"), th("SHIFT")],
          [...q.inspectors.map(([k, n, sh]) => [tdKey(k), td(String(n), "right"), td(share(n, q.inspected), "right"), tdMuted(sh)]),
           [tdTotal("Total"), tdTotal(String(q.inspected), "right"), tdTotal("100%", "right"), tdTotal("")]],
          [64, 32, 38, "*"]),
      ]},
    ),

    heading("WHAT WAS POLISHED", `${q.polished} slabs, and how each design was graded`),
    { columns: [
        { width: 360, table: { headerRows: 1, widths: [70, 40, 26, 19, 21, 17, 17, 36, "*"],
            body: [
              [th("DESIGN"), th("BATCH"), th("SLABS", "right"), th("A", "right"), th("A2", "right"),
               th("B", "right"), th("C", "right"), th("UNGRADED", "right"), th("FACE")],
              ...q.designs.map((x) => [
                tdKey(x.design ?? DASH), td([...x.batches].sort().reverse()[0] ?? DASH),
                td(String(x.slabs), "right"), td(String(x.A), "right"), td(String(x.A2), "right"),
                td(String(x.B), "right"), td(String(x.C), "right"), tdMuted(String(x.ungraded), "right"),
                tdMuted(x.face ?? DASH),
              ]),
              [tdTotal("Total"), tdTotal(""), tdTotal(String(q.polished), "right"),
               tdTotal(String(q.designs.reduce((a, x) => a + x.A, 0)), "right"),
               tdTotal(String(q.designs.reduce((a, x) => a + x.A2, 0)), "right"),
               tdTotal(String(q.designs.reduce((a, x) => a + x.B, 0)), "right"),
               tdTotal(String(q.designs.reduce((a, x) => a + x.C, 0)), "right"),
               tdTotal(String(q.designs.reduce((a, x) => a + x.ungraded, 0)), "right"), tdTotal("")],
            ] }, layout: LAYOUT },
        { width: "*", table: { headerRows: 1, widths: ["*", 34, 40],
            body: [
              [th("THICKNESS"), th("SLABS", "right"), th("SHARE", "right")],
              ...q.thickness.map(([k, n]) => [tdKey(k), td(String(n), "right"), tdMuted(share(n, q.polished), "right")]),
              [tdTotal("Total"), tdTotal(String(q.polished), "right"), tdTotal("100%", "right")],
            ] }, layout: LAYOUT },
      ], columnGap: 16 },
    note(`"Not graded" covers slabs still awaiting a grade and slabs with no QC record yet, so these counts differ from the Quality Grades table \u2014 ` +
         `that counts the ${q.inspected} inspected, a different set from the ${q.polished} polished. Polishing runs behind the press, so this page is not the same slabs as page one.`),
  ];
}

/* ------------------------------------------------------------------ page 3 */
// The web report's third sheet, on paper. Same figures, same rules, same
// order — src/app/report/ceo/page.tsx SheetMaintenance is the reference and
// this must not drift from it. The 09:00 email was the one place the owner
// could not see the maintenance page.
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const plural = (n, one, many) => (n === 1 ? one : many);

function pageThree(d, m, dateLong) {
  const worst = m.byArea[0];
  const longest = [...m.events].sort((a, b) => b.delay.breakdown - a.delay.breakdown)[0];
  const sub = (t) => ({ text: t, font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] });

  const out = [
    bandHeader("Maintenance", dateLong), headRule(),
    kpis([
      [String(m.events.length), "BREAKDOWN EVENTS"],
      [`${m.minutes} m`, "TIME LOST TO BREAKDOWNS"],
      [String(m.byArea.length), "AREAS AFFECTED"],
      [String(m.withRca), "RCA NUMBERS RAISED"],
      [String(m.spares.length), "HOURS THAT USED SPARES"],
    ]),
    prose(m.events.length === 0
      ? ["No machine or electrical breakdown was recorded on this day."]
      : [
        `${m.events.length} ${plural(m.events.length, "hour was", "hours were")} flagged as a machine or electrical breakdown, costing `,
        strong(`${m.minutes} minutes`),
        ...(worst ? [` ${DASH} most of it in the `, strong(worst.area), ` (${worst.minutes} minutes across ${worst.events} ${plural(worst.events, "hour", "hours")})`] : []),
        ".",
        ...(longest && longest.delay.breakdown > 0 ? [` The single longest stop was the ${longest.hour} hour at ${longest.delay.breakdown} minutes.`] : []),
        ...(m.withRca === 0 ? [" No RCA number was raised against any of them."] : []),
      ]),
  ];

  if (m.events.length > 0) {
    out.push(
      heading("EVERY BREAKDOWN, HOUR BY HOUR"),
      { table: { headerRows: 1, widths: [34, 24, 74, 28, "*", 64, 30],
          body: [
            [th("HOUR"), th("SHIFT"), th("AREA"), th("LOST", "right"), th("WHAT HAPPENED"), th("SPARES USED"), th("RCA", "right")],
            ...m.events.map((x) => [
              tdKey(x.hour ?? DASH), td(x.shift ?? DASH),
              td(x.area.length ? x.area.join(" / ") : DASH),
              td(x.delay.breakdown ? `${x.delay.breakdown} m` : NDASH, "right"),
              tdMuted(x.details ? cap(tidy(x.details)) : DASH),
              tdMuted(x.spares ?? DASH), tdMuted(x.rca ?? DASH, "right"),
            ]),
            [tdTotal("Total"), tdTotal(""), tdTotal(`${m.byArea.length} ${plural(m.byArea.length, "area", "areas")}`),
             tdTotal(`${m.minutes} m`, "right"),
             tdTotal(m.spares.length ? `Spares used in ${m.spares.length} of ${m.events.length} hours` : "No spares recorded"),
             tdTotal(""), tdTotal(String(m.withRca), "right")],
          ] }, layout: LAYOUT },

      heading("WHERE IT FAILED"),
      pair(
        { stack: [ sub("BY AREA"),
          miniTable([th("AREA"), th("EVENTS", "right"), th("MINUTES", "right"), th("HOURS")],
            [...m.byArea.map((a) => [tdKey(a.area), td(String(a.events), "right"), td(String(a.minutes), "right"), tdMuted(a.hours.join(", "))]),
             [tdTotal("Total"), tdTotal(String(m.byArea.reduce((a, x) => a + x.events, 0)), "right"), tdTotal(String(m.minutes), "right"), tdTotal("")]],
            ["*", 36, 40, 70]),
        ]},
        { stack: [ sub("BY SHIFT"),
          miniTable([th("SHIFT"), th("EVENTS", "right"), th("MINUTES", "right"), th("PRODUCTION IN-CHARGE")],
            [...m.byShift.map((x) => [tdKey(x.shift), td(String(x.events), "right"), td(String(x.minutes), "right"),
                                       tdMuted(d.shifts.find((sh) => sh.letter === x.shift)?.incharge ?? DASH)]),
             [tdTotal("Total"), tdTotal(String(m.events.length), "right"), tdTotal(String(m.minutes), "right"), tdTotal("")]],
            [34, 36, 40, "*"]),
        ]},
      ),

      heading("WHO WAS ON"),
      { table: { headerRows: 1, widths: [64, "*", 150],
          body: [
            [th("TRADE"), th("NAMED ON THE LOG"), th("COVERING")],
            [tdKey("Electrical"), td(m.electrical.join(", ") || DASH), tdMuted("Named on every hour of the day")],
            [tdKey("Mechanical"), td(m.mechanical.join(", ") || DASH), tdMuted("Named on every hour of the day")],
          ] }, layout: LAYOUT },
    );
  }

  if (m.powerCuts.rows.length > 0) {
    const n = m.powerCuts.rows.length;
    out.push(
      heading("POWER CUTS FROM THE GRID"),
      prose([
        `The grid went down in ${n} ${plural(n, "hour", "hours")}, costing `, strong(`${m.powerCuts.minutes} minutes`),
        `. These are not maintenance events ${DASH} nothing failed in the plant ${DASH} so they sit apart from the breakdown tables above and match the power-cut row on page one.`,
      ]),
      { table: { headerRows: 1, widths: [34, 24, 28, "*"],
          body: [
            [th("HOUR"), th("SHIFT"), th("LOST", "right"), th("WHAT THE LOG SAYS")],
            ...m.powerCuts.rows.map((x) => [
              tdKey(x.hour ?? DASH), td(x.shift ?? DASH),
              td(x.minutes ? `${x.minutes} m` : NDASH, "right"),
              tdMuted(x.reasonsSayPower
                ? (x.note ? cap(tidy(x.note)) : x.reasons.filter((rr) => /POWER/i.test(rr)).join(", ") || DASH)
                : `Minutes entered in the hour's power-out column${x.alsoMachineFault ? ` ${DASH} the same hour's machine stop is listed above` : ""}`),
            ]),
            [tdTotal("Total"), tdTotal(""), tdTotal(`${m.powerCuts.minutes} m`, "right"), tdTotal("Booked to power on page one, not to maintenance")],
          ] }, layout: LAYOUT },
    );
  }

  out.push(note(
    `This page is built from the maintenance fields on the hourly shift log ${DASH} the area of the problem, the breakdown flag, spares used and the RCA number. ` +
    `The maintenance ticket system holds no entries at all, for this day or any other, so nothing here comes from it. ` +
    `Until tickets are raised, an RCA column of dashes means the analysis was never recorded, not that the cause was obvious.`));
  return out;
}

/* ---------------------------------------------------------------- exports */

/** Yesterday in UTC, which is what this report is for by default. */
export const yesterdayUTC = () => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

/**
 * The report for one day, as a PDF in memory.
 *
 * Separated from the CLI below so the scheduled job can attach the bytes to an
 * email without writing a temp file - a serverless function has nowhere
 * durable to write one, and a file written to /tmp on one invocation is not
 * there on the next.
 *
 * Returns null when the day has no MIS rows. That is not an error: it is a
 * plant that did not run, and the caller decides whether silence or an email
 * saying so is the right answer. Throwing would put a stack trace in a cron
 * log every Sunday.
 */
export async function buildDailyReportPdf(date) {
  // INSIDE the try. collect() builds its own PrismaClient and can throw part
  // way through - above the try, that connection was never closed, and a
  // serverless invocation holds a Neon connection until the runtime recycles.
  let data;
  try {
    data = await collect(date);
    if (!data.hours.length) return null;
    const doc = printer.createPdfKitDocument(buildDoc(data));
    const buf = await new Promise((res, rej) => {
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => res(Buffer.concat(chunks)));
      doc.on("error", rej);
      doc.end();
    });
    return { pdf: buf, date, fileName: `Pacific ERP ${fileDate(date)}.pdf`, summary: data.day };
  } finally {
    // ALWAYS, even when the day was empty, the render threw, or collect itself
    // failed part way through. The optional chain matters: collect can throw
    // before `data` is assigned, and a finally that itself throws would
    // replace the real error with a meaningless one.
    await data?.prisma?.$disconnect();
  }
}

/* -------------------------------------------------------------------- main */
//
// CLI ONLY. import.meta.main is not available on every Node this runs under,
// so the check is on argv[1] - importing this module must not start a render.
const isCli = process.argv[1] && process.argv[1].endsWith("make-daily-report-pdf.mjs");
if (isCli) {
  const [, , argDate, argOut] = process.argv;
  // A DATE THAT WAS ASKED FOR AND NOT UNDERSTOOD IS AN ERROR. Substituting
  // yesterday renders a different day than the one requested and names the
  // file after the substitute, so the output is internally consistent and
  // there is nothing to notice - somebody forwards it as the 15th.
  if (argDate && !/^\d{4}-\d{2}-\d{2}$/.test(argDate)) {
    console.error(`Not a date: ${argDate}. Use YYYY-MM-DD, or pass nothing for yesterday.`);
    process.exit(2);
  }
  const date = argDate || yesterdayUTC();
  const out = argOut ?? `Daily-Report-${fileDate(date)}.pdf`;
  const built = await buildDailyReportPdf(date);
  if (!built) {
    console.error(`No MIS rows for ${date} — nothing to report.`);
    process.exit(1);
  }
  fs.writeFileSync(out, built.pdf);
  console.log(`${out}  ${date}  ${built.summary.made}/${built.summary.target} slabs, ` +
              `${built.summary.lost} min lost  [body font: ${FONT_TIER}]`);
}