"""Render the shift-incentive notice as a printable A4 handout.

Deliberately ASCII/Latin-1 only: ReportLab's built-in fonts carry no emoji,
arrows or the rupee sign, and any such glyph renders as a solid black box on
the printed sheet. Money is written "Rs 1,22,500".

Every figure on the money tables is COMPUTED from the constants below, not
typed - so the columns cannot drift out of step with each other, and changing
one salary or one headcount re-cuts the whole sheet. The asserts refuse to
build a notice whose shares do not add up to the pool.

LENGTH. This was one double-sided sheet at 7.9pt until 2026-08-06, when the
worked example, the manually-awarded points and the OEE block went in. Holding
one sheet would have meant keeping type too small to read standing at a
machine, so it is three sides at 9pt instead. PAGES_EXPECTED guards the length
so it cannot grow without someone noticing - raise it deliberately, do not
shrink the type to hide a new section.

    python scripts/make-incentive-notice-pdf.py [output.pdf]
"""
import re
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
# HEADCOUNT, final figures 2026-08-06: 75 operators, 30 supervisors/incharges,
# 7 managers - 112 people, against 28 at the start of the day. The pool tiers
# below were NOT scaled to match, by decision, so the same rupees are shared by
# four times as many people and every percentage on the sheet falls with them.
# Nothing here is typed twice: the tables re-cut themselves from these three
# lines and cannot quietly disagree with each other.
#
# TWO THINGS 112 PEOPLE DID, BOTH VISIBLE ON THE SHEET:
#
#  1. No tier reaches a full month's salary. The top row (12,000 slabs, Rs 25
#     lakh) pays 58%, so LANDMARK is None and the headline sentence falls back
#     to stating what the top row really pays. Raise the pools if a full month
#     is meant to be reachable again.
#  2. The middle group is now the LARGEST claim on every pool - 30 people at
#     Rs 52,500 is Rs 15.75 lakh of the bill, ahead of the 75 operators'
#     Rs 15 lakh. The share table says so plainly; it is arithmetic, not a
#     decision made here, but it is the row people will read twice.
#
# Keep this comment in step with the numbers - it has twice described a
# headcount the file had already moved past, which is what makes a correct file
# look broken.
MANAGERS, MANAGER_PAY = 7, 175_000
INCHARGES, INCHARGE_PAY = 30, 52_500
OPERATORS, OPERATOR_PAY = 75, 20_000

# 30 days x 3 shifts. Used only to say what one shift has to average.
SHIFTS_IN_MONTH = 90

# The quality band, and the ONLY place it is written on this sheet. Must match
# QUALITY_FLOOR / QUALITY_TARGET in src/lib/shiftScoreMath.ts, which is what
# actually computes the payout - a notice promising one band while the ERP pays
# another is worse than no notice.
FLOOR_PCT, TARGET_PCT = 87, 97

# THE HEADCOUNT ABOVE IS PROVISIONAL. It was given verbally on 2026-08-06 and HR
# is confirming the establishment; every rupee figure and every percentage on
# this sheet is computed from it, so the whole money side of the notice moves if
# it changes. The sheet has to say so, or a signed document reads as a promise
# of figures nobody has confirmed.
#
# WHEN HR CONFIRMS: correct the three constants at the top, set this to False,
# and rebuild. That removes both notices and the qualifier under the title in
# one go - there is nothing else to remember.
HEADCOUNT_PROVISIONAL = True
HEADCOUNT_SOURCE_DATE = "6 August 2026"
HEADCOUNT_CONFIRM_BY = "8 August 2026"

