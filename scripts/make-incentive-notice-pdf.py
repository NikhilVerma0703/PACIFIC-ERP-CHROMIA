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
                              fontSize=14, leading=18, alignment=TA_CENTER,
                              textColor=DARK, spaceBefore=5, spaceAfter=5),
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
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
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
A(Paragraph("Your score is built from <b>two things only</b> - how much you made, and how good it was.", S["b"]))
A(Paragraph("SCORE  =  QUANTITY  &times;  QUALITY", S["formula"]))
A(Paragraph("They are <b>multiplied, not added</b> - 1,000 slabs made badly scores low, and so do 100 made perfectly.", S["b"]))
A(Paragraph("You cannot make up bad quality by producing more, and you cannot make up low production by being "
            "careful with a few slabs. <b>You need both.</b>", S["b"]))

A(Paragraph("1. QUANTITY - how many slabs", S["h"]))
A(Paragraph("The number of slabs your shift produced that reached <b>Jot</b> and were measured.", S["b"]))

A(Paragraph("2. QUALITY - what QC grades those same slabs", S["h"]))
A(Paragraph("Quality follows <b>your</b> slabs. We take the slabs your shift pressed and look at the grade QC "
            "finally gave them - not whatever was being polished during your hours, which is someone else's work.",
            S["b"]))
A(tbl([["QC grade", "Counts as"],
       ["A  (and A2)", "100%"],
       ["B", "50%"],
       ["C  (reject)", "0%"]],
      [34 * mm, 26 * mm], align_right=[1]))
A(Spacer(1, 5))
A(Paragraph("Your grade share is then scored against a <b>90% minimum standard</b> - you are paid for how far "
            "<b>above</b> 90% you get:", S["b"]))
A(tbl([["Your grade share", "Quality score"],
       ["90% or below", "0%"],
       ["95%", "50%"],
       ["98%", "80%"],
       ["100%", "100%"]],
      [40 * mm, 30 * mm], align_right=[1]))
A(Spacer(1, 4))
A(Paragraph("A slab still waiting to be polished is <b>not</b> counted against you - it simply waits until QC "
            "grades it.", S["b"]))

A(Paragraph("Our own figures - July 2026", S["h"]))
A(Paragraph("Real numbers from our line, not examples:", S["b"]))
A(tbl([["Shift", "Slabs pressed", "Grade share", "POINTS"],
       ["Shift C", "2,042", "94.7%", "1,336"],
       ["Shift A", "1,690", "96.2%", "1,075"],
       ["Shift B", "1,839", "94.6%", "1,026"]],
      [24 * mm, 32 * mm, 28 * mm, 26 * mm], align_right=[1, 2, 3]))
A(Spacer(1, 5))
A(band("<b>Look at Shift A and Shift B.</b> Shift A pressed <b>149 fewer slabs</b> than Shift B - and still "
       "<b>beat it</b>, 1,075 points to 1,026, because a higher share of A's slabs came out Grade A.<br/>"
       "<b>Making more is not enough. It has to be right.</b>",
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
A(Paragraph("The score can only count what is measured. <b>A slab with no thickness reading at Jot cannot earn "
            "quality points.</b>", S["b"]))
A(KeepTogether(bullets([
    "Enter the <b>thickness readings at Jot</b> for every slab - all measurement points.",
    "Enter the <b>slab class</b> (3 cm / 2 cm / 1.2 cm) on every Jot record.",
    "Enter every <b>MIS hour</b> with the correct <b>shift number</b> and the <b>incharge names</b>.",
], bullet="•")))
A(Spacer(1, 3))
A(Paragraph("If a shift measures only a few slabs, its quality score is built from those few slabs only. "
            "<b>Measure everything - it is your own score.</b>", S["b"]))

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
                      topMargin=15 * mm, bottomMargin=18 * mm)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=footer)])
doc.build(story)
print("written:", OUT)
