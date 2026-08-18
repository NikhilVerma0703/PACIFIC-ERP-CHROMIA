"""
Image preprocessing for bill photos.

This module does the heavy lifting for accuracy. On the sample bills - thermal
receipts photographed in low light, curled, held in a hand against a dark
background - raw Tesseract returns almost nothing. The chain below is what
makes those pages readable at all.

Order matters:
    1. EXIF orientation      - phones lie about rotation
    2. Document detection    - crop the receipt out of the dark background
    3. Illumination flatten  - remove the shadow gradient (the big win on photos)
    4. Deskew                - Tesseract loses accuracy fast past ~2 degrees
    5. Upscale               - Tesseract wants ~300 DPI; phone crops are often less
    6. Binarise              - adaptive, because lighting is never uniform
    7. Denoise               - thermal paper speckle
"""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image, ImageOps


def load_bgr(path: str) -> np.ndarray:
    """Load an image, honouring EXIF orientation."""
    pil = Image.open(path)
    pil = ImageOps.exif_transpose(pil)
    if pil.mode != "RGB":
        pil = pil.convert("RGB")
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


# ---------------------------------------------------------------------------
# 1. Document detection
# ---------------------------------------------------------------------------
def _paper_mask(bgr: np.ndarray) -> np.ndarray:
    """Mask of pixels that look like paper: bright AND unsaturated.

    Brightness alone is not enough. The sample set includes a receipt lying on
    an orange-and-brown patterned cloth, where the cloth is bright enough to
    pass an Otsu threshold and the resulting contour swallowed the background.
    Paper is close to neutral grey, so requiring low saturation as well
    separates it cleanly from any coloured surface - and from skin, which is the
    other thing routinely in frame when someone holds up a receipt.
    """
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    s, v = hsv[:, :, 1], hsv[:, :, 2]

    v_blur = cv2.GaussianBlur(v, (7, 7), 0)
    _, bright = cv2.threshold(v_blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Saturation cut-off scales with the image so it adapts to white balance.
    sat_cut = max(60, int(np.percentile(s, 45)))
    unsat = (s < sat_cut).astype(np.uint8) * 255

    mask = cv2.bitwise_and(bright, unsat)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_RECT, (31, 31)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,
                            cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21)))
    return mask


def _downscale(img: np.ndarray, max_side: int = 900) -> tuple[np.ndarray, float]:
    """Shrink for analysis. Detection and validation do not need full resolution,
    and running them at full res dominates total pipeline time."""
    h, w = img.shape[:2]
    side = max(h, w)
    if side <= max_side:
        return img, 1.0
    scale = max_side / side
    return cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), scale


def _ink_pixels(bgr: np.ndarray) -> int:
    """Count dark, text-like pixels - used to check a crop did not lose content.

    Runs on a downscaled copy with a cheap local-mean threshold; the absolute
    count does not matter, only the ratio between the full frame and the crop.
    """
    small, _ = _downscale(bgr, 700)
    g = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if small.ndim == 3 else small
    blur = cv2.GaussianBlur(g, (0, 0), 12)
    dark = (g.astype(np.int16) < blur.astype(np.int16) - 18)
    return int(np.count_nonzero(dark))


def detect_document(bgr: np.ndarray, min_area_frac: float = 0.12) -> np.ndarray | None:
    """Find the bill in the frame and perspective-correct it.

    Cropping to the document removes the background entirely, which speeds up
    OCR and stops Tesseract inventing text out of carpet texture.

    Every candidate crop is validated before being accepted, because a bad crop
    is far more damaging than no crop - it silently deletes half the bill and
    everything downstream then works confidently on a fragment. If any check
    fails, this returns None and the caller keeps the full frame.
    """
    # Detect on a downscaled copy, then map the geometry back to full res.
    small, scale = _downscale(bgr)
    sh, sw = small.shape[:2]
    frame_area = sh * sw

    mask = _paper_mask(small)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    best = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(best)
    if area < frame_area * min_area_frac or area > frame_area * 0.97:
        return None

    peri = cv2.arcLength(best, True)
    approx = cv2.approxPolyDP(best, 0.02 * peri, True)

    candidate = None
    if len(approx) == 4 and cv2.isContourConvex(approx):
        quad = approx.reshape(4, 2).astype("float32") / scale
        # The quad must actually explain the contour it came from. If it covers
        # much less, the contour was an irregular blob and the quad is fiction.
        if cv2.contourArea(quad * scale) >= area * 0.80:
            candidate = _four_point_transform(bgr, quad)

    if candidate is None:
        # Curled paper rarely yields a clean quad. An axis-aligned bounding box
        # with a little padding is the conservative fallback: it keeps
        # everything inside the document even if it keeps some background too.
        h, w = bgr.shape[:2]
        x, y, bw_, bh_ = [int(v / scale) for v in cv2.boundingRect(best)]
        pad = int(0.02 * max(bw_, bh_))
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(w, x + bw_ + pad), min(h, y + bh_ + pad)
        candidate = bgr[y0:y1, x0:x1]

    return candidate if _crop_is_sane(bgr, candidate) else None


