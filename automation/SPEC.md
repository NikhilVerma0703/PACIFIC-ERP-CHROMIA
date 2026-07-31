# Finance Agent 01 — Bill Capture → Ledger Classification → Tally Posting

**Company:** Pacific Engineered Surfaces Pvt Ltd (PESPL)
**Scope of Agent 01:** Staff reimbursements. A clerk uploads a bill (PDF/image). The system extracts it, classifies it against the existing Tally ledger master, checks for duplicates, lets a human review and correct, then posts a voucher to Tally. Every correction makes the next classification better.

**What reaches Tally — three fields only:** the expense ledger, the person to reimburse, and the amount. The date is included when readable. Everything else the pipeline extracts stays local.

**The person is chosen before upload, not extracted.** A clerk selects the claimant from a name list sourced from Tally, then uploads that person's bills as a batch. This is not a UI preference — a restaurant receipt contains no information about who paid for it, so there is nothing to extract. Selecting once per person rather than once per bill also matches how claims physically arrive.
**Explicitly out of scope for v1:** LLM/GenAI inference. All matching is deterministic — fuzzy string distance, TF-IDF cosine similarity, and character n-gram embeddings.

---

## 1. Why "no AI" is the right call here, and where it has a hard limit

Deterministic matching is a good fit for ledger classification: you have a fixed vocabulary of 444 ledgers, the mapping is highly repetitive (the same 30 vendors generate 80% of bills), and an auditor can be shown exactly *why* a bill was coded to a ledger. A cosine score is defensible in a way that "the model said so" is not.

There is one place it does not hold, and it should be said plainly up front:

> **Handwritten bills cannot be read by classical OCR.** Tesseract and PaddleOCR are trained on printed glyphs. On handwriting they do not degrade gracefully — they produce confident nonsense, which is worse than producing nothing.

So handwriting is handled by *detection and routing*, not by recognition. The pipeline detects that a page is likely handwritten and sends it straight to the Manual Entry screen with the image displayed large, skipping OCR entirely. The clerk types 6 fields instead of 6 fields plus correcting 20 wrong ones. If handwritten volume turns out to be material, the escape hatch is a cloud handwriting OCR provider — the OCR layer is built as a plug-in interface specifically so that switch is a config change, not a rewrite.

**Realistic accuracy expectations by input type:**

| Input type | OCR quality | Expected routing |
|---|---|---|
| Digital PDF invoice (text layer) | ~100% | Auto-extract, high confidence |
| Clean scan of printed invoice | 90–97% | Auto-extract, review flagged fields |
| Phone photo, good light, flat | 75–90% | Auto-extract, human review |
| Phone photo, dark/curled (your sample) | 40–70% | Low-confidence → review or re-upload |
| Coloured / carbon-copy bill | 60–85% | Colour-channel preprocessing helps |
| Handwritten | Not viable | Detect → route to manual entry |

The sample provided (`june food bill 1.pdf`) is the hard case: 11 pages of thermal receipts photographed in low light, curled, with a thumb over the corner. It is a useful worst-case test, and the preprocessing chain is tuned against it.

---

## 2. Pipeline