# Shifts before a per-shift rate is trusted at face value.
#
# LEFT AT 5 ON PURPOSE, AND IT DOES NOT MATCH THE CODE. CREDIBLE_SHIFTS in
# src/lib/shiftScoreMath.ts is 3 — lowered from 5 in commit 1097b11 for a
# three-man rotation, whose own message said the wall notice needed re-cutting
# before it drove a payout. This sheet was changed to 3 to match, then reverted
# on 2026-08-06 because the change had not been asked for.
#
# SO THE NOTICE AND THE PAYOUT DISAGREE: a man with 3 or 4 shifts is told his
# rate is scaled down, and the code pays him in full. It errs in the employee's
# favour, which is why it is survivable, but it is still a promise the system
# does not keep. Decide which number is right and change BOTH.
CREDIBLE_SHIFTS = 5

# Performance target for the OEE block. Mirrors TARGET_SLABS_PER_SHIFT in
# src/lib/shiftScoreMath.ts. It USED to be read off the pool ladder - the tier
# paying a full month's salary, divided by the shifts in a month - but no tier
# pays a full month any more, so it is now a standalone decision. Keep the two
# files in step; see the long note beside the TypeScript constant.
TARGET_SLABS_PER_SHIFT = 100

# Good slabs the plant makes in the month -> the pool everyone shares.
# MINIMUM RAISED 6,000 -> 7,000 and the TOP POOL CUT 30 -> 25 lakh, 2026-08-06.
# The 6,000 row (Rs 2 lakh) is gone: below 7,000 there is no pool at all, which
# is what makes it a minimum rather than just the smallest row printed - the
# sheet says so under the table.
#
# The rest were scaled by the same 25/30 the top was cut by, then rounded to
# WHOLE LAKHS - "Rs 3.33333 lakh" is not a figure to print on a wall.
# Exact vs printed: 3.33->3, 5.83->6, 8.33->8, 12.5->13, 16.67->17, 25->25.
# The ladder's shape is unchanged and every row is within 10% of the true
# proportion. Keep them whole lakhs if these are ever re-cut.
TIERS = [(7_000, 300_000), (8_000, 600_000), (9_000, 800_000),
         (10_000, 1_300_000), (11_000, 1_700_000), (12_000, 2_500_000)]

ROLES = [("Operators", OPERATORS, OPERATOR_PAY),
         ("Supervisors / Pigment Incharge / Line Incharge", INCHARGES, INCHARGE_PAY),
         ("Managers / R&amp;D", MANAGERS, MANAGER_PAY)]

# The pay table's last three columns are what ONE person in that group takes, so
# their headers say the role in the singular and how many of them are on the
# line. Keyed off ROLES rather than trimming the plural, which would quietly
# produce "Incharge" from any name that happened to end in an s. The middle row
# carries a line break because "SUPERVISOR / PIGMENT INCHARGE" will not fit one
# column at this width.
SINGULAR = {
    "Operators": "Operator",
    "Supervisors / Pigment Incharge / Line Incharge":
        "Supervisor /<br/>Pigment Incharge /<br/>Line Incharge",
    "Managers / R&amp;D": "Manager / R&amp;D",
}

BILL = sum(n * pay for _, n, pay in ROLES)
HEADS = sum(n for _, n, _ in ROLES)

# It was ONE sheet until 2026-08-06, when the worked example, the referral and
# manually-awarded points, and the OEE block went in. The only way to hold one
# sheet was 7.9pt type, which is the wrong trade for a notice read standing at a
# machine - so it is three sides at a readable size instead. Printed both sides
# that leaves the back of the second sheet blank, which is the intended layout:
# the guard exists to stop the notice growing SILENTLY, not to force a fold.
# 4 while HEADCOUNT_PROVISIONAL is set - the two provisional notices and the
# title qualifier add most of a side between them. It drops back to 3 when HR
# confirms the establishment and that flag goes False.
PAGES_EXPECTED = 4 if HEADCOUNT_PROVISIONAL else 3

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


