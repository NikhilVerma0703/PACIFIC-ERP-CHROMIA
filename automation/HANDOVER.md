# Handover — Finance Agent 01 (Reimbursements)

**Pacific Engineered Surfaces Pvt Ltd** · prepared for merge into the Next.js ERP

---

## What this is

Staff hand in bills for money they spent out of pocket. This service reads the bill,
works out which expense ledger it belongs to, checks it isn't a duplicate, and produces
**one Tally-importable XML for a whole batch** — 2 bills or 200.

```
Dr  <expense ledger>          the expense
Cr  <the person>              what the company owes them
```

Three fields reach Tally: **person, ledger, amount** (plus date). That's it — matching how
PESPL already books reimbursements as Journal vouchers. The existing payment run settles
the person against Kotak Bank afterwards, unchanged.

**No LLM, no paid API.** All matching is deterministic — fuzzy string distance, TF-IDF
cosine, character n-gram similarity, and memory of past confirmations. Any coding decision
can be explained to an auditor, and there is no per-bill cost.

## Status: the risky part is proven

The XML import was verified against **live PESPL data** on the AIOCLOUD Tally server on
30 July 2026:

| Verified | Result |
|---|---|
| Voucher format, Dr/Cr direction | ✅ correct in the Day Book |
| Company / GST fields | ✅ matched against PESPL's own voucher export |
| Unique voucher numbers | ✅ `REIMB/26-27/00412` style |
| New ledgers created from the same file | ✅ masters + vouchers in one import |
| A ledger created earlier in the file, used by a later voucher | ✅ works |

That last row is what makes a 100-bill batch safe, and it was the single biggest unknown
in the project.

**299 automated checks pass** (`python tests.py`), covering OCR, extraction, classification,
learning, duplicate detection, thread safety, the Tally XML, and the full REST API contract.

## Architecture

```
                Next.js ERP  (login, screens, users)
                       │  HTTPS, X-API-Key + X-User
                       ▼
        ┌──────────────────────────────────────────┐
        │   Finance Engine   (Python / FastAPI)     │
        │                                           │
        │   upload → split pages → OCR → extract    │
        │   → classify → duplicate check → review   │
        │   → confirm (learns) → batch XML          │
        │                                           │
        │   SQLite + bill images on disk            │
        └──────────────────────────────────────────┘
                       │  one .xml file
                       ▼
              Tally Prime  (O: Import → Transactions)
```

**Deliberately file-exchange, not a live connection.** Tally has no REST API, and its XML
gateway needs a port open on the accounts machine — which on PESPL's AIOCLOUD setup is not
reliably available. A file also means a human sees what is about to enter the books before
it does. A live-gateway path exists in `app/tally.py` and turns on with one config change
if that becomes preferable.

### Division of labour with the ERP

| | ERP | Engine |
|---|---|---|
| Login, roles, screens | ✅ | — |
| Bill images | — | ✅ stores + serves |
| OCR, classification, learning | — | ✅ |
| Duplicate detection | — | ✅ |
| Tally XML | — | ✅ |

The ERP stores nothing about bills — it holds bill ids and renders what the engine returns.
**See `API.md`** for the full endpoint reference with TypeScript examples.

## Running it

```bash
pip install -r requirements.txt
# Tesseract OCR must be installed separately (Windows installer does not add it to PATH;
# the app auto-detects the usual locations)
python run.py                    # http://localhost:8080
python tests.py                  # 299 checks
```

Every accuracy and safety decision is a value in **`config.yaml`** — nothing requires a
code change to tune. The values in there are not defaults; they were derived from PESPL's
own data (company name and GSTIN from their voucher export, people group and ledger parents
from their All Masters export).

## Code map

| File | Lines | What it does |
|---|---|---|
| `app/api.py` | 785 | **REST API for the ERP** — start here |
| `app/pipeline.py` | 681 | orchestration: register → OCR → extract → classify → confirm |
| `app/extract.py` | 873 | field extraction: amounts, GSTIN, dates, fuel triangulation |
| `app/classify.py` | 631 | 5-signal ensemble, learning, memory decay |
| `app/main.py` | 623 | FastAPI app + the internal HTML dashboard |
| `app/tally.py` | 423 | single-voucher XML + the live gateway path |
| `app/export_batch.py` | 394 | **batch XML** — N bills → one import file |
| `app/db.py` | 402 | schema + self-deriving migrations |
| `app/agent.py` | 393 | watch folder, maintenance loop, insights |
| `app/ocr/` | 954 | Tesseract engine, preprocessing variants, quality gate |
| `app/dedupe.py` | 277 | three-layer duplicate detection |
| `app/master_xml.py` | 168 | parses Tally's All Masters export (2,538 ledgers) |
| `tests.py` | 1,295 | 299 checks |
| `import_history.py` | 417 | bootstraps learning from years of past Tally vouchers |

