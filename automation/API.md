# Finance Engine API — for the Next.js ERP

Base URL: `http://<engine-host>:8080/api/v1`

## How the two systems divide up

| | Next.js ERP | This engine |
|---|---|---|
| Login, roles, screens | ✅ | — |
| Bill images | — | ✅ stores and serves them |
| OCR, classification, learning | — | ✅ |
| Duplicate detection | — | ✅ |
| Tally XML generation | — | ✅ |
| Database | its own | its own (SQLite) |

The ERP stores **nothing** about bills. It holds bill ids and renders what the engine returns.

## Auth

Every request needs two headers, sent from your **server** (never the browser — the key must not reach client-side JS):

```
X-API-Key: <api.key from config.yaml>
X-User:    <the logged-in ERP username>
```

`X-User` is recorded against every confirmation, override and export. That's what makes the audit trail read "SHALMAN approved this" rather than "the system did".

Generate a key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Put it in `config.yaml` under `api.key`, and in your Next.js env as `FINANCE_ENGINE_KEY`.

### Suggested wrapper

```ts
// lib/finance-engine.ts  — server-side only
const BASE = process.env.FINANCE_ENGINE_URL!;   // http://10.0.0.5:8080/api/v1
const KEY  = process.env.FINANCE_ENGINE_KEY!;

export async function engine(path: string, user: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "X-API-Key": KEY,
      "X-User": user,
      ...(init.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Engine ${res.status}: ${await res.text()}`);
  return res.json();
}
```

## Conventions

- All responses are JSON, **including errors** — you never have to parse an HTML error page.
- Money is always a number. Formatting (₹, Indian digit grouping) is the UI's job.
- Dates on the wire are ISO `YYYY-MM-DD`. Tally's formats stay behind this boundary.
- GETs never mutate anything, so they're safe to retry.

---

# The flow

```
pick person → upload → poll → review & confirm → select approved → preview → export → import to Tally
```

## 1. Pick the person — before uploading

```http
GET /people?q=vij
→ { "people": ["VIJAY KIRAN GAUTARAJ", ...], "total": 335 }
```

The list comes from the ledgers under `SUNDRY CRS FOR SUNDRY EXPENSES` in Tally, so a name chosen here always exists and the import can't fail on it.

**The person is never read off the bill.** A restaurant receipt doesn't record who paid for it. Pick the person, then upload their whole stack.

## 2. Upload

```http
POST /bills          (multipart/form-data)
  person: "VIJAY KIRAN GAUTARAJ"
  files:  <one or more PDFs / images>
  handwritten: false        (optional hint)

→ {
    "batch_id": "a1b2c3d4e5f6",
    "bill_ids": [412, 413, 414],
    "count": 3,
    "rejected": [],
    "poll": "/api/v1/batches/a1b2c3d4e5f6"
  }
```

Returns in well under a second — OCR runs in the background.

**`bill_ids` is usually longer than `files`.** An 11-page PDF of receipts becomes 11 bills, because each page is a separate claim with its own ledger and amount.

One unreadable file doesn't lose the rest of the stack; it appears in `rejected`.

## 3. Poll while OCR runs

```http
GET /batches/{batch_id}
→ {
    "person": "VIJAY KIRAN GAUTARAJ",
    "total": 3, "done": 2, "finished": false, "sum": 1450.0,
    "bills": [{
      "id": 412, "status": "review", "vendor": "Hotel Sangam",
      "amount": 250.0, "date": "2026-07-30",
      "ledger": "Boarding & Lodging Expenses",
      "ledger_confirmed": false,
      "confidence": 88,
      "suggestion": { "ledger": "Boarding & Lodging Expenses",
                      "score": 0.91, "band": "high" },
      "auto_approved": false, "exported": false
    }]
  }