def whole_percents(values):
    """Round a set of shares to whole percents that still total exactly 100.

    Rounding each share on its own does not add up. At 55/11/6 the true shares
    are 40.33 / 21.17 / 38.50, which round to 40 / 21 / 38 and print as 99% in a
    table whose last row says 100% - the first thing anyone checking the sheet
    would find. Largest-remainder: floor everything, then hand the leftover
    points to whoever was rounded down hardest.
    """
    total = sum(values)
    exact = [v / total * 100 for v in values]
    out = [int(x) for x in exact]
    leftover = 100 - sum(out)
    # Biggest fractional part first; index as a tie-break so it is deterministic.
    order = sorted(range(len(exact)), key=lambda i: (-(exact[i] - out[i]), i))
    for i in order[:leftover]:
        out[i] += 1
    assert sum(out) == 100, out
    return out


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
assert BILL == 4_300_000, f"salary bill is {BILL}: check the percentages in the prose"


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


def tier_at(slabs):
    """The tier row for a given slab count, BY SLABS - never by position.

    Both the worked example and the share-table sum used to index POOL directly
    (POOL[3], POOL[2]). Dropping the 6,000 row on 2026-08-06 shifted every
    index by one, which would silently have re-pointed the worked example from
    the 9,000 tier to the 10,000 one and the share-table sum from 8,000 to
    9,000 - the prose around them still naming the old figures. Ask for the row
    you mean.
    """
    for r in POOL:
        if r["slabs"] == slabs:
            return r
    raise AssertionError(f"no tier for {slabs:,} slabs - the TIERS table changed under a caller")


def worked_example(slabs=9_000):
    """One month, three shifts, all the way through to rupees.

    COMPUTED WITH THE REAL RULES, not illustrative numbers typed to look right -
    the whole point is that a reader can check it against the tables on the
    earlier pages and find they agree. The example shifts' figures are chosen;
    everything derived from them is not.

    The mechanism: each shift takes a share of the volume pool on its good-slabs
    RATE and a share of the quality pool on its quality SCORE. Level pegging is
    a third each, which is what the pay table shows, so a shift's payout is the
    tier percentage scaled by how far its share sits above or below that third.
    """
    tier = tier_at(slabs)
    # (shift, good slabs per shift, raw grade share)
    shifts = [("A", 100, 0.95), ("B", 90, 0.92), ("C", 80, 0.90)]
    scored = [(s, rate, raw, max(0.0, min(1.0, (raw - FLOOR_PCT / 100) / ((TARGET_PCT - FLOOR_PCT) / 100))))
              for s, rate, raw in shifts]
    rate_tot = sum(r for _, r, _, _ in scored)
    qual_tot = sum(q for _, _, _, q in scored)
    out = []
    for s, rate, raw, q in scored:
        share = POOL_VOLUME * rate / rate_tot + POOL_QUALITY * q / qual_tot
        # share is of the WHOLE pool; a third is level, so multiply up.
        pct = tier["pct"] * share * len(scored)
        out.append({"shift": s, "rate": rate, "raw": raw, "quality": q,
                    "share": share, "pct": pct, "operator": OPERATOR_PAY * pct})
    assert abs(sum(r["share"] for r in out) - 1) < 1e-9, "example shares must total the pool"
    return tier, out


