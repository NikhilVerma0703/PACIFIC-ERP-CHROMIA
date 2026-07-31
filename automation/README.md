# Finance Agent 01 — Bill → Ledger → Tally

Staff upload a bill. The system reads it, works out which expense ledger it belongs to,
checks it isn't a duplicate, and a human confirms three fields before it goes to Tally.
Every correction makes the next one better.

No LLM. All matching is deterministic — fuzzy string distance, TF-IDF cosine, and
character n-gram similarity — so any coding decision can be explained to an auditor.

---

## What actually goes to Tally

Three fields, exactly as you specified:

| Field | Source |
|---|---|
| **Person** | Chosen from a name list **before** uploading — never read off the bill |
| **Expense ledger** | Classified automatically, confirmed by a human |
| **Amount** | Extracted from the bill, editable |
| Date | Extracted, defaults to today |

**The flow is person-first.** A clerk picks who is being reimbursed, then drops in that
person's whole stack of bills at once. Every bill is filed against them automatically, so
the name is typed once rather than once per bill. A restaurant receipt does not record who
paid for it, so this is the only reliable source for that field anyway.

It creates a **Journal** voucher — `Dr <expense ledger>` / `Cr <person>` — which matches
how PESPL already books reimbursements. Your existing payment run settles the person
against the bank afterwards, unchanged.

GSTIN, invoice number, vendor and tax breakdown are still extracted, but they stay in the
local database. They drive duplicate detection and the learning loop. They never reach Tally.

---

## Install

**1. Tesseract** (the OCR engine)

- Windows: <https://github.com/UB-Mannheim/tesseract/wiki> — install, then add the install
  folder to PATH (or set `pytesseract.pytesseract.tesseract_cmd` in `app/ocr/engine.py`)
- Linux: `sudo apt install tesseract-ocr`

**2. Python 3.10+**

```bash
pip install -r requirements.txt
```

**3. Ledger master**

Already built from your trial balance — 443 ledgers, 196 valid reimbursement targets.
To rebuild after exporting a fresh trial balance from Tally:

```bash
python -m app.ledgers "data/Trial Balance - PESPL.xlsx" data/ledgers.json
```

Better still, once Tally's HTTP server is on, `POST /api/sync-ledgers` pulls the live list.
The trial balance is only a bootstrap — accountants create ledgers directly in Tally and the
dashboard must never offer a name Tally will reject.

**4. Run**

```bash
python run.py
```

Then open <http://localhost:8080>.

---

## Connecting Tally

TallyPrime has no REST API. It runs an HTTP server that accepts XML envelopes.

1. In TallyPrime: **F1 (Help) → Settings → Advanced Configuration → enable HTTP Server**
2. Keep Tally running with the company open
3. Set `tally.company` in `config.yaml` to match the Tally title bar exactly
4. Leave `tally.mode: file` to start

**Start in `file` mode.** The app writes ready-to-import XML to `data/tally_export/` and an
accountant imports it through Tally's Import Data screen. Nothing reaches your books
without a person choosing to import it. Switch `mode: http` once you trust the output —
that's a one-line change.

Set `tally.people_group` to the Tally group holding staff ledgers (`Sundry Creditors` by
default). The person dropdown is populated from it, which guarantees a voucher can never
fail on an unknown ledger name.

---

## How classification works

Four signals, combined:

| Signal | Weight | What it's for |
|---|---|---|
| Vendor memory | 0.42 | This vendor's confirmed history. Fact, not guess — so it outranks everything. |
| **Person memory** | **0.14** | **Which ledgers this claimant's bills go to. Known before the bill is even read.** |
| Fuzzy match | 0.18 | Survives OCR corruption and word reordering |
| TF-IDF cosine | 0.16 | Weights rare words: "Fumigation" decides, "Charges" doesn't |
| Char n-grams | 0.10 | OCR-noise backstop — matches on fragments when whole words fail |

### Getting intelligence without paying for AI

Three things do the work a model would, at zero cost:

**1. Import your existing Tally history.** Every past reimbursement Journal is a
labelled example — `Dr Travelling Expenses / Cr VIJAY KIRAN GAUTARAJ` tells the system
that Vijay claims travel. Export a Day Book or Journal Register from Tally and run:

```bash
python import_history.py --file daybook.xlsx --dry-run   # preview
python import_history.py --file daybook.xlsx             # apply
```

This is the single biggest accuracy lever available, and it uses data you already own.

