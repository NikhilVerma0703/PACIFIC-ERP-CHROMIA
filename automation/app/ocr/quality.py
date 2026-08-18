"""
Quality gate.

Two jobs, both about refusing to guess:

  1. Decide whether a page is good enough to trust. If not, ask for a re-upload
     BEFORE showing a clerk a screen full of garbage they must correct field by
     field.

  2. Flag probable handwriting. Classical OCR does not degrade gracefully on
     handwriting - it emits confident nonsense, which in a finance system is
     worse than an honest "I can't read this".

CALIBRATION NOTE - read this before tuning.

Thresholds below were measured against the 11 real sample pages plus a clean
synthetic control. The measurements killed the obvious approach:

    clean printed (synthetic)      stroke variation 0.48
    printed receipt photos (real)  stroke variation 0.59 - 0.89

Stroke-width variation alone CANNOT separate handwriting from a badly
photographed printed bill. Noise, JPEG artefacts and thermal-paper speckle
inflate it into exactly the range handwriting occupies. Any single-signal
handwriting detector built on it will flag most of your real bills as
handwritten.

So handwriting detection here requires two independent signals to agree, and is
deliberately tuned to fire rarely. The dashboard also gives the uploader an
explicit "this bill is handwritten" checkbox, which is more reliable than any
heuristic and costs one click. If handwritten volume is material, the real fix
is a cloud handwriting OCR provider, not a better threshold.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class QualityReport:
    blur_score: float          # Laplacian variance - higher is sharper
    contrast: float            # std dev of grey levels
    brightness: float          # mean grey level
    ink_coverage: float        # fraction of dark pixels - text density proxy
    resolution: tuple[int, int]
    stroke_variation: float    # handwriting signal 1
    plausibility: float = 0.0  # handwriting signal 2 (set after OCR)
    ocr_confidence: float = 0.0
    verdict: str = "ok"        # ok | poor | reupload | handwritten
    reasons: list[str] = field(default_factory=list)

    @property
    def usable(self) -> bool:
        return self.verdict in ("ok", "poor")

    @property
    def needs_human_check(self) -> bool:
        return self.verdict != "ok"


THRESHOLDS = {
    # Pre-OCR image checks. Deliberately loose: page 0 of the sample scores
    # blur 43 and still yields usable line items, so a tight blur gate would
    # reject bills the pipeline can actually read. Real filtering happens
    # post-OCR, where the evidence is much stronger.
    "blur_min": 18.0,
    "contrast_min": 12.0,
    "brightness_min": 30.0,
    "brightness_max": 248.0,
    "ink_min": 0.003,
    "ink_max": 0.55,
    "min_width": 450,
    "min_height": 450,
    # Post-OCR checks.
    "conf_reupload": 45.0,
    "conf_poor": 62.0,
    "plaus_reupload": 0.40,
    "plaus_poor": 0.55,
    "min_words": 8,
    # Handwriting: BOTH must trip.
    "hw_stroke_variation": 1.00,
    "hw_plausibility": 0.30,
}

# Vocabulary that appears on essentially every Indian commercial bill. Used to
# judge whether OCR output is real text or noise.
BILL_VOCAB = set("""
total amount net gross sub subtotal gst cgst sgst igst utgst cess tax taxable
invoice bill no number date time qty quantity rate item items description
rs inr rupees cash card upi paid due balance change round off charges charge
service hotel restaurant fuel diesel petrol litre price value hsn sac gstin
phone mobile address thank you visit again please customer name table covers
discount advance received payment ref reference vendor supplier buyer seller
state code place supply reverse mode terms delivery order challan eway
""".split())

_TOKEN_RE = re.compile(r"[A-Za-z]{2,}|\d+[.,]?\d*")
_CONSONANT_RUN = re.compile(r"[bcdfghjklmnpqrstvwxz]{4}")


def text_plausibility(text: str) -> float:
    """Fraction of OCR tokens that look like real content rather than noise.

    Three ways a token counts as plausible:
      - it is a number (receipts are mostly numbers, and OCR reads digits well)
      - it is known bill vocabulary
      - it is a word-shaped string: has a vowel, no implausible consonant run

    A printed bill photographed badly still scores 0.45-0.70 because the digits
    and the standard vocabulary survive. Genuine handwriting scores far lower
    because almost nothing survives. This is the discriminator that stroke
    variation could not provide on its own.
    """
    toks = _TOKEN_RE.findall(text.lower())
    if not toks:
        return 0.0
    good = 0
    for t in toks:
        if t.replace(",", "").replace(".", "").isdigit():
            good += 1
        elif t in BILL_VOCAB:
            good += 1
        elif len(t) >= 4 and re.search(r"[aeiou]", t) and not _CONSONANT_RUN.search(t):
            good += 1
    return good / len(toks)


def assess(gray: np.ndarray, thresholds: dict | None = None) -> QualityReport:
    """Pre-OCR image assessment."""
    t = {**THRESHOLDS, **(thresholds or {})}
    h, w = gray.shape[:2]
    reasons: list[str] = []

    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    contrast = float(gray.std())
    brightness = float(gray.mean())

    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ink = float(np.count_nonzero(bw) / bw.size)
    stroke_var = _stroke_width_variation(bw)

    if w < t["min_width"] or h < t["min_height"]:
        reasons.append(f"Image is only {w}x{h} pixels - too small to read reliably")
    if blur < t["blur_min"]:
        reasons.append("Image is out of focus or motion-blurred")
    if contrast < t["contrast_min"]:
        reasons.append("Not enough contrast between the text and the paper")
    if brightness < t["brightness_min"]:
        reasons.append("Photo is too dark")
    if brightness > t["brightness_max"]:
        reasons.append("Photo is overexposed - glare is washing out the text")
    if ink < t["ink_min"]:
        reasons.append("Almost no text detected - is the bill inside the frame?")
    if ink > t["ink_max"]:
        reasons.append("Image is mostly dark - check the background and lighting")

    return QualityReport(
        blur_score=round(blur, 1),
        contrast=round(contrast, 1),
        brightness=round(brightness, 1),
        ink_coverage=round(ink, 4),
        resolution=(w, h),
        stroke_variation=round(stroke_var, 3),
        verdict="reupload" if reasons else "ok",
        reasons=reasons,
    )


def _stroke_width_variation(bw: np.ndarray) -> float:
    """Coefficient of variation of stroke width, over glyph-sized components.

    Small specks and page-sized blobs are filtered out first; without that
    filter the number measures noise rather than strokes.
    """
    if np.count_nonzero(bw) < 200:
        return 0.0
    n, labels, stats, _ = cv2.connectedComponentsWithStats(bw, 8)
    keep = np.zeros_like(bw)
    max_h = bw.shape[0] * 0.12
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        hh = stats[i, cv2.CC_STAT_HEIGHT]
        if area >= 12 and 6 <= hh <= max_h:
            keep[labels == i] = 255
    if np.count_nonzero(keep) < 200:
        return 0.0
    dist = cv2.distanceTransform(keep, cv2.DIST_L2, 5)
    widths = dist[dist > 0.6]
    if widths.size < 100:
        return 0.0
    mean = float(widths.mean())
    return float(widths.std() / mean) if mean > 0 else 0.0


def finalise(report: QualityReport, ocr_text: str, ocr_confidence: float,
             word_count: int, thresholds: dict | None = None,
             user_says_handwritten: bool = False) -> QualityReport:
    """Post-OCR verdict. This is where the real decision is made."""
    t = {**THRESHOLDS, **(thresholds or {})}
    plaus = text_plausibility(ocr_text)
    report.plausibility = round(plaus, 3)
    report.ocr_confidence = round(ocr_confidence, 1)

    if user_says_handwritten:
        report.verdict = "handwritten"
        report.reasons = ["Marked as handwritten at upload - sent to manual entry"]
        return report

    # Handwriting needs both signals to agree (see module docstring).
    if (report.stroke_variation > t["hw_stroke_variation"]
            and plaus < t["hw_plausibility"]
            and word_count >= 15):
        report.verdict = "handwritten"
        report.reasons = [
            "This looks handwritten - OCR cannot read handwriting reliably, "
            "so please enter the details manually"
        ]
        return report

    if report.verdict == "reupload":
        return report  # image checks already failed

    if word_count < t["min_words"]:
        report.verdict = "reupload"
        report.reasons.append("OCR found almost no text on this page")
    elif ocr_confidence < t["conf_reupload"] and plaus < t["plaus_reupload"]:
        report.verdict = "reupload"
        report.reasons.append(
            f"OCR confidence {ocr_confidence:.0f}% and most of the output is "
            "unreadable - please retake the photo"
        )
    elif ocr_confidence < t["conf_poor"] or plaus < t["plaus_poor"]:
        report.verdict = "poor"
        report.reasons.append(
            f"Partly readable (confidence {ocr_confidence:.0f}%) - "
            "please check every field before submitting"
        )
    else:
        report.verdict = "ok"

    return report


REUPLOAD_TIPS = [
    "Lay the bill flat - smooth out folds and curl",
    "Place it on a dark, plain surface so the edges stand out",
    "Use bright, even light and avoid casting your own shadow",
    "Hold the phone directly above the bill, not at an angle",
    "Fill the frame with the bill and keep fingers off the text",
    "Tap the screen to focus before taking the photo",
]