POOL_VOLUME, POOL_QUALITY = 0.7, 0.3
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
    # SET FOR READING, NOT FOR FITTING. This sheet was squeezed to 7.9pt to hold
    # everything on one page; once the referral, manual-points and OEE sections
    # were added that stopped being possible, and shrinking type to save a fold
    # is a bad trade on a notice people read standing at a machine. It is now
    # two sheets printed both sides, and the type is back to a comfortable size.
    "h": ParagraphStyle("h", parent=ss["Normal"], fontName="Helvetica-Bold",
                        fontSize=11, leading=13, textColor=BRAND,
                        spaceBefore=7, spaceAfter=3),
    "b": ParagraphStyle("b", parent=ss["Normal"], fontSize=9, leading=12,
                        spaceAfter=4),
    "li": ParagraphStyle("li", parent=ss["Normal"], fontSize=9, leading=12,
                         leftIndent=12, bulletIndent=2, spaceAfter=3),
    "warn": ParagraphStyle("w", parent=ss["Normal"], fontSize=9.2, leading=12.4,
                           textColor=AMBER, spaceAfter=2),
    "formula": ParagraphStyle("f", parent=ss["Normal"], fontName="Helvetica-Bold",
                              fontSize=12, leading=15, alignment=TA_CENTER,
                              textColor=DARK, spaceBefore=4, spaceAfter=4),
    "quote": ParagraphStyle("q", parent=ss["Normal"], fontSize=9, leading=12,
                            leftIndent=8, textColor=colors.HexColor("#374151")),
    "note": ParagraphStyle("n", parent=ss["Normal"], fontSize=7.3, leading=9.4,
                           textColor=GREY, spaceBefore=1.5, spaceAfter=2),
    "th": ParagraphStyle("th", parent=ss["Normal"], fontName="Helvetica-Bold",
                         fontSize=7.8, leading=9.3, textColor=DARK, alignment=TA_CENTER),
    "td": ParagraphStyle("td", parent=ss["Normal"], fontSize=7.4, leading=8.8,
                         alignment=TA_CENTER),
    "tdl": ParagraphStyle("tdl", parent=ss["Normal"], fontSize=8.2, leading=9.8),
    "foot": ParagraphStyle("fo", parent=ss["Normal"], fontSize=7.4, leading=9.2,
                           textColor=GREY, alignment=TA_CENTER),
}


def th(text):
    """Header cell that wraps - plain strings in a Table do not."""
    return Paragraph(text, S["th"])


def td(text):
    """Body cell that wraps, for the same reason."""
    return Paragraph(text, S["td"])


def tdl(text):
    """Left-aligned body cell.

    USE THIS FOR ANY CELL CARRYING MARKUP OR AN ENTITY. A bare string in a
    ReportLab Table is drawn verbatim - only Paragraph cells go through the
    mini-HTML parser - so the role name "Managers / R&amp;D" printed the entity
    literally on the share table while rendering correctly two pages later,
    where the same text sat inside a Paragraph.
    """
    return Paragraph(text, S["tdl"])


def role_lower(name):
    """A role name for running text: lower-cased, but initialisms left alone.

    Plain .lower() printed "7 managers / r&d" in the roll-call sentence, because
    R&D is an initialism and not a word. It is spelled &amp; in ROLES, so the
    entity has to survive the fold too - "&AMP;" and "&amp;" are not the same
    thing to a parser that is case-sensitive about entity names.
    """
    out = name.lower().replace("&amp;", "&amp;")
    return re.sub(r"\br&amp;d\b", "R&amp;D", out)


