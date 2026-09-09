# Commercial module — the owner's round-three answers, 2026-09-09

Answers to `OPEN-QUESTIONS-3.md`, with the rule each one sets and what the
files he sent actually specify. `DECISIONS.md` (31 answers, 2026-09-07) and
`DECISIONS-2.md` (20 answers, 2026-09-08) come first; where they disagree with
this file, this one wins and says so.

---

## 1 — the four logins

| Person | Address | Role | State today |
|---|---|---|---|
| Setumani R | Commercial@pacific-surfaces.com | `COMMERCIAL_EXEC` | to create |
| Santosh Thapa | mis.pespl@thepacific.group | `COMMERCIAL_MANAGER` | **exists** — this is the one live `COMMERCIAL` login |
| Raghav | Docs@pacific-surfaces.com | `COMMERCIAL_DOCS` | to create |
| Murali | customs@pacific-surfaces.com | `COMMERCIAL_LOGISTICS` | to create |

**Rule, and it is an ordering rule.** The three new role values exist in the
database (scripts/0080) but the code on `main` does not know them: `rankOf` of
an unknown role is 0, so a login moved onto one today would lose access to
everything in production. **Nobody is created or re-roled until the module is
deployed.** Then Santosh's existing account changes role, and the other three
are created in Users & Roles — an admin sets the passwords, not the ERP and
not me.

## 2 — the old Commercial login
"Keep commercial, just change to whatever is the new permission and role."
It is Santosh's own account, so it is not retired: `mis.pespl@thepacific.group`
becomes `COMMERCIAL_MANAGER`. The legacy `COMMERCIAL` role then has nobody on
it and its row in the area table stays only as the fallback for a login that
has not been moved yet.

## 3 — who approves the checklist
Still Murali. `approve` = ADMIN, `COMMERCIAL_MANAGER`, `COMMERCIAL_LOGISTICS`,
which is what is already built. No change.

## 4 — the barcode labels
Two labels, both read off the files he sent.

**The crate label** (`Desert Silk Crate BARCODE.docx`) — five lines and a
rendered barcode image:

```
CQBE 101x19.5x2                     item code + size in CM
WINDOW SILLS 101x19.5x2             description + size
BARCODE: 8720847172228              the customer's EAN-13
QUANTITY: 35                        pieces in this crate
SHIPPING DATE: 07-09-2026           dd-mm-yyyy
```

**The piece label** (`DS - Thresholds (103 x 11) -360 PCS.docx`) — one line,
repeated once per piece: `CQBE 103X11X2`. Item code and size, nothing else.

**Rule.** The EAN belongs to the customer's ARTICLE — the design at one size —
not to our slab or our piece, so it is stored per design-and-size and printed
on every crate of it. Twelve distinct articles in that one file. The label is
generated from the packing list: item code, description and size from the
design master and the line, quantity from the crate, shipping date from the
list. The barcode itself is drawn from the EAN (EAN-13, so the check digit is
verifiable and a mistyped code can be refused at entry rather than at the
customer's gate).

**Two things in his file to raise with the customer, not to copy:**
`220x19.5x2` and `220x15x2` carry the SAME EAN `8720847172266`, and
`126x25x2` reads `'8720847172297` with a leading apostrophe — an Excel text
prefix that has leaked onto the printed label.

## 5 — the cut-to-size packing list
Read off the three workbooks. A cut-to-size line is not a slab: it is a PIECE
cut to a customer's size, and the sheets carry these columns —

```
CRATE NO. | DRAWING NO | PIECE NO. | MATERIAL NAME | SIZE L × W | THICK (MM)
          | SQFT | QTY (PCS) | BUILDING | WEIGHT
```

with a totals row per crate and per sheet (sqft, pieces, weight), and a header
block carrying CONSIGNMENT, CONSIGNEE COLOUR NAME, **PACIFIC COLOUR NAME**
(e.g. `CPKT12412A` — our design code, the same master answer 20 created),
PROJECT #, PO and the crate count.

**Rule.** A packing list gains a second kind of line. A slab line stays what it
is; a cut-to-size line carries crate number, drawing number, piece number,
design, length × width, thickness, sqft, quantity, building/room and weight.
Sizes in those sheets are MILLIMETRES despite headers reading "SIZE(Inches)"
and "SIZE(IN CM)" on the same file — the stored unit is explicit and the
printed unit follows `measurementUnit` (answer 17), so the header can never
again disagree with the numbers under it.

## 6 — "dispatch marking, we have to make auto"
"Whatever is reserved should be marked dispatched after deliver / last step."
**Rule.** When the last step completes — delivery — every slab still RESERVED
against that order is moved to DISPATCHED automatically, through
`inventory-bridge`, in one transaction with the delivery, and logged. No
clerk marks slabs one at a time.

## 7 and 8 — Murali's and Raghav's work outside this module
"However much we can incorporate; we will build on it at last." And: "for now
if we cannot add anything we'll add a tickbox, or if we can add more then
we'll add more."
**Rule.** Container booking, CHA, price checking, transport and freight bills;
BL draft, COO and CEFA, the Daltile upload, TiO2, RFID, container pictures,
fumigation, the ETA sheet — each becomes a CHECKLIST LINE on the order with a
tick, a date and a note, so the desk can see what is done without the module
pretending to do it. The ones that are really ours grow into screens later.

## 9 — the advance percentages
"Make it editable too." Already settings (`dispatch.advancePctDomestic` 100,
`advancePctExport` 30) and already per-order (`advance_pct`). Confirmed, and
the settings screen gets the two fields.

## 10 — currency
"Add exchange rate per invoice, manual."
**Rule.** An invoice carries its own exchange rate, typed by hand, and a
receipt in another currency is converted through the rate on the order's
invoice when testing the advance. This replaces DECISIONS-2's "same currency
only" — a receipt in INR against an export PI now counts.

## 11 — the advance waiver, per order or per truck
"Murali or the manager will decide." So it stays a human's call and the waiver
stays where it is — on the ORDER, with the name and the reason recorded.

## 12 — the abrupt-changeover thresholds
Yes: dark at or below L\* 30, light at or above L\* 75, both editable.

## 13 — the alternate GSTIN when the answer is "no"
Yes: it applies to the invoice alone and every other sheet of the workbook
keeps the company's own registration.

## 14 — the design colour popup
Both: L\*a\*b\* read off the sample AND a hex typed by hand, the typed hex
winning. Already built that way.

## 15 — the internal order number
Yes: `ORD/{fy}/N0001` stays internal and prints on no customer document.

---

## What this round adds to the build

- **Two label kinds**, generated from the packing list, with the EAN held per
  design-and-size and validated as EAN-13.
- **Cut-to-size packing lines** beside slab lines, with crate, drawing, piece,
  size in millimetres, sqft, quantity, room and weight, and per-crate totals.
- **Automatic dispatch** of everything still reserved when delivery completes.
- **A checklist of the outside work** — container booking, BL, COO, fumigation
  and the rest — as ticks with a date and a note on the order.
- **A manual exchange rate per invoice**, which also makes a foreign-currency
  receipt count towards the advance.
- The four logins, created only after the module deploys.
