import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync, readdirSync } from "fs";
import { join, basename } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

export const maxDuration = 120;

// ─── Python OCR script ────────────────────────────────────────────────────────
// Each page = one distinct physical slab. Labels = Excel serial numbers.
const OCR_PY = String.raw`
import sys, json, re, cv2, numpy as np, pytesseract, os

pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

LABEL_RE = re.compile(r'(?<!\d)(\d{1,4}(?:-[A-Za-z0-9]{1,10})?)(?!\d)')

def norm_stock_code(raw):
    code = re.sub(r'[xX\xd7*\xab]', 'x', raw.strip())
    if 'x' in code:
        parts = code.split('x', 1)
        if len(parts) == 2:
            try:
                w, h = float(parts[0]), float(parts[1])
                while h > 400 and h >= 10: h = int(str(int(h))[:-1])
                while w > 400 and w >= 10: w = int(str(int(w))[:-1])
                if 20 <= w <= 400 and 10 <= h <= 400:
                    return f"{int(w)}x{int(h)}"
            except:
                pass
        return code
    if re.match(r'^\d{4,8}$', code):
        n = len(code)
        for sp in ([3] if n == 5 else [3, 4] if n == 6 else [4] if n in (7, 8) else []):
            w, h = int(code[:sp]), int(code[sp:])
            if 60 <= w <= 400 and 40 <= h <= 400:
                return f"{w}x{h}"
    return code

def find_stock(text):
    NOISE = {'sheet', 'the', 'a', 'an', 'of', 'no', 's', 'used', 'wasted', 'cuts'}
    m = re.search(r'Stock\s+sheet\b\s*[:#]?\s*(\S+)', text, re.IGNORECASE)
    if m and m.group(1).lower() not in NOISE:
        return norm_stock_code(m.group(1))
    lines = text.split('\n')
    for i, line in enumerate(lines):
        if re.match(r'\s*Stock\s+sheet\b', line, re.IGNORECASE):
            for j in range(i + 1, min(i + 5, len(lines))):
                c = lines[j].strip()
                if not c: continue
                c = norm_stock_code(c)
                if c.lower() in NOISE: continue
                if re.match(r'^[A-Za-z0-9][\w.\-x]{2,}$', c): return c
                break
    m2 = re.search(r'^\s*1\s+(\d+[xX\xd7*]\d+)\s+[xy]=', text, re.IGNORECASE | re.MULTILINE)
    if m2: return norm_stock_code(m2.group(1))
    return None

def ocr_text(img, psm):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    gray = cv2.resize(gray, (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4)
    gray = cv2.fastNlMeansDenoising(gray, h=8)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if np.mean(binary) < 127: binary = cv2.bitwise_not(binary)
    return pytesseract.image_to_string(binary, config=f'--psm {psm}')

def extract_labels_text(img, H, W):
    # Parse the panel table from OCR text — handles column-drift and OCR misses
    tbl = img[int(H * 0.08):int(H * 0.55), 0:int(W * 0.50)]
    big = cv2.resize(tbl, (tbl.shape[1] * 2, tbl.shape[0] * 2), interpolation=cv2.INTER_LANCZOS4)
    gray = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if np.mean(binary) < 127: binary = cv2.bitwise_not(binary)
    text = pytesseract.image_to_string(binary, config='--psm 6')
    m = re.search(r'Label\s+Qty', text, re.IGNORECASE)
    if not m: return []
    after = text[m.end():]
    out = []; seen = set()
    for line in after.split('\n'):
        line = line.strip()
        if not line: continue
        if re.search(r'#\s*Panel|Cut\s+Result', line, re.IGNORECASE): break
        parts = line.split()
        if len(parts) < 2: continue
        # Scan from right: find first qty<=30, then label before it
        for i in range(len(parts) - 1, 0, -1):
            try:
                qty = int(parts[i])
                if not (1 <= qty <= 30): continue
                lbl = re.sub(r'[^0-9]', '', parts[i - 1])
                if lbl and re.match(r'^\d{1,4}$', lbl) and lbl not in seen:
                    out.append({'label': lbl, 'qty': qty})
                    seen.add(lbl)
                break
            except (ValueError, IndexError):
                continue
    return out

def extract_labels(img, H, W):
    table = img[int(H * 0.12):int(H * 0.70), 0:int(W * 0.65)]
    TH, TW = table.shape[:2]
    big = cv2.resize(table, (TW * 2, TH * 2), interpolation=cv2.INTER_LANCZOS4)
    gray = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if np.mean(binary) < 127: binary = cv2.bitwise_not(binary)
    data = pytesseract.image_to_data(binary, config='--psm 6', output_type=pytesseract.Output.DICT)

    lx0 = int(TW * 0.195); lx1 = int(TW * 0.255)
    qx0 = int(TW * 0.29);  qx1 = int(TW * 0.37)

    header_y = None; cutresult_y = TH
    for i, t in enumerate(data['text']):
        if data['conf'][i] < 25 or not t.strip(): continue
        x = data['left'][i] // 2; y = data['top'][i] // 2
        if t.strip().lower() == 'label' and (lx0 - 60) <= x <= (lx1 + 60):
            header_y = y
        if t.strip() == '#' and x < int(TW * 0.12):
            cutresult_y = min(cutresult_y, y)
    if cutresult_y == TH:
        cutresult_y = int(TH * 0.30)
    # Always enforce a minimum start y to exclude stock-summary rows at top
    y_start = header_y if header_y is not None else int(TH * 0.10)

    lbl_rows = {}; qty_rows = {}
    for i, t in enumerate(data['text']):
        if data['conf'][i] < 25 or not t.strip(): continue
        x = data['left'][i] // 2; y = data['top'][i] // 2; band = (y // 20) * 20
        if y <= y_start: continue
        if y >= cutresult_y: continue
        if lx0 <= x <= lx1:
            m = LABEL_RE.search(t.strip())
            if m: lbl_rows[band] = m.group(1)
        if qx0 <= x <= qx1:
            if re.match(r'^\d{1,2}$', t.strip()):
                q = int(t.strip())
                if 1 <= q <= 99: qty_rows[band] = q

    spatial = []; seen = set()
    for band in sorted(lbl_rows):
        lbl = lbl_rows[band]
        if lbl in seen: continue
        seen.add(lbl)
        qty = next((qty_rows[band + d] for d in [0, 20, -20, 40, -40] if (band + d) in qty_rows), 1)
        spatial.append({'label': lbl, 'qty': qty})

    # Text parsing is more robust (not column-position dependent); prefer it
    text_based = extract_labels_text(img, H, W)
    return text_based if text_based else spatial

def parse_page(img_path, page_num):
    img = cv2.imread(img_path)
    if img is None: return None
    H, W = img.shape[:2]
    hdr = img[0:int(H * 0.25), :]
    stock = (find_stock(ocr_text(hdr, 11))
             or find_stock(ocr_text(hdr, 6))
             or find_stock(ocr_text(img, 11))
             or find_stock(ocr_text(img, 6)))
    if not stock: return None
    labels = extract_labels(img, H, W)
    if not labels: return None
    return {'stockSheet': stock, 'page': page_num, 'labels': labels}


if __name__ == '__main__':
    img_paths = sys.argv[1:]
    results = []; debug_pages = []
    for idx, path in enumerate(img_paths):
        page_num = idx + 1
        result = parse_page(path, page_num)
        if result:
            debug_pages.append({'page': page_num, 'file': os.path.basename(path),
                                 'stock': result['stockSheet'], 'labels': result['labels']})
            results.append(result)
        else:
            debug_pages.append({'page': page_num, 'file': os.path.basename(path),
                                 'stock': None, 'labels': []})
    print(json.dumps({'plan': results, 'debug': debug_pages}))
`;

