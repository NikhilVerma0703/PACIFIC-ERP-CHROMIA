# Commercial module: the owner's answers (2026-09-07)

The 31 questions in OPEN-QUESTIONS.md were answered by the owner on 2026-09-07. This file is the record the module is now built against; OPEN-QUESTIONS.md is kept for the history of what was asked. Where an answer could be read two ways, the reading taken is stated under it and the doubt is carried to OPEN-QUESTIONS-2.md.

Answers are the owner's words, lightly spelled out. "Rule" is what the software does as a result.

## Process order

**1. Stock check before the PI; the advance is asked for with the PI.**
Rule: the pipeline is CONFIRMED → STOCK_CHECKED → PI_ISSUED. A PI cannot be issued until the order has been stock-checked (`stages.ts` canEnter). The PI carries the advance terms.

**2. Nothing between PO and stock check. Packing and loading can happen before the advance arrives, but the truck does not leave before the advance.**
Rule: the ONE payment gate is at dispatch. `POST …/packing-lists/[id]/dispatch` refuses until an ADVANCE receipt is recorded on the order (see 29). Packing, verification and invoicing are not gated.

**3. A PI is always issued, domestic or export.** Confirmed.

## Numbering

**4. ERP-generated numbers. No relation to Tally.**
Rule: the counters are authoritative. The manual override stays as an escape hatch but is no longer the expected path.

**5. PI numbers reset when the financial year changes.**
Rule: the order/PI counter is per financial year.

**6. Export invoice numbers continue across the year change; the date is printed under the number. DTA is its own sequence. The sequences must be linked at the back end so anything can be traced.**
Reading: "PO number" in the answer means the export invoice number, the subject of the question. Rule: export invoice counter continuous; DTA counter per FY; every invoice carries `order_id` and the order carries its PI, so number → invoice → order → PI is one join.

**7. Delivery challans also reset per financial year.** Confirmed.

**8. Put an N before the number on everything the new ERP issues: N1, N2, … so they are unmistakably different from the old numbers.**
Rule: every generated series carries the N: `SAL-ORD/26-27/N1`, `PESPL/N1`, `PESPL/N1/26-27`, `PESPL/DC/N1/26`, `ENQ/26-27/N1`, `PL/26-27/N1`. Written exactly as the owner wrote it, without zero padding. Counters start at 1 by design; nothing needs aligning with Tally.

## People and roles

**9. New roles for each set of tasks, and a Commercial Manager role. The sets will be defined later.**
Rule now: a `COMMERCIAL_MANAGER` role exists with everything COMMERCIAL can do plus approve, cancel and plan. The per-task roles wait for the sets.

**10. Checked by Raghav (not Pavankumar); approved by Murali. Approval must happen after the PI and before the final invoice.**
Rule: `check` is a write action; `approve` needs ADMIN or COMMERCIAL_MANAGER; `POST …/invoices/[id]/issue` refuses until the order is approved. Raghav and Murali are not ERP logins yet — carried to the new list.

## Stock hold

**11. No extension. When a hold expires the order goes back to the hold step.**
Rule: the extend endpoint is removed. When a hold lapses and the order has no other active hold, the order returns to CONFIRMED with event `hold_expired`, so the stock check has to be done again.

**12. No holds against an enquiry.**
Rule: `POST /holds` with an enquiry reference is refused; the enquiry screen offers no hold.

## Shortage and production planning

