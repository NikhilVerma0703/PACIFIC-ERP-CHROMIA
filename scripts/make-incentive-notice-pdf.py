"""Render the shift-incentive notice as one printable double-sided A4 sheet.

Deliberately ASCII/Latin-1 only: ReportLab's built-in fonts carry no emoji,
arrows or the rupee sign, and any such glyph renders as a solid black box on
the printed sheet. Money is written "Rs 1,22,500".

Every figure on the money tables is COMPUTED from the constants below, not
typed - so the columns cannot drift out of step with each other, and changing
one salary or one headcount re-cuts the whole sheet. The asserts refuse to
build a notice whose shares do not add up to the pool.

It has to fit TWO pages - one sheet, printed both sides. The type is set tight
for that reason: if you add a section, take one out, or the build will tell you
it has gone to three.

    python scripts/make-incentive-notice-pdf.py [output.pdf]
"""
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

# --------------------------------------------------------------- the scheme
# Headcount and pay on the production line (Silos -> Jot). The pool is shared
# in proportion to salary, which is the same thing as everyone taking the same
# percentage of their own pay - so the salary bill is what turns a pool into a
# percentage.
# HEADCOUNT REVISED 2026-08-06: 22/4/2 -> 35/4/5. The pool tiers below were
# NOT changed to match, by decision - the same rupees now buy 44 people instead
# of 28, so every percentage and every per-head figure on the sheet falls. That
# is why nothing here is typed twice: the tables re-cut themselves and cannot
# quietly disagree with each other.
MANAGERS, MANAGER_PAY = 5, 175_000
INCHARGES, INCHARGE_PAY = 4, 52_500
OPERATORS, OPERATOR_PAY = 35, 20_000

# 30 days x 3 shifts. Used only to say what one shift has to average.
SHIFTS_IN_MONTH = 90

# The quality band, and the ONLY place it is written on this sheet. Must match
# QUALITY_FLOOR / QUALITY_TARGET in src/lib/shiftScoreMath.ts, which is what
# actually computes the payout - a notice promising one band while the ERP pays
# another is worse than no notice.
FLOOR_PCT, TARGET_PCT = 87, 97

# Shifts before a per-shift rate is trusted at face value. Mirrors
# CREDIBLE_SHIFTS in src/lib/shiftScoreMath.ts, which was lowered 5 -> 3 in
# commit 1097b11 for a three-man rotation. THE PRINTED NOTICE STILL SAID FIVE
# until 2026-08-06, so the sheet on the wall and the code paying the money
# disagreed about the rule. Corrected here; keep the two in step.
CREDIBLE_SHIFTS = 3

# Performance target for the OEE block. Mirrors TARGET_SLABS_PER_SHIFT in
# src/lib/shiftScoreMath.ts, and is itself read off the pool ladder: the tier
# that pays a full month's salary, divided by the shifts in a month.
TARGET_SLABS_PER_SHIFT = 100

# Good slabs the plant makes in the month -> the pool everyone shares.
TIERS = [(6_000, 200_000), (7_000, 400_000), (8_000, 700_000), (9_000, 1_000_000),
         (10_000, 1_500_000), (11_000, 2_000_000), (12_000, 3_000_000)]

ROLES = [("Operators", OPERATORS, OPERATOR_PAY),
         ("Incharges", INCHARGES, INCHARGE_PAY),
         ("Managers", MANAGERS, MANAGER_PAY)]

BILL = sum(n * pay for _, n, pay in ROLES)
HEADS = sum(n for _, n, _ in ROLES)

PAGES_EXPECTED = 2

OUT = (Path(sys.argv[1]) if len(sys.argv) > 1
       else Path(__file__).resolve().parent.parent / "docs" / "SHIFT-INCENTIVE-NOTICE.pdf")


def inr(n):
    """Indian digit grouping: 1,22,500 - not 122,500."""
    n = int(round(n))
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return ("-" if n < 0 else "") + s


def lakh(n):
    """200000 -> '2 lakh'. Only whole lakhs appear in the tiers."""
    return f"{n / 100_000:g} lakh"


