"""
OCR engines behind one interface.

The interface exists so the accuracy decision stays a config change rather than
a rewrite. Today the pilot runs fully offline on Tesseract. If handwritten or
badly-photographed bills turn out to be a material share of volume, enabling a
cloud provider is one line in config.yaml - no calling code changes.

Providers:
    pdftext   - embedded PDF text layer. Free, instant, 100% accurate. Always
                tried first: a digital invoice never needs OCR.
    tesseract - offline, free, bundled. Good on clean print, moderate on photos.
    paddle    - offline, free, better on skewed/low-contrast receipts.
                Optional install (~500MB).
    cloud     - stub. Implement against Google Vision / Azure DI if needed.
                Notably the only option with usable handwriting support.
"""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Tesseract's own OpenMP parallelism is counterproductive: it spreads a single
# page across cores inefficiently and spends most of the gain on thread
# overhead. Forcing each tesseract process to one thread and instead running
# the three preprocessing variants concurrently is dramatically faster for
# byte-identical output. Measured on one sample page, 2-core machine:
#
#     OMP_THREAD_LIMIT=4, sequential   4.45s
#     OMP_THREAD_LIMIT=4, parallel     3.64s
#     OMP_THREAD_LIMIT=1, sequential   1.70s
#     OMP_THREAD_LIMIT=1, parallel     1.10s   <- 4x, same winner, same confidence
#
# Must be set before any tesseract subprocess is spawned, so it lives at import.
# setdefault, so an operator can still override it from the environment.
# ---------------------------------------------------------------------------
os.environ.setdefault("OMP_THREAD_LIMIT", "1")

# ---------------------------------------------------------------------------
# Locating Tesseract on Windows
#
# The Windows installer does NOT add Tesseract to PATH, so pytesseract cannot
# find it even though it is correctly installed. Rather than making that the
# user's problem, the usual install locations are checked directly.
#
# Override order: config.yaml (ocr.tesseract_cmd) -> TESSERACT_CMD env var ->
# PATH -> the known install paths below.
# ---------------------------------------------------------------------------
WINDOWS_TESSERACT_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
    os.path.expandvars(r"%USERPROFILE%\AppData\Local\Tesseract-OCR\tesseract.exe"),
]


def configure_tesseract(explicit_path: str | None = None) -> str | None:
    """Point pytesseract at the binary. Returns the path used, or None."""
    import pytesseract

    candidates: list[str] = []
    if explicit_path:
        candidates.append(explicit_path)
    if os.environ.get("TESSERACT_CMD"):
        candidates.append(os.environ["TESSERACT_CMD"])
    on_path = shutil.which("tesseract")
    if on_path:
        candidates.append(on_path)
    if os.name == "nt":
        candidates.extend(WINDOWS_TESSERACT_PATHS)

    for cand in candidates:
        if cand and Path(cand).exists():
            pytesseract.pytesseract.tesseract_cmd = cand
            return cand
    return None


@dataclass
class Word:
    text: str
    conf: float
    left: int
    top: int
    width: int
    height: int

    @property
    def bottom(self) -> int:
        return self.top + self.height


@dataclass
class OcrResult:
    text: str
    words: list[Word] = field(default_factory=list)
    mean_conf: float = 0.0
    engine: str = ""
    lines: list[str] = field(default_factory=list)

    @property
    def word_count(self) -> int:
        return len(self.words)


class OcrEngine:
    name = "base"

    def run(self, image: np.ndarray) -> OcrResult:  # pragma: no cover
        raise NotImplementedError


class TesseractEngine(OcrEngine):
    """Offline default.

    psm 6 ("assume a single uniform block of text") beats the default psm 3 on
    receipts, because receipts are one narrow column and the layout analyser in
    psm 3 tends to split them into spurious blocks.
    """

    name = "tesseract"

    def __init__(self, lang: str = "eng", psm: int = 6, extra_config: str = ""):
        self.lang = lang
        self.psm = psm
        self.extra_config = extra_config

    def run(self, image: np.ndarray) -> OcrResult:
        import pytesseract
        from pytesseract import Output

        config = f"--oem 3 --psm {self.psm} {self.extra_config}".strip()
        data = pytesseract.image_to_data(
            image, lang=self.lang, config=config, output_type=Output.DICT
        )

        words: list[Word] = []
        for i, txt in enumerate(data["text"]):
            txt = (txt or "").strip()
            if not txt:
                continue
            try:
                conf = float(data["conf"][i])
            except (TypeError, ValueError):
                conf = -1.0
            if conf < 0:
                continue
            words.append(
                Word(txt, conf, data["left"][i], data["top"][i],
                     data["width"][i], data["height"][i])
            )

        mean_conf = float(np.mean([w.conf for w in words])) if words else 0.0
        lines = _group_lines(words)
        return OcrResult(
            text="\n".join(lines), words=words,
            mean_conf=mean_conf, engine=self.name, lines=lines,
        )