**13. When stock is short: an email from Santosh's ID to vmundra, and a private Telegram message to Varun Mundra.**
Rule: `notify.mail` on, to `vmundra@thepacific.group`, sent as the Commercial login (Santosh's SMTP when configured, else the global SMTP); `notify.telegram` on, to a private chat id from `TELEGRAM_COMMERCIAL_CHAT_ID`. Both credentials are outstanding — carried to the new list.

**Production sequence: after a light colour, prefer another light colour; move slowly towards dark and slowly back to light. An abrupt change from dark to light needs 6 hours of cleaning instead of the regular 3. In the planning page an admin can add, remove or edit the hours and the number of slabs. When something planned is reduced, put it on another table showing it was there but not planned, with add-back or remove.**
Rule: every design carries a shade (light / medium / dark, editable in Settings, first guess from the name). The queue shows the cleaning hours between consecutive rows: 3 by default, 6 when the row before is dark and this one is light. Planned hours and planned slabs are editable per row by ADMIN and COMMERCIAL_MANAGER; every edit that reduces the plan is written to `commercial_production_plan_change` and shown in a "not planned" panel with add-back and remove.

**14.** Answered inside 13.

**15. "Produced" is marked by hand. Requests can be edited and deleted manually.**
Rule: edit and delete on a production request; the received-since-request count stays as a hint.

## Packing and dispatch

**16. Both slab-number columns exist. The customer's prints when filled; ours always.** Confirmed.

**17. Domestic documents show 347 × 201; dispatch records show 137 × 79. Have an edit option to switch a size from cm to inches and to change the numbers.**
Reading: printed documents default to centimetres (the CIOT sheet's own unit); the ERP's finished-goods record stays in inches; the operator can switch a packing list to inches and edit any slab's figures. Rule: `commercial_packing_list.measurement_unit` (cm | in, default cm) drives the packing and measurement lists; per-slab measured values are editable, as before.

**18. One PI has one packing list, which may hold several colours, batches, crates and containers. One PI has one invoice.**
Reading: "W invoice" is "one invoice". Rule: a second packing list or a second invoice on an order is refused while the first exists and is not cancelled. Containers and crates are many-per-list.

## Documents

**19. All export sheets generated automatically, editable, for starters.** Confirmed.

**20. Customer codes are auto-generated; each design has its own code. The owner will supply the codes per design.**
Rule: a design-code master (`commercial_design_code`), editable in Settings, is the source of the item code on order lines and export documents. It ships empty; the owner's codes go in when they arrive.

**21. A dropdown to choose which GSTIN prints, defaulting to PESPL's.**
Rule: Settings holds the alternates (PGI's 33AAFCP5374A1ZQ seeded); the export document form has the dropdown; default is PESPL's 33AALCP2750N1Z3.

**22. Domestic tax is always IGST 18%.**
Rule: `tax.alwaysIgst = true`; the buyer's state is not consulted. The CGST+SGST path stays in the code behind that switch.

**23. ICICI on domestic, Kotak on international, with a dropdown to change it.**
Rule: the bank is a selector on the PI and on the invoice, defaulted by kind.

**24. A PI number is valid forever. A revision gets a brand-new number and the old one is discarded. Cancellation only by an admin or the Commercial Manager.**
Rule: `valid_until` is not set. Issuing a revision cancels the current PI and issues a new number from the PI counter; the order keeps its own number. `cancel` needs ADMIN or COMMERCIAL_MANAGER. Cancelled PIs stay in the register marked cancelled.

**25. Four labelled copies of the challan.** Confirmed.

## Enquiry

**26. Reading the mailbox automatically is wanted; the way to do it is to be decided and then built. Manual logging stays.**
Rule now: manual. Carried forward as a design item.

**27. Keep the enquiry number in the back end if required.**
Rule: generated and stored, not surfaced to the customer.

## Scope edges

**28. Free-text lines for now, with quantity and HSN per line.** Confirmed.

**29. Yes, record advance and CAD receipts.**
Rule: `commercial_receipt` on the order (kind ADVANCE / CAD / BALANCE / OTHER, amount, currency, date, mode, reference). The first ADVANCE receipt is what opens dispatch (see 2).

## Raised by the review

**30. Dispatch refuses. Recovery is by hand: the refused slab is swappable.**
Rule: on a FINAL packing list a write user can swap one slab for another; the list stays FINAL and is logged.

**31. Nothing ships until the list is corrected.** Confirmed.