```
    Choose person  ──┐
                     ▼
                                   ┌──────────────────────────┐
  Upload (PDF / JPG / PNG)  ───►   │ 1. INGEST                │
   (many bills at once)            │ page split, file hash,   │
                                   │ person attached to each  │
                                   └────────────┬─────────────┘
                                                ▼
                                   ┌──────────────────────────┐
                                   │ 2. DUPLICATE CHECK (fast)│──► exact file seen before? BLOCK
                                   │ sha256 + perceptual hash │
                                   └────────────┬─────────────┘
                                                ▼
                                   ┌──────────────────────────┐
                                   │ 3. PREPROCESS            │
                                   │ deskew, shadow removal,  │
                                   │ adaptive threshold,      │
                                   │ upscale, denoise         │
                                   └────────────┬─────────────┘
                                                ▼
                                   ┌──────────────────────────┐
                                   │ 4. QUALITY GATE          │──► too blurry/dark → ASK RE-UPLOAD
                                   │ blur, contrast, coverage │──► handwriting → MANUAL ENTRY
                                   └────────────┬─────────────┘
                                                ▼
                                   ┌──────────────────────────┐
                                   │ 5. OCR (pluggable)       │
                                   │ tesseract | paddle |     │
                                   │ cloud — per-word conf    │
                                   └────────────┬─────────────┘
                                                ▼
                                   ┌──────────────────────────┐
                                   │ 6. FIELD EXTRACTION      │
                                   │ GSTIN, inv no, date,     │
                                   │ HSN/SAC, taxable, CGST,  │
                                   │ SGST, IGST, net, lines   │
                                   └────────────┬─────────────┘
                                                ▼
                                   ┌──────────────────────────┐
                                   │ 7. DUPLICATE CHECK (deep)│──► same vendor+inv+amt? WARN
                                   │ fuzzy business key       │
                                   └────────────┬─────────────┘
                                                ▼
                                   ┌──────────────────────────┐
                                   │ 8. CLASSIFY              │
                                   │ memory → fuzzy → cosine  │
                                   │ → n-gram embedding       │
                                   └────────────┬─────────────┘
                                                ▼
                                   ┌──────────────────────────┐
                                   │ 9. HUMAN REVIEW          │  ◄── always available, never skipped
                                   │ edit any field, pick     │      for low-confidence items
                                   │ ledger, request new ldgr │
                                   └────────────┬─────────────┘
                                                ▼
                          ┌─────────────────────┴─────────────────────┐
                          ▼                                           ▼
              ┌────────────────────────┐                  ┌────────────────────────┐
              │ 10. LEARN              │                  │ 11. POST TO TALLY      │
              │ store vendor→ledger,   │                  │ XML → :9000 gateway    │
              │ token→ledger weights   │                  │ or export .xml file    │
              └────────────────────────┘                  └────────────────────────┘
```

---

## 3. Ledger master

Source: `Trial Balance - PESPL.xlsx`, 444 rows, hierarchy encoded as Excel indent levels.

The trial balance flattens Tally's group tree into indentation, and the indents in the export are **not clean** — they jump 0→2→4→3→5 rather than nesting by one. The parser therefore treats indent as a *relative* signal (pop the stack until a strictly smaller indent is found) rather than an absolute depth, which reconstructs the tree correctly despite the noise.

Each ledger row is normalised into:

```json
{
  "name": "Boarding & Lodging Expenses",
  "path": ["Expenses (Indirect)", "ADMINISTRATION EXPENSES", "Boarding & Lodging Expenses"],
  "parent": "ADMINISTRATION EXPENSES",
  "root_group": "Expenses (Indirect)",
  "nature": "expense",
  "is_postable": true,
  "search_text": "boarding lodging expenses administration expenses",
  "aliases": ["hotel", "food", "restaurant", "stay", "accommodation"]
}
```

`nature` is derived from the root group and drives which ledgers are even *candidates* for a purchase voucher — a food bill should never be offered `Equity Shares - Kanta Somani`. This single filter removes ~60% of the search space and is the cheapest accuracy win available.

`is_postable`: rows that are pure group headers (they have children) are not postable. Tally will reject a voucher posted to a group.

**Seed aliases.** Cold-start is the weak point of any learning system, so the ledger master ships with a hand-written alias file mapping common bill vocabulary to PESPL's actual ledger names — `hotel/restaurant/food → Boarding & Lodging Expenses`, `diesel/petrol/fuel → FUEL EXPENSES VEHICLE`, `courier/dtdc/bluedart → Courier Charges`, and so on. Without this, the first few hundred bills all land in the review queue and the team loses faith in the tool before the learning loop has anything to learn from.

---

## 4. Classification — the four-signal ensemble

Candidates are scored by four independent signals, combined with weights. The output is a ranked top-5 with a confidence score, never a silent single answer.

**Signal 1 — Vendor memory (weight 0.50, and it short-circuits).**
A lookup table of `vendor_key → ledger → count`. If "HOTEL SITARA GRAND" was coded to `Boarding & Lodging Expenses` three times before, that is a near-certain answer and it outranks every text signal. Vendor key is the normalised vendor name, with GSTIN used as the primary key when available since it is exact and immune to OCR noise in the name. **This is the single highest-value component of the system** — it is what makes bill #500 take four seconds instead of two minutes.

**Signal 2 — Fuzzy string match (weight 0.20).**
`rapidfuzz` token-set ratio between bill text and ledger name. Handles OCR corruption and word reordering: "Freght Outwrd Chrgs" still matches `Freight Outward` at ~85.

