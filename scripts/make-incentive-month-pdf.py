"""Render one month's shift-incentive settlement as a printable A4 notice.

    python scripts/make-incentive-month-pdf.py [YYYY-MM] [output.pdf]

Every figure is read from docs/incentive/<month>.json, written by
scripts/incentive-month.mts from the same code the /scoreboard/incentive page
runs. Nothing is typed here: if a number on the sheet is wrong, the fix is in
the ERP, and re-running the two scripts re-cuts the sheet.

ASCII / Latin-1 only, as scripts/make-incentive-notice-pdf.py explains: the
built-in fonts carry no rupee sign or arrows, so money is "Rs 1,05,900" and
"->" is written out. Styles and palette are that script's, so the two notices
read as one document on the wall.
"""
import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)

ROOT = Path(__file__).resolve().parent.parent
MONTH = sys.argv[1] if len(sys.argv) > 1 and len(sys.argv[1]) == 7 else None
if MONTH is None:
    months = sorted(p.stem for p in (ROOT / "docs" / "incentive").glob("????-??.json"))
    if not months:
        sys.exit("no docs/incentive/<month>.json — run scripts/incentive-month.mts first")
    MONTH = months[-1]
SRC = ROOT / "docs" / "incentive" / f"{MONTH}.json"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs" / f"INCENTIVE-{MONTH}.pdf"
M = json.loads(SRC.read_text(encoding="utf8"))

# THE SNAPSHOT HAS TO BE THE CURRENT SHAPE, AND SAYING SO IS CHEAPER THAN A
# KeyError HALFWAY THROUGH A NOTICE. outstanding.groups gained per-row grade
# counts (graded / share / gradeA / gradeA2 / ...) and lost the design-level
# pair (designShare / designGraded) on 2026-09-03. A notice cut from a snapshot
# written before that would either crash mid-render or, worse if the fields were
# defaulted, print a quality column of blanks over batches QC has finished. The
# fix is always the same: re-run scripts/incentive-month.mts, which rebuilds the
# JSON from the live database.
_g = (M.get("outstanding") or {}).get("groups") or []
if _g and "share" not in _g[0]:
    sys.exit(f"{SRC.name} predates the per-batch grade columns (2026-09-03) - "
             f"re-run: npx tsx scripts/incentive-month.mts {MONTH}")
# The counted total's decomposition (credit / doubling / rounding), added
# 2026-09-03. Without it this notice would have to go back to inferring the
# difficulty rule's worth as points - credit, which is the doubling and the
# rounding drift added together and labelled as the doubling alone. Same fix as
# above: re-cut the snapshot rather than default the field.
if "decomposition" not in M:
    sys.exit(f"{SRC.name} predates the counted-slab decomposition (2026-09-03) - "
             f"re-run: npx tsx scripts/incentive-month.mts {MONTH}")

# --------------------------------------------------------------- helpers
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
Y, MO = int(MONTH[:4]), int(MONTH[5:7])
MONTH_NAME = MONTHS[MO - 1]
NEXT_NAME = MONTHS[MO % 12]


def inr(n):
    """Indian grouping: 1,05,900."""
    n = int(round(n))
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    if len(s) <= 3:
        return f"Rs {sign}{s}"
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return f"Rs {sign}{','.join(parts)},{tail}"


def lakh(n):
    return f"Rs {n / 100000:g} lakh" if n >= 100000 else inr(n)


def num(n):
    return f"{int(n):,}"


def half(n):
    return num(n) if float(n).is_integer() else f"{num(int(n))}½"


def drift(n):
    """A per-shift rounding residual: signed, one decimal, never a slab count."""
    return f"{'-' if n < 0 else '+'}{abs(n):.1f}"


def pct(x, d=1):
    return "-" if x is None else f"{x * 100:.{d}f}%"


def ist(iso):
    from datetime import datetime, timedelta, timezone
    t = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=5, minutes=30)))
    return t.strftime("%-d %B %Y, %H:%M IST") if sys.platform != "win32" else t.strftime("%d %B %Y, %H:%M IST").lstrip("0")


