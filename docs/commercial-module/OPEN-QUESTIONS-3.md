# Commercial module: questions, round three

Collected 2026-09-08 while building your round-two answers in. Your twenty answers are recorded in DECISIONS-2.md with the rule each one set. These are the things those answers opened up: new work you named but did not describe, a list you are still sending, and a few readings I had to make. The module runs on the default in brackets, so nothing waits on them.

## The four logins
1. Please send the four users to create: full name, email and the branch for each. I have the roles ready - Raghav on Commercial Documentation, Setumani on Commercial Executive, Santosh Thapa on Commercial Manager, Murali on Commercial Logistics - but an admin has to create the logins with their email addresses, and I do not have them. [default: nobody is created; the roles exist empty and the one old Commercial login keeps working]
2. That old Commercial login: retire it once the four are in, or leave it as a shared fallback? It currently reaches everything except the planner and the settings. [default: it stays, unchanged, until you say otherwise]
3. Murali approves the order checklist - you told me that on 7 September, before Santosh Thapa was named the manager. Is the approval still Murali's, or the manager's, or either? [default: Murali, the manager and an admin may each approve]

## Work you named that I have not built
4. Barcodes for slabs and cut-to-size before dispatch (Setumani's duty). You offered the format - please send it, with what the label has to carry and what scans it. [default: not built; nothing prints a barcode today]
5. Packing lists for cut-to-size. The module packs SLABS: a packed line is a slab number with its size. A cut-to-size list is pieces cut to a customer's sizes. What does one line look like - piece number, finished size, how many to a crate - and does it have its own number series? [default: slabs only; a cut-to-size order cannot be packed yet]
6. "Dispatch marking, we have to make auto." What should mark it automatically - the dispatch check passing, the invoice being issued, the gate pass, or the truck leaving? Today a person presses Dispatched and the software refuses until the list is clean and the advance is in. [default: stays a button, with the two gates in front of it]
7. Container booking, CHA, price checking, transportation bills, freight bills - Murali's real day. Should any of that become ERP screens after this module settles, or does it stay outside? [default: outside; Murali gets the enquiry, order, client and challan screens]
8. Raghav's BL draft, COO and CEFA, the Daltile portal upload, the TiO2 MOC application, the RFID lock, container pictures, fumigation follow-up, the ETA and Penguin sheets - same question. [default: outside; Raghav gets the invoice, the checklist, the challans and the export documents]

## Numbers I had to choose
9. The advance percentage when an order does not carry its own: I set 100% for domestic (your terms on file read "100% Advance Payment") and 30% for export. Correct, or different numbers? [default: 100 domestic, 30 export, both editable in settings]
10. The advance is counted in the ORDER's currency only - a receipt in another currency is recorded and shown but does not count towards the percentage, because the ERP holds no exchange-rate table. Is that right, or should a rate be entered per receipt? [default: same currency only]
11. The manager's override of the advance is recorded on the ORDER, so it releases every truck on that order. Should it instead be per truck, so a second container still waits for the money? [default: per order, with the reason and the name recorded]
12. "Abrupt" is now a distance in lightness: the previous design at L* 30 or darker, the next at L* 75 or lighter, gets six hours. Those two numbers are a guess until your colour list arrives - tell me if a different pair matches what the plant does. [default: 30 and 75, both editable in settings]

## Readings to confirm
13. The alternate GSTIN prompt: when you answer no, I apply the alternate registration to the invoice alone and leave every other sheet of the workbook on the Pacific Engineered Surfaces GSTIN. Is the invoice the right document to carry it? [default: the invoice alone]
14. The design colour popup takes the colour name and L*a*b* off the sample, shows the hex it derives, and lets you type a hex to overrule it. Is L*a*b* what you read off the instrument, or would you rather type the hex alone? [default: both, with the typed hex winning]
15. The internal order number ORD/26-27/N0001 prints on no customer document - I checked the PI, the DTA invoice and the export workbook and none of them carries one. The PI number is what the customer sees, and "Buyer's PO No." carries theirs. Confirm that is right. [default: internal only]
