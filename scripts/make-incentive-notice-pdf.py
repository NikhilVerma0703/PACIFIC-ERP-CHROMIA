"""Render the shift-incentive notice as a clean, printable 2-page A4 PDF.

Deliberately ASCII/Latin-1 only: ReportLab's built-in fonts carry no emoji or
arrows, and any such glyph renders as a solid black box on the printed sheet.
"""
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

OUT = r"C:\Users\user\Desktop\ERP\docs\SHIFT-INCENTIVE-NOTICE.pdf"
BRAND = colors.HexColor("#0f4c5c")
DARK = colors.HexColor("#0a3540")
AMBER = colors.HexColor("#92400e")
AMBER_BG = colors.HexColor("#fffbeb")
GREY = colors.HexColor("#6b7280")
LINE = colors.HexColor("#d1d5db")

ss = getSampleStyleSheet()
S = {
    "title": ParagraphStyle("t", parent=ss["Title"], fontName="Helvetica-Bold",
                            fontSize=19, leading=22, textColor=BRAND, spaceAfter=2),
    "sub": ParagraphStyle("s", parent=ss["Normal"], fontSize=8.5, leading=11,
                          textColor=GREY, alignment=TA_CENTER, spaceAfter=9),
    "h": ParagraphStyle("h", parent=ss["Normal"], fontName="Helvetica-Bold",
                        fontSize=11, leading=13, textColor=BRAND,
                        spaceBefore=7, spaceAfter=3.5),
    "b": ParagraphStyle("b", parent=ss["Normal"], fontSize=8.8, leading=11.8, spaceAfter=3.5),
    "li": ParagraphStyle("li", parent=ss["Normal"], fontSize=9, leading=12.4,
                         leftIndent=11, bulletIndent=2, spaceAfter=2.5),
    "warn": ParagraphStyle("w", parent=ss["Normal"], fontSize=9.2, leading=12.6,
                           textColor=AMBER, spaceAfter=3),
    "formula": ParagraphStyle("f", parent=ss["Normal"], fontName="Helvetica-Bold",
                              fontSize=12.5, leading=15, alignment=TA_CENTER,
                              textColor=DARK, spaceBefore=4, spaceAfter=4),
    "quote": ParagraphStyle("q", parent=ss["Normal"], fontSize=9, leading=12.4,
                            leftIndent=9, textColor=colors.HexColor("#374151")),
    "foot": ParagraphStyle("fo", parent=ss["Normal"], fontSize=7.6, leading=9.5,
                           textColor=GREY, alignment=TA_CENTER),
}


def tbl(data, widths, align_right=None, head=True, pad=4):
    t = Table(data, colWidths=widths, hAlign="LEFT")
    cmds = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8.6),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
    ]
    if head:
        cmds += [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.6),
                 ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                 ("TEXTCOLOR", (0, 0), (-1, 0), DARK)]
    for c in (align_right or []):
        cmds.append(("ALIGN", (c, 0), (c, -1), "CENTER"))
    t.setStyle(TableStyle(cmds))
    return t


def band(text, bg, border, style):
    """A full-width tinted callout box."""
    t = Table([[Paragraph(text, style)]], colWidths=[170 * mm], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.8, border),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def bullets(items, style="li", bullet="-"):
    """bulletText is a fixed string, so a numbered list needs the number built
    per item - passing "1." gave every row a literal 1."""
    if bullet == "#":
        return [Paragraph(x, S[style], bulletText=f"{i}.") for i, x in enumerate(items, 1)]
    return [Paragraph(x, S[style], bulletText=bullet) for x in items]


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.2)
    canvas.setFillColor(GREY)
    canvas.drawString(20 * mm, 11 * mm, "Pacific Surfaces - Shift Production Incentive")
    canvas.drawRightString(190 * mm, 11 * mm, f"Page {doc.page} of 2")
    canvas.setStrokeColor(LINE)
    canvas.line(20 * mm, 14 * mm, 190 * mm, 14 * mm)
    canvas.restoreState()


story = []
A = story.append

# ---------------------------------------------------------------- page 1
A(Paragraph("Shift Production Incentive", S["title"]))
A(Paragraph("Pacific Surfaces - Production: Silos &rarr; Mixer &rarr; Distributor/Kreos &rarr; Robo &rarr; Press &rarr; Oven &rarr; Jot"
            .replace("&rarr;", "&gt;"), S["sub"]))