def _crop_is_sane(original: np.ndarray, crop: np.ndarray | None) -> bool:
    """Reject crops that lost the document."""
    if crop is None or crop.size == 0:
        return False
    oh, ow = original.shape[:2]
    ch, cw = crop.shape[:2]

    if cw < 350 or ch < 350:
        return False
    if (cw * ch) < 0.15 * (ow * oh):
        return False
    # A receipt is tall and narrow, but not a hairline. Anything past 8:1 is a
    # sliver of the edge of something, not a bill.
    aspect = max(cw, ch) / max(1, min(cw, ch))
    if aspect > 8.0:
        return False
    # Most importantly: the crop must keep most of the ink.
    orig_ink = _ink_pixels(original)
    if orig_ink > 0 and _ink_pixels(crop) < 0.55 * orig_ink:
        return False
    return True


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """tl, tr, br, bl"""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]
    return rect


def _four_point_transform(img: np.ndarray, pts: np.ndarray) -> np.ndarray:
    tl, tr, br, bl = _order_corners(pts)
    wa = np.linalg.norm(br - bl)
    wb = np.linalg.norm(tr - tl)
    ha = np.linalg.norm(tr - br)
    hb = np.linalg.norm(tl - bl)
    W, H = int(max(wa, wb)), int(max(ha, hb))
    if W < 50 or H < 50:
        return img
    dst = np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], dtype="float32")
    M = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl], dtype="float32"), dst)
    return cv2.warpPerspective(img, M, (W, H))


# ---------------------------------------------------------------------------
# 2. Illumination flattening
# ---------------------------------------------------------------------------
def flatten_illumination(gray: np.ndarray, kernel: int = 41) -> np.ndarray:
    """Remove the lighting gradient by dividing out a heavily-blurred background.

    This is the single most effective step for hand-held photos. A receipt shot
    under a ceiling light has one bright edge and one dark edge; a global
    threshold destroys whichever end it is not tuned for. Estimating the
    illumination surface with a large morphological close and dividing it out
    leaves flat black-on-white text regardless of the original gradient.
    """
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel, kernel))
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, k)
    background = cv2.GaussianBlur(background, (0, 0), kernel / 4)
    flat = cv2.divide(gray, background, scale=255)
    return flat


# ---------------------------------------------------------------------------
# 3. Deskew
# ---------------------------------------------------------------------------
def deskew(gray: np.ndarray, max_angle: float = 15.0) -> tuple[np.ndarray, float]:
    """Rotate so text baselines are horizontal.

    Uses the min-area rectangle of the text mask. Angles beyond max_angle are
    ignored - they mean the estimate failed, and applying a wild rotation is
    worse than leaving the page alone.
    """
    inv = cv2.bitwise_not(gray)
    _, bw = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Smear characters into lines so the rectangle follows the text direction.
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (30, 3)))
    coords = cv2.findNonZero(bw)
    if coords is None or len(coords) < 50:
        return gray, 0.0

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = 90 + angle
    elif angle > 45:
        angle = angle - 90
    if abs(angle) > max_angle or abs(angle) < 0.2:
        return gray, 0.0

    h, w = gray.shape
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    rotated = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC,
                             borderMode=cv2.BORDER_REPLICATE)
    return rotated, float(angle)