# --------------------------------------------------------------- the figures
P = M["plant"]; POOL = M["pool"]; O = M["outstanding"]; PR = M["projection"]; MONEY = M["money"]; QC = M["qc"]
L = {l["shift"]: l for l in M["letters"]}
SH = {s["shift"]: s for s in M["shares"]["aggregate"]}          # the method the notice is written in
SHW = {s["shift"]: s for s in M["shares"]["weighted"]}          # the scoreboard's, for the basis note
MN = {m["shift"]: m for m in MONEY["aggregate"]}
ROLES = MONEY["roles"]

# Values from the JSON go into reportlab Paragraphs, whose mini-HTML parser
# treats "&" as the start of an entity: "Category B (R&D)" printed as "R&D;".
# Anything that came from data is escaped on its way in; the literal strings in
# this file are written as markup on purpose and are not.
esc = lambda t: str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
ORDER = sorted("ABC", key=lambda k: -SH[k]["share"])            # best share first
FLOOR = POOL["floor"]
counted = POOL["counted"]
below = counted < FLOOR
projected = PR["projectedReal"]
pool_plan = MONEY["pool"]
real = O["real"]
by = O["byStage"]
# THE COUNTED TOTAL IN THE THREE PARTS THAT ACTUALLY MAKE IT, and this notice
# used to get them wrong. `slow_extra` was points - credit, which is the
# doubling AND the per-shift rounding drift added together, and it was printed
# as "what the difficulty rule is worth" beside a slab COUNT (plant.slowSlabs)
# offered as the same quantity. It is not: a slow-hour slab that graded B is
# one slab and half a slab of credit. Both figures now come from the snapshot's
# own decomposition, where credit + doubling + rounding = counted exactly.
DEC = M["decomposition"]
credit_exact = DEC["plant"]["credit"]
doubling = DEC["plant"]["doubling"]
rounding = DEC["plant"]["rounding"]
exact_counted = DEC["plant"]["exact"]
DL = DEC["byLetter"]

# --------------------------------------------------------------- styles (the wall notice's)
BRAND = colors.HexColor("#0f4c5c")
DARK = colors.HexColor("#0a3540")
AMBER = colors.HexColor("#92400e")
AMBER_BG = colors.HexColor("#fffbeb")
GREEN = colors.HexColor("#166534")
GREEN_BG = colors.HexColor("#f0fdf4")
RED = colors.HexColor("#991b1b")
RED_BG = colors.HexColor("#fef2f2")
GREY = colors.HexColor("#6b7280")
LINE = colors.HexColor("#d1d5db")
TINT = colors.HexColor("#f0f7f8")

ss = getSampleStyleSheet()
S = {
    "title": ParagraphStyle("t", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=17.5, leading=20, textColor=BRAND, spaceAfter=1),
    "sub": ParagraphStyle("s", parent=ss["Normal"], fontSize=8, leading=10, textColor=GREY, alignment=TA_CENTER, spaceAfter=6),
    "h": ParagraphStyle("h", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=11, leading=13, textColor=BRAND, spaceBefore=7, spaceAfter=3),
    "b": ParagraphStyle("b", parent=ss["Normal"], fontSize=9, leading=12, spaceAfter=4),
    "li": ParagraphStyle("li", parent=ss["Normal"], fontSize=9, leading=12, leftIndent=12, bulletIndent=2, spaceAfter=3),
    "band": ParagraphStyle("w", parent=ss["Normal"], fontSize=9.2, leading=12.4, spaceAfter=2),
    "formula": ParagraphStyle("f", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=11, leading=14, alignment=TA_CENTER, textColor=DARK, spaceBefore=3, spaceAfter=3),
    "kpiN": ParagraphStyle("kn", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=15, leading=17, textColor=DARK, alignment=TA_CENTER),
    "kpiL": ParagraphStyle("kl", parent=ss["Normal"], fontSize=7.2, leading=8.6, textColor=GREY, alignment=TA_CENTER),
    "note": ParagraphStyle("n", parent=ss["Normal"], fontSize=7.3, leading=9.4, textColor=GREY, spaceBefore=1.5, spaceAfter=2),
    "th": ParagraphStyle("th", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=7.8, leading=9.3, textColor=DARK, alignment=TA_CENTER),
    "td": ParagraphStyle("td", parent=ss["Normal"], fontSize=7.6, leading=9, alignment=TA_CENTER),
    "tdl": ParagraphStyle("tdl", parent=ss["Normal"], fontSize=8, leading=9.6),
    "foot": ParagraphStyle("fo", parent=ss["Normal"], fontSize=7.4, leading=9.2, textColor=GREY, alignment=TA_CENTER),
}
th = lambda t: Paragraph(t, S["th"])
td = lambda t: Paragraph(t, S["td"])
tdl = lambda t: Paragraph(t, S["tdl"])


