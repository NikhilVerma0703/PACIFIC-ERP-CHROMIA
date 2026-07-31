"""
Field extraction from OCR text.

Rule-based, no model. Indian commercial bills follow strong conventions -
GSTIN has a checksummable 15-character format, tax lines are labelled CGST/
SGST/IGST, totals are labelled, dates come in a handful of formats - and those
conventions carry far more signal than any general-purpose extractor.

Design principles, both learned from the sample bills:

  1. Every field carries its own confidence and the OCR span it came from.
     A bill is rarely uniformly readable; the total may be crisp while the
     invoice number is mush. Per-field confidence lets the UI highlight exactly
     what needs checking instead of flagging the whole bill.

  2. Cross-field arithmetic is a confidence signal, not just a validation.
     If taxable + cgst + sgst + round_off == net, all four numbers are almost
     certainly right even when OCR confidence was mediocre. This recovers a lot
     of accuracy on bad photos and is the cheapest check in the file.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from datetime import date, datetime


@dataclass
class Field:
    value: object = None
    confidence: float = 0.0
    source: str = ""       # the OCR text this came from
    method: str = ""       # which rule fired

    def __bool__(self) -> bool:
        return self.value is not None


@dataclass
class Extraction:
    vendor_name: Field = field(default_factory=Field)
    vendor_gstin: Field = field(default_factory=Field)
    invoice_no: Field = field(default_factory=Field)
    invoice_date: Field = field(default_factory=Field)
    taxable_value: Field = field(default_factory=Field)
    cgst: Field = field(default_factory=Field)
    sgst: Field = field(default_factory=Field)
    igst: Field = field(default_factory=Field)
    round_off: Field = field(default_factory=Field)
    net_amount: Field = field(default_factory=Field)
    hsn_sac: Field = field(default_factory=Field)
    line_items: list[dict] = field(default_factory=list)
    arithmetic_ok: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = {}
        for k, v in self.__dict__.items():
            d[k] = asdict(v) if isinstance(v, Field) else v
        return d

    @property
    def overall_confidence(self) -> float:
        """Weighted by how much each field matters for a voucher."""
        weights = {
            "net_amount": 3.0, "vendor_name": 2.0, "invoice_date": 2.0,
            "invoice_no": 1.5, "vendor_gstin": 1.5, "taxable_value": 1.0,
            "cgst": 0.5, "sgst": 0.5, "igst": 0.5,
        }
        total = got = 0.0
        for k, w in weights.items():
            f: Field = getattr(self, k)
            total += w
            got += w * (f.confidence if f else 0.0)
        base = got / total if total else 0.0
        if self.arithmetic_ok:
            base = min(1.0, base + 0.15)
        return round(base, 3)


# --------------------------------------------------------------------------
# Patterns
# --------------------------------------------------------------------------
# 2 state digits, 5 letters (PAN), 4 digits, 1 letter, 1 alnum, Z, 1 alnum.
GSTIN_RE = re.compile(r"\b(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b")

DATE_PATTERNS = [
    (re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b"), "dmy"),
    (re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b"), "dmy2"),
    (re.compile(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})\b"), "dMy"),
]

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

# Label -> field, in priority order (most specific first), each with the
# minimum fuzzy score required to count as a hit.
#
# Fuzzy rather than exact, because OCR mangles labels constantly. Real examples
# from the sample bills: "Total Amcunt", "BillAmoun'", "Ttem Descrjtion",
# "Rounc Off". An exact regex misses every one of them; partial-ratio matching
# at 85 catches all four while still rejecting unrelated text.
# (label, field, min_fuzzy_score, require_decimals)
#
# require_decimals exists for the bare "amount" family. A pump printout is a
# column header row followed by a value row, and when OCR collapses them the
# label sits in a jumble of unrelated numbers:
#
#   "Societies "\MOUNT: VOLUME: RATE PRODUCT: DENSITy: NOZZLE VEHICLE INVOIce
#    NO: No 103 ye No: NO: 14 1200.00 DIESEL 8215 + 5 Noy 5 2017994 89 lL"
#
# Nothing positional can be trusted there. But of 103, 14, 1200.00, 8215,
# 2017994, 89 exactly one is written like money - 1200.00 - and that is the
# amount. So for these weak labels only a value with two decimal places counts.
# It also keeps the collided "Amount Volume : 91500. 4." case safe: no
# 2-decimal candidate, so nothing is claimed and the fuel/ceiling logic decides.
TOTAL_LABELS: list[tuple[str, str, int, bool]] = [
    ("net amount", "net_amount", 86, False),
    ("bill amount", "net_amount", 86, False),
    ("grand total", "net_amount", 86, False),
    ("total amount", "net_amount", 86, False),
    ("amount payable", "net_amount", 88, False),
    ("net payable", "net_amount", 88, False),
    ("round off", "round_off", 85, False),
    ("rounded off", "round_off", 88, False),
    ("sub total", "taxable_value", 85, False),
    ("subtotal", "taxable_value", 88, False),
    ("taxable value", "taxable_value", 86, False),
    ("taxable amount", "taxable_value", 86, False),
    ("central gst", "cgst", 88, False),
    ("state gst", "sgst", 88, False),
    ("integrated gst", "igst", 88, False),
    ("cgst", "cgst", 90, False),
    ("sgst", "sgst", 90, False),
    ("igst", "igst", 90, False),
    ("total", "net_amount", 92, False),
    # Bare "amount", plus the mangled forms OCR actually produces. The leading
    # "A" is the character most often lost or turned into punctuation, so
    # "MOUNT" and "AMOUNI" are matched explicitly rather than hoped for.
    ("amount", "net_amount", 90, True),
    ("mount:", "net_amount", 90, True),
    ("amount:", "net_amount", 88, True),
    ("amt", "net_amount", 92, True),
]

# Lines whose numbers must never be read as money.
NON_AMOUNT_LINE = re.compile(
    r"\b(phone|ph\b|mobile|contact|tel|fssai|gstin|gst\s*no|pan|bill\s*no|"
    r"invoice\s*no|kot|table|covers|time|user|cashier|hsn|sac|fax|pin)\b", re.I
)

INVOICE_LABELS = [
    r"(?:tax\s*)?invoice\s*(?:no|number|#)?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})",
    r"\bbill\s*(?:no|number|#)\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})",
    r"\binv\s*(?:no|#)?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})",
    r"\breceipt\s*(?:no|#)\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})",
    r"\bdoc(?:ument)?\s*(?:no|#)\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})",
]

HSN_RE = re.compile(r"\b(?:hsn|sac)\s*(?:/\s*sac)?\s*(?:code)?\s*[:.\-]?\s*(\d{4,8})\b", re.I)

NOISE_PREFIXES = re.compile(r"^[^A-Za-z0-9]+")

# A staff reimbursement above this is implausible - a meal, a tank of fuel, a
# courier docket. When the only candidate exceeds it, the right answer is to
# leave the field blank and say so, not to post a number that is wrong by 100x.
MAX_PLAUSIBLE_AMOUNT = 50_000.0

# Below this, a 2-decimal number on a receipt is more likely a rate, a litre
# count or a tax component than the total being claimed.
MIN_MONEY_AMOUNT = 20.0

# --------------------------------------------------------------------------
# Fuel receipt triangulation
#
# Fuel bills are the worst offenders in the sample set: the pump printer packs
# Amount, Rate, Volume and Preset into narrow columns that OCR collapses into a
# single run of digits. One real page read as:
#
#     "AmountcRs) Rate(Rs/i» Votumec,y Preset Type: : : : 0014.45 01500."
#
# No label survives, so no label-matching rule can work. But fuel bills carry
# something better than a label - an ARITHMETIC IDENTITY:
#
#     amount = rate x volume
#
# and the rate is tightly bounded in practice (Indian petrol/diesel sits around
# 90-110 Rs/litre). So the three numbers can be recovered by searching the
# page's numbers for a triple that satisfies the identity. On the page above
# this finds 103.00/L x 14.45 L = 1488, matching the 1500 printed - recovering
# the real total from text where no rule could read it.
#
# This is the kind of domain knowledge that substitutes for a model: free,
# offline, explainable, and provably right when it fires.
# --------------------------------------------------------------------------
FUEL_HINT = re.compile(
    r"(?i)\b(volume|litre|liter|ltrs?|nozzle|density|preset|petrol|diesel|"
    r"hsd|fuel|pump|kg/m3|rate\s*\(rs)", re.I)

FUEL_RATE_MIN, FUEL_RATE_MAX = 60.0, 145.0     # Rs per litre, generously wide
FUEL_VOLUME_MIN, FUEL_VOLUME_MAX = 1.5, 400.0  # litres in one transaction
FUEL_AMOUNT_MIN = 100.0
FUEL_TOLERANCE = 0.025                          # 2.5% - covers rounding + OCR


def looks_like_fuel(text: str) -> bool:
    """Two or more pump-specific words. One could be coincidence."""
    return len(set(m.group(0).lower() for m in FUEL_HINT.finditer(text))) >= 2


def triangulate_fuel_amount(numbers: list[float]) -> tuple[float, str] | None:
    """Find amount = rate x volume among the numbers on a fuel bill.

    Returns (amount, explanation) for the LARGEST satisfying triple, or None.
    Largest because a fuel receipt's biggest figure is the amount charged, and
    small triples like 103 x 1.00 = 103 are just the rate restated.
    """
    uniq = sorted({round(n, 2) for n in numbers})
    rates = [n for n in uniq if FUEL_RATE_MIN <= n <= FUEL_RATE_MAX]
    volumes = [n for n in uniq if FUEL_VOLUME_MIN <= n <= FUEL_VOLUME_MAX]
    if not rates or not volumes:
        return None

    best: tuple[float, str] | None = None
    for rate in rates:
        for vol in volumes:
            product = rate * vol
            if product < FUEL_AMOUNT_MIN:
                continue
            for amount in uniq:
                if amount < FUEL_AMOUNT_MIN or amount > MAX_PLAUSIBLE_AMOUNT:
                    continue
                if abs(amount - product) <= max(2.0, product * FUEL_TOLERANCE):
                    if best is None or amount > best[0]:
                        best = (amount, f"{rate:g}/litre x {vol:g} litres "
                                        f"= {product:,.2f}, matching {amount:,.2f}")
    return best


def _clean_amount(s: str) -> float | None:
    if not s:
        return None
    s = s.replace(",", "").replace(" ", "").strip(".")
    # OCR frequently reads O/o for 0 and l/I for 1 inside numbers.
    s = s.translate(str.maketrans({"O": "0", "o": "0", "l": "1", "I": "1", "S": "5"}))
    try:
        v = float(s)
    except ValueError:
        return None
    return v if 0 <= v < 1e9 else None


# --------------------------------------------------------------------------
# GSTIN repair
#
# GSTIN is the most valuable field on the bill - it is the exact vendor
# identity, so it drives both duplicate detection and vendor memory. It is also
# the field most worth fighting for, because it has two properties nothing else
# on a bill has: a rigid positional format, and a check digit.
#
# That means OCR damage is genuinely repairable rather than merely guessable.
# Positions constrain each character to digit or letter, which resolves most
# confusions outright; where a character is still ambiguous (B could be 6 or 8)
# the alternatives are enumerated and the check digit decides. A repaired GSTIN
# that passes the checksum is right with probability ~35/36 - not a guess.
# --------------------------------------------------------------------------
GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# Ambiguous OCR readings, by target type. Order matters only for determinism.
_AS_DIGIT = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "T": "7",
             "Z": "2", "S": "5", "A": "4", "G": "6", "C": "3", "E": "8"}
_AS_DIGIT_ALT = {"B": ["8", "6"], "G": ["6", "9"], "S": ["5", "8"]}
_AS_ALPHA = {"0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G",
             "4": "A", "7": "T", "3": "E", "9": "G"}

DIGIT_POS = set(range(0, 2)) | set(range(7, 11))   # state code + PAN digits
ALPHA_POS = set(range(2, 7)) | {11}                # PAN letters + entity letter


def gstin_checksum(first14: str) -> str:
    """Official GSTIN check character: base-36, alternating weights 1 and 2."""
    total = 0
    for i, ch in enumerate(first14):
        v = GSTIN_ALPHABET.index(ch)
        p = v * (2 if i % 2 else 1)
        total += p // 36 + p % 36
    return GSTIN_ALPHABET[(36 - total % 36) % 36]


def _valid_gstin(s: str, require_checksum: bool = True) -> bool:
    if not GSTIN_RE.fullmatch(s) or not (1 <= int(s[:2]) <= 38):
        return False
    return gstin_checksum(s[:14]) == s[14] if require_checksum else True


# Characters that OCR confuses with each other, used for the free positions
# (12 and 14) where either a digit or a letter is legal.
_AMBIGUOUS = [set("0OQD"), set("1IL"), set("2Z"), set("5S"),
              set("6G"), set("8B"), set("7T"), set("4A"), set("3E")]

MAX_GSTIN_EDITS = 6


def _alternatives(ch: str) -> list[str]:
    for group in _AMBIGUOUS:
        if ch in group:
            return [ch] + sorted(group - {ch})
    return [ch]


def _gstin_candidates(window: str, max_combos: int = 20000):
    """Enumerate plausible repairs of a 15-character window, cheapest first."""
    opts: list[list[str]] = []
    for i, ch in enumerate(window):
        if i == 13:
            opts.append(["Z"])
        elif i in DIGIT_POS:
            if ch.isdigit():
                opts.append([ch])
            elif ch in _AS_DIGIT_ALT:
                opts.append(_AS_DIGIT_ALT[ch])
            elif ch in _AS_DIGIT:
                opts.append([_AS_DIGIT[ch]])
            else:
                return
        elif i in ALPHA_POS:
            if ch.isalpha():
                opts.append([ch])
            elif ch in _AS_ALPHA:
                opts.append([_AS_ALPHA[ch]])
            else:
                return
        else:
            opts.append(_alternatives(ch))  # positions 12 and 14

    total = 1
    for o in opts:
        total *= len(o)
    if total > max_combos:
        return

    from itertools import product
    for combo in product(*opts):
        cand = "".join(combo)
        edits = sum(1 for a, b in zip(cand, window) if a != b)
        if edits <= MAX_GSTIN_EDITS:
            yield cand, edits


# A GSTIN is only ever looked for immediately after a GST label. Without this
# constraint the repair search is actively harmful: scanning every window of the
# page and trying thousands of substitutions will eventually produce a string
# that passes the check digit by chance (roughly 1 in 36 per candidate), and it
# did - early testing "found" 15HFIAA5004A5Z0 in a line of OCR noise. A
# fabricated GSTIN that validates is far worse than no GSTIN, because it becomes
# the vendor's identity for duplicate detection and memory.
GST_LABEL_RE = re.compile(r"(?:GSTIN|GSTNO|GSTREGNO|GSTREGISTRATIONNO|GST)")
LABEL_SEARCH_SPAN = 8   # chars after the label where the GSTIN may start


def find_gstin(text: str) -> tuple[str, str, str, int] | None:
    """Return (gstin, method, source, edits) or None."""
    up = re.sub(r"[^0-9A-Z]", "", text.upper())
    if len(up) < 15:
        return None

    # Unambiguous match anywhere on the page needs no label context.
    for m in GSTIN_RE.finditer(up):
        if _valid_gstin(m.group(1)):
            return m.group(1), "gstin_exact", m.group(1), 0

    best_checksum: tuple[str, str, int] | None = None
    format_hit: tuple[str, str, int] | None = None

    for lm in GST_LABEL_RE.finditer(up):
        for start in range(lm.end(), min(lm.end() + LABEL_SEARCH_SPAN, len(up) - 14)):
            window = up[start:start + 15]
            for cand, edits in _gstin_candidates(window) or ():
                if _valid_gstin(cand):
                    if best_checksum is None or edits < best_checksum[2]:
                        best_checksum = (cand, window, edits)
                elif format_hit is None and _valid_gstin(cand, require_checksum=False):
                    format_hit = (cand, window, edits)

    if best_checksum:
        return best_checksum[0], "gstin_repaired_checksum", best_checksum[1], best_checksum[2]
    if format_hit:
        # Right shape, wrong check digit - at least one character is still
        # wrong. Worth showing at low confidence for a clerk to confirm, never
        # worth trusting silently.
        return format_hit[0], "gstin_format_only", format_hit[1], format_hit[2]
    return None


def extract(text: str, lines: list[str] | None = None,
            ocr_conf: float = 60.0) -> Extraction:
    """Main entry point. `lines` should be the grouped OCR lines from engine.py."""
    ex = Extraction()
    lines = lines or text.splitlines()
    low = text.lower()
    base = max(0.30, min(0.95, ocr_conf / 100.0))

    _extract_gstin(ex, text, base)
    _extract_invoice_no(ex, lines, base)
    _extract_date(ex, text, base)
    _extract_amounts(ex, lines, base)
    _extract_hsn(ex, text, base)
    _extract_vendor(ex, lines, base)
    _extract_line_items(ex, lines)

    page_amounts = []
    for line in lines:
        page_amounts.extend(_line_amounts(line))
    _check_arithmetic(ex, page_amounts=page_amounts)
    return ex


def _extract_gstin(ex: Extraction, text: str, base: float) -> None:
    hit = find_gstin(text)
    if not hit:
        return
    gstin, method, source, edits = hit
    if method == "gstin_exact":
        conf = min(0.98, base + 0.25)
    elif method == "gstin_repaired_checksum":
        # Confidence falls as more characters had to be changed.
        conf = max(0.45, min(0.92, base + 0.15) - 0.06 * edits)
    else:
        conf = base * 0.45

    ex.vendor_gstin = Field(gstin, round(conf, 3), source, method)
    if method == "gstin_repaired_checksum":
        ex.notes.append(
            f"GSTIN read as '{source}', repaired to {gstin} "
            f"({edits} character{'s' if edits != 1 else ''} corrected, check digit verified)"
        )
    elif method == "gstin_format_only":
        ex.notes.append(
            f"Possible GSTIN {gstin} - correct format but the check digit fails, "
            "so please verify it against the bill"
        )


def _extract_invoice_no(ex: Extraction, lines: list[str], base: float) -> None:
    for pat in INVOICE_LABELS:
        rx = re.compile(pat, re.I)
        for line in lines:
            m = rx.search(line)
            if not m:
                continue
            val = m.group(1).strip(" .:-/")
            # Guard against swallowing a date or a bare tax rate.
            if len(val) < 2 or re.fullmatch(r"\d{1,2}[-/.]\d{1,2}", val):
                continue
            if val.lower() in {"no", "number", "date"}:
                continue
            ex.invoice_no = Field(val, base * 0.9, line.strip(), "label_match")
            return


def _extract_date(ex: Extraction, text: str, base: float) -> None:
    """Prefer a date sitting next to a 'date' label; fall back to any plausible date."""
    best: tuple[date, float, str] | None = None
    for rx, kind in DATE_PATTERNS:
        for m in rx.finditer(text):
            d = _parse_date(m, kind)
            if not d:
                continue
            # Bills are recent; a 1998 date is an OCR artefact.
            if not (2015 <= d.year <= date.today().year + 1):
                continue
            window = text[max(0, m.start() - 30):m.start()].lower()
            score = base * (1.0 if "date" in window or "dt" in window else 0.75)
            if best is None or score > best[1]:
                best = (d, score, m.group(0))
    if best:
        ex.invoice_date = Field(best[0].isoformat(), min(0.95, best[1]), best[2], "date_regex")


def _parse_date(m: re.Match, kind: str) -> date | None:
    try:
        if kind == "dmy":
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        elif kind == "dmy2":
            d, mo, y = int(m.group(1)), int(m.group(2)), 2000 + int(m.group(3))
        elif kind == "ymd":
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        else:  # dMy
            d = int(m.group(1))
            mo = MONTHS.get(m.group(2)[:3].lower(), 0)
            y = int(m.group(3))
            if y < 100:
                y += 2000
        if not mo:
            return None
        # Year OCR repair: "30/06/7026" should be 2026. A 4-digit year outside
        # the plausible range but whose last three digits are plausible is
        # almost always a corrupted leading '2'.
        if kind in ("dmy", "ymd") and not (2015 <= y <= date.today().year + 1):
            if 1000 <= y <= 9999 and 2015 <= 2000 + y % 100 <= date.today().year + 1:
                y = 2000 + y % 100
        # Indian bills are day-first. If the "day" cannot be a day but the
        # "month" can, they were swapped.
        if d > 31 or mo > 12:
            if mo <= 31 and d <= 12:
                d, mo = mo, d
            else:
                return None
        return datetime(y, mo, d).date()
    except (ValueError, TypeError):
        return None


_NUM_TOKEN = re.compile(r"\d[\d,]*(?:\.\d{1,3})?")


def _line_amounts(text: str, with_flags: bool = False):
    """Every money-looking number on a line, left to right.

    Two OCR repairs live here, both from the sample bills:

      "Total Amcunt 2108 28"  - the decimal point was lost. A trailing 2-digit
                                group separated only by whitespace is folded
                                back in, giving 2108.28.
      "BillAmoun' :1486.060"  - a spurious third decimal. Truncated to 2.

    Numbers with 6+ digits and no decimals are dropped: on a receipt those are
    phone numbers, FSSAI licences and bill numbers, never money. Without this
    the largest-amount fallback confidently returns a phone number as the total,
    which is exactly what it did before this guard existed.
    """
    toks = list(_NUM_TOKEN.finditer(text))
    out: list = []
    i = 0
    while i < len(toks):
        raw = toks[i].group(0)
        merged = False
        if "." not in raw and i + 1 < len(toks):
            nxt = toks[i + 1]
            gap = text[toks[i].end():nxt.start()]
            if re.fullmatch(r"\s{1,3}", gap) and re.fullmatch(r"\d{2}", nxt.group(0)):
                raw = raw + "." + nxt.group(0)
                merged = True
        v = _clean_amount(raw)
        if v is not None:
            digits = raw.replace(",", "").split(".")[0]
            if not (len(digits) >= 6 and "." not in raw):
                # The flag means "printed like money", so a decimal point this
                # code inserted itself does not count. Without that distinction
                # "AMOUNT: 103 14 8215" merges to 103.14 and gets treated as a
                # genuine 2-decimal total.
                genuine_decimals = ("." in raw) and not merged
                out.append((v, genuine_decimals) if with_flags else v)
        i += 2 if merged else 1
    return out


def _label_hit(line_lower: str, label: str, min_score: int) -> bool:
    from rapidfuzz import fuzz
    return fuzz.partial_ratio(label, line_lower) >= min_score


def _extract_amounts(ex: Extraction, lines: list[str], base: float) -> None:
    """Match labelled amounts line by line, taking the rightmost number.

    Rightmost matters: "State GST @ 2.5% 52.72" contains both 2.5 and 52.72, and
    on a receipt the amount is always the last column.
    """
    found: dict[str, tuple[float, str, float]] = {}
    unreadable_total = False
    for line in lines:
        l = line.lower().strip()
        if not l:
            continue

        # The identifier veto ("phone", "invoice no", "fssai"...) exists to stop
        # those numbers being read as money. But on a collapsed pump printout the
        # amount shares a line with "INVOIce NO:", and vetoing the whole line
        # threw away the total along with the noise. So the veto only applies
        # when the line carries no amount label at all - and the labels that can
        # fire on such a line require money formatting anyway, which an invoice
        # number or phone number does not have.
        labelled = any(_label_hit(l, lb, ms) for lb, _t, ms, _d in TOTAL_LABELS)
        if NON_AMOUNT_LINE.search(l) and not labelled:
            continue

        for label, target, min_score, needs_decimals in TOTAL_LABELS:
            if not _label_hit(l, label, min_score):
                continue

            if needs_decimals:
                # Weak label in a jumble of numbers: only money-formatted values
                # count, and the largest of them is the total.
                decimals = [v for v, had in _line_amounts(l, with_flags=True)
                            if had and MIN_MONEY_AMOUNT <= v <= MAX_PLAUSIBLE_AMOUNT]
                if not decimals:
                    # The label IS there, but no value on the line is written
                    # like money. That means the total is genuinely unreadable,
                    # so the largest-number fallback must not step in and offer
                    # the density or the nozzle number instead.
                    unreadable_total = True
                    break
                val = max(decimals)
                conf = base * 0.85
                if target not in found or conf > found[target][2]:
                    found[target] = (val, line.strip(), conf)
                break

            nums = _line_amounts(l)
            if not nums:
                break
            val = nums[-1]
            # Tax lines print the rate before the amount ("CGST 2.5% 35.17").
            # If the rightmost number is a bare small rate, step left.
            if target in ("cgst", "sgst", "igst") and len(nums) > 1 and val <= 30 and "%" in l:
                val = nums[-1] if nums[-1] > nums[-2] else nums[-2]
            conf = base * (1.0 if target == "net_amount" else 0.95)
            if target not in found or conf > found[target][2]:
                found[target] = (val, line.strip(), conf)
            break

    for k, (val, src, conf) in found.items():
        setattr(ex, k, Field(val, min(0.95, conf), src, "label_amount"))

    if unreadable_total and not ex.net_amount:
        ex.notes.append(
            "Found the 'Amount' label on the bill but no value next to it was "
            "written like money, so the total has been left blank rather than "
            "guessed. Please type it from the bill."
        )

    # Fuel bills: recover the amount arithmetically before falling back to
    # guessing, because the pump's columns rarely survive OCR intact.
    if not ex.net_amount:
        full = "\n".join(lines)
        if looks_like_fuel(full):
            all_nums: list[float] = []
            for line in lines:
                all_nums.extend(_line_amounts(line))
            hit = triangulate_fuel_amount(all_nums)
            if hit:
                ex.net_amount = Field(hit[0], min(0.85, base + 0.30),
                                      hit[1], "fuel_triangulated")
                ex.notes.append(f"Fuel bill: amount confirmed by {hit[1]}")

    # Fallback: no labelled total. Skipped when a label WAS found but its value
    # could not be read - in that case any other number on the page is noise.
    if not ex.net_amount and not unreadable_total:
        cands: list[tuple[float, str]] = []
        for line in lines:
            if NON_AMOUNT_LINE.search(line):
                continue
            for v in _line_amounts(line):
                if 1 <= v < 1e7:
                    cands.append((v, line.strip()))
        if cands:
            v, src = max(cands, key=lambda x: x[0])
            if v > MAX_PLAUSIBLE_AMOUNT:
                # Refuse to guess. On a fuel bill whose Amount and Volume columns
                # collided, the largest number was 91,500 for a 915-rupee
                # purchase. Silently posting that is far worse than asking - a
                # blank field gets typed in; a wrong one gets confirmed.
                ex.notes.append(
                    f"Could not read the total. The largest number on the page "
                    f"is {v:,.2f}, which is too large to be a staff claim, so it "
                    f"has been left blank rather than guessed. Please enter it."
                )
            else:
                ex.net_amount = Field(v, base * 0.45, src, "largest_amount_fallback")
                ex.notes.append(
                    "No total label was found - used the largest amount on the "
                    "page. Please check this."
                )


def _extract_hsn(ex: Extraction, text: str, base: float) -> None:
    m = HSN_RE.search(text)
    if m:
        ex.hsn_sac = Field(m.group(1), base * 0.9, m.group(0), "hsn_label")


_CAPS_WORD = re.compile(r"^[A-Z][A-Z&.'-]{1,}$")


def _extract_vendor(ex: Extraction, lines: list[str], base: float) -> None:
    """Vendor name comes from the letterhead in the first few lines.

    The naive version - "pick the most uppercase line" - returns whole lines
    including OCR debris, which on the sample bills produced things like
    "A Unita y : ek Obits) SITARA GRAND Z".

    What actually works is looking for the longest RUN of consecutive
    all-capitals words within the top lines and keeping only that run. Trading
    names are set in caps on essentially every Indian bill, and OCR debris is
    almost never several capitalised words in a row. That extracts
    "SITARA GRAND" and "URBAN MAYABAZAR" cleanly from the same lines.
    """
    best_run: tuple[float, str, str] | None = None
    for i, line in enumerate(lines[:10]):
        words = NOISE_PREFIXES.sub("", line).split()
        run: list[str] = []
        runs: list[list[str]] = []
        for w in words:
            cw = w.strip(".,:;|()[]")
            if _CAPS_WORD.match(cw) and cw not in {"GST", "GSTIN", "NO", "PH", "FSSAI"}:
                run.append(cw)
            else:
                if run:
                    runs.append(run)
                run = []
        if run:
            runs.append(run)
        for r in runs:
            text = " ".join(r)
            letters = sum(c.isalpha() for c in text)
            if letters < 5:
                continue
            score = len(r) * 2.0 + letters / 10.0 - i * 0.4
            if best_run is None or score > best_run[0]:
                best_run = (score, text, line.strip())

    if best_run:
        ex.vendor_name = Field(best_run[1], base * 0.8, best_run[2], "caps_run")
        return

    # Fallback: most letter-dense early line.
    best = None
    for i, line in enumerate(lines[:8]):
        s = NOISE_PREFIXES.sub("", line).strip()
        letters = sum(c.isalpha() for c in s)
        if letters < 5 or len(s) > 60:
            continue
        digits = sum(c.isdigit() for c in s)
        if digits > letters * 0.4:
            continue
        score = letters / 30.0 - i * 0.15
        if best is None or score > best[0]:
            best = (score, s)
    if best:
        name = re.sub(r"\s{2,}", " ", best[1]).strip(" .,:-|")
        ex.vendor_name = Field(name, base * 0.55, best[1], "letterhead_heuristic")


ITEM_RE = re.compile(
    r"^\s*(?:(\d{1,2})\s+)?"                    # optional serial no
    r"([A-Za-z][A-Za-z0-9 .,'&/()\-]{2,45}?)"   # description
    r"\s+(\d{1,3})\s+"                          # qty
    r"([\d,]+\.?\d{0,2})\s+"                    # rate
    r"([\d,]+\.?\d{0,2})\s*$"                   # amount
)


def _extract_line_items(ex: Extraction, lines: list[str]) -> None:
    """Parse qty/rate/amount rows.

    Kept deliberately strict - it only accepts rows where rate * qty is close to
    the stated amount. A loose line-item parser produces junk rows that a clerk
    then has to delete, which is worse than producing none. For expense
    vouchers the line items are informational anyway; the ledger posting uses
    the totals.
    """
    for line in lines:
        m = ITEM_RE.match(line.strip())
        if not m:
            continue
        desc = m.group(2).strip()
        qty = _clean_amount(m.group(3))
        rate = _clean_amount(m.group(4))
        amt = _clean_amount(m.group(5))
        if not all(v is not None for v in (qty, rate, amt)) or amt == 0:
            continue
        if abs(qty * rate - amt) > max(1.0, amt * 0.02):
            continue
        if len(desc) < 3 or desc.lower() in {"total", "sub total", "amount"}:
            continue
        ex.line_items.append(
            {"description": desc, "qty": qty, "rate": rate, "amount": amt}
        )


def _promote_net_if_pretax(ex: Extraction, page_amounts: list[float],
                           tolerance: float = 1.5) -> bool:
    """Detect that the captured "total" was actually the pre-tax total.

    Receipts commonly print:

        Total Amount     2108.28     <- pre-tax
        State GST @2.5%    52.72
        Central GST @2.5%  52.72
        Round Off           0.28
        Net Amount       2214.00     <- the real total

    If the "Net Amount" line is unreadable (on the sample bill it collided with
    the KOT line and became "KOT NO Net : 13625,' Amount 3629 ___ 2214.00"),
    the label matcher lands on "Total Amount" and the voucher would be posted
    2214 - 2108 = 105.72 short.

    The fix is arithmetic rather than textual: add the taxes to the captured
    total and see whether that number appears elsewhere on the page. If it does,
    the labels were misread and the roles are swapped. This does not depend on
    reading the net label at all.
    """
    def v(f: Field) -> float:
        return float(f.value) if f and f.value is not None else 0.0

    net = v(ex.net_amount)
    taxes = v(ex.cgst) + v(ex.sgst) + v(ex.igst)
    if not net or not taxes or v(ex.taxable_value):
        return False

    implied = net + taxes + v(ex.round_off)
    for amt in page_amounts:
        if abs(amt - implied) <= tolerance and amt > net:
            ex.taxable_value = Field(net, ex.net_amount.confidence,
                                     ex.net_amount.source, "reclassified_pretax")
            ex.net_amount = Field(round(amt, 2), 0.85,
                                  f"derived: {net} + taxes = {amt}",
                                  "arithmetic_promoted")
            ex.arithmetic_ok = True
            ex.notes.append(
                f"The labelled total ({net:.2f}) is the pre-tax amount; "
                f"net of {amt:.2f} confirmed by adding the taxes"
            )
            return True
    return False


def _check_arithmetic(ex: Extraction, tolerance: float = 1.5,
                      page_amounts: list[float] | None = None) -> None:
    """Verify taxable + taxes + round-off == net, and repair a single hole.

    When the sum checks out, every number involved is corroborated - that is
    stronger evidence than any individual OCR confidence, so the fields get
    promoted. When exactly one number is missing, it can be derived, which
    routinely recovers the taxable value on receipts that only print a total.
    """
    def v(f: Field) -> float:
        return float(f.value) if f and f.value is not None else 0.0

    net = v(ex.net_amount)
    if not net:
        return

    if page_amounts and _promote_net_if_pretax(ex, page_amounts, tolerance):
        return

    net = v(ex.net_amount)
    parts = v(ex.taxable_value) + v(ex.cgst) + v(ex.sgst) + v(ex.igst) + v(ex.round_off)
    if v(ex.taxable_value) and abs(parts - net) <= tolerance:
        ex.arithmetic_ok = True
        for f in (ex.net_amount, ex.taxable_value, ex.cgst, ex.sgst, ex.igst):
            if f and f.value is not None:
                f.confidence = min(0.98, f.confidence + 0.20)
        return

    # Derive the taxable value if it is the only thing missing.
    if not ex.taxable_value and (v(ex.cgst) or v(ex.sgst) or v(ex.igst)):
        derived = net - v(ex.cgst) - v(ex.sgst) - v(ex.igst) - v(ex.round_off)
        if derived > 0:
            ex.taxable_value = Field(
                round(derived, 2), 0.75,
                "derived: net - taxes", "arithmetic_derived"
            )
            ex.arithmetic_ok = True
            ex.notes.append("Taxable value derived from net minus taxes")
            return

    if v(ex.taxable_value):
        ex.notes.append(
            f"Amounts do not reconcile: parts sum to {parts:.2f} but net is {net:.2f}"
        )