def upper_kept(text):
    """Upper-case the words but leave any markup alone.

    Plain .upper() turns the <br/> inside a role label into <BR/>. ReportLab
    happens to accept that today, so the first version of this function - which
    matched [^<>/]+ and therefore uppercased the "br" BETWEEN the angle brackets
    - looked like it worked while doing exactly what it exists to prevent. It
    was passing on luck, not correctness.

    Match whole tags AND html entities first so the alternation consumes them
    intact, and only upper-case the runs of text between them. Entities matter
    as much as tags: "R&amp;D" upper-cased whole becomes "R&AMP;D", and entity
    names are case-sensitive, so that renders as literal "&AMP;D" on the sheet.
    """
    return re.sub(r"<[^>]*>|&[A-Za-z]+;|[^<&]+",
                  lambda m: m.group(0) if m.group(0)[0] in "<&" else m.group(0).upper(),
                  text)


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
    if HEADCOUNT_PROVISIONAL:
        A(Paragraph(f"<b>PROVISIONAL DRAFT</b> - figures computed from an unconfirmed headcount of {HEADS} "
                    f"and subject to revision on confirmation by Human Resources (expected {HEADCOUNT_CONFIRM_BY})",
                    ParagraphStyle("prov", parent=S["sub"], textColor=AMBER, fontSize=8.2, spaceAfter=7)))

    A(Paragraph("What this is", S["h"]))
    A(Paragraph("Every month, each shift earns a <b>score</b>. A better score earns a bigger incentive. It is paid as "
                "a <b>percentage of your own salary</b>: everyone on the shift earns the <b>same percentage</b>, so the "
                "rupees differ but the result is shared.", S["b"]))
    A(band("<b>Production is a team game.</b> One person cannot win this alone, and one person cannot lose it alone. "
           "Silos, mixer, distributor, press, oven and Jot all count as one shift. You win together.",
           TINT, BRAND, S["quote"]))

    A(Paragraph("How the score is calculated", S["h"]))
    A(Paragraph("Your score is built from <b>two things only</b> - how much you made, and how good it was. The money "
                "is <b>split between them</b>, and both halves are counted <b>per shift, not per month</b>.", S["b"]))
    A(Paragraph("70%  GOOD SLABS YOU MADE&nbsp;&nbsp;&nbsp;+&nbsp;&nbsp;&nbsp;30%  QUALITY OF WHAT YOU MADE", S["formula"]))
    A(KeepTogether(bullets([
        "<b>You need both halves.</b> Make a lot badly and you lose the quality half. Make a little carefully and you "
        "lose most of the bigger half.",
        "<b>Your average per shift counts, not your total.</b> 3 shifts making 300 good slabs (100 each) beats 10 shifts "
        f"making 500 (50 each). Under {CREDIBLE_SHIFTS} shifts your rate is scaled down - one good night is not a month.",
    ])))

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

    shareRows = [[th("Who"), th("On the line"), th("Monthly salary"), th("Share of every pool")]]
    # Largest-remainder, so the column totals the 100% the last row claims.
    shares = whole_percents([n * pay for _, n, pay in ROLES])
    for (name, n, pay), share in zip(ROLES, shares):
        # tdl, not a bare string: the role names carry entities (R&amp;D).
        shareRows.append([tdl(name), str(n), f"Rs {inr(pay)} each", f"{share}%"])
    shareRows.append(["Total", str(HEADS), f"Rs {inr(BILL)}", "100%"])
    # First column widened twice now: at 30mm "Supervisors / Pigment Incharge"
    # did not fit, and as a bare string it did not wrap either - it overprinted
    # the headcount in the next column, so the 8 read as part of the word.
    # Paragraph cells wrap; the width keeps the longest role name on ONE line,
    # which is 60.3mm once "/ Line Incharge" is on the end. Measure before
    # changing a role name - scripts/ has no layout test to catch it for you.
    shareTable = tbl(shareRows, [68 * mm, 18 * mm, 30 * mm, 30 * mm], align_right=[1, 2, 3])
    # The example tier is picked, not typed: whichever row the plant is likeliest
    # to read first has to be the one the sentence explains.
    ex = tier_at(8_000)
    # The roll-call and the worked division are both generated, so the sentence
    # cannot survive a headcount change that makes it false.
    roll = ", ".join(f"{n} {role_lower(name)}" for name, n, _ in ROLES[:-1])
    roll += f" and {ROLES[-1][1]} {role_lower(ROLES[-1][0])}"
    # The table and the notice qualifying it are ONE unit. Kept apart they broke
    # across the fold and "the establishment in the table above" pointed at a
    # table the reader could no longer see - the qualifier has to be on the same
    # page as the numbers it qualifies or it is not a qualifier.
    # Heading inside the group too, or it is left stranded at the foot of the
    # previous page announcing a table that is not there.
    block = [
        Paragraph("How the pool is shared out", S["h"]),
        Paragraph("The pool is divided <b>in proportion to salary</b>: everyone is paid the same percentage of their "
                  "own pay, so the shares always add up to exactly the pool.", S["b"]),
        shareTable,
        Paragraph(f"There are <b>{HEADS} people on the line</b> - {roll} - and a production salary bill of "
                  f"<b>Rs {inr(BILL)}</b> a month. That bill is what turns a pool into a percentage, and the sum is "
                  f"one division you can check yourself:", S["note"]),
        Paragraph(f"Rs {inr(ex['pool'])} pool &divide; Rs {inr(BILL)} salary bill = "
                  f"<b>{ex['pct'] * 100:.0f}% of a month's pay, for everybody</b>", S["formula"]),
        Paragraph("The pool itself is set by what the plant makes - the table overleaf. Whatever that percentage "
                  "comes to, every person on the line takes exactly that much of their own salary.", S["note"]),
    ]
    if HEADCOUNT_PROVISIONAL:
        block.append(band(
            f"<b>PROVISIONAL - HEADCOUNT NOT YET CONFIRMED.</b> The establishment in the table above "
            f"({OPERATORS} operators / {INCHARGES} supervisors and incharges / {MANAGERS} managers) is an assumed "
            f"figure recorded on {HEADCOUNT_SOURCE_DATE} and is <b>subject to confirmation by Human Resources</b>, "
            f"expected by {HEADCOUNT_CONFIRM_BY}. <b>Every amount and percentage in this notice is calculated from "
            "it</b>, including the pay table and the worked example overleaf. Should the confirmed establishment "
            "differ, all such figures will change accordingly and a corrected notice will be issued. <b>This notice "
            "is not to be relied upon as a statement of entitlement until the confirmed figures are published.</b>",
            AMBER_BG, colors.HexColor("#f59e0b"), S["warn"]))
    A(KeepTogether(block))

    A(PageBreak())

    # ------------------------------------------------ side 2: what it pays
    A(Paragraph("What the month pays - count the slabs, read your own line", S["h"]))
    A(Paragraph("The pool everyone shares is set by the <b>good slabs the whole plant makes in the month</b>. It rises "
                "far faster than production does: 10,000 to 12,000 slabs is 20% more work and <b>double</b> the money. "
                "This is not last month's result - it is what is waiting to be earned.", S["b"]))

    # The last three columns are what ONE person takes, so each says how many
    # people are in that group - otherwise Rs 7,843 reads as though it might be
    # the whole operator group's share rather than one operator's.
    head = [th("Good slabs<br/>in the month"), th("A shift<br/>averages"), th("Total<br/>pool"),
            th("Of one month's<br/>salary")] + [
        th(f"EACH {upper_kept(SINGULAR[name])}<br/>{n} on the line<br/>Rs {inr(pay)} salary")
        for name, n, pay in ROLES]
    rows = [head]
    for r in POOL:
        # Per-person columns built by walking ROLES, not by naming the three
        # groups here: renaming a group used to KeyError on the old literal.
        rows.append([f"{r['slabs']:,}", f"{r['per_shift']} a shift", f"Rs {lakh(r['pool'])}",
                     f"{r['pct'] * 100:.0f}%"]
                    + [f"Rs {inr(r['cut'][name])}" for name, _, _ in ROLES])
    # Shade the row worth a full month's pay, wherever it now falls - +1 for the
    # header. At 28 people that was the 9,000 row; at 44 it is 11,000.
    shade = [POOL.index(LANDMARK) + 1] if LANDMARK else []
    # Narrowed the four left columns to widen the three per-person ones: their
    # headers now carry three role words plus a headcount and a salary, and the
    # longest ("PIGMENT INCHARGE /") is 29.5mm at 7.8pt bold.
    A(tbl(rows, [21 * mm, 20 * mm, 20 * mm, 20 * mm, 30 * mm, 29 * mm, 30 * mm],
          align_right=[0, 1, 2, 3, 4, 5, 6], shade=shade, pad=3.5))
    A(Paragraph("Your own figure is that same percentage of your own salary. \"A shift averages\" is the good slabs one "
                f"shift needs to average across the {SHIFTS_IN_MONTH} shifts in a month.", S["note"]))
    # Stated ON the table, not only at the foot of the sheet: this is the line
    # that stops a printed figure being read as a promise.
    A(band(f"<b>{POOL[0]['slabs']:,} good slabs is the minimum.</b> Below that the plant earns <b>no pool at all</b> "
           "and there is nothing to share out, whatever any single shift did. The table starts where the money "
           "starts.<br/>"
           "<b>And these figures are not fixed.</b> Every number here already takes your own performance into account, "
           "and what you actually receive <b>can go up or down from what is printed</b> depending on how you "
           "personally perform.",
           AMBER_BG, colors.HexColor("#f59e0b"), S["warn"]))
    A(band(f"<b>Read the second column, then the last three.</b> About <b>{SLAB_STEP} more good slabs a shift</b> moves the "
           f"whole plant up one row - and every row up adds another <b>{STEP_LO * 100:.0f}% to {STEP_HI * 100:.0f}% of a "
           "month's pay</b> to every person on the line."
           # The headline sentence, and its honest fallback. With 72 people on
           # the line no tier reaches a full month's salary any more, so rather
           # than quietly dropping the line the sheet says what the top row
           # DOES pay. A missing headline reads as an oversight; a smaller
           # number reads as the truth.
           + (f" <b>{LANDMARK['slabs']:,} slabs is a full extra month's pay for everyone.</b>" if LANDMARK
              else f" <b>{POOL[-1]['slabs']:,} slabs pays everyone {POOL[-1]['pct'] * 100:.0f}% of a month's "
                   "salary - the best the ladder currently goes.</b>")
           + "<br/>Every shift's output counts towards the same total, so <b>the whole plant has to get there together</b> - "
           "one shift alone cannot reach it, and one shift falling behind holds everyone back.",
           TINT, BRAND, S["quote"]))

    ex_tier, ex = worked_example()
    A(Paragraph("A worked example - one month, all the way to rupees", S["h"]))
    A(Paragraph(f"Say the plant makes <b>{ex_tier['slabs']:,} good slabs</b>, so the pool is "
                f"<b>Rs {lakh(ex_tier['pool'])}</b> and level pegging pays <b>{ex_tier['pct'] * 100:.0f}%</b> of salary. "
                "The three shifts do not finish level:", S["b"]))
    exRows = [[th("Shift"), th("Good slabs<br/>per shift"), th("QC grade<br/>share"),
               th("Quality<br/>score"), th("Share of<br/>the pool"), th("Paid, as % of<br/>own salary"),
               th(f"An operator on<br/>Rs {inr(OPERATOR_PAY)}")]]
    for r in ex:
        exRows.append([f"Shift {r['shift']}", f"{r['rate']}", f"{r['raw'] * 100:.0f}%",
                       f"{r['quality'] * 100:.0f}%", f"{r['share'] * 100:.0f}%",
                       f"{r['pct'] * 100:.0f}%", f"Rs {inr(r['operator'])}"])
    A(tbl(exRows, [20 * mm, 24 * mm, 22 * mm, 22 * mm, 22 * mm, 26 * mm, 30 * mm],
          align_right=[0, 1, 2, 3, 4, 5, 6], pad=3.5))
    A(Paragraph("Shift A made 25% more than C and finished five grade points ahead, and took "
                f"{ex[0]['pct'] / ex[2]['pct']:.1f} times the money for it. "
                "Every shift still earned - nobody is left with nothing - and all three shares add up to exactly the "
                "pool, so nothing is held back.", S["note"]))
    A(Spacer(1, 4))

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
    A(Paragraph("At month end each shift's <b>good slabs per shift</b> and <b>quality score</b> are worked out. Each "
                "shift takes its share of both halves, and that becomes the <b>percentage of salary</b> everyone on "
                "that shift is paid. Slabs count once QC grades them, so your score keeps rising as polishing catches "
                "up.", S["b"]))
    A(band("The pay table is what each shift earns when all three finish level. Win the month and you take more; finish "
           "last and you take less. <b>But the row the plant lands on is worth far more than the place you finish in</b> "
           "- which is why the shift you beat this month is the same shift you need next month.",
           colors.HexColor("#f9fafb"), LINE, S["quote"]))
    # EVERYTHING IN THIS SECTION IS AWARDED BY HAND. None of it exists in the
    # ERP - there is no referral table, no skill grade, no kaizen log, no energy
    # or resin figure per shift, no attendance roster. So the notice must not
    # imply a formula the floor could check and argue with, only a decision they
    # can ask about. Points here are added ON TOP of the production score and
    # are never subtracted from it, which is what keeps this from quietly
    # becoming a way to dock a good shift.
    A(Paragraph("Extra points - judged by management, not by the system", S["h"]))
    A(Paragraph("The score above is calculated from your MIS and QC records. The points below are <b>not calculated</b> "
                "- they are <b>awarded by management at your assessment</b>, and they are added <b>on top of</b> your "
                "production points, never taken out of them. Ask your incharge to record them as they happen.",
                S["b"]))
    A(tbl([[th("What earns extra points"), th("What counts")],
           [td("<b>Bringing in good people</b>"),
            td("You refer someone and we hire them. The plant is growing, and the people "
               "already on the line know best who can do this work - make sure your name is recorded against theirs.")],
           [td("<b>Safety and housekeeping</b>"),
            td("Reporting a hazard before it hurts someone, and keeping your own area clean")],
           [td("<b>Attendance and conduct</b>"),
            td("Turning up, following the SOP, no disciplinary issues")],
           [td("<b>Skill</b>"),
            td("Learning a second and third machine, and training the people who come after you")],
           [td("<b>Saving cost</b>"),
            td("Less resin, pigment, power and gas per slab - and less scrap")],
           [td("<b>Improvement ideas</b>"),
            td("Any change you suggest that we adopt and that measurably works")],
           [td("<b>For incharges</b>"),
            td("Getting a breakdown attended fast, closing the root cause so it does not "
               "come back, planning the shift, and developing your team")]],
          [46 * mm, 124 * mm], size=8.4, pad=3.2))
    A(Spacer(1, 3))

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
    A(Spacer(1, 5))
    A(Paragraph("<b>A note on every figure in this notice.</b> All the amounts and percentages shown - in the pay "
                "table, in the worked example and in the share table - <b>already include your personal performance</b>. "
                "They are what the scheme produces for a shift performing as described; the amount you actually "
                "receive <b>may be higher or lower than the figure printed</b>, depending on how you perform "
                "individually. Treat the tables as the shape of the scheme, not as a fixed promise of a number.",
                S["note"]))
    if HEADCOUNT_PROVISIONAL:
        A(Paragraph(f"<b>Basis of the figures.</b> All amounts in this notice are computed from an assumed "
                    f"establishment of {OPERATORS} operators, {INCHARGES} {role_lower(ROLES[1][0])} and {MANAGERS} "
                    f"{role_lower(ROLES[2][0])} ({HEADS} in total), recorded on {HEADCOUNT_SOURCE_DATE} and pending "
                    f"confirmation by Human Resources, expected by {HEADCOUNT_CONFIRM_BY}. The pool is shared in "
                    "proportion to the total salary bill, so a change in the establishment changes every amount and "
                    "percentage shown. <b>This document is issued for information in its present form and is not a "
                    "statement of entitlement until the confirmed establishment is published and a corrected notice "
                    "issued.</b>", S["note"]))
        A(Spacer(1, 4))
    A(Spacer(1, 5))
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
        print(f"WARNING: this is meant to be {PAGES_EXPECTED} pages. It came to {pages}. "
              "Cut a section, or raise PAGES_EXPECTED if the notice is genuinely meant to grow "
              "- do NOT shrink the type in S[] to hide it; it is already at a readable minimum.")