```

Poll every 1–2s until `finished`. Roughly 2 seconds per page.

Show a per-page loader — a 20-page PDF takes ~40s and users need to see movement.

### Bill statuses

| status | meaning | ERP should |
|---|---|---|
| `queued`, `processing` | OCR pending | show a spinner |
| `review` | read, suggestion ready | show the review screen |
| `manual_entry` | OCR too weak to suggest | open the form empty |
| `needs_reupload` | unusable photograph | ask for a better scan |
| `duplicate` | matches an earlier bill | block, offer override |
| `approved` | confirmed, ready to export | include in the batch |
| `posted` | in an exported XML | read-only |
| `rejected` | not a company expense | archive |
| `error` | processing failed | show `error` |

### Bands — what to do with a suggestion

| band | score | UI |
|---|---|---|
| `high` | ≥ 0.85 | pre-fill, one-click confirm |
| `medium` | ≥ 0.60 | pre-fill, show alternatives |
| `low` | ≥ 0.35 | pre-fill but open the picker |
| `none` | < 0.35 | don't pre-fill |

Always pre-fill the top suggestion regardless, with a **Change** button — that was a deliberate UX decision, since making clerks choose from scratch on every bill is what kills adoption.

## 4. Review one bill

```http
GET /bills/{id}
→ {
    "person": "VIJAY KIRAN GAUTARAJ",
    "status": "review",
    "image_url": "/api/v1/bills/412/image",
    "ocr": { "confidence": 88, "text": "HOTEL SANGAM...", "reasons": [] },
    "extracted": {
      "vendor": "Hotel Sangam", "gstin": "33AAACT2727Q1ZW",
      "invoice_no": "INV/4421", "date": "2026-07-30",
      "taxable": 211.86, "cgst": 19.07, "sgst": 19.07,
      "amount": 250.0, "arithmetic_ok": true,
      "fields": { "net_amount": { "confidence": 0.94, "source": "total label" } }
    },
    "suggestions": [ { "ledger": "...", "score": 0.91, "band": "high",
                       "reasons": ["seen 4 times for this vendor"] } ],
    "duplicates": [],
    "export": null
  }
```

Two things worth surfacing in your UI:

- **`ocr.text`** — when a suggestion is wrong, the clerk can see instantly whether the OCR misread the bill or the classifier misjudged good text. Those need different fixes.
- **`extracted.arithmetic_ok`** — true means taxable + CGST + SGST reconciles to the total, so the amount is arithmetically verified, not just read.

Embed the image straight from `image_url` (proxy it through your server so the API key stays server-side).

## 5. Ledger picker

```http
GET /ledgers?q=trav              → search
GET /ledgers?person=VIJAY...     → what THIS person has claimed before
GET /ledgers                     → most-used company-wide
```

With no query it returns the person's own history first — for a driver that's fuel and tolls, which is usually the answer before anyone types.

## 6. Confirm

```http
POST /bills/{id}/confirm
{
  "ledger": "Boarding & Lodging Expenses",
  "person": "VIJAY KIRAN GAUTARAJ",
  "amount": 250.0,
  "date": "2026-07-30",          // optional
  "narration": ""                // optional
}
→ { "ok": true, "status": "approved" }
```

Every confirmation feeds vendor memory, person memory and token weights. **This is how the system gets smarter** — the tenth bill from a vendor lands on the right ledger without anyone choosing it.

Errors: `400` bad ledger/person/amount · `404` unknown bill · `409` already exported (can't edit a bill whose voucher is in Tally).

### Duplicates

If `duplicates` is non-empty, block confirmation and offer an override:

```http
POST /bills/{id}/override-duplicate
{ "reason": "genuinely ate there twice that week" }
```

A reason of 4+ characters is mandatory and is stored with the username. The bill returns to `review`, not straight to `approved` — a duplicate payment is real money.

### Reject

```http
POST /bills/{id}/reject
{ "reason": "personal expense" }
```

## 7. List what's ready

```http
GET /bills?status=approved&exported=false&limit=100
GET /bills?person=VIJAY%20KIRAN%20GAUTARAJ
GET /bills?status=review,manual_entry
```

Returns `{ bills, total, limit, offset }`.

## 8. Preview the export — always do this first

```http
POST /export/preview
{ "bill_ids": [412, 413, 414] }