**Signal 3 — TF-IDF cosine similarity (weight 0.20).**
Word-level TF-IDF over the ledger corpus, cosine against the bill's text. IDF weighting is what makes this earn its place: the word "Charges" appears in 15 ledger names and carries almost no information, while "Fumigation" appears in one and is decisive. Fuzzy matching cannot make that distinction; cosine can.

**Signal 4 — Character n-gram embeddings (weight 0.10).**
TF-IDF over character 3–5 grams, cosine. This is the OCR-noise backstop: it matches on sub-word fragments, so "Ele ctricity Chrgs" still lands near `Electricity Charges - Factory` even when whole-word matching fails. Cheap, offline, no model download — `TfidfVectorizer(analyzer='char_wb')` is genuinely all that is needed here.

**Confidence bands and what happens at each:**

| Score | Band | Behaviour |
|---|---|---|
| ≥ 0.85 | High | Pre-filled, green. Clerk confirms with one click. |
| 0.60–0.85 | Medium | Pre-filled, amber, top-5 alternatives shown expanded. |
| 0.35–0.60 | Low | Nothing pre-filled. Suggestions offered, clerk must actively choose. |
| < 0.35 | No match | "No suitable ledger found" → offer **Create Ledger** or **Manual Entry**. |

Auto-posting without human review is **not** enabled in v1 at any confidence level. It becomes reasonable once the vendor memory table shows a sustained ≥98% confirm-rate on a given vendor, and the spec recommends turning it on per-vendor rather than globally.

---

## 5. Self-learning loop

Learning happens on **confirmation**, not on suggestion — the system only learns from what a human accepted or corrected.

Three things are written when a clerk confirms an entry:

1. **Vendor → ledger counter** incremented. Drives Signal 1.
2. **Token → ledger weights** updated. Every meaningful token in the bill text gets its association with the chosen ledger strengthened. This generalises beyond the specific vendor: after enough bills, the token "biryani" points at `Boarding & Lodging Expenses` regardless of which restaurant issued it.
3. **Correction record** written when the clerk overrode the suggestion — logging both what was suggested and what was chosen. This is the training signal *and* the audit trail, and it is what you review monthly to find systematically mis-mapped vendors.

**Layout memory.** Beyond ledger choice, the system fingerprints the bill layout (vendor GSTIN + the geometric arrangement of the OCR text blocks). When a matching layout is seen again, previously-successful extraction regions are applied directly. This is what makes recurring vendors — the same electricity bill every month, the same courier invoice — extract near-perfectly after the third or fourth one, and it is a large part of the answer to "some repeated same type of bill, we can know."

**Guard rails, because a learning system that learns wrong is worse than one that does not learn:**
- A single confirmation never creates a high-confidence rule; three consistent confirmations are needed before a vendor mapping short-circuits.
- A correction immediately decays the previous mapping's weight rather than merely adding to the alternative.
- All learned mappings are visible and editable in a Learned Mappings admin screen. Nothing the system infers is hidden from the finance team.

---

## 6. Duplicate detection — three layers

Duplicate bills are the most expensive error in AP automation, because a duplicate that reaches Tally becomes a duplicate payment. Three layers run at different points:

**Layer 1 — Exact file (at upload, blocking).** SHA-256 of the file bytes. Catches the same file uploaded twice. Instant, zero false positives.

**Layer 2 — Perceptual image hash (at upload, warning).** `phash` with a Hamming distance ≤ 8. Catches the same physical bill photographed twice, or re-saved at different compression. Tolerant of small crop and brightness differences.

**Layer 3 — Business key (after extraction, warning).** The real one. A composite fuzzy match on:

```
vendor_gstin  (exact, if present — strongest)
invoice_no    (normalised: strip spaces, leading zeros, punctuation)
invoice_date  (exact, ±1 day tolerance for OCR date errors)
net_amount    (±1 rupee tolerance for rounding)
```

Scoring is weighted, not all-or-nothing, because OCR will mangle one field. Match on GSTIN + invoice_no alone is enough to flag. Match on amount + date alone is not — that is a legitimate coincidence in a business with many small bills.

Flagged duplicates are **warnings with an override**, never hard blocks. Genuine same-amount-same-day bills from one vendor do occur, and a system that cannot be overridden will be worked around. The override requires a typed reason, which is stored.

