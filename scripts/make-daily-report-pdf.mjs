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
import PdfPrinter from "pdfmake/src/printer.js";
import { collect } from "./dailyReportData.mjs";

/* ------------------------------------------------------------------ fonts */
const FONT_DIRS = [
  "C:/Windows/Fonts",                            // the original pairing
  "/System/Library/Fonts/Supplemental",          // macOS
  "/usr/share/fonts/truetype/msttcorefonts",     // linux, if installed
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

const body = BODY_ORIGINAL ?? BODY_SUBSTITUTE;
if (!body || !DISPLAY) {
  console.error("No usable fonts found. Looked in:\n  " + FONT_DIRS.join("\n  "));
  process.exit(1);
}
// Trebuchet sets ~3.6% wider than Calibri at the same nominal size; scaling the
// point size back keeps every column the width it was designed to be.
const S = BODY_ORIGINAL ? 1 : 0.964;
const printer = new PdfPrinter({ Body: body, Display: DISPLAY });

/* --------------------------------------------------------------- palette */
// Sampled from the original PDF's own colour operators, not chosen again.
const INK = "#16191D", SLATE = "#232A33", GREY = "#5C6570",
      RULE = "#E4E7EA", SHADE = "#F2F3F5", PAPER = "#FFFFFF";

/* ----------------------------------------------------------------- helpers */
const pt = (n) => +(n * S).toFixed(2);
const hm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const hmWords = (m) => `${Math.floor(m / 60)} hours ${m % 60} minutes`;
const pct1 = (n) => (n == null ? "\u2014" : `${n.toFixed(1)}%`);
const pctI = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "\u2014");
const share = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "\u2014");
const TRACK = 1.15;                                   // the spaced section headings
const DASH = "\u2014", NDASH = "\u2013";

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
  margin: [0, 6, 0, 3],
});

// One table look for the whole document: a hairline under the header row and
// between rows, nothing vertical, and a shaded header. Anything heavier turns
// a page of small numbers into a grid the eye cannot cross.
const LAYOUT = {
  hLineWidth: (i, node) => (i === 0 ? 0 : i === 1 || i === node.table.body.length ? 0.5 : 0.35),
  vLineWidth: () => 0,
  hLineColor: (i, node) => (i === 1 || i === node.table.body.length ? "#C9CFD6" : RULE),
  paddingTop: () => 1.5, paddingBottom: () => 1.5, paddingLeft: () => 3, paddingRight: () => 3,
  fillColor: (i) => (i === 0 ? SHADE : null),
};
const th = (t, alignment) => ({ text: t, font: "Body", fontSize: pt(6.9), bold: true, color: SLATE, alignment });
const td = (t, alignment, o = {}) => ({ text: t, font: "Body", fontSize: pt(7.4), color: SLATE, alignment, ...o });
const tdMuted = (t, alignment) => ({ text: t, font: "Body", fontSize: pt(7.4), color: GREY, alignment });
const tdTotal = (t, alignment) => ({ text: t, font: "Body", fontSize: pt(7.4), bold: true, color: INK, alignment });
const note = (t) => ({ text: t, font: "Body", fontSize: pt(6.7), color: GREY, margin: [0, 4, 0, 0], lineHeight: 1.2 });

