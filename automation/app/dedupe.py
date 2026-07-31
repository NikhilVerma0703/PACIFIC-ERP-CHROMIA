"""
Duplicate detection - three independent layers.

A duplicate bill that reaches Tally becomes a duplicate payment, so this is the
most expensive error the system can make. Three layers catch different things
and run at different points in the pipeline:

    Layer 1  file_sha256    at upload, BLOCKING   same file, byte for byte
    Layer 2  perceptual hash at upload, warning   same bill photographed twice
    Layer 3  business key    after extraction     same invoice, any image

Layer 3 is the one that matters. Layers 1 and 2 only see pixels; a clerk who
photographs the same bill from a slightly different angle defeats both. The
business key compares what the bill actually says.

Everything except Layer 1 is a WARNING WITH OVERRIDE, never a hard block. Two
genuinely different bills from one vendor on one day for one amount do happen -
two identical taxi fares, two identical courier consignments - and a system that
cannot be overridden will be worked around, usually by not using it. Overrides
require a typed reason and are stored.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date, timedelta

from rapidfuzz import fuzz


@dataclass
class DuplicateMatch:
    matched_bill_id: int
    layer: str
    score: float
    detail: str

    @property
    def blocking(self) -> bool:
        return self.layer == "file_hash"

    def to_dict(self) -> dict:
        return {
            "matched_bill_id": self.matched_bill_id, "layer": self.layer,
            "score": round(self.score, 3), "detail": self.detail,
            "blocking": self.blocking,
        }


def file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def perceptual_hash(image_path: str) -> str | None:
    """Perceptual hash, tolerant of recompression, small crops and brightness."""
    try:
        import imagehash
        from PIL import Image
        return str(imagehash.phash(Image.open(image_path)))
    except Exception:
        return None


def _phash_distance(a: str, b: str) -> int:
    try:
        import imagehash
        return imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b)
    except Exception:
        return 64


def normalise_invoice_no(s: str | None) -> str:
    """Strip everything that varies between two readings of the same number.

    'INV-0074/26', 'inv 74/26' and 'INV74/26' are the same invoice. Leading
    zeros go too, because OCR drops and invents them freely.
    """
    if not s:
        return ""
    s = re.sub(r"[^A-Za-z0-9]", "", s).upper()
    s = re.sub(r"(?<=[A-Z])0+(?=\d)", "", s)
    return s.lstrip("0") or s


# --------------------------------------------------------------------------
# Layers 1 and 2 - at upload
# --------------------------------------------------------------------------
def check_file_duplicates(conn, sha: str, phash: str | None,
                          exclude_bill_id: int | None = None) -> list[DuplicateMatch]:
    out: list[DuplicateMatch] = []

    rows = conn.execute(
        "SELECT id, filename, created_at FROM bills WHERE file_sha256 = ? "
        "AND status != 'rejected' AND id != COALESCE(?, -1)",
        (sha, exclude_bill_id),
    ).fetchall()
    for r in rows:
        out.append(DuplicateMatch(
            r["id"], "file_hash", 1.0,
            f"Identical file already uploaded as '{r['filename']}' on {r['created_at'][:10]}",
        ))
    if out:
        return out

    if phash:
        rows = conn.execute(
            "SELECT id, filename, phash, created_at FROM bills "
            "WHERE phash IS NOT NULL AND status != 'rejected' "
            "AND id != COALESCE(?, -1) ORDER BY id DESC LIMIT 2000",
            (exclude_bill_id,),
        ).fetchall()
        for r in rows:
            d = _phash_distance(phash, r["phash"])
            if d <= 8:
                out.append(DuplicateMatch(
                    r["id"], "image_hash", 1.0 - d / 16.0,
                    f"Looks like the same bill as '{r['filename']}' "
                    f"uploaded on {r['created_at'][:10]} (image similarity "
                    f"{100 - d * 6}%)",
                ))
    return out


# --------------------------------------------------------------------------
# Layer 3 - after extraction
# --------------------------------------------------------------------------
# Weights sum to 1.0. GSTIN and invoice number carry most of it because they
# identify the document; amount and date corroborate but do not identify.
WEIGHTS = {"gstin": 0.30, "invoice_no": 0.35, "amount": 0.20, "date": 0.15}
FLAG_THRESHOLD = 0.72


def check_business_key(conn, extraction: dict,
                       exclude_bill_id: int | None = None) -> list[DuplicateMatch]:
    """Fuzzy composite match against previously extracted bills.

    Weighted rather than all-or-nothing, because OCR will mangle one field on
    any given bill. Two hard rules keep it honest:

      - GSTIN + invoice number agreeing is sufficient on its own. Those two
        fields uniquely identify a tax invoice in India.
      - Amount + date agreeing is NOT sufficient. In a business with many small
        bills that is an ordinary coincidence, and flagging it trains people to
        click through warnings.
    """
    gstin = (extraction.get("vendor_gstin") or "").upper()
    inv = normalise_invoice_no(extraction.get("invoice_no"))
    vendor = (extraction.get("vendor_name") or "").lower()
    amount = extraction.get("net_amount")
    d = _parse_date(extraction.get("invoice_date"))

    if not any([gstin, inv, amount]):
        return []

    rows = conn.execute(
        "SELECT e.*, b.filename, b.created_at, b.status FROM extractions e "
        "JOIN bills b ON b.id = e.bill_id "
        "WHERE b.status NOT IN ('rejected','duplicate') "
        "AND e.bill_id != COALESCE(?, -1) "
        "ORDER BY e.id DESC LIMIT 5000",
        (exclude_bill_id,),
    ).fetchall()

    matches: list[DuplicateMatch] = []
    for r in rows:
        score = 0.0
        why: list[str] = []

        r_gstin = (r["vendor_gstin"] or "").upper()
        gstin_hit = bool(gstin and r_gstin and gstin == r_gstin)
        if gstin_hit:
            score += WEIGHTS["gstin"]
            why.append("same GSTIN")
        elif vendor and r["vendor_name"]:
            sim = fuzz.token_set_ratio(vendor, r["vendor_name"].lower()) / 100.0
            if sim > 0.85:
                score += WEIGHTS["gstin"] * sim * 0.8
                why.append(f"vendor name {sim:.0%} similar")

        r_inv = normalise_invoice_no(r["invoice_no"])
        inv_hit = False
        if inv and r_inv:
            # Straight ratio, plus containment. The same invoice is routinely
            # read two different ways - "INV-07039" one time and bare "7039" the
            # next, depending on whether OCR caught the prefix. Straight ratio
            # scores that pair at 72% and misses a real duplicate, so
            # containment of the longer in the shorter is checked too, provided
            # the shorter is long enough to be meaningful on its own.
            sim = fuzz.ratio(inv, r_inv) / 100.0
            short, long_ = sorted((inv, r_inv), key=len)
            if len(short) >= 4 and short in long_:
                sim = max(sim, 0.97)
            elif len(short) >= 4:
                sim = max(sim, fuzz.partial_ratio(short, long_) / 100.0 * 0.95)
            if sim >= 0.90:
                score += WEIGHTS["invoice_no"] * sim
                inv_hit = sim >= 0.95
                why.append(f"invoice no {r['invoice_no']}")

        amount_hit = False
        if amount and r["net_amount"]:
            if abs(float(amount) - float(r["net_amount"])) <= 1.0:
                score += WEIGHTS["amount"]
                amount_hit = True
                why.append(f"same amount {float(amount):,.2f}")

        date_hit = False
        r_date = _parse_date(r["invoice_date"])
        if d and r_date and abs((d - r_date).days) <= 1:
            score += WEIGHTS["date"]
            date_hit = True
            why.append(f"same date {r['invoice_date']}")

        # GSTIN + invoice number is decisive on its own.
        if gstin_hit and inv_hit:
            score = max(score, 0.95)

        # Exact same vendor, exact same amount, same day. Weighted scoring puts
        # this at 0.65 and lets it through, but it is the classic double-claim:
        # someone submits the same receipt twice and OCR reads the invoice
        # number differently each time, so the invoice signal never fires.
        # Worth a warning - which is overridable, so the rare legitimate case
        # costs one click and a typed reason.
        elif gstin_hit and amount_hit and date_hit:
            score = max(score, 0.80)
            why.append("same vendor, amount and date")

        # Amount + date WITHOUT a vendor match is a coincidence, not a
        # duplicate. In a business with many small bills, flagging it would
        # train people to click through warnings.
        if not gstin_hit and not inv_hit and amount_hit and date_hit:
            continue

        if score >= FLAG_THRESHOLD:
            matches.append(DuplicateMatch(
                r["bill_id"], "business_key", min(1.0, score),
                f"Possible duplicate of '{r['filename']}' "
                f"(uploaded {r['created_at'][:10]}, status {r['status']}): "
                + ", ".join(why),
            ))

    matches.sort(key=lambda m: -m.score)
    return matches[:5]


def _parse_date(s) -> date | None:
    if not s:
        return None
    try:
        y, m, d = str(s)[:10].split("-")
        return date(int(y), int(m), int(d))
    except (ValueError, TypeError):
        return None


def record(conn, bill_id: int, matches: list[DuplicateMatch]) -> None:
    for m in matches:
        conn.execute(
            "INSERT INTO duplicates(bill_id, matched_bill_id, layer, score, detail) "
            "VALUES (?,?,?,?,?)",
            (bill_id, m.matched_bill_id, m.layer, m.score, m.detail),
        )
    conn.commit()


def override(conn, bill_id: int, reason: str, user: str) -> None:
    """Overrides are always allowed, always logged, and always need a reason."""
    conn.execute(
        "UPDATE duplicates SET overridden = 1, override_reason = ? WHERE bill_id = ?",
        (f"{reason} (by {user})", bill_id),
    )
    conn.commit()