---

## 7. Tally integration

**There is no Tally REST API.** TallyPrime exposes an HTTP server on **port 9000** that speaks XML envelopes. This is the officially documented and supported integration path.

### The voucher shape

Confirmed against PESPL's existing books. The ledger `VIJAY KIRAN GAUTARAJ` shows the pattern already in use:

```
17-Apr-26   Travelling Expenses              Journal   Cr 11,662.00
25-Apr-26   Kotak Mahindra Bank - 3214292773 Payment   Dr 11,662.00
```

Two steps. The agent generates **step one only**:

```
Dr  <expense ledger>      the cost lands in P&L
Cr  <person's ledger>     the company now owes the person
```

Step two — settling the person against the bank — stays in the existing payment run, untouched. This is deliberate: reimbursement payments are usually batched and involve a treasury decision about which bank account to draw on, which is not something this agent should be making.

Switch `tally.voucher_type` to `Payment` in config to credit cash/bank directly instead, if a site reimburses immediately from petty cash.

Setup on the Tally machine: `F1 (Help) → Settings → Advanced Configuration → enable HTTP Server`. Tally must be running with the target company open, and the port must be reachable from the app server.

**Reading masters** — `EXPORT` envelope pulling the `Ledger` collection. Run nightly to keep the ledger master in sync, so ledgers created directly in Tally by accountants appear in the dashboard automatically.

**Writing vouchers** — `IMPORTDATA` envelope containing a Purchase voucher:

```xml
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>Vouchers</REPORTNAME>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>Pacific Engineered Surfaces Pvt Ltd- FAB</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </REQUESTDESC>
    <REQUESTDATA>
      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="Purchase" ACTION="Create">
          <DATE>20260629</DATE>
          <NARRATION>Hotel Sitara Grand - staff meals</NARRATION>
          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
          <REFERENCE>7039</REFERENCE>
          <ALLLEDGERENTRIES.LIST>       <!-- Credit: party -->
            <LEDGERNAME>Hotel Sitara Grand</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>2214.00</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>       <!-- Debit: expense -->
            <LEDGERNAME>Boarding &amp; Lodging Expenses</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-2108.28</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>       <!-- Debit: CGST input -->
            <LEDGERNAME>CGST Input</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-52.72</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          ...
        </VOUCHER>
      </TALLYMESSAGE>
    </REQUESTDATA>
  </IMPORTDATA></BODY>
</ENVELOPE>
```

**Sign convention** is the classic trap: in Tally XML, negative `AMOUNT` = debit, positive = credit, and `ISDEEMEDPOSITIVE` must agree with the sign. A voucher whose entries do not sum to zero is silently rejected. The builder asserts balance before transmission.

**Response handling.** Tally returns `<CREATED>1</CREATED>` on success, or `<LINEERROR>` with a message. The most common errors in practice are unknown ledger name (usually a whitespace or `&` mismatch) and company not open. Both are surfaced to the clerk in plain language rather than as raw XML.

**Two modes, config-switchable:**
- `file` — writes `.xml` to a watched folder for an accountant to import. Recommended for the first month.
- `http` — posts directly to `http://<tally-host>:9000`. Flip when the confirm-rate justifies it.

---

## 8. Data model (SQLite for v1, Postgres when multi-user)

| Table | Purpose |
|---|---|
| `bills` | one row per uploaded document: file path, hashes, status, uploader, timestamps |
| `bill_pages` | page images, OCR text, per-page confidence, quality verdict |
| `extractions` | extracted fields with per-field confidence and the OCR span each came from, plus the confirmed ledger / person / amount |
| `ledgers` | ledger master synced from Tally |
| `ledger_aliases` | seed aliases + learned aliases |
| `vendor_memory` | vendor_key → ledger → count, last_seen |
| `token_weights` | token → ledger → weight |
| `layout_memory` | layout fingerprint → extraction regions |
| `corrections` | suggested vs chosen, per field — audit + training signal |
| `duplicates` | flagged pairs, match score, override reason |
| `vouchers` | generated XML, post status, Tally response, voucher no |
| `ledger_requests` | new-ledger requests awaiting approval |

Every table carries `created_at` and `created_by`. Finance systems get audited; retrofitting an audit trail is painful.

---

## 9. Roles

