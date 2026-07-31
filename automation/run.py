#!/usr/bin/env python3
"""Start the dashboard.  python run.py"""
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))


def preflight() -> bool:
    ok = True

    # --- Python packages ---------------------------------------------------
    missing = []
    for mod, pkg in [("cv2", "opencv-python-headless"), ("numpy", "numpy"),
                     ("PIL", "Pillow"), ("pytesseract", "pytesseract"),
                     ("pdfplumber", "pdfplumber"), ("rapidfuzz", "rapidfuzz"),
                     ("sklearn", "scikit-learn"), ("imagehash", "ImageHash"),
                     ("openpyxl", "openpyxl"), ("yaml", "PyYAML"),
                     ("fastapi", "fastapi"), ("uvicorn", "uvicorn"),
                     ("jinja2", "jinja2"), ("multipart", "python-multipart")]:
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)
    if missing:
        ok = False
        print("[X] Missing Python packages: " + ", ".join(missing))
        print("    pip install " + " ".join(missing))
        print()

    import yaml
    cfg = yaml.safe_load((BASE / "config.yaml").read_text(encoding="utf-8"))

    # --- Tesseract ---------------------------------------------------------
    tess = None
    if "pytesseract" not in missing:
        from app.ocr.engine import configure_tesseract, WINDOWS_TESSERACT_PATHS
        tess = configure_tesseract(cfg["ocr"].get("tesseract_cmd"))
        if tess:
            try:
                import pytesseract
                print(f"[ok] Tesseract {pytesseract.get_tesseract_version()}")
                print(f"     {tess}")
            except Exception as e:
                ok = False
                print(f"[X] Found Tesseract at {tess} but could not run it: {e}")
        else:
            ok = False
            print("[X] Tesseract is not installed, or is installed somewhere unexpected.")
            print()
            print("    WINDOWS")
            print("      1. Download the installer:")
            print("         https://github.com/UB-Mannheim/tesseract/wiki")
            print("         (pick tesseract-ocr-w64-setup-....exe)")
            print("      2. Install it. The default location is fine - this app finds it")
            print("         automatically and does NOT need it on your PATH.")
            print("      3. Run this again.")
            print()
            print("      Installed somewhere else? Put the full path to tesseract.exe in")
            print("      config.yaml under ocr.tesseract_cmd, for example:")
            print(r'         tesseract_cmd: "D:\Tools\Tesseract-OCR\tesseract.exe"')
            print()
            print("      Checked these locations:")
            for p in WINDOWS_TESSERACT_PATHS:
                print(f"         {p}")
            print()
            print("    LINUX:  sudo apt install tesseract-ocr")
            print("    MAC:    brew install tesseract")
            print()

    # --- Ledger master -----------------------------------------------------
    data = BASE / cfg["app"]["data_dir"]
    if not (data / "ledgers.json").exists() and \
       not (data / "Trial Balance - PESPL.xlsx").exists():
        ok = False
        print("[X] No ledger master found.")
        print(f"    Put your Tally trial balance export here:")
        print(f"      {data / 'Trial Balance - PESPL.xlsx'}")
        print("    Then run:")
        print(f'      python -m app.ledgers "{data}/Trial Balance - PESPL.xlsx" "{data}/ledgers.json"')
        print()
    else:
        import json
        if (data / "ledgers.json").exists():
            n = len(json.loads((data / "ledgers.json").read_text(encoding="utf-8")))
            print(f"[ok] Ledger master: {n} ledgers")

    return ok


if __name__ == "__main__":
    import yaml
    cfg = yaml.safe_load((BASE / "config.yaml").read_text(encoding="utf-8"))

    print()
    if not preflight():
        print("Fix the above and run again.")
        sys.exit(1)

    print(f"[ok] Tally mode: {cfg['tally']['mode']}", end="")
    if cfg["tally"]["mode"] == "file":
        print(f"  (XML written to {cfg['tally']['export_dir']}, nothing posted)")
    else:
        print(f"  (posting to {cfg['tally']['host']}:{cfg['tally']['port']})")

    print()
    print(f"  {cfg['app']['name']}")
    print(f"  http://localhost:{cfg['app']['port']}")
    print()

    import uvicorn
    uvicorn.run("app.main:app", host=cfg["app"]["host"],
                port=cfg["app"]["port"], reload=False)