→ {
    "requested": 3, "vouchers": 3, "total": 1450.0,
    "new_ledgers": [
      { "name": "ZZ New Head", "parent": "ADMINISTRATION EXPENSES" }
    ],
    "skipped": [ { "bill_id": 414,
                   "reasons": ["already exported to Tally in an earlier batch"] } ],
    "voucher_numbers": [ { "bill_id": 412, "voucher_no": "REIMB/26-27/00412" } ]
  }
```

Changes nothing. This is the last point at which a mistake is cheap — once the XML is in Tally, unwinding it is manual work in someone's evening.

**Show `new_ledgers` prominently.** Those ledgers will be created in the live chart of accounts. Someone should agree to that before it happens.

## 9. Export

```http
POST /export
{ "bill_ids": [412, 413] }

→ {
    "ok": true, "ref": "reimbursements_20260730_1412",
    "vouchers": 2, "total": 1200.0,
    "download_url": "/api/v1/exports/reimbursements_20260730_1412/download",
    "import_instructions": [...]
  }
```

Produces **one XML** for the whole batch — 2 bills or 200. New ledgers are emitted first, then every voucher, so a single import creates masters and vouchers together.

Bills move to `posted` and are permanently excluded from later batches.

```http
GET /exports/{ref}/download              → the XML to import
GET /exports/{ref}/download?fmt=xlsx     → review sheet, NOT importable
GET /exports/{ref}                       → what's in it
GET /exports                             → history
```

The `.xlsx` is for humans to eyeball. Tally's Excel import can't create masters, so importing it would fail confusingly on any batch with a new ledger. Label it clearly in your UI.

## 10. Import into Tally, then confirm

The clerk copies the XML to the Tally machine and imports it:

**`O: Import → Transactions`** → full path to the `.xml` → Enter → check **Errors : 0**

Then:

```http
POST /exports/{ref}/mark-imported
{ "note": "Created : 2  Errors : 0" }
```

Deliberately a human confirmation. In file mode the engine never learns the outcome by itself, and showing exports as "in Tally" when nobody checked would make your records confidently wrong — worse than showing nothing.

---

# Duplicate protection — read this

The batch posts under Tally's **standard Journal** voucher type. Verified on PESPL's live data: **Tally does not reject a re-import.** Five imports of one test file produced ten vouchers without a single complaint.

So there are exactly two defences, both on this side:

1. **Bill-level** — `dedupe.enabled` in config.yaml catches the same bill submitted twice (file hash, image hash, and vendor+amount+date fuzzy match).
2. **Export-level** — the `exports` table. A bill that has been exported is excluded from every later batch with a stated reason, and can no longer be edited.

Neither stops a human re-importing yesterday's XML file into Tally. Nothing on this side can. Mitigate operationally: import once, mark it imported, then move the file out of the import folder.

> `dedupe.enabled` is currently `false` for OCR testing. **Set it to `true` before real bills flow.**

---

# Supporting endpoints

```http
GET  /health              engine status, ledger count, counts by status
GET  /insights            accuracy, correction hotspots, learning coverage
GET  /events?limit=50     the agent's journal — what it did unprompted
POST /ledger-requests     ask an owner to create a ledger properly
```

`/health` is worth putting on an ERP admin page — it reports whether dedupe is on and how many bills await review.

---

# Scope

This engine handles **staff spend bills only** — someone paid out of pocket and gets reimbursed:

```
Dr  <expense head>
Cr  <the person>
```

Vendor purchase bills are a different agent: party ledger instead of a person, GST input credit split across CGST/SGST/IGST ledgers, invoice number and date as legal fields, HSN codes, and they post as **Purchase**, not Journal. Don't route them here.

Coming next: the **payment run** — settling these accrued claims against the bank as Tally `Payment` vouchers.