| Role | Can |
|---|---|
| Clerk | Upload, review, edit, submit for approval |
| Approver | Everything a clerk can, plus post to Tally, approve new-ledger requests, override duplicates |
| Admin | Manage ledger sync, view/edit learned mappings, view audit log |

v1 ships with a simple username/password table. Wire to your AD/Google SSO before rolling beyond the pilot group.

---

## 10. Phasing

**Phase 1 — Pilot (this build).** Single company, reimbursement journals only, file-export mode. 3–5 clerks. Goal: accumulate 300–500 confirmed bills to prime the learning tables. Success metric is not accuracy on day one — it is confirm-rate trending upward week over week.

**Phase 2 — Live posting.** Enable HTTP posting for vendors with ≥98% confirm-rate. Add nightly ledger sync from Tally. Add approval workflow.

**Phase 3 — Coverage.** Additional voucher types (vendor purchase invoices with GST input credit, payment, receipt). Multi-company. Email ingestion — bills forwarded to an inbox get processed automatically, which is usually a bigger volume win than the dashboard itself.

**Phase 4 — Other departments.** The ingest → extract → classify → review → post skeleton is department-agnostic. Purchase orders, delivery challans, and HR documents reuse it with a different field extractor and target system.

---

## 11. Honest risk register

| Risk | Mitigation |
|---|---|
| OCR accuracy on photos is genuinely poor | Quality gate + re-upload; train clerks to photograph flat, in good light, on a dark surface. **A one-page photo guide will move accuracy more than any code change.** |
| Handwritten bills | Detected and routed to manual entry. Cloud handwriting OCR is the escape hatch if volume justifies it. |
| Learning system learns a wrong mapping | 3-confirmation threshold, corrections decay old weights, all mappings visible and editable |
| Duplicate slips through | Three independent layers; the business-key layer catches what hashing cannot |
| Tally rejects vouchers | Balance assertion pre-send, ledger names validated against synced master, plain-language errors |
| Clerks bypass the tool | The tool must be *faster* than typing into Tally directly. If it is not, the pilot fails regardless of accuracy. Measure time-per-bill from week one. |
| Ledger master drifts | Nightly sync from Tally, not a one-time import of the trial balance |

---

## 12. What "done" looks like for Phase 1

- A clerk can upload a bill and reach a posted voucher in under 60 seconds for a recognised vendor.
- No duplicate reaches Tally.
- Every field the system filled in can be corrected, and the correction sticks.
- The confirm-rate chart goes up.


---

## 13. Measured results on the sample bills

Everything below was measured against the 11 real pages supplied, not estimated.

**Ledger master.** 443 rows parsed from the trial balance, 323 postable, 196 valid reimbursement targets, 75 carrying seed aliases. Group hierarchy reconstructed correctly despite the export's inconsistent indent levels.

**Learning curve**, same vendor repeated:

| Confirmations | Confidence | Band |
|---|---|---|
| 0 | 52% | low |
| 1 | 70% | medium |
| 2 | 82% | medium |
| 3 | 100% | high |

**Extraction**, page 0 (Hotel Sitara Grand):

| Field | Extracted | On the bill | |
|---|---|---|---|
| Vendor | SITARA GRAND | HOTEL SITARA GRAND | correct |
| Taxable | 2108.28 | 2108.28 | correct |
| CGST | 52.72 | 52.72 | correct |
| SGST | 52.72 | 52.72 | correct |
| **Net** | **2214.00** | **2214.00** | correct — recovered arithmetically after the label collided with the KOT line |

**GSTIN repair**, page 1: OCR read `C6ABCFKOIB7HIZH`; repaired to `36ABCFK0167H1ZH`, matching the bill exactly. Five characters corrected, verified by check digit.

**Duplicate detection**: 8 of 8 test cases classified correctly, including an OCR-mangled invoice number (`INV-07039` vs `7039`) that the first implementation missed.

**Tally XML**: balances to zero, escapes `&` in ledger names, rejects empty ledger, empty person, zero, negative and absurd amounts, and unconfigured Payment mode.

**Known weak spots.** OCR confidence on the supplied photos runs 30–58%; two of eleven pages are correctly routed to re-upload. Vendor name extraction returns the trading name without the "HOTEL" prefix. Service-charge lines are not captured, so bills carrying them fail the arithmetic reconciliation and are flagged for checking rather than silently accepted.