def pool_rows():
    """One row per tier, with every column derived from the pool."""
    rows = []
    for slabs, pool in TIERS:
        pct = pool / BILL
        cut = {name: pay * pct for name, _, pay in ROLES}
        paid = sum(n * cut[name] for name, n, _ in ROLES)
        assert abs(paid - pool) < 1, f"{slabs}: shares total {paid}, pool is {pool}"
        rows.append({"slabs": slabs, "pool": pool, "pct": pct,
                     "per_shift": round(slabs / SHIFTS_IN_MONTH), "cut": cut})
    return rows


POOL = pool_rows()
assert BILL == 1_785_000, f"salary bill is {BILL}: check the percentages in the prose"


def landmark():
    """The first tier that pays a FULL month's salary - the sheet's headline.

    Derived, never typed. At 28 people it was 9,000 slabs; at 44 the same pools
    buy less, so it is 11,000. Hard-coding it is exactly how a notice ends up
    promising a month's pay on a row that no longer pays one.
    """
    for r in POOL:
        if r["pct"] >= 1:
            return r
    return None


def step_range():
    """Smallest and largest jump between consecutive rows, as % of salary -
    what "one row up is worth" actually is at this headcount."""
    steps = [b["pct"] - a["pct"] for a, b in zip(POOL, POOL[1:])]
    return min(steps), max(steps)


LANDMARK = landmark()
STEP_LO, STEP_HI = step_range()
# The second column's promise: how many more good slabs a shift must average to
# move the whole plant up one row.
SLAB_STEP = round((POOL[1]["slabs"] - POOL[0]["slabs"]) / SHIFTS_IN_MONTH)

BRAND = colors.HexColor("#0f4c5c")
DARK = colors.HexColor("#0a3540")
AMBER = colors.HexColor("#92400e")
AMBER_BG = colors.HexColor("#fffbeb")
GREY = colors.HexColor("#6b7280")
LINE = colors.HexColor("#d1d5db")
TINT = colors.HexColor("#f0f7f8")

ss = getSampleStyleSheet()
S = {
    "title": ParagraphStyle("t", parent=ss["Title"], fontName="Helvetica-Bold",
                            fontSize=17.5, leading=20, textColor=BRAND, spaceAfter=1),
    "sub": ParagraphStyle("s", parent=ss["Normal"], fontSize=8, leading=10,
                          textColor=GREY, alignment=TA_CENTER, spaceAfter=6),
    # TIGHTENED 2026-08-06 to absorb the OEE section without going to a third
    # sheet. This is close to the floor for a notice read standing up at a
    # machine - if another section is added, take one out rather than shrinking
    # these further.
    "h": ParagraphStyle("h", parent=ss["Normal"], fontName="Helvetica-Bold",
                        fontSize=9.8, leading=11.6, textColor=BRAND,
                        spaceBefore=4, spaceAfter=2),
    "b": ParagraphStyle("b", parent=ss["Normal"], fontSize=7.9, leading=10.3,
                        spaceAfter=2.5),
    "li": ParagraphStyle("li", parent=ss["Normal"], fontSize=8, leading=10.5,
                         leftIndent=11, bulletIndent=2, spaceAfter=1.5),
    "warn": ParagraphStyle("w", parent=ss["Normal"], fontSize=8.2, leading=10.8,
                           textColor=AMBER, spaceAfter=2),
    "formula": ParagraphStyle("f", parent=ss["Normal"], fontName="Helvetica-Bold",
                              fontSize=11, leading=13, alignment=TA_CENTER,
                              textColor=DARK, spaceBefore=2.5, spaceAfter=2.5),
    "quote": ParagraphStyle("q", parent=ss["Normal"], fontSize=8, leading=10.6,
                            leftIndent=8, textColor=colors.HexColor("#374151")),
    "note": ParagraphStyle("n", parent=ss["Normal"], fontSize=7.3, leading=9.4,
                           textColor=GREY, spaceBefore=1.5, spaceAfter=2),
    "th": ParagraphStyle("th", parent=ss["Normal"], fontName="Helvetica-Bold",
                         fontSize=7.8, leading=9.3, textColor=DARK, alignment=TA_CENTER),
    "td": ParagraphStyle("td", parent=ss["Normal"], fontSize=7.4, leading=8.8,
                         alignment=TA_CENTER),
    "foot": ParagraphStyle("fo", parent=ss["Normal"], fontSize=7.4, leading=9.2,
                           textColor=GREY, alignment=TA_CENTER),
}


