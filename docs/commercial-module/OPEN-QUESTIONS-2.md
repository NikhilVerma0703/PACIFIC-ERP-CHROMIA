# Commercial module: questions, round two

Collected 2026-09-07 while building your 31 answers in. Each one either needs something only you have (a login, a list, a credential) or checks a reading I had to make of an answer. The module ships with the default in brackets, so nothing is blocked; answering one switches that rule.

## People and logins
1. Raghav and Murali: do they have ERP logins yet, and which is which? I read Raghav as the Commercial user who prepares the checklist and Murali as the new Commercial Manager who approves it. If neither has a login, an admin creates them in Users & Roles (Office branch, role Commercial / Commercial Manager). [default: the one existing Commercial login keeps preparing; the manager role exists with nobody in it until a user is created]
2. You mentioned "new roles for each set of tasks" beside the manager. Which tasks belong together (for example enquiries + orders, stock + planning, packing, invoices)? Each set becomes one role that sees only its screens. [default: two roles only - Commercial does everything except plan, approve and cancel; Commercial Manager does those too]
3. The shortage mail is to go "from Santosh's ID". Is Santosh the Commercial login? His mailbox's SMTP details (server, user, password) have to be entered on his ERP user before mail can leave in his name. [default: until then it goes from the ERP's own mail account, still addressed to you]
4. vmundra@thepacific.group is not an ERP user; is a plain recipient address fine, and does anyone else get the shortage mail? [default: that address only]
5. The private Telegram to Varun Mundra needs his personal chat id with the ERP bot (he messages the bot once, we read the id). Who does that, and when? [default: no private message until it is set; the shortage still lands on the Production Planning page]
6. Still open from the first list: which role is the dispatch team that physically checks slabs - the existing Store Incharge role or a new Dispatch role with its own tablet login? [default: Store Incharge and the Line Manager can verify]

## Numbering
7. The N prefix: N1, N2 ... N1404 with no zero padding - confirm that is what you want, rather than N0001. [default: no padding]
8. Cancelled PI numbers (a revised PI cancels the old number): should they stay visible in the PI register, marked cancelled with the replacement number beside them, or be hidden? [default: visible, struck through, with the new number]
9. A reading check on answer 6: I took "PO number continues even when the year changes" to mean the export invoice number (PESPL/N...). Confirm, or tell me which number you meant. [default: export invoice runs on across years; everything else resets each financial year]
10. Does the internal order number (ORD/26-27/N1) print anywhere the customer sees, or only the PI number? [default: internal only; the customer sees the PI number]

## Money and the dispatch gate
11. Answer 2 says the truck does not leave before the advance. Does ANY recorded advance open dispatch, or must it reach the PI's advance percentage? [default: any recorded advance of any amount]
12. Orders on CAD or LC terms have no advance. Who may let those trucks leave, and how - the manager recording a receipt of kind "CAD/LC terms", or an admin override? [default: only a receipt of kind ADVANCE opens dispatch, so today a CAD or LC order cannot be dispatched at all - this needs your answer before the first such order]
13. Should the receipt log carry the currency of the order only, or may an advance be recorded in INR against an export PI? [default: any currency, the order's is pre-filled]

## Production planning
14. What counts as an "abrupt" change that needs 6 hours of cleaning: only dark to light, or also medium to light and dark to medium? [default: only dark to light gets 6 hours; every other change gets 3]
15. The design list with each design's code and shade (light / medium / dark): please send it. Until then the shade is guessed from the design name and shown as "unconfirmed", and lines print the design name where a code is missing. [default: guessed from the name; no code]
16. Who may edit the planned hours and slabs - answer 13 says "only for admin". I have let the Commercial Manager do it too, as the office-side admin of this module. Confirm or restrict to admins. [default: admin and Commercial Manager]

## Documents
17. A reading check on answer 18: "1 PI has W invoice" - I read W as ONE: one PI, one packing list, one invoice. Confirm. [default: one of each; a second is refused until the first is cancelled]
18. A reading check on answer 17: the measurement list defaults to centimetres (347 x 201) with a switch to inches (137 x 79) and hand-editable numbers. Confirm the default unit. [default: cm]
19. When the alternate GSTIN (Pacific Granites) is chosen on an export invoice, does it apply to every sheet of the export workbook or only the packing list? [default: every sheet of that invoice]
20. The bank chosen on the PI and the bank on the final invoice: may they differ, or must the invoice follow the PI? [default: chosen independently, both default by order kind - Kotak export, ICICI domestic]