class PaddleEngine(OcrEngine):
    """Optional offline upgrade. Notably better than Tesseract on skewed,
    low-contrast receipts. Install: pip install paddlepaddle paddleocr"""

    name = "paddle"

    def __init__(self, lang: str = "en"):
        self._ocr = None
        self.lang = lang

    def _get(self):
        if self._ocr is None:
            from paddleocr import PaddleOCR  # imported lazily - heavy
            self._ocr = PaddleOCR(use_angle_cls=True, lang=self.lang, show_log=False)
        return self._ocr

    def run(self, image: np.ndarray) -> OcrResult:
        import cv2

        img = image if image.ndim == 3 else cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        raw = self._get().ocr(img, cls=True)
        words: list[Word] = []
        for block in (raw or []):
            for box, (txt, conf) in (block or []):
                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                words.append(
                    Word(txt, float(conf) * 100, int(min(xs)), int(min(ys)),
                         int(max(xs) - min(xs)), int(max(ys) - min(ys)))
                )
        mean_conf = float(np.mean([w.conf for w in words])) if words else 0.0
        lines = _group_lines(words)
        return OcrResult("\n".join(lines), words, mean_conf, self.name, lines)


class CloudEngine(OcrEngine):
    """Deliberately a stub.

    Wire this to Google Cloud Vision (DOCUMENT_TEXT_DETECTION) or Azure Document
    Intelligence when you decide handwriting or photo quality justifies sending
    bills off your network. The rest of the pipeline needs no changes - just
    return words with pixel boxes and 0-100 confidences.
    """

    name = "cloud"

    def run(self, image: np.ndarray) -> OcrResult:
        raise NotImplementedError(
            "Cloud OCR is not configured. Set ocr.engine to 'tesseract' or "
            "'paddle' in config.yaml, or implement CloudEngine.run()."
        )


def _group_lines(words: list[Word], tol_ratio: float = 0.6) -> list[str]:
    """Reassemble words into reading-order lines.

    Tesseract's own line grouping is unreliable on receipts, and the field
    extractor depends on lines ("Total Amount    2108.28" must stay one string
    for the label-value regexes to fire). Grouping by vertical overlap with a
    tolerance proportional to glyph height handles the slight baseline drift you
    get from a curled receipt.
    """
    if not words:
        return []
    ws = sorted(words, key=lambda w: (w.top, w.left))
    lines: list[list[Word]] = []
    for w in ws:
        placed = False
        for line in lines:
            ref = line[-1]
            tol = max(ref.height, w.height) * tol_ratio
            if abs((w.top + w.height / 2) - (ref.top + ref.height / 2)) <= tol:
                line.append(w)
                placed = True
                break
        if not placed:
            lines.append([w])
    out = []
    for line in lines:
        line.sort(key=lambda w: w.left)
        out.append(" ".join(w.text for w in line))
    return out


def score_result(result: OcrResult) -> float:
    """Rank OCR attempts.

    Confidence alone is a poor ranking signal: Tesseract can be highly
    confident about a handful of words while missing most of the page.
    Multiplying by plausibility (does the output look like real bill text?) and
    nudging by word count picks the variant a human would call best.
    """
    from .quality import text_plausibility

    if not result.words:
        return 0.0
    plaus = text_plausibility(result.text)
    coverage = min(1.0, result.word_count / 60.0)
    return (result.mean_conf / 100.0) * (0.35 + 0.65 * plaus) * (0.6 + 0.4 * coverage)


def run_best_of(variants: dict[str, np.ndarray], engine: str = "tesseract",
                psms: tuple[int, ...] = (6,), parallel: bool = True,
                **kwargs) -> tuple[OcrResult, str]:
    """OCR every preprocessing variant, return the best-scoring result.

    Runs the variants CONCURRENTLY. pytesseract shells out to the tesseract
    binary, so the GIL is released for the whole of each call and threads give
    real parallelism. Measured on a sample page: 4.4s sequential (1.94 + 1.32 +
    1.14) against roughly the cost of the slowest one in parallel. Since three
    variants is the single biggest accuracy win available, making them nearly
    free is worth more than dropping one.

    Returns (result, label); the label identifies the winning variant so it can
    be logged. After a few hundred bills those logs tell you which variant your
    bills actually favour, and the list can be trimmed.
    """
    # psm may arrive either as the psms tuple or inside kwargs; it must not be
    # passed to get_engine twice.
    kwargs = dict(kwargs)
    if "psm" in kwargs:
        psms = (kwargs.pop("psm"),)

    jobs = [(label, img, psm) for label, img in variants.items() for psm in psms]
    errors: list[str] = []

    def run_one(job):
        label, img, psm = job
        try:
            res = get_engine(engine, psm=psm, **kwargs).run(img)
        except Exception as exc:  # noqa: BLE001
            # Record rather than silently swallow. A bug here once made every
            # page fail OCR and report "needs re-upload", which looked exactly
            # like bad photographs and hid the real cause.
            errors.append(f"{label}: {type(exc).__name__}: {exc}")
            return None
        tag = label if len(psms) == 1 else f"{label}/psm{psm}"
        return score_result(res), res, tag

    if parallel and len(jobs) > 1:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(4, len(jobs))) as pool:
            results = [r for r in pool.map(run_one, jobs) if r]
    else:
        results = [r for r in (run_one(j) for j in jobs) if r]

    if not results:
        raise RuntimeError(
            "Every OCR attempt failed. " + ("; ".join(errors) if errors
            else "No preprocessing variants were produced.")
        )
    best = max(results, key=lambda r: r[0])
    return best[1], best[2]


def get_engine(name: str, **kwargs) -> OcrEngine:
    return {
        "tesseract": TesseractEngine,
        "paddle": PaddleEngine,
        "cloud": CloudEngine,
    }[name](**kwargs)