def th(text):
    """Header cell that wraps - plain strings in a Table do not."""
    return Paragraph(text, S["th"])


def td(text):
    """Body cell that wraps, for the same reason."""
    return Paragraph(text, S["td"])


def tbl(data, widths, align_right=None, head=True, pad=3, size=8.2, shade=None):
    t = Table(data, colWidths=widths, hAlign="LEFT")
    cmds = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", size),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
    ]
    if head:
        cmds += [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", size),
                 ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                 ("TEXTCOLOR", (0, 0), (-1, 0), DARK)]
    for c in (align_right or []):
        cmds.append(("ALIGN", (c, 0), (c, -1), "CENTER"))
    for r in (shade or []):
        cmds.append(("BACKGROUND", (0, r), (-1, r), TINT))
    t.setStyle(TableStyle(cmds))
    return t


def band(text, bg, border, style):
    """A full-width tinted callout box."""
    t = Table([[Paragraph(text, style)]], colWidths=[170 * mm], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.8, border),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def bullets(items, style="li", bullet="•"):
    """bulletText is a fixed string, so a numbered list needs the number built
    per item - passing "1." gave every row a literal 1."""
    if bullet == "#":
        return [Paragraph(x, S[style], bulletText=f"{i}.") for i, x in enumerate(items, 1)]
    return [Paragraph(x, S[style], bulletText=bullet) for x in items]