**2. The claimant is a signal.** The person is chosen at upload, so it's known *before*
the bill is read. A driver claims fuel; a salesperson claims hotels. Measured: a
stationery bill for someone with six prior stationery claims goes from 84% to 94% —
crossing from "check this" into one-click confirm. Its weight is deliberately low, so a
fuel-claimer submitting a restaurant bill still gets Boarding & Lodging.

**3. Domain arithmetic beats pattern matching.** Fuel receipts satisfy
`amount = rate × litres`, and Indian fuel sits near ₹100/litre. When the pump's columns
collapse under OCR — one real page read `"AmountcRs) Rate Volume : 0014.45 01500."` —
the amount is recovered by finding the triple that satisfies the identity. On that page:
`103.00/L × 14.45 L = 1488 ≈ 1500`. No label was readable; the arithmetic was.

**If you later want more,** a local sentence-embedding model (~80 MB, offline, free
forever, no API) would improve the text signals further. Not needed yet — the six
reimbursement categories all classify correctly on text alone.

Scores are calibrated on both absolute strength **and** margin over the runner-up, because
0.30 with the next candidate at 0.05 is confident while 0.30 against 0.28 is a coin flip.

Measured on your sample bill, learning from scratch:

```
confirmations   confidence   band
      0            52%       low       ← text signals only
      1            70%       medium
      2            82%       medium
      3           100%       high      ← auto-fills, one-click confirm
```

Confidence is deliberately **capped** below three confirmations. One confirmation could be a
clerk clicking through carelessly, and a system that treats one click as certainty will
propagate that mistake to every future bill from that vendor.

---

## Duplicate detection

Three layers. A duplicate reaching Tally becomes a duplicate payment, so this gets the most care.

| Layer | When | Action |
|---|---|---|
| SHA-256 of the file | Upload | **Blocks** — no reason to process the same file twice |
| Perceptual image hash | Upload | Warns — same bill photographed twice |
| Business key | After extraction | Warns — same invoice, any image |

The business key fuzzy-matches GSTIN + invoice number + amount + date, weighted. GSTIN plus
invoice number is decisive on its own. Amount plus date *without* a vendor match is ignored —
in a business with many small bills that's an ordinary coincidence, and flagging it trains
people to click through warnings.

Everything except the file hash is overridable with a typed reason, which is logged.

Test results across 8 cases including OCR-mangled invoice numbers and same-vendor-same-amount:
all 8 classify correctly.

---

## OCR: what to expect

This is the honest part.

| Input | Expect |
|---|---|
| Digital PDF invoice | ~100% — text read directly, no OCR |
| Clean scan of printed bill | 90–97% |
| Phone photo, flat, good light | 75–90% |
| Phone photo, dark/curled (your samples) | 40–70% — usable, needs checking |
| Coloured / carbon-copy | 60–85% |
| **Handwritten** | **Not viable — routed to manual entry** |

Your 11 sample pages are the worst case: thermal receipts photographed in low light, curled,
with a thumb over the corner. After preprocessing they run 30–58% OCR confidence and the
pipeline still extracts the right totals on most.

**Handwriting cannot be solved with classical OCR.** Tesseract is trained on printed glyphs;
on handwriting it emits confident nonsense, which in a finance system is worse than nothing.
Measurement confirmed the obvious detector doesn't work either — stroke-width variation runs
0.48 on clean print but 0.59–0.89 on your *printed* photos, straight through the range
handwriting occupies. So the pipeline uses two independent signals that must agree, is tuned
to fire rarely, and gives the uploader an explicit **"this bill is handwritten"** checkbox.
One click beats any heuristic.

If handwritten volume turns out to matter, the fix is a cloud OCR provider with handwriting
support — `app/ocr/engine.py` is a plug-in interface specifically so that's a config change.

**A one-page photo guide for staff will improve accuracy more than any code change.**

### Should people scan instead of photograph?

Yes — and it is the single highest-leverage change available. Measured on the same bill content:

| Input | Route | Confidence | Fields correct |
|---|---|---|---|
| Photo of the receipt | Tesseract OCR | 43% | vendor, total (GSTIN missed) |
| **Scan → searchable PDF** | **text layer, no OCR** | **99%** | **everything, incl. GSTIN and all 5 line items** |

A "searchable PDF" (also called "OCR'd PDF" or "text-searchable PDF") carries a text layer
your scanner has already produced. This app detects that and skips OCR entirely — no
preprocessing, no confidence gate, no re-upload loop, and roughly six seconds per page saved.
Most office MFPs (Canon, Ricoh, Xerox, HP) have this under **Scan → File Format → PDF
(Searchable)**. If your MFP has it, turning it on is worth more than everything else on this page.