Docs: **`API.md`** (ERP integration) · **`README.md`** (how it works and why) ·
**`SPEC.md`** (original design) · this file.

## Three things the ERP team must know

### 1. Tally does not reject duplicate imports

Verified the hard way: five imports of one test file produced **ten vouchers** and Tally
never complained. So duplicate control is entirely ours, in two layers:

- **Bill level** — `dedupe.enabled` catches the same bill submitted twice (file hash,
  perceptual image hash, and vendor+amount+date fuzzy match).
- **Export level** — the `exports` table. An exported bill is excluded from every later
  batch with a stated reason, and can no longer be edited.

Neither stops a human re-importing yesterday's file. Handle that operationally: import
once, mark it imported in the ERP, move the file out of the import folder.

> ⚠️ **`dedupe.enabled` is currently `false`** — it was turned off to allow the same bills
> to be re-uploaded repeatedly during OCR tuning. **Set it to `true` before real bills.**
> The dashboard shows a banner while it is off.

### 2. The person is chosen before upload, never read off the bill

A restaurant receipt does not record who paid for it. The clerk picks the claimant, then
drops in that person's whole stack. Any UI that tries to extract the name from the bill
will be wrong most of the time.

### 3. Scope is staff spend bills only

Vendor purchase bills are a different agent: party ledger instead of a person, GST input
credit split across CGST/SGST/IGST, invoice number and date as legal fields, HSN codes, and
they post as **Purchase**, not Journal. Don't route them here.

## What is done and what is not

**Done and tested**

- Per-page bill splitting (an 11-page PDF is 11 claims, not one)
- OCR at ~2.2s/page with multi-variant preprocessing and best-of scoring
- Field extraction with arithmetic verification (taxable + CGST + SGST = total)
- GSTIN checksum repair — recovered `C6ABCFKOIB7HIZH` → `36ABCFK0167H1ZH`
- 5-signal classification with no model; learning curve measured 39% → 100% on repeats
- Three-layer duplicate detection
- Ledger master from Tally's All Masters export — 2,538 ledgers
- Batch XML validated for 100 bills, format verified in live Tally
- REST API with API-key auth and per-user audit trail
- Watch folder, guarded auto-approval, anomaly sentinel, self-tuning OCR variants
- Thread safety (8 concurrent workers, 0 errors)

**Not done**

- The Next.js screens (that's the merge work)
- **Payment run** — settling accrued claims against the bank as Tally `Payment` vouchers.
  Config keys are in place (`payment_voucher_type`, `cash_ledger`); the voucher builder
  handles Payment already but it is untested against real Tally.
- Handwritten bills. Tesseract cannot read handwriting; the quality gate detects it and
  asks for manual entry rather than guessing. A cloud OCR hook exists if that changes.
- No authentication inside the engine beyond the shared API key — by design, since the ERP
  owns login.
- Excel export exists but is a **review artefact only**. Tally's Excel import cannot create
  masters, so it would fail on any batch containing a new ledger.

## Recommended first steps for the ERP team

1. `python tests.py` — confirms the environment is sound before touching anything.
2. Generate an API key, export it as `FINANCE_ENGINE_KEY` (not into `config.yaml`,
   which is tracked in git), hit `/api/v1/health`.
3. Read `API.md` and build the screens against the running engine.
4. Run `python import_history.py --file "Journal Register (FY2024-26).xlsx"` — this teaches
   the classifier from years of PESPL's own vouchers, so it starts out knowing who claims
   what instead of learning from zero. Biggest accuracy win available and it costs nothing.
5. Set `dedupe.enabled: true`.
6. Pilot with one department's real claims for a fortnight before opening it up.

## Files that should not be committed

`data/` holds a 30 MB Tally masters export, the SQLite database, bill images and scratch
test XMLs. A `.gitignore` is included. `data/TEST_*.xml` were throwaway import probes —
`TEST_5` and `TEST_6` are the ones that passed; the rest can be deleted.