def story():
    """Rebuilt per pass: platypus consumes flowables as it lays them out."""
    out = []
    A = out.append

    # ------------------------------------------------- side 1: how you score
    A(Paragraph("Shift Production Incentive", S["title"]))
    A(Paragraph("Pacific Surfaces - Production: Silos &gt; Mixer &gt; Distributor/Kreos &gt; Robo &gt; Press &gt; Oven &gt; Jot", S["sub"]))

    A(Paragraph("What this is", S["h"]))
    A(Paragraph("Every month each shift earns a <b>score</b>. The highest score earns the highest incentive, paid as "
                "a <b>percentage of your own salary</b> - everyone on the shift shares the same result, each person's "
                "amount based on their own pay.", S["b"]))
    A(band("<b>Production is a team game.</b> One person cannot win this alone, and one person cannot lose it alone. "
           "Silos, mixer, distributor, press, oven and Jot all count as one shift. You win together.",
           TINT, BRAND, S["quote"]))

    A(Paragraph("How the score is calculated", S["h"]))
    A(Paragraph("Your score is built from <b>two things only</b> - how much you made, and how good it was. The money "
                "is <b>split between them</b>, and both halves are counted <b>per shift, not per month</b>.", S["b"]))
    A(Paragraph("70%  GOOD SLABS YOU MADE&nbsp;&nbsp;&nbsp;+&nbsp;&nbsp;&nbsp;30%  QUALITY OF WHAT YOU MADE", S["formula"]))
    A(Paragraph("A big producer with poor quality loses the whole quality half; a careful shift that makes very little "
                "loses most of the larger half - <b>you need both</b>. And you are measured on your average per shift, "
                "not your total: 3 shifts making 300 good slabs (100 a shift) beats 10 shifts making 500 (50 a shift). "
                f"Below {CREDIBLE_SHIFTS} shifts in the month your rate is scaled down in proportion - one good night is "
                "not a month.", S["b"]))

    A(Paragraph("1. GOOD SLABS - 70% of the money", S["h"]))
    A(Paragraph("The slabs <b>your own MIS entry claims</b> - the starting and ending slab number you enter each hour. "
                "Those slabs are yours, and each counts by the grade QC finally gives it. An hour with no slab numbers "
                "entered claims nothing.", S["b"]))

    A(Paragraph("2. QUALITY - 30% of the money", S["h"]))
    A(Paragraph("The share of <b>your</b> slabs that came out Grade A. Quality follows the slab, not the clock: we look "
                "at what QC gave the slabs your MIS entry claimed, not whatever was polished during your hours - that "
                "is someone else's work.", S["b"]))
    gradeT = tbl([["QC grade", "Counts as"],
                  ["A  (and A2)", "1 good slab"],
                  ["B", "half a slab"],
                  ["C  (reject)", "nothing"]], [28 * mm, 26 * mm], align_right=[1])
    floorT = tbl([["Your grade share", "Quality score"],
                  [f"{FLOOR_PCT}% or below", "0%"],
                  ["90%", "30%"],
                  ["92%", "50%"],
                  ["95%", "80%"],
                  [f"{TARGET_PCT}% or above", "100%"]], [34 * mm, 26 * mm], align_right=[1])
    qpair = Table([[gradeT, floorT]], colWidths=[58 * mm, 68 * mm], hAlign="LEFT")
    qpair.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    A(qpair)
    A(Spacer(1, 3))
    A(Paragraph(f"Your grade share is scored between an <b>{FLOOR_PCT}% minimum standard</b> and a <b>{TARGET_PCT}% target</b> - "
                f"you are paid for how far <b>above {FLOOR_PCT}%</b> you get, and <b>{TARGET_PCT}% scores the full 100%</b>. "
                "You do not have to be perfect to score perfectly. The plant already runs between 93% and 98%, so this is "
                "where places are won and lost: two points of grade share is worth twenty points of quality score.", S["b"]))
    A(band("<b>A reject costs you nothing beyond itself</b> - it is worth zero, never a minus. There is no reason to "
           "leave a slab out of MIS: hiding a bad one gains nothing and loses the good ones on the same line. A slab "
           "still waiting to be polished is <b>not</b> counted against you - your score rises when QC grades it.",
           TINT, BRAND, S["quote"]))

    A(Paragraph("How the pool is shared out", S["h"]))
    A(Paragraph("The pool is divided <b>in proportion to salary</b>: everyone is paid the same percentage of their own "
                "pay, so the shares always add up to exactly the pool.", S["b"]))
    shareRows = [[th("Who"), th("On the line"), th("Monthly salary"), th("Share of every pool")]]
    for name, n, pay in ROLES:
        shareRows.append([name, str(n), f"Rs {inr(pay)} each", f"{n * pay / BILL * 100:.0f}%"])
    shareRows.append(["Total", str(HEADS), f"Rs {inr(BILL)}", "100%"])
    A(tbl(shareRows, [30 * mm, 24 * mm, 38 * mm, 40 * mm], align_right=[1, 2, 3]))
    # The example tier is picked, not typed: whichever row the plant is likeliest
    # to read first has to be the one the sentence explains.
    ex = POOL[2]
    A(Paragraph(f"There are <b>{HEADS} people on the line</b> - {OPERATORS} operators, {INCHARGES} incharges "
                f"and {MANAGERS} managers - and a production salary bill of Rs {lakh(BILL)} a month. That bill is what "
                "turns a pool into a percentage. The pool itself is set by what the plant makes - the table overleaf. "
                f"A Rs {lakh(ex['pool'])} pool is {ex['pct'] * 100:.0f}% of one month's salary, and every person on the "
                f"line takes {ex['pct'] * 100:.0f}% of their own.", S["note"]))

    A(PageBreak())

    # ------------------------------------------------ side 2: what it pays
    A(Paragraph("What the month pays - count the slabs, read your own line", S["h"]))
    A(Paragraph("The pool everyone shares is set by the <b>good slabs the whole plant makes in the month</b>. It rises "
                "far faster than production does: 10,000 to 12,000 slabs is 20% more work and <b>double</b> the money. "
                "This is not last month's result - it is what is waiting to be earned.", S["b"]))

    head = [th("Good slabs<br/>in the month"), th("A shift<br/>averages"), th("Total<br/>pool"),
            th("Of one month's<br/>salary"),
            th(f"Operator<br/>Rs {inr(OPERATOR_PAY)}"), th(f"Incharge<br/>Rs {inr(INCHARGE_PAY)}"),
            th(f"Manager<br/>Rs {inr(MANAGER_PAY)}")]
    rows = [head]
    for r in POOL:
        rows.append([f"{r['slabs']:,}", f"{r['per_shift']} a shift", f"Rs {lakh(r['pool'])}",
                     f"{r['pct'] * 100:.0f}%",
                     f"Rs {inr(r['cut']['Operators'])}", f"Rs {inr(r['cut']['Incharges'])}",
                     f"Rs {inr(r['cut']['Managers'])}"])
    # Shade the row worth a full month's pay, wherever it now falls - +1 for the
    # header. At 28 people that was the 9,000 row; at 44 it is 11,000.
    shade = [POOL.index(LANDMARK) + 1] if LANDMARK else []
    A(tbl(rows, [25 * mm, 21 * mm, 21 * mm, 24 * mm, 26 * mm, 26 * mm, 27 * mm],
          align_right=[0, 1, 2, 3, 4, 5, 6], shade=shade, pad=3.5))
    A(Paragraph("Your own figure is that same percentage of your own salary. \"A shift averages\" is the good slabs one "
                f"shift needs to average across the {SHIFTS_IN_MONTH} shifts in a month.", S["note"]))
    A(band(f"<b>Read the second column, then the last three.</b> About <b>{SLAB_STEP} more good slabs a shift</b> moves the "
           f"whole plant up one row - and every row up adds another <b>{STEP_LO * 100:.0f}% to {STEP_HI * 100:.0f}% of a "
           "month's pay</b> to every person on the line."
           + (f" <b>{LANDMARK['slabs']:,} slabs is a full extra month's pay for everyone.</b>" if LANDMARK else "")
           + "<br/>Every shift's output counts towards the same total, so <b>the whole plant has to get there together</b> - "
           "one shift alone cannot reach it, and one shift falling behind holds everyone back.",
           TINT, BRAND, S["quote"]))

    A(Paragraph("IMPORTANT - log in to your OWN shift only", S["h"]))
    A(band("<b>The score is counted from the MIS entry. If you are logged in during another shift, your work is counted "
           "in THEIR score - not yours.</b> This is the most common way a shift loses points it had already earned.",
           AMBER_BG, colors.HexColor("#f59e0b"), S["warn"]))
    A(Spacer(1, 3))
    A(KeepTogether(bullets([
        "<b>Log in at the start of your shift and LOG OUT at the end.</b> No login = no entry = no score for that hour. "
        "Stay logged in and the next shift's slabs are recorded under your name - and your own next shift may show nothing.",
        "<b>Enter every hour in MIS</b>, with the correct <b>shift number</b> (1 / 2 / 3), the <b>incharge names</b>, and "
        "the <b>starting and ending slab number</b> - that is what claims those slabs for your shift.",
        "<b>Never enter data for another shift.</b> If an hour was missed, tell your incharge - do not fill it in under "
        "the wrong shift.",
        "<b>Log the reason and minutes for any stoppage</b> - the electrical and mechanical incharges are scored on it.",
    ])))
    A(Spacer(1, 2))
    A(Paragraph("<b>We check this.</b> The system compares the shift written on each record against the actual clock "
                "time. Records logged under the wrong shift are visible in the report and will be corrected - which may "
                "move points from one shift to another.", S["b"]))

    A(Paragraph("How the money is decided", S["h"]))
    A(Paragraph("At the end of the month each shift's <b>good slabs per shift</b> and <b>quality score</b> are worked "
                "out. The pool is split 70% on good slabs and 30% on quality, each shift takes its share of both, and "
                "that combined share becomes the <b>percentage of salary</b> paid to everyone on the shift. Good slabs "
                "are counted once QC has graded them, so a shift's score keeps rising as polishing catches up with it.",
                S["b"]))
    A(band("The pay table is what every shift earns when the three finish level. Win the month and your shift takes "
           "more; finish last and you take less. <b>But the row the plant lands on is worth far more than the place you "
           "finish in</b> - which is why the shift you beat this month is the same shift you need next month.",
           colors.HexColor("#f9fafb"), LINE, S["quote"]))
    A(Spacer(1, 3))
    A(Paragraph("<b>Conditions</b>", S["b"]))
    A(KeepTogether(bullets([
        f"A shift below the <b>{FLOOR_PCT}% minimum quality standard</b> takes nothing from the quality half - the highest "
        f"quantity alone does not win. At <b>{TARGET_PCT}% and above the quality half scores in full</b>.",
        "<b>Safety comes first.</b> Any lost-time accident in the shift means no incentive that month, whatever the score.",
        "Scores are <b>published every month</b> and can be checked. If you believe a number is wrong, raise it with "
        "your incharge - every point traces back to the individual slab records behind it.",
    ])))

    A(Paragraph("New on the board - OEE, the number world-class factories run on", S["h"]))
    A(Paragraph("Three numbers multiplied, all of them already coming from your own MIS entry - nothing new to write "
                "down. <b>They do not decide your money yet</b>: watch them for a month first.", S["b"]))
    # Paragraph cells, not strings: a plain string in a Table neither wraps nor
    # honours a newline, so these would run straight out of their columns.
    A(tbl([[th("Availability"), th("Performance"), th("Quality"), th("OEE")],
           [td("Of the hours you logged, the time the line could run"),
            td(f"Good slabs against {TARGET_SLABS_PER_SHIFT} a running shift"),
            td("Your QC grade share (A = 1, B = 0.5, C = 0)"),
            td("The three multiplied together")],
           ["over 95%", "over 95%", "over 98%", "over 85%"]],
          [40 * mm, 40 * mm, 45 * mm, 30 * mm], align_right=[0, 1, 2, 3], size=7.6, pad=2.5))
    A(Spacer(1, 2))
    A(Paragraph("Beside them is <b>MIS discipline</b>: hours filed out of eight, ranges typed too wide to be real, and "
                "slabs another shift claimed too. Each already costs you points under the rules above - now you can see "
                "it and fix the entry <b>while the month is still running</b>, instead of on payday.", S["b"]))

    A(Spacer(1, 4))
    A(band("<b>Make more. Make it right. Log in to your own shift. Record everything.</b>",
           TINT, BRAND, ParagraphStyle("c", parent=S["b"], fontSize=10.5, leading=13,
                                       alignment=TA_CENTER, textColor=DARK)))
    A(Spacer(1, 7))
    A(Paragraph("Effective from: ____________________ &nbsp;&nbsp;&nbsp; Signed: ____________________ "
                "&nbsp;&nbsp;&nbsp; Date: ____________________", S["b"]))
    A(Spacer(1, 3))
    A(Paragraph("Questions: speak to your Production Incharge.", S["foot"]))
    return out