A(Paragraph("What this is", S["h"]))
A(Paragraph("Every month each shift earns a <b>score</b>. The highest score earns the highest incentive, paid as a <b>percentage of your own salary</b> - everyone on the shift shares the same result, each person's amount based on their own pay.", S["b"]))
A(band("<b>Production is a team game.</b> One person cannot win this alone, and one person cannot lose it "
       "alone. Silos, mixer, distributor, press, oven and Jot all count as one shift. You win together.",
       colors.HexColor("#f0f7f8"), BRAND, S["b"]))

A(Paragraph("How the score is calculated", S["h"]))
A(Paragraph("Your score is built from <b>two things only</b> - how much you made, and how good it was. "
            "The money is <b>split between them</b>.", S["b"]))
A(Paragraph("70%  GOOD SLABS YOU MADE&nbsp;&nbsp;&nbsp;+&nbsp;&nbsp;&nbsp;30%  QUALITY OF WHAT YOU MADE", S["formula"]))
A(Paragraph("A big producer with poor quality loses the whole quality half; a careful shift that makes very "
            "little loses most of the larger half. <b>You need both.</b>", S["b"]))
A(Paragraph("BOTH HALVES ARE COUNTED&nbsp;&nbsp; PER SHIFT,  NOT PER MONTH", S["formula"]))
A(band("<b>You are measured on your average per shift, not your total.</b> 3 shifts making 300 good slabs "
       "(100 a shift) beats 10 shifts making 500 (50 a shift). Below 5 shifts in the month your rate is "
       "scaled down in proportion - one good night is not a month.",
       colors.HexColor("#f0f7f8"), BRAND, S["quote"]))

A(Paragraph("1. GOOD SLABS - 70% of the money", S["h"]))
A(Paragraph("The slabs <b>your own MIS entry claims</b> - the starting and ending slab number you enter each hour. Those slabs are yours, and each counts by the grade QC finally gives it. An hour with no slab numbers entered claims nothing.", S["b"]))

A(Paragraph("2. QUALITY - 30% of the money", S["h"]))
A(Paragraph("The share of <b>your</b> slabs that came out Grade A. Quality follows the slab, not the clock: we look at what QC gave the slabs your MIS entry claimed, not whatever was polished during your hours - that is someone else's work.", S["b"]))
gradeT = tbl([["QC grade", "Counts as"],
       ["A  (and A2)", "1 good slab"],
       ["B", "half a slab"],
       ["C  (reject)", "nothing"]], [30 * mm, 28 * mm], align_right=[1])
floorT = tbl([["Your grade share", "Quality score"],
       ["90% or below", "0%"],
       ["95%", "50%"],
       ["98%", "80%"],
       ["100%", "100%"]], [36 * mm, 28 * mm], align_right=[1])
qpair = Table([[gradeT, floorT]], colWidths=[60 * mm, 70 * mm], hAlign="LEFT")
qpair.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
A(qpair)
A(Spacer(1, 4))
A(Paragraph("Your grade share is scored against a <b>90% minimum standard</b> - you are paid for how far "
            "<b>above</b> 90% you get. The plant already runs between 93% and 98%, so this is where places "
            "are won and lost.", S["b"]))
A(band("<b>A reject costs you nothing beyond itself</b> - it is worth zero, never a minus. There is no reason "
       "to leave a slab out of MIS: hiding a bad one gains nothing and loses the good ones on the same line. "
       "A slab still waiting to be polished is <b>not</b> counted against you - your score rises when QC "
       "grades it.",
       colors.HexColor("#f0f7f8"), BRAND, S["quote"]))

A(Paragraph("Our own figures - July 2026", S["h"]))
A(Paragraph("Real numbers from our line, not examples:", S["b"]))
A(tbl([["Shift", "Nights", "Slabs pressed", "Grade share", "Good slabs", "PER SHIFT"],
       ["Shift C", "29", "2,021", "95.4%", "1,488", "51"],
       ["Shift B", "28", "1,731", "95.0%", "1,342", "48"],
       ["Shift A", "28", "1,638", "95.6%", "1,228", "44"]],
      [24 * mm, 18 * mm, 27 * mm, 24 * mm, 24 * mm, 23 * mm], align_right=[1, 2, 3, 4, 5]))
A(Spacer(1, 5))
A(band("Three shifts, near enough the same nights, <b>seven slabs a shift</b> between first and last, and "
       "grade share separating them by half a point.<br/>"
       "<b>The month is won by a few slabs an hour and a few grades a night.</b>",
       colors.HexColor("#f9fafb"), LINE, S["quote"]))

A(PageBreak())

# ---------------------------------------------------------------- page 2
A(Paragraph("IMPORTANT - log in to your OWN shift only", S["h"]))
A(band("<b>The score is counted from the MIS entry. If you are logged in during another shift, your work is "
       "counted in THEIR score - not yours.</b><br/>"
       "This is the most common way a shift loses points it had already earned.",
       AMBER_BG, colors.HexColor("#f59e0b"), S["warn"]))
