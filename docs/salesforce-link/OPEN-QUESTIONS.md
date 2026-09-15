# Salesforce ↔ ERP: questions, round one

Collected 2026-09-14 from discovery and the design panel. `DESIGN.md` is the
recommended design; `DISCOVERY.md` is what both systems actually hold. Every
question carries a default in brackets and the build runs on it, so nothing waits
on an answer — as with the Commercial rounds, answer only what you want changed.

Two things the panel checked live and that remove work rather than add it: approval
only for a new stand ALREADY exists in the org (a flow from 5 September keys it off
the approver), so no Salesforce approval change is needed; and of the 26 stuck
sales-order rows, only two orders still exist, both zero-value drafts — the rest were
deleted test orders. Question 16 is about those.


## The product master and the stock number
1. Create QZ-<NAME>-30 products in Salesforce for the 59 designs (4,202 AVAILABLE slabs) the yard holds at 30 mm but Salesforce sells only at 20 or 12? The largest body of stock has no product to show against. The ERP can show it as a stock line flagged 'no Salesforce product' and on the sibling product, but only a product can be quoted, and a product implies a price-book entry the ERP knows nothing about. [default: Not created by the ERP. The 30 mm lines are visible and filterable in the ERP Stock search from day one; the admin creates the products from the ERP's CSV when the owner says so, and the next run links them with no code change.]
2. Should the Salesforce slab count exclude sales-unapproved (design, batch) pairs, as a Commercial login's stock check does? Every non-admin path in the ERP hides unapproved pairs; Salesforce's audience is salespeople. Including them would show reps stock the approval screen exists to withhold. [default: Yes — AVAILABLE, whole-slab, sales-approved; the raw total is logged beside it every run so the gap is visible.]
3. What counts as 'in stock' on a product? The formula field drives the in/out flag reps filter on. [default: At least one AVAILABLE slab; a floor such as 5 is one number in the formula.]

## Requests and approval
4. Which request types need approval — New Stand only, as Salesforce routes today, or Stand Top-up as well? Salesforce already routes only New Stand (changed 5 Sept 2026). The ERP enforces whatever Salesforce decides a second time at pack; the choice is one line in the Needs_Approval decision. [default: New Stand only.]
5. Keep free-text requests with the incharge building the shelf lines in the ERP, or make reps pick colour, finish and size from the stock list? The request screen was built for free text on purpose ('the precise item list is the desk's job'); both requests in the org are free text with no items. [default: Free text stays; the incharge builds the lines and the ERP writes them back onto the record; a rep who does pick lines gets them checked automatically.]
6. Add a 'Packed' value to Sample_Dispatch__c.Status__c, or keep it in the new ERP Status field? Three existing flows (status sync to the opportunity, date stamping, activity logging) read Status__c and would meet a value they do not know. [default: Not added; Packed shows in ERP_Status__c and the list view; Sent is written as the existing Dispatched.]
7. Should a New Stand request still Pending approval appear on the incharge's board? He can start finding the stand; the ERP will not let him pack it until Approved. [default: Yes, greyed, 'awaiting approval by <manager>', no pack button.]

## Boxes and stands
8. Stands serial-numbered and tracked to a customer; boxes a plain count? And a stand that comes back: since Sample_Stand__c has no Returned value, should one be added? Sample_Stand__c already carries Serial_No__c and an installed date; a box is packaging. The ERP writes only stand statuses that exist. [default: Serialised stands, counted boxes; no new Salesforce value — a returned stand keeps its last Salesforce status and the incharge decides in the ERP whether it goes back on the shelf or is retired.]

## What happens between the two systems
9. Reserve pieces when a request checks Available, or only count older Available requests against newer ones until pack? No reservation column exists on sampling_stock and stock leaves at release by the module's own rule; a soft count already stops two reps being told the same pieces are theirs. [default: Counted, not reserved — an older Available request is subtracted from a newer one's check; nothing is decremented until the incharge packs, and a held or short request does not count against anyone.]
10. When the rep marks Delivered or Installed in Salesforce, should the ERP's package and stand follow, stamped 'Salesforce' as the person? The sampling board has a Delivered step and the stand register has an installed date; otherwise the two systems disagree at the end of every request. [default: Yes.]
11. A request cancelled in Salesforce after the desk packed it: refused, or allowed with the pieces returned to the shelf automatically? The sampling lifecycle has no undo by an earlier decision; whether pulled pieces come back at full count is a question a person answers. [default: Refused with 'contact the sampling desk'; pieces come back through the intake form by hand with source RETURNED and the request number.]

## Cadence and setup
12. Cadence: 10 minutes for everything, or 5 for requests? A rep sees the ERP's verdict within one cadence; packed and sent land in seconds regardless. Both are one line in vercel.json. [default: 10 minutes.]
13. The integration user's licence: a Salesforce Integration seat or a full user licence? Every ERP write in Salesforce carries this user's name; a person's login must never be used. [default: The Integration licence if the edition has it; the admin confirms under Company Information.]
14. Sandbox first? The first thing that touches production Salesforce should not be able to change a request. [default: Yes if the org has one; otherwise go live in the order Connected App → read-only stock push → requests.]
15. Who holds the Connected App secret? One credential exists and points one way; it must live in exactly two places. [default: The admin creates the app and hands the consumer key and secret to the owner, who sets them in Vercel; nobody else sees them.]

## The stuck sales orders
16. The 26 sales-order rows in Salesforce's integration log, all Pending since a trigger queued them for a middleware nobody built: 24 point at orders that have since been deleted, 2 at zero-value drafts. Should the admin close the 24 as Failed ("Order deleted; no middleware was ever built") so the queue reads truthfully, and should the ERP take on sales orders at all — which needs a decision on how a Salesforce Order maps onto the Commercial module's order before it can be designed? [default: leave all 26 as they are, shown on the ERP's Salesforce status page; sales orders are not part of this build]