/* ------------------------------------------------------------------ build */
function bandHeader(title, dateLong) {
  return {
    margin: [0, 0, 0, 12],
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

const kpis = (tiles) => ({
  margin: [0, 0, 0, 7],
  columns: tiles.map(([value, label]) => ({
    width: "*",
    stack: [
      { text: value, font: "Body", bold: true, fontSize: pt(16.2), color: INK },
      { text: label, font: "Body", fontSize: pt(6.2), color: GREY, characterSpacing: 0.7, margin: [0, 2.5, 0, 0] },
    ],
  })),
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
      { text: `Page ${page} of 2`, font: "Body", fontSize: pt(6.9), color: GREY, alignment: "right" },
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
  const std = hours.find((x) => x.std)?.std ?? null;
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
    bandHeader("Daily Production Report", dateLong),
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
    heading("HOUR BY HOUR", `Target is ${std} slabs an hour. A dash means the line produced nothing that hour.`),
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
const GRADE_MEANING = {
  "A": "First quality, passed",
  "A2": "Passed at the second tier",
  "B": "Downgraded and held back",
  "C (Reject)": "Rejected",
  "Not graded yet": "Still in process, grade pending",
  "Not recorded": "No grade on the record",
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

  const faultRow = (total) => ([f, n]) => [td(f), td(String(n), "right"), tdMuted(share(n, total))];

  return [
    bandHeader("Polishing and Quality", dateLong),
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
      `${held} ${held === 1 ? "was" : "were"} downgraded or rejected. A further ${ungraded} are still being graded and are not counted either way. `,
      `${q.openForRework} slabs remain open for repolishing or rework, and ${q.toDispatch} of the ${q.inspected} are already flagged to go to dispatch.`,
    ]),

    heading("QUALITY GRADES", `all ${q.inspected} slabs inspected during the day`),
    { table: { headerRows: 1, widths: [96, 40, 44, "*"],
        body: [
          [th("GRADE"), th("SLABS", "right"), th("SHARE", "right"), th("WHAT IT MEANS")],
          ...q.grades.map(([g, n]) => [td(g), td(String(n), "right"), td(share(n, q.inspected), "right"), tdMuted(GRADE_MEANING[g] ?? "")]),
          [tdTotal("TOTAL INSPECTED"), tdTotal(String(q.inspected), "right"), tdTotal("100%", "right"),
           tdTotal(`${q.passed} passed, ${held} held or rejected, ${ungraded} still to be graded`)],
        ] }, layout: LAYOUT },

    heading("WHAT STILL NEEDS WORK"),
    pair(
      { stack: [
        { text: "AFTER POLISHING", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
        miniTable([th("STATUS"), th("SLABS", "right"), th("SHARE", "right")],
          [...polishRows.map(([k, n]) => [td(k), td(String(n), "right"), tdMuted(share(n, q.inspected))]),
           [tdTotal("Total"), tdTotal(String(q.inspected), "right"), tdTotal("100%", "right")]],
          ["*", 38, 44]),
      ]},
      { stack: [
        { text: "REWORK", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
        miniTable([th("STATUS"), th("SLABS", "right"), th("SHARE", "right")],
          [...reworkRows.map(([k, n]) => [td(k), td(String(n), "right"), tdMuted(share(n, q.inspected))]),
           [tdTotal("Total"), tdTotal(String(q.inspected), "right"), tdTotal("100%", "right")]],
          ["*", 38, 44]),
      ]},
    ),

    // TWO FAULT TABLES, DELIBERATELY ON DIFFERENT DENOMINATORS.
    // Left is every fault recorded anywhere on the day, so nothing is hidden
    // by a top-N cut. Right is only the faults on slabs that actually lost a
    // grade, which is the list worth acting on — the same fault name can be
    // common overall and never once cost a grade.
    heading("THE FAULTS THAT CAUSED IT", "left, every fault recorded; right, only those on downgraded and rejected slabs"),
    pair(
      { stack: [
        { text: "ALL FAULTS", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
        miniTable([th("FAULT"), th("RECORDED", "right"), th("SHARE", "right")],
          [...q.faultsAll.map(faultRow(q.faultTotal)),
           [tdTotal("Total"), tdTotal(String(q.faultTotal), "right"), tdTotal("100%", "right")]],
          ["*", 50, 40]),
      ]},
      { stack: [
        { text: "B AND C GRADES ONLY", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
        miniTable([th("FAULT"), th("RECORDED", "right"), th("SHARE", "right")],
          [...q.faultsBC.map(faultRow(q.bcFaultTotal)),
           [tdTotal("Total"), tdTotal(String(q.bcFaultTotal), "right"), tdTotal("100%", "right")]],
          ["*", 50, 40]),
      ]},
    ),
    note(`${q.faultTotal} faults were recorded in all, spread across ${q.faultSlabs} of the ${q.inspected} slabs inspected; ` +
         `${q.faultSlabsMulti} carried more than one. The remaining ${q.inspected - q.faultSlabs} were logged with no fault at all. ` +
         `On the right, ${q.bcFaultTotal} faults on the ${q.bcSlabs} slabs graded B or C ${DASH} the same slab can appear in both tables.`),

    heading("WHO DID THE WORK"),
    pair(
      { stack: [
        { text: "POLISHING OPERATOR", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
        miniTable([th("OPERATOR"), th("SLABS", "right"), th("SHARE", "right")],
          [...q.operators.map(([k, n]) => [td(k), td(String(n), "right"), tdMuted(share(n, q.polished))]),
           [tdTotal("Total"), tdTotal(String(q.polished), "right"), tdTotal("100%", "right")]],
          ["*", 38, 44]),
      ]},
      { stack: [
        { text: "QUALITY INSPECTOR", font: "Body", fontSize: pt(6.4), bold: true, color: GREY, characterSpacing: 0.7, margin: [0, 0, 0, 3] },
        miniTable([th("INSPECTOR"), th("SLABS", "right"), th("SHARE", "right")],
          [...q.inspectors.map(([k, n]) => [td(k), td(String(n), "right"), tdMuted(share(n, q.inspected))]),
           [tdTotal("Total"), tdTotal(String(q.inspected), "right"), tdTotal("100%", "right")]],
          ["*", 38, 44]),
      ]},
    ),

    heading("WHAT WAS POLISHED", `${q.polished} slabs, and how each design was graded`),
    { columns: [
        { width: 322, table: { headerRows: 1, widths: [82, 46, 28, 20, 22, 18, 18, "*"],
            body: [
              [th("DESIGN"), th("BATCH"), th("SLABS", "right"), th("A", "right"), th("A2", "right"),
               th("B", "right"), th("C", "right"), th("UNGRADED", "right")],
              ...q.designs.map((x) => [
                td(x.design ?? DASH), td([...x.batches].sort().reverse()[0] ?? DASH),
                td(String(x.slabs), "right"), td(String(x.A), "right"), td(String(x.A2), "right"),
                td(String(x.B), "right"), td(String(x.C), "right"), tdMuted(String(x.ungraded), "right"),
              ]),
              [tdTotal("Total"), tdTotal(""), tdTotal(String(q.polished), "right"),
               tdTotal(String(q.designs.reduce((a, x) => a + x.A, 0)), "right"),
               tdTotal(String(q.designs.reduce((a, x) => a + x.A2, 0)), "right"),
               tdTotal(String(q.designs.reduce((a, x) => a + x.B, 0)), "right"),
               tdTotal(String(q.designs.reduce((a, x) => a + x.C, 0)), "right"),
               tdTotal(String(q.designs.reduce((a, x) => a + x.ungraded, 0)), "right")],
            ] }, layout: LAYOUT },
        { width: "*", table: { headerRows: 1, widths: ["*", 34, 40],
            body: [
              [th("THICKNESS"), th("SLABS", "right"), th("SHARE", "right")],
              ...q.thickness.map(([k, n]) => [td(k), td(String(n), "right"), tdMuted(share(n, q.polished), "right")]),
              [tdTotal("Total"), tdTotal(String(q.polished), "right"), tdTotal("100%", "right")],
            ] }, layout: LAYOUT },
      ], columnGap: 16 },
    note(`"Not graded" covers slabs still awaiting a grade and slabs with no QC record yet, so these counts differ from the Quality Grades table \u2014 ` +
         `that counts the ${q.inspected} inspected, a different set from the ${q.polished} polished. Polishing runs behind the press, so this page is not the same slabs as page one.`),
  ];
}

/* -------------------------------------------------------------------- main */
const [, , argDate, argOut] = process.argv;
const yesterday = () => { const t = new Date(); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const date = argDate && /^\d{4}-\d{2}-\d{2}$/.test(argDate) ? argDate : yesterday();
const out = argOut ?? `Daily-Report-${fileDate(date)}.pdf`;

const data = await collect(date);
if (!data.hours.length) { console.error(`No MIS rows for ${date} — nothing to report.`); process.exit(1); }
const pdf = printer.createPdfKitDocument(buildDoc(data));
await new Promise((res, rej) => {
  const s = fs.createWriteStream(out);
  pdf.pipe(s); pdf.end(); s.on("finish", res); s.on("error", rej);
});
await data.prisma.$disconnect();
console.log(`${out}  ${date}  ${data.day.made}/${data.day.target} slabs, ${data.day.lost} min lost` +
            `  [body font: ${BODY_ORIGINAL ? "Calibri (original)" : "Trebuchet MS substitute"}]`);