# ---------------------------------------------------------------------------
# 4. Full chain
# ---------------------------------------------------------------------------
def preprocess(
    path: str,
    *,
    crop_document: bool = True,
    target_height: int = 2200,
    max_height: int = 2600,
    binarise: bool = True,
) -> dict:
    """Run the full chain. Returns the processed image plus what was done to it."""
    bgr = load_bgr(path)
    steps: list[str] = []

    if crop_document:
        cropped = detect_document(bgr)
        if cropped is not None:
            bgr = cropped
            steps.append("document_cropped")

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # Coloured bills: the print is often a colour that is low-contrast in
    # luminance but high-contrast in one channel. Pick the channel with the
    # most spread - cheap and it rescues carbon-copy and blue-ink bills.
    b, g, r = cv2.split(bgr)
    best_channel = max([("b", b), ("g", g), ("r", r)], key=lambda c: c[1].std())
    if best_channel[1].std() > gray.std() * 1.15:
        gray = best_channel[1]
        steps.append(f"channel_{best_channel[0]}")

    gray = flatten_illumination(gray)
    steps.append("illumination_flattened")

    gray, angle = deskew(gray)
    if angle:
        steps.append(f"deskewed_{angle:.1f}deg")

    # Normalise the working size in BOTH directions. Upscaling small crops helps
    # Tesseract; downscaling oversized ones costs nothing in accuracy and saves
    # most of the runtime, since every later step and all three OCR passes scale
    # with pixel count.
    h = gray.shape[0]
    if h < target_height:
        scale = target_height / h
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        steps.append(f"upscaled_{scale:.2f}x")
    elif h > max_height:
        scale = target_height / h
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        steps.append(f"downscaled_{scale:.2f}x")

    # Median blur removes thermal-paper speckle at a fraction of the cost of
    # non-local means, and on binarised text the difference is not measurable.
    gray = cv2.medianBlur(gray, 3)
    steps.append("denoised")

    out = gray
    if binarise:
        out = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
        )
        out = cv2.morphologyEx(out, cv2.MORPH_CLOSE,
                               cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)))
        steps.append("adaptive_threshold")

    return {"image": out, "gray": gray, "steps": steps, "deskew_angle": angle}


def preprocess_variants(path: str, **kwargs) -> dict:
    """Produce several binarisation variants of the same cleaned page.

    Measured on the sample bills, no single binarisation wins:

        page 0   greyscale (no threshold)  conf 43.1 / plaus 0.56
                 adaptive threshold        conf 36.7 / plaus 0.48
        page 10  Otsu                      conf 45.5 / plaus 0.81
                 greyscale                 conf 41.8 / plaus 0.75

    The winner depends on paper, lighting and print density, none of which are
    known in advance. Rather than pick one and accept the loss on every page it
    suits badly, the pipeline OCRs each variant and keeps whichever scores best
    (see engine.run_best_of). It costs roughly 3x OCR time per page - about two
    seconds - and is the largest single accuracy gain available without leaving
    Tesseract.
    """
    base = preprocess(path, binarise=False, **kwargs)
    gray = base["gray"]

    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
    )
    adaptive = cv2.morphologyEx(
        adaptive, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    )
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    return {
        "gray": gray,
        "steps": base["steps"],
        "deskew_angle": base["deskew_angle"],
        "variants": {"grayscale": gray, "adaptive": adaptive, "otsu": otsu},
    }


def pdf_to_images(pdf_path: str, out_dir: str, dpi: int = 300) -> list[str]:
    """Split a PDF into page PNGs.

    Digital PDFs keep their text layer (checked separately in engine.py); this
    is for the scanned/photographed case.
    """
    import pdfplumber
    from pathlib import Path

    Path(out_dir).mkdir(parents=True, exist_ok=True)
    paths = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            p = f"{out_dir}/page_{i:03d}.png"
            page.to_image(resolution=dpi).save(p)
            paths.append(p)
    return paths


def pdf_text_layer(pdf_path: str) -> list[str]:
    """Extract the embedded text layer, if any. Empty strings mean scanned."""
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        return [(p.extract_text() or "") for p in pdf.pages]