**But don't mandate flatbed scanning for the people claiming.** They are out of the office when
they get the receipt, and a rule they can't follow gets worked around. Three tiers, in order of
what actually works:

1. **Finance desk batch-scans.** Claims physically reach finance anyway. Put the stack in the
   ADF, scan to one searchable PDF, upload it — this app splits multi-page PDFs automatically.
   Best accuracy and the least total effort.
2. **Claimants use a phone scanner app** — Microsoft Lens, Adobe Scan, Google Drive's scan
   button, or iPhone Notes. These do perspective correction and flattening on-device and
   output a clean PDF. Most of the benefit of a scanner, none of the friction.
3. **Raw camera photo** — the fallback, and what the preprocessing chain is tuned for.

Two caveats. Scan at **300 DPI in text/document mode**, not photo mode — a low-DPI or
photo-mode scan is no better than a good phone picture. And **thermal receipts fade**, so
scan them within a few weeks; a faded thermal receipt is unreadable to any OCR engine.

Scanning does not help handwriting. A crisp 600 DPI scan of handwriting is still handwriting.

If input becomes overwhelmingly scans, set `ocr.try_variants: false` in `config.yaml` — the
three-variant ensemble exists to rescue bad photos and just costs time on clean input.

---

## Preprocessing

Runs before every OCR attempt:

1. EXIF orientation — phones lie
2. **Document detection** — crops the bill out of the background using a brightness *and*
   saturation mask. Brightness alone failed on the sample where a receipt sits on orange
   patterned cloth; the cloth passed the threshold and the crop destroyed the cleanest bill
   in the set. Every crop is now validated and rejected if it loses ink.
3. Illumination flattening — divides out the lighting gradient. Biggest single win on hand-held photos.
4. Deskew
5. Upscale to ~300 DPI equivalent
6. Denoise
7. **Three binarisation variants**, all OCR'd, best result kept — no single variant wins
   across bill types (page 0 prefers greyscale at 43% confidence, page 10 prefers Otsu at 46%)

---

## Field extraction

Rule-based. Some things worth knowing:

**GSTIN repair uses the check digit.** GSTIN has a rigid positional format and a base-36
checksum, so OCR damage is genuinely repairable rather than guessable. Ambiguous characters
are enumerated and the checksum decides. On your sample this recovered
`C6ABCFKOIB7HIZH` → `36ABCFK0167H1ZH`, exactly matching the bill — five characters corrected.

The search is restricted to windows near a "GST" label. Without that constraint it is
actively harmful: scanning the whole page and trying thousands of substitutions will
eventually produce a checksum-valid string by chance, and during testing it "found" a
fabricated GSTIN in a line of OCR noise. A fake GSTIN that validates is far worse than none,
because it becomes the vendor's identity for duplicate detection.

**Labels are matched fuzzily.** OCR produces "Total Amcunt", "BillAmoun'", "Rounc Off".
Exact regex misses all of them.

**Arithmetic corroborates OCR.** If `taxable + taxes + round-off == net`, all four numbers are
confirmed regardless of individual OCR confidence. This also catches a specific failure: on
your sample the "Net Amount" line collided with the KOT line and became unreadable, so the
matcher landed on "Total Amount" — the *pre-tax* figure. Adding the taxes and finding the
result elsewhere on the page recovered the true total of 2214.00 rather than posting 2108.28.

Phone numbers, FSSAI licences and bill numbers are excluded from amount candidates — before
that guard, the fallback confidently returned a phone number as the total.

---

## Layout

```
finance-agent/
├── run.py                  start here
├── config.yaml             every threshold and switch
├── SPEC.md                 architecture and design rationale
├── app/
│   ├── main.py             FastAPI routes
│   ├── pipeline.py         orchestration
│   ├── ledgers.py          ledger master + seed aliases
│   ├── extract.py          field extraction, GSTIN repair
│   ├── classify.py         four-signal ensemble + learning
│   ├── dedupe.py           three duplicate layers
│   ├── tally.py            XML builder + HTTP gateway
│   ├── db.py               SQLite schema
│   ├── ocr/
│   │   ├── preprocess.py   crop, flatten, deskew, variants
│   │   ├── quality.py      quality gate + handwriting detection
│   │   └── engine.py       pluggable OCR providers
│   └── templates/
└── data/
    ├── ledgers.json        443 ledgers
    ├── finance.db          SQLite
    ├── uploads/
    └── tally_export/       XML for manual import
```