def tbl(data, widths, head=True, pad=3, size=8, shade=None, bold_rows=None):
    t = Table(data, colWidths=widths, hAlign="LEFT")
    cmds = [("FONT", (0, 0), (-1, -1), "Helvetica", size), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), pad), ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
            ("LEFTPADDING", (0, 0), (-1, -1), 5), ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE), ("BOX", (0, 0), (-1, -1), 0.6, LINE)]
    if head:
        cmds += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6"))]
    for r in (shade or []):
        cmds.append(("BACKGROUND", (0, r), (-1, r), TINT))
    for r in (bold_rows or []):
        cmds.append(("LINEABOVE", (0, r), (-1, r), 0.8, GREY))
    t.setStyle(TableStyle(cmds))
    return t


def band(text, bg, border):
    t = Table([[Paragraph(text, S["band"])]], colWidths=[170 * mm], hAlign="LEFT")
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("BOX", (0, 0), (-1, -1), 0.8, border),
                           ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return t


def kpis(items):
    """A row of big numbers with small labels."""
    w = 170 * mm / len(items)
    t = Table([[Paragraph(n, S["kpiN"]) for n, _ in items], [Paragraph(l, S["kpiL"]) for _, l in items]],
              colWidths=[w] * len(items), hAlign="LEFT")
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TINT), ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                           ("LINEAFTER", (0, 0), (-2, -1), 0.4, LINE),
                           ("TOPPADDING", (0, 0), (-1, 0), 6), ("BOTTOMPADDING", (0, 1), (-1, 1), 6),
                           ("TOPPADDING", (0, 1), (-1, 1), 0), ("BOTTOMPADDING", (0, 0), (-1, 0), 1)]))
    return t


def bullets(items, bullet="•"):
    return [Paragraph(x, S["li"], bulletText=bullet) for x in items]