type LabelEntry = { label: string; qty: number };
type SlabPlan   = { stockSheet: string; page: number; labels: LabelEntry[] };
type DebugPage  = { page: number; file: string; stock: string | null; labels: LabelEntry[] };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (!file.name.match(/\.pdf$/i)) return Response.json({ error: "Only PDF files accepted" }, { status: 400 });

  const tmpDir  = tmpdir();
  const ts      = Date.now();
  const pdfPath = join(tmpDir, `cutplan_${ts}.pdf`);
  const pyPath  = join(tmpDir, `cutplan_ocr_${ts}.py`);
  const imgPfx  = join(tmpDir, `cutplan_${ts}_p`);

  writeFileSync(pdfPath, Buffer.from(await file.arrayBuffer()));
  writeFileSync(pyPath, OCR_PY);

  try {
    execSync(`pdftoppm -r 300 -png "${pdfPath}" "${imgPfx}"`, { timeout: 30000 });

    const pyOut = execSync(`python3 "${pyPath}"`, { timeout: 60000 }).toString();
    const parsed = JSON.parse(pyOut) as { plan: SlabPlan[]; debug: DebugPage[] };

    return Response.json({ success: true, plan: parsed.plan, debug: parsed.debug });
  } catch (err: any) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  } finally {
    try { unlinkSync(pdfPath); } catch {}
    try { unlinkSync(pyPath);  } catch {}
  }
}