def render(path, total=None):
    """Returns the page count, so pass 1 can tell pass 2 what to print."""
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.2)
        canvas.setFillColor(GREY)
        canvas.drawString(20 * mm, 11 * mm, "Pacific Surfaces - Shift Production Incentive")
        canvas.drawRightString(190 * mm, 11 * mm,
                               f"Page {doc.page}" + (f" of {total}" if total else ""))
        canvas.setStrokeColor(LINE)
        canvas.line(20 * mm, 14 * mm, 190 * mm, 14 * mm)
        canvas.restoreState()

    doc = BaseDocTemplate(str(path), pagesize=A4, title="Shift Production Incentive",
                          author="Pacific Surfaces", leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=13 * mm, bottomMargin=13 * mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=footer)])
    doc.build(story())
    return doc.page


if __name__ == "__main__":
    import tempfile
    probe = Path(tempfile.gettempdir()) / "_notice-probe.pdf"
    pages = render(probe)
    render(OUT, total=pages)
    probe.unlink(missing_ok=True)
    print(f"written: {OUT}  ({pages} pages)")
    if pages != PAGES_EXPECTED:
        print(f"WARNING: this is meant to be {PAGES_EXPECTED} pages - one sheet, both sides. "
              f"It came to {pages}. Cut a section or tighten the type in S[].")