---

## The agent parts (no APIs, all offline)

**The full autonomous loop.** With everything on (the defaults), a trusted repeat bill needs
ZERO clicks end to end:

```
MFP scans to data/inbox/VARUN MUNDRA/
  → agent ingests, splits, OCRs (rescuing failed reads itself)
  → classifies, checks duplicates + anomalies
  → auto-approves if every guard passes
  → writes the Tally voucher XML into data/tally_export/
  → accountant imports into Tally            ← the one human step, by design
```

Money movement always has a human at the gate: in file mode that gate is Tally's own
import screen, and over HTTP the agent refuses to post autonomously no matter what the
config says.

**Every autonomous act is journaled** at `/journal` — intakes, rescues, approvals, posted
vouchers, anomalies, self-tuning decisions, Tally syncs, and a daily digest. When someone
asks "why is this bill already posted?", the answer is one screen away.

**It tries harder before asking for help.** A failed read triggers a rescue pass — different
page-segmentation modes, uncropped frame — before any human sees "please re-upload".

**It knows what's normal for each person.** A claim over 3× someone's median is flagged,
explained ("15.8× VARUN MUNDRA's median claim of 304.00"), and never auto-approved.

**It tunes its own speed.** Once one OCR variant has won ≥90% of 200+ bills, the losers stop
running — except on every 10th bill, which runs the full set so the statistic keeps being
earned instead of becoming self-fulfilling. Reversible by itself if the paper changes.

**It maintains itself.** Hourly it probes Tally's gateway — the day you switch it on,
ledgers sync with no command. Daily it writes a digest, gives `_failed` files one retry
(copy hiccups are transient; a file that fails twice stays failed), and compacts the DB.



**Watch folder — hands-free intake.** Drop bills into `data/inbox/<PERSON NAME>/` and they
are picked up, split, read and classified with nobody opening the dashboard. The folder name
IS the claimant, so pointing a scan-to-folder MFP or a shared drive at the inbox makes intake
fully automatic. Files are only ingested once their size is stable across two scans (a file
still being copied is truncated garbage), then moved to `_done/` — failures to `_failed/`.

**Auto-approval — trusted repeats skip the confirm click.** A bill approves itself only when
every guard passes: the vendor→ledger mapping has ≥3 confirmations, the suggestion is in the
high band, the amount was arithmetic-verified or read at ≥80% confidence, no duplicate was
flagged, and the amount is under `agent.auto_approve_max_amount` (default ₹5,000). It's
marked "auto-approved", still editable, and **posting to Tally always remains a human
click.** Turn off with `agent.auto_approve: false`.

**Insights — the system reports on itself** at `/insights`, every number counted from
recorded decisions: correction hotspots (repeated identical corrections = a missing alias or
mis-mapped vendor), OCR variant win-rates (once one dominates, drop the others for a 3×
speedup), learning coverage, and vocabulary the system has taught itself — tokens that
confirmed bills keep associating with a ledger but that the matcher's dictionary lacks.
Those are proposed for a human to add, never applied silently: a learning system that
rewrites its own matching rules unreviewed is how one bad week becomes permanent.

---

## Screens

- **Queue** — everything by status, with the confirm-rate trend
- **Upload** — person picker first, then multi-file select, handwritten checkbox, photo guidance
- **Batch summary** — after a multi-bill upload: every bill, its suggested ledger, amount and status
- **Review** — bill image beside the three fields, ranked suggestions with reasons,
  what-else-was-read panel, new-ledger request
- **Learned mappings** — everything the system inferred, all of it deletable
- **Insights** — the system's self-report: correction hotspots, variant win-rates, alias suggestions
- **Ledger requests** — approve and create in Tally

---

## Before you roll this out

**Set `FINANCE_AGENT_DB`** if the app folder is on a network share — SQLite needs real file
locking and some shares don't provide it.

**Add authentication.** There is none. Put it behind your network or add SSO before it leaves
the pilot group. The role model (clerk / approver / admin) is specified in SPEC.md but not
enforced in code.

**Measure time-per-bill from week one.** The tool has to be *faster* than typing into Tally
directly. If it isn't, the pilot fails regardless of accuracy.

**Expect to correct a lot early.** The learning tables start empty. Accuracy climbs sharply
after a few hundred bills. The metric that matters in month one is not accuracy — it's whether
the confirm-rate is trending up.