# --------------------------------------------------------------- the sheet
def story():
    out = []
    A = out.append
    A(Paragraph(f"{MONTH_NAME} {Y} shift incentive", S["title"]))
    A(Paragraph(f"Pacific Surfaces - Production. The month from 06:00 on 1 {MONTH_NAME} to 06:00 on 1 {NEXT_NAME}, "
                f"scored under the shift incentive scheme with the two counting rules agreed in August. "
                f"Figures from the ERP as of {ist(M['asOf'])}; the live position is at erp.pacific-surfaces.com/scoreboard/incentive?month={MONTH}.", S["sub"]))

    # ---- where the month stands
    if below and projected >= FLOOR:
        A(band(f"<b>PROVISIONAL - NOT YET PAYABLE.</b> {MONTH_NAME} has not cleared the {num(FLOOR)} floor - yet. Counted today, the plant made "
               f"<b>{num(counted)}</b> good slabs against a floor of {num(FLOOR)}, so as things stand there is nothing to pay out. "
               f"<b>{num(real)}</b> slabs pressed in {MONTH_NAME} are still waiting for QC. Graded at the {pct(PR['share'])} the month has actually run, they take it to "
               f"about <b>{num(round(projected))}</b> - over the line, and into the first pool of <b>{lakh(pool_plan)}</b>. "
               f"This month is decided at the polishing line, not at the press.", AMBER_BG, AMBER))
    elif below:
        A(band(f"<b>NOT PAYABLE.</b> {num(counted)} good slabs counted against a floor of {num(FLOOR)}. Even if every one of the {num(real)} slabs still waiting "
               f"for QC grades at the month's {pct(PR['share'])}, the month reaches about {num(round(projected))} - below the floor. No pool is unlocked.", RED_BG, RED))
    else:
        A(band(f"<b>POOL UNLOCKED.</b> {num(counted)} good slabs counted - the {lakh(POOL['poolNow'])} row. "
               + (f"{num(POOL['next']['slabs'] - int(counted))} more counted slabs reach the {lakh(POOL['next']['pool'])} row." if POOL.get("next") else ""), GREEN_BG, GREEN))
    A(Spacer(1, 4))
    A(kpis([(num(counted), "counted good slabs today"), (num(FLOOR), "where the pool starts"),
            (num(real), "still waiting for QC"), (f"~{num(round(projected))}", "projected when grading is done"),
            (lakh(pool_plan) if pool_plan else "-", "the pool that unlocks")]))

    # ---- the two rules
    A(Paragraph("The two counting rules", S["h"]))
    A(Paragraph("Both change what a slab is worth. Neither changes how many slabs you have to make.", S["b"]))
    A(tbl([[th("Rule"), th("What it says"), th("Worked")],
           [tdl("<b>Grade</b>"), tdl("A grade A slab counts as one. A grade B counts as half. A reject counts as nothing - never a minus, so there is no reason to leave a bad slab out of MIS."), tdl("A = 1, B = ½, C = 0")],
           [tdl("<b>Difficulty</b>"), tdl("If the hour's STANDARD output is 10 slabs or fewer, every good slab in it counts twice. The multiplier is set by the standard, not by what you achieved - nobody earns it by working slowly."), tdl("Standard &lt;= 10/hr: A = 2, B = 1, C = 0")]],
          [26 * mm, 104 * mm, 40 * mm]))
    # THE DIFFICULTY RULE'S WORTH IS THE CREDIT IT ADDS, NOT THE SLABS IT
    # CAUGHT. This paragraph used to give one figure for both, and it was
    # neither: points - credit is the doubling AND the per-shift rounding drift
    # added together, printed beside plant.slowSlabs as though the two were the
    # same quantity. They differ by half a slab for every slow-hour slab that
    # graded B. All three terms now come from the snapshot's decomposition and
    # add to the counted total exactly.
    A(Paragraph((f"In {MONTH_NAME} the difficulty rule caught {num(P['slowSlabs'])} good slabs from slow-design hours, and it is worth "
                 f"<b>{half(doubling)}</b> counted slabs - fewer than the slabs it caught, because a slab that graded B is one slab "
                 f"and only half a slab of credit. "
                 f"Counted the old way the month stands at {half(credit_exact)} even before the waiting slabs grade, "
                 f"and it is the doubling that puts the floor within reach. " if P["slowSlabs"] else
                 f"In {MONTH_NAME} no hour ran a standard of 10 slabs or fewer, so the difficulty rule added nothing and the month "
                 f"stands on its {half(credit_exact)} good slabs alone. ")
                + f"{half(credit_exact)} + {half(doubling)} is {half(exact_counted)}; the counted total is {num(counted)} because every shift is scored "
                  f"on its own and rounded on its own, and a half always rounds up - {drift(rounding)} across the month.", S["b"]))

    # ---- the month in numbers
    A(Paragraph(f"{MONTH_NAME} in numbers", S["h"]))
    A(kpis([(num(P["instances"]), "shifts run"), (num(P["claimed"]), "slabs pressed"), (num(P["graded"]), "graded by QC"),
            (num(real), "awaiting QC"), (pct(P["rawShare"]), "grade share (A = 1, B = ½)"), (num(counted), "counted good slabs")]))
    A(Spacer(1, 3))
    A(Paragraph(f"Of the {num(P['graded'])} slabs QC has reached: {num(P['gradeA'])} grade A, {num(P['gradeB'])} grade B, {num(P['gradeC'])} rejects - "
                f"{half(credit_exact)} good slabs before the difficulty rule, {half(doubling)} added by it, {drift(rounding)} from rounding each shift on its own. "
                f"A grade share of {pct(P['rawShare'])} is a good month. "
                f"A further {num(by['routed'])} slabs were routed by QC to cut-to-size and will not grade; they are neither counted nor waited for.", S["b"]))

    # ---- the three shifts
    A(Paragraph("The three shifts", S["h"]))
    rows = [[th("Shift"), th("Shifts"), th("Pressed"), th("Graded"), th("Counted slabs"), th("Per shift"), th("Grade share"), th("Quality score"), th("Share of pool")]]
    for i, k in enumerate(ORDER, 1):
        l = L[k]
        rows.append([tdl(f"<b>{i}</b>&nbsp; Shift {k}"), td(num(l["instances"])), td(num(l["claimed"])), td(num(l["graded"])),
                     td(num(l["points"])), td(f"{l['pointsPerShift']:.1f}"), td(pct(l["rawShare"])), td(pct(l["qualityAggregate"])), td(pct(SH[k]["share"]))])
    rows.append([tdl("<b>Plant</b>"), td(num(P["instances"])), td(num(P["claimed"])), td(num(P["graded"])), td(num(counted)),
                 td(f"{counted / sum(l['effectiveShifts'] for l in M['letters']):.1f}"), td(pct(P["rawShare"])), td("-"), td("100%")])
    A(tbl(rows, [30 * mm, 14 * mm, 18 * mm, 18 * mm, 24 * mm, 18 * mm, 20 * mm, 20 * mm, 18 * mm], bold_rows=[len(rows) - 1]))
    A(Paragraph("Counted slabs already include both rules. Per shift is counted slabs divided by shifts worked, after removing the time the line was stopped by "
                "breakdown or power cut. Quality score stretches the grade share between the 87% minimum and the 97% target.", S["note"]))
    top, second = L[ORDER[0]], L[ORDER[1]]
    A(Paragraph(f"Shift {ORDER[0]} leads on both halves at once - the most counted slabs per shift and the best grade share. "
                f"{top['pointsPerShift'] - L[ORDER[-1]]['pointsPerShift']:.1f} slabs a shift is the whole gap between first and third: one good hour.", S["b"]))

    # ---- the calculation, Shift <best> as the worked example
    k = ORDER[0]; l = L[k]; s = SH[k]; mn = MN[k]
    vtot = sum(L[x]["pointsPerShift"] for x in "ABC")
    qtot = sum(L[x]["qualityAggregate"] or 0 for x in "ABC")
    A(Paragraph("How the money is worked out", S["h"]))
    A(Paragraph("Five steps, and every one of them traces back to the individual slab records behind it.", S["b"]))
    out.extend(bullets([
        f"<b>Count each shift's good slabs.</b> Shift {k}: {num(l['gradeA'])} A + {num(l['gradeB'])} B + {num(l['gradeC'])} rejects = {half(l['credit'])} good, "
        f"then the difficulty rule on {num(l['slowSlabs'])} slow-design slabs adds {half(DL[k]['doubling'])} "
        f"and rounding the shift's own instances adds {drift(DL[k]['rounding'])} -> <b>{num(l['points'])} counted</b>.",
        f"<b>Divide by the shifts actually worked.</b> {num(l['points'])} counted / {l['effectiveShifts']:.1f} running shifts = <b>{l['pointsPerShift']:.1f} a shift</b>. "
        f"Time the line was down for breakdown or power cut comes out of the divisor.",
        f"<b>Score the quality.</b> ({pct(l['rawShare'])} - 87%) / (97% - 87%) = <b>{pct(l['qualityAggregate'])}</b>. 87% or below scores nothing; 97% or above scores the full 100%.",
        f"<b>Split the pool 70 / 30.</b> 70% x ({l['pointsPerShift']:.1f} / {vtot:.1f}) + 30% x ({(l['qualityAggregate'] or 0) * 100:.1f} / {qtot * 100:.1f}) = "
        f"{pct(s['volumeShare'])} + {pct(s['qualityShare'])} = <b>{pct(s['share'])}</b> of the pool.",
        f"<b>Turn the share into a percentage of salary.</b> {pct(s['share'])} x {lakh(pool_plan)} = {inr(s['share'] * pool_plan)}, divided by the shift's third of the "
        f"Rs 41 lakh bill (Rs 13,66,667) = <b>{pct(mn['pctSalary'], 2)} of your own salary</b>.",
    ], bullet="#"))

    # ---- the payout
    A(Paragraph("What each person would receive", S["h"]))
    A(Paragraph(f"On the projected month - a {lakh(pool_plan)} pool, once QC finishes grading {MONTH_NAME}. "
                f"Worked on the salary bands in the incentive notice; your own figure is the same percentage of your own salary.", S["b"]))
    rows = [[th("Shift"), th("Share"), th("Of own salary")] + [th(f"{esc(r['label'])}<br/>{inr(r['pay'])}") for r in ROLES]]
    for i, k2 in enumerate(ORDER, 1):
        m2 = MN[k2]
        rows.append([tdl(f"<b>{i}</b>&nbsp; Shift {k2}"), td(pct(m2["share"])), td(pct(m2["pctSalary"], 2))] + [td(inr(m2["bands"][r["key"]])) for r in ROLES])
    A(tbl(rows, [30 * mm, 18 * mm, 24 * mm] + [24.5 * mm] * len(ROLES)))
    A(Paragraph("The three shares add to exactly 100%, so the whole pool is paid out and nothing is held back. The row the plant lands on is worth far more than the "
                "place you finish in: 8,000 counted slabs would double the pool and pay every figure in this table twice over.", S["note"]))

    # ---- what happens next
    A(Paragraph(f"What happens next - {num(real)} slabs decide this month", S["h"]))
    A(Paragraph(f"{MONTH_NAME} cannot be settled until QC has graded the slabs already pressed. Every one of them still counts for the shift that made it, "
                f"whenever it is graded. Where they are today: <b>{num(by['at-qc'])}</b> at QC, not yet graded; <b>{num(by['at-polish'])}</b> on the polishing line; "
                f"<b>{num(by['pressed'])}</b> pressed and not at polish yet"
                + (f"; <b>{num(by['nowhere'])}</b> claimed numbers no station has seen, which will not grade and are left out of the projection" if by["nowhere"] else "")
                + f". QC has been grading about <b>{num(round(QC['avgPerDay7']))} slabs a day</b> over the last week"
                + (f" - at that pace the backlog clears in roughly <b>{QC['daysToClear']} days</b>." if QC.get("daysToClear") else "."), S["b"]))
    # THE CAPTION UNDER THIS TABLE IS THE SENTENCE THE MONTH IS SETTLED FROM, SO
    # IT COUNTS THE ROWS IT IS DESCRIBING AND NOT THE LIST THEY CAME FROM.
    # outstanding.groups was widened on 2026-09-03 from "design+batch with slabs
    # waiting" to "every design+batch the month CLAIMED", so the admin page could
    # show graded and waiting on one line. The caption still said "The N
    # design-and-batch groups with slabs waiting" over len(groups): on live
    # August 2026 that went from a true 33 to a false 41, because 8 of the new
    # rows have nothing waiting at all. The table body was never wrong - the
    # rows are sorted by waiting count and sliced to ten, so all ten still had
    # slabs waiting - which is exactly what made the caption dangerous: nothing
    # on the printed page revealed the overcount. Filter first, count what is
    # left, and say both numbers.
    waiting_groups = [g for g in O["groups"] if g["count"] > 0]
    groups = waiting_groups[:10]
    # "Batch grade share" replaces "Design's grade share": the design-level
    # figure was removed from incentiveMonth.ts on 2026-09-03 because it joined
    # the MIS design spelling to QC's and printed "none graded yet" over 161
    # graded slabs on live August. This is the row's own four grade counts.
    rows = [[th("Design"), th("Batch"), th("Waiting"), th("Counts x2"), th("At QC"), th("At polish"), th("Pressed only"), th("Batch grade share so far")]]
    for g in groups:
        gs = g["share"]
        rows.append([tdl(esc(g["design"])), td(esc(g["batch"])), td(num(g["count"])), td(num(g["slow"]) if g["slow"] else "-"),
                     td(num(g["stages"]["at-qc"]) if g["stages"]["at-qc"] else "-"), td(num(g["stages"]["at-polish"]) if g["stages"]["at-polish"] else "-"),
                     td(num(g["stages"]["pressed"]) if g["stages"]["pressed"] else "-"),
                     td(f"{pct(gs)} on {num(g['graded'])}" if gs is not None else (f"{num(g['graded'])} graded - too few to say" if g["graded"] else "none graded yet"))])
    A(KeepTogether([tbl(rows, [38 * mm, 16 * mm, 16 * mm, 18 * mm, 16 * mm, 18 * mm, 20 * mm, 28 * mm]),
                    Paragraph(f"The {len(waiting_groups)} design-and-batch groups with slabs waiting, largest {len(groups)} shown; "
                              f"{MONTH_NAME} claimed {len(O['groups'])} groups in all, and the other {len(O['groups']) - len(waiting_groups)} are fully graded. "
                              f"The projection assumes the outstanding slabs grade at the same {pct(PR['share'])} the month has already achieved. "
                              f"If quality holds, {MONTH_NAME} pays. If a large batch comes back badly, it may not - which is the honest position, and the reason this notice is marked provisional.", S["note"])]))

    # ---- basis
    A(Paragraph("The basis of these figures", S["h"]))
    out.extend(bullets([
        f"<b>Provisional.</b> {MONTH_NAME} is not settled: {num(real)} slabs are ungraded and the counted total is below the {num(FLOOR)} floor as things stand. No payment is due on this notice.",
        "<b>Establishment.</b> Amounts are computed from the assumed establishment in the incentive notice - 75 operators, 30 supervisors / pigment incharges / line incharges, "
        "2 Category B (R&amp;D) and 5 managers, 112 in all, on a production salary bill of Rs 41,00,000 a month - and from that bill being shared equally across the three shifts. "
        "A change in either changes every amount here.",
        "<b>Safety comes first.</b> Any lost-time accident in a shift means no incentive for that shift that month, whatever the score. Nothing in these figures checks for one.",
        "<b>Counting.</b> The month is the shift window - 06:00 on the 1st to 06:00 on the 1st of the next month - not the calendar date. Counted slabs are rounded per shift instance, "
        "as the scoreboard does; the unrounded plant total is a few slabs lower and does not change the row.",
        "<b>Quality score.</b> Each shift's month-long grade share is scored once between 87% and 97%, which is how the notice on the wall describes it. "
        f"The scoreboard averages each night's score instead; on {MONTH_NAME} the two differ by at most {max(abs(SH[x]['share'] - SHW[x]['share']) for x in 'ABC') * 100:.2f} points of share "
        f"(about {inr(max(abs(SH[x]['share'] - SHW[x]['share']) for x in 'ABC') * pool_plan / 1366667 * 20000)} to an operator). Management should confirm which reading applies before settlement.",
        "<b>Every point can be traced.</b> Scores are built from the MIS hours your shift filed and the QC grades on the slabs those hours claimed. "
        "If you believe a number is wrong, raise it with your incharge - it can be followed back to the individual slab.",
    ]))
    return out


def render(path, total=None):
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.2)
        canvas.setFillColor(GREY)
        canvas.drawString(20 * mm, 11 * mm, f"Pacific Surfaces - {MONTH_NAME} {Y} shift incentive - provisional, from the ERP as of {ist(M['asOf'])}")
        canvas.drawRightString(190 * mm, 11 * mm, f"Page {doc.page}" + (f" of {total}" if total else ""))
        canvas.setStrokeColor(LINE)
        canvas.line(20 * mm, 14 * mm, 190 * mm, 14 * mm)
        canvas.restoreState()

    doc = BaseDocTemplate(str(path), pagesize=A4, title=f"{MONTH_NAME} {Y} shift incentive", author="Pacific Surfaces",
                          leftMargin=20 * mm, rightMargin=20 * mm, topMargin=13 * mm, bottomMargin=13 * mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=footer)])
    doc.build(story())
    return doc.page


if __name__ == "__main__":
    import tempfile
    probe = Path(tempfile.gettempdir()) / "_incentive-month-probe.pdf"
    pages = render(probe)
    render(OUT, total=pages)
    probe.unlink(missing_ok=True)
    print(f"written: {OUT}  ({pages} pages, from {SRC.name} as of {M['asOf']})")
