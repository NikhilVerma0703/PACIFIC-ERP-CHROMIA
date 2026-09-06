# Commercial module: questions only the owner can answer

Collected 2026-09-05/06 while designing and building the module. Each one changes a rule in the software, so the module ships with a safe default (in brackets) that can be switched once answered.

## Process order
1. Does the stock check happen before the PI is issued, or after the PI and the advance? Is there anything between PO and stock check (order confirmation, credit approval)? [default: no fixed order; every stage can be entered whenever, all stamped and logged — `lib/commercial/stages.ts` canEnter]
2. Does any payment gate any step: can packing or dispatch start before the advance is received? [default: no gate; payment is not recorded by this module yet]
3. Is a PI always issued, even for domestic orders like JB Homes? Its DTA invoice references PI SAL-ORD/25-26/01416, so it looks like yes. [default: yes for both]

## Numbering
4. Who issues SAL-ORD/25-26/NNNNN (PI) and PESPL/NNNN (invoice): Tally, or the ERP with Tally following? These look like Tally voucher numbers and the finance module already imports Tally XML. [default: ERP issues in the same format; every number has a manual override; counters are editable in Settings]
5. The FY label in the PI number rolls on 1 April. Does the sequence restart each year, or continue (01404, 01416, 01477 look continuous, and July-2026 documents still say 25-26)? [default: continuous sequence, FY label from the document date]
6. Export invoices are PESPL/2780 with no year; DTA invoices are PESPL/0137/26-27 with a year. Two separate sequences? [default: two sequences, DTA restarts each FY]
7. Delivery challans PESPL/DC/20/26: per calendar year or per FY? [default: per FY, printed with the two-digit calendar year]
8. What is the CURRENT next number for each series, so the counters can be set before the first live document? [default: counters start at 1 until set in Settings]

## People and roles
9. Which ERP role is the dispatch team that physically checks slabs: the existing STORE role (3 shop-floor logins, only Thiru active) or a new DISPATCH role? Do they need a tablet on the floor? [default: STORE and LINE_MANAGER can verify; COMMERCIAL can too until the team has logins]
10. Who approves the internal sales order checklist (the SOP sheet shows Checked by Pavankumar, Approved by Murali)? Must approval precede the hold or the PI? [default: any Commercial user checks and approves; nothing is blocked]

## Stock hold
11. The hold is 5 days from placement. Can Commercial extend it, how often, and what happens on expiry: silent release, or a notice to Commercial? [default: extendable; expiry releases silently and is shown on the order and the dashboard]
12. Can a hold be placed against an enquiry before there is an order? [default: yes, reference = enquiry number]

## Shortage and production planning
13. When stock is short, who is told and where: Telegram group, email, both? Which people? [default: lands on the Production Planning page only; both channels off in Settings]
14. Cleaning between designs: a fixed table (light to dark needs X, dark to light needs Y) or decided per run? [default: free-text note per queued request]
15. Should "produced" be marked by hand, or detected when finished goods receive enough slabs of that design and thickness after the request date? [default: by hand, with the ERP showing the count received since the request as a hint]

## Packing and dispatch
16. Which customers want their own slab numbering and same-batch grouping? Should the customer-facing number print on the measurement list, or only ours? [default: both columns exist; the customer's prints when filled, ours always]
17. The measurement list gives cm (347 × 201) but the ERP stores inches (137 × 79, nominal on nearly every slab). Confirm cm = inches × 2.54 rounded, and that 10.764 sqft per sqm is the factor to keep (it is what the sheets use). [default: exactly that; measured cm can be typed per slab]
18. Under one PI there can be several packing lists, containers and invoices? The ERP shows 116 slabs dispatched under PI 1477 across 8 to 20 August while invoice PESPL/2780 covers 47. [default: one order, many packing lists and invoices]

## Documents
19. Which export sheets must the ERP generate and which stay manual: Annexure C1, Annex D, VGM, PL-852? [default: all 14 sheets generated from the same root variables]
20. What are the "Cust-Inv" and "Cust-PL" copies where the consignee shows as a code like USA-041, and who receives them? [default: generated as-is with the customer code as an input]
21. The export packing list and invoice sheets print GSTIN 33AAFCP5374A1ZQ under the PESPL name. That GSTIN belongs to Pacific Granites (India) Pvt Ltd; PESPL's is 33AALCP2750N1Z3 (on the PI, the DTA invoice and the challan). Is the export template carrying the sister company's GSTIN by mistake, or are exports declared under PGI's registration? [default: PESPL's GSTIN on every document; the workbook root variable can be overridden]
22. Domestic tax: always IGST 18 percent? A Tamil Nadu buyer would need CGST 9 + SGST 9. Any exempt or SEZ buyers? Both HSN 68101990 (quartz) and 73089050 (display stand) at 18? [default: IGST when the buyer's state code differs from 33, else CGST + SGST; both HSN at 18]
23. Which bank prints on domestic invoices: ICICI 020405012473 (the JB Homes reference) or Kotak 3214292773 (the PI and the challan)? [default: ICICI on DTA, Kotak on PI/export/challan]
24. PI validity and revision policy: how long is a PI valid, and does a revision get a new number or a suffix? [default: 30 days; a revision keeps the number with -R1, -R2]
25. The delivery challan's four copy labels sit outside the print area on the reference sheet and never print. Should each copy carry its label? [default: yes, four pages, each labelled]

## Enquiry
26. Should the ERP read the commercial mailbox automatically, or is manual logging fine for now? [default: manual]
27. Does an enquiry need its own number for reference back to the customer? [default: ENQ/26-27/NNNN]

## Scope edges
28. Are free trade samples and display stands stock items to be tracked, or free-text lines? [default: free-text lines with quantity, HSN per line]
29. Should the module record advance and CAD receipts, or is that Finance and Tally only? [default: not recorded here]

## Raised by the review (2026-09-06)
30. A packing list is FINAL and one of its slabs is then genuinely cut to size by fabrication. Dispatch now correctly refuses to ship it, but a final list cannot be edited, so the shipment is stuck. Should a final list be reopenable by an admin, should the refused slab be swappable in place, or should the list be cancelled and rebuilt? [default: dispatch refuses and names the slab; recovery is by hand until you decide]
31. When a dispatch is refused because one slab is no longer shippable, should the rest of the container go without it, or does nothing ship until the list is corrected? [default: nothing ships; the refusal names every slab and the order is not advanced]