A(Spacer(1, 4))
A(KeepTogether(bullets([
    "<b>Log in at the start of your shift.</b> No login = no entry = no score for that hour.",
    "<b>Enter every hour in MIS.</b> Missing hours are missing production. The system cannot count what was never entered.",
    "<b>LOG OUT at the end of your shift.</b> If you stay logged in, the next shift's slabs are recorded under your name - and your own next shift may show nothing.",
    "<b>Never enter data for another shift.</b> If an hour was missed, tell your incharge - do not fill it in under the wrong shift.",
    "<b>Enter the correct shift number</b> (1 / 2 / 3) on every record. Wrong shift = slabs go to the wrong team.",
], bullet="•")))
A(Spacer(1, 4))
A(band("<b>We check this.</b> The system compares the shift written on each record against the actual clock "
       "time. Records logged under the wrong shift are visible in the report and will be corrected - which may "
       "move points from one shift to another.", colors.HexColor("#f9fafb"), LINE, S["quote"]))

A(Paragraph("What you must record for the score to count", S["h"]))
A(Paragraph("The score can only count what your shift records. <b>An hour with no slab numbers claims nothing.</b>",
            S["b"]))
A(KeepTogether(bullets([
    "Enter the <b>starting and ending slab number</b> every hour - that is what claims those slabs for your shift.",
    "Enter every <b>MIS hour</b> with the correct <b>shift number</b> and the <b>incharge names</b>.",
    "Log the <b>reason and minutes</b> for any stoppage - the electrical and mechanical incharges are scored on it.",
], bullet="•")))
A(Spacer(1, 3))
A(Paragraph("Good slabs are counted once QC has graded them, so a shift&apos;s score keeps rising as polishing "
            "catches up with it.", S["b"]))

A(Paragraph("The prize depends on what the PLANT makes", S["h"]))
A(Paragraph("The pool everyone shares is set by the factory's total output for the month. It rises far faster "
            "than production does - going from 10,000 to 12,000 slabs is 20% more work and <b>double</b> the money:",
            S["b"]))
A(tbl([["Slabs in the month", "Total incentive pool"],
       ["8,000", "Rs 7 lakh"],
       ["10,000", "Rs 15 lakh"],
       ["12,000", "Rs 30 lakh"]],
      [46 * mm, 46 * mm], align_right=[1]))
A(Spacer(1, 4))
A(Paragraph("Every shift's output counts towards the same total, so <b>the whole plant has to get there "
            "together</b> - one shift alone cannot reach it, and one shift falling behind holds everyone back.",
            S["b"]))

A(Paragraph("How the money is decided", S["h"]))
A(KeepTogether(bullets([
    "At the end of the month every shift's score is totalled.",
    "Shifts are <b>ranked</b> by score.",
    "Each rank carries an incentive <b>percentage of salary</b>.",
    "Everyone on that shift receives that percentage <b>of their own salary</b>.",
], bullet="#")))
A(Spacer(1, 6))
A(Paragraph("<b>Conditions</b>", S["b"]))
A(KeepTogether(bullets([
    "A shift must meet the <b>minimum quality standard</b> to take first place - the highest quantity alone does not win.",
    "<b>Safety comes first.</b> Any lost-time accident in the shift means no incentive that month, whatever the score.",
    "Scores are <b>published every month</b> and can be checked. If you believe a number is wrong, raise it with your incharge - every point traces back to the individual slab records behind it.",
], bullet="•")))

A(Spacer(1, 8))
A(band("<b>Make more. Make it right. Log in to your own shift. Record everything.</b>",
       colors.HexColor("#f0f7f8"), BRAND, ParagraphStyle("c", parent=S["b"], fontSize=11,
                                                         leading=14, alignment=TA_CENTER, textColor=DARK)))
A(Spacer(1, 10))
A(Paragraph("Effective from: ____________________ &nbsp;&nbsp;&nbsp; Signed: ____________________ "
            "&nbsp;&nbsp;&nbsp; Date: ____________________", S["b"]))
A(Spacer(1, 4))
A(Paragraph("Questions: speak to your Production Incharge.", S["foot"]))

doc = BaseDocTemplate(OUT, pagesize=A4, title="Shift Production Incentive",
                      author="Pacific Surfaces", leftMargin=20 * mm, rightMargin=20 * mm,
                      topMargin=14 * mm, bottomMargin=14 * mm)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=footer)])
doc.build(story)
print("written:", OUT)
