# Commercial module — the owner's round-two answers, 2026-09-08

Answers to `OPEN-QUESTIONS-2.md`, with the rule each one sets. `DECISIONS.md`
holds the first 31 answers of 2026-09-07; where the two disagree, this file
wins and says so.

---

## 1 and 2 — the desk, person by person

There is one Commercial login today and it is not enough. The owner named four
people and asked for "new roles for each set of tasks … one role that sees only
its screens". The roles are named for the desk, not the person.

| Person | Role | What this module gives them |
|---|---|---|
| Raghav | `COMMERCIAL_DOCS` — Commercial Documentation | The invoice, the order checklist, the delivery challans, the export documents. He reads an order and its packing list; he does not edit them. |
| Setumani | `COMMERCIAL_EXEC` — Commercial Executive | Everything Raghav has, plus the stock check, the PI, the packing lists and the dispatch marking. |
| Santosh Thapa | `COMMERCIAL_MANAGER` — Commercial Manager | All access, except the production planner (answer 16) and the settings form. |
| Murali | `COMMERCIAL_LOGISTICS` — Commercial Logistics | Enquiries, orders, clients, challans, and the checklist **approval** (2026-09-07 answer 10, "approved by Murali"). |

Most of Raghav's day is outside this module: the BL draft, COO and CEFA, the
Daltile portal, the TiO2 MOC application, the RFID lock, container pictures,
fumigation follow-up, the ETA and Penguin sheets. Murali's container booking,
CHA, price checking and the transport and freight bills are outside it too.
Nothing here tries to model them.

**Rule:** `lib/commercial/access-rules.ts` gains an AREA table beside the action
table. Middleware asks the area question for every path in the module, so a
screen a login was not given is refused whether or not its route names its
area. The old `COMMERCIAL` role keeps exactly what it had, so nobody is locked
out the day this deploys.

## 3 — Santosh's SMTP
Set up at the end. Until then the shortage mail leaves from the ERP's own
account, still addressed to the owner.

## 4 — the mail recipient
`vmundra@thepacific.group` as a plain recipient is fine. He has an admin login
as well. No other recipient.

## 5 — Telegram
Leave it for now. **Rule:** `notify.telegram` ships **off**. The private-chat
plumbing stays in the code behind the switch.

## 6 — the dispatch team
No new role. They sign in as they do now and get one tab. They work in bay 5.
**Rule:** `DISPATCH_CHECKER_ROLES` is unchanged, and the area table gives that
actor `dispatchCheck` and nothing else. Their landing page is that tab.

## 7 — the N prefix
`N0001`, not `N1`. **Rule:** every template pads to four digits, `N{seq:4}`. A
number longer than the pad is never truncated, so N1404 stays N1404.

## 8 — a cancelled PI number
Visible in the register, struck through, with the replacement number beside it.
Cancelling asks for a reason and the register shows it.
**Rule:** `commercial_proforma.replaced_by_id` (scripts/0080) links the
cancelled PI to the one issued in its place; the cancel action requires a
reason.

## 9 — which series runs on
The export invoice runs across financial years. Everything else resets.
Unchanged from what was built.

## 10 — the internal order number
"See the given docs. If it is there then print, else no."
**Checked, and it is not there.** The reference documents carry two numbers and
neither is ours: the PI prints `Invoice No: SAL-ORD/25-26/01404` and, beside
it, `Buyer's PO No: 10053` — the customer's own number. The DTA invoice's
"PO No. & Date" cell carries the PI number again. Nothing carries an internal
ERP order number.
**Rule:** `ORD/{fy}/N0001` stays internal. It appears on our screens and on no
customer document.

## 11 — how much advance opens dispatch
It must reach the PI's advance percentage.
**Rule:** the order carries `advance_pct`; the gate compares the ADVANCE
receipts recorded against that share of the order total. With no percentage on
the order the settings default applies: 100% domestic, 30% export — the
domestic terms on file read "100% Advance Payment". Both are settings fields.

## 12 — a truck with no advance
The manager may let it go by overriding the advance rule.
**Rule:** `advance_waived_at / _by_id / _by_name / _reason` on the order, set by
`commercialGate("cancel")` — the manager and an admin — always with a reason,
always logged. The waiver satisfies the dispatch gate and shows on the order.

## 13 — the currency of a receipt
Any currency; the order's is pre-filled. Already built.

## 14 — what "abrupt" means
"Sudden very dark like Alabaster Noir, to super white."
**Rule:** it is a distance, not a category. A changeover is abrupt when the
previous design's L\* is at or below `planning.darkMaxL` (30) and the next one's
is at or above `planning.lightMinL` (75). Both are settings. A design with no
colour on file falls back to its LIGHT/MEDIUM/DARK label.

## 15 — how a design gets its colour
A popup on the design master: the colour name and the L\*a\*b\* read off the
sample, from which the ERP derives a hue and a hex; the owner may overrule the
hex by hand, and that is what decides.
**Rule:** `colour_name`, `lab_l`, `lab_a`, `lab_b`, `hex` on
`commercial_design_code` (scripts/0080). L\* drives the sequencing; the hex is
the swatch. A hand-typed hex wins over the derived one.

## 16 — who edits the planned hours and slabs
Only the admin. The Commercial Manager does not see the planner as of now.
**Rule:** the `plan` action is ADMIN alone, and `planning` is `none` for every
other actor including the manager. This **overrides** the 2026-09-07 reading
that admitted the manager. There is one admin login and it spans Office,
International Sales and the shop floor.

## 17 — one PI, one invoice
Confirmed. Already built.

## 18 — the measurement unit
Centimetres by default, with the inch toggle. Confirmed.

## 19 — the alternate GSTIN on an export workbook
Prompt, then apply. Yes applies it to every sheet; no applies it to that
document alone.
**Rule:** choosing an alternate GSTIN asks once; the answer rides in the
invoice snapshot as `gstinApplyAll`.

## 20 — the bank on the PI and on the invoice
They should be the same. The Commercial Manager may change it.
**Rule:** an invoice inherits the PI's `bankKey` and the field is read-only
below manager level; the manager may change it, and the change is logged.

---

## Still open after this round
Written up as `OPEN-QUESTIONS-3.md`:

- The slab and cut-to-size **barcode** format (Setumani's duty, format to come).
- **Cut-to-size packing lists** — the module packs slabs today.
- What "**dispatch marking, we have to make auto**" should key off.
- The design **code and colour list** itself.
- Whether 100% / 30% are the right default advance percentages.
