# Pacific ERP ↔ Salesforce — work for the Salesforce administrator

**For: the Pacific Salesforce System Administrator (and any AI assistant helping them).**
**From: the Pacific ERP team.**
**Date: 2026-09-16.**

Everything in this document happens **inside Salesforce**. Nothing here touches
the ERP or its hosting — that side is ours and we will do it from the output you
give back. You do not need access to the ERP, to Vercel, or to the database.

Work in a **sandbox first** if the org has one, and tell us; we will point the
ERP at `test.salesforce.com` until you promote. If there is no sandbox, do
Stages 1 and 2 only, tell us, and stop — the first thing that touches production
must not be able to change a customer-facing record.

---

## What we are building, in three sentences

Salesforce keeps the **product master** and the **sample requests**. The ERP
keeps the **stock** — 25,808 slabs, the sample shelf, and the boxes and display
stands. The ERP will push stock into Salesforce every ten minutes so a rep can
see what is available before promising it, and will pick up sample requests reps
raise, check them against real stock, and report back.

**The ERP only ever writes fields whose names start with `ERP_`,** plus two
specific exceptions called out in Stage 4. It never deletes anything.

---

## Stage 1 — the way in (do this first; everything waits on it)

### 1.1 Integration user

Create a user named **ERP Integration**, username `erp.integration@<your org domain>`.

- Licence: a **Salesforce Integration** licence if the edition has them. If it
  does not, a full licence. **Tell us which you used.**
- Profile: *Minimum Access – API Only Integrations*, or the nearest equivalent.
- No UI login. Do not set login hours or IP ranges on it.
- Nobody logs in as this user, ever. Every ERP write in Salesforce will carry
  its name, which is the point — so that a person's login is never used.

### 1.2 Permission set "ERP Integration"

Create it and assign it to that user. It needs:

| Object | Access |
|---|---|
| `Product2` | Read, Edit — including the five new fields in Stage 2 |
| `ERP_Stock__c` | Create, Read, Edit, **View All**. **No Delete.** |
| `Sample_Dispatch__c` | Read, Edit, View All, **Modify All** |
| `Sample_Dispatch_Item__c` | Create, Read, Edit |
| `Sample_Stand__c` | Create, Read, Edit |
| `Integration_Log__c` | Create, Read |
| `Account`, `Opportunity`, `User` | Read |

Also grant the system permission **API Enabled**.

**Why Modify All on `Sample_Dispatch__c`** — it is needed twice over, and normal
Edit is not enough for either. The request records are owned by the *PCES
Sampling Desk* queue, not by this user; and a New Stand awaiting approval is
**locked by the approval process** (LockType Workitem), and only Modify All or
Modify All Data can edit a locked record. Without it the ERP cannot write the
stock verdict onto a stand request — which is exactly the record the approving
manager needs to read before deciding.

Finally, create a **Custom Permission** named `ERP_Integration` and grant it
through this same permission set. Two validation rules in Stage 4 test for it
rather than hardcoding a username.

### 1.3 Connected App "Pacific ERP"

- Enable OAuth Settings.
- Scope: **Manage user data via APIs (api)**.
- Enable **Client Credentials Flow**, with *Run As* = the ERP Integration user.
- IP Relaxation: **Relax IP restrictions** (our hosting has no fixed egress IP).
- Permitted Users: *Admin approved users are pre-authorized*, then add the
  **ERP Integration** permission set under Manage → Profiles/Permission Sets.

**If your org policy forbids the client-credentials flow**, tell us and we will
switch to the JWT bearer flow instead — we generate a certificate, you upload
only the public `.crt`. Do not work around the policy.

> **The consumer key and consumer secret go to the ERP owner directly and to
> nobody else.** Do not paste them into a chat, a ticket, a document, or an AI
> assistant's conversation — including this one. Hand them over the way your org
> hands over any production credential. We put them into our hosting ourselves.

**Report back after Stage 1:** the username you created, which licence type, that
the permission set is assigned, and that the Connected App exists. Not the secret.

---

## Stage 2 — what the ERP writes stock into (read-only for everyone else)

Nothing here can change a sample request, which is why it comes before Stage 4.

### 2.1 Five new fields on `Product2`

Assign the picklist values to the **Quartz Slab** record type (Product2 has five
record types).

| Field | Type |
|---|---|
| `ERP_Available_Slabs__c` | Number(8, 0) |
| `ERP_Match__c` | Picklist, **restricted**: `Matched`, `Not at this thickness`, `No ERP design` |
| `ERP_Other_Thickness_Stock__c` | Text(255) |
| `ERP_Stock_As_Of__c` | Date/Time |
| `ERP_In_Stock__c` | **Formula (Checkbox)** = `ERP_Available_Slabs__c > 0` |

`ERP_In_Stock__c` must be a formula, not a checkbox anyone can set — it is the
flag reps filter on, and it must not be able to disagree with the count beside it.

Set `ERP_SKU__c` to **External ID + Unique** (recommended; the sync works either
way). About 55 of the 110 active quartz products have it blank — **leave them
blank, the ERP fills them on its first run.** Do not populate them by hand.

- Page layout: an **ERP stock** section, all five fields **read-only**.
- List view **"Quartz — in stock"**: Family = Quartz Slab, IsActive,
  `ERP_In_Stock__c` = true, with the ERP columns shown.
- Field-level security: everyone who reads Product2 can read these; **only the
  ERP Integration permission set can edit them.**

### 2.2 New custom object `ERP_Stock__c`

Label **ERP Stock**, plural **ERP Stock**. Record name: Text, "Stock line".
Allow Reports **on**, Allow Search **on**, create a **tab**. Sharing: **Public
Read Only**.

| Field | Type |
|---|---|
| `ERP_Key__c` | Text(80), **External ID + Unique + Required** |
| `Kind__c` | Picklist, restricted: `Slab`, `Sample`, `Box`, `Stand` |
| `Product__c` | Lookup(Product2) |
| `Design__c` | Text(120) |
| `Thickness_mm__c` | Number(3, 0) |
| `Series__c` | Text(60) |
| `Colour__c` | Text(80) |
| `Finish__c` | Text(40) |
| `Size_Label__c` | Text(60) |
| `ERP_Colour_Finish_Id__c` | Text(40) |
| `ERP_Size_Id__c` | Text(40) |
| `ERP_Stock_Id__c` | Text(40) |
| `Available_Qty__c` | Number(8, 0) |
| `In_Stock__c` | **Formula (Checkbox)** = `Available_Qty__c > 0` |
| `Never_Stocked__c` | Checkbox |
| `Product_Missing__c` | Checkbox |
| `Retired__c` | Checkbox |
| `Synced_At__c` | Date/Time |
| `Stale__c` | **Formula (Checkbox)** = `(NOW() - Synced_At__c) > (1/24)` |

`ERP_Key__c` is the upsert key — it is how a re-run updates a row instead of
creating a second one. It must be External ID and Unique or the ERP will twin
every row on its second run.

**Four list views** (this is the "stock search with both slab and sample"
the owner asked for — the object tab plus these four, not a dashboard):

1. **Slabs in stock** — `Kind__c` = Slab, `In_Stock__c` = true, `Retired__c` = false
2. **Samples in stock** — `Kind__c` = Sample
3. **Stands & boxes** — `Kind__c` IN (Box, Stand)
4. **Everything incl. unmapped** — no filter

Search layout columns: Name, Kind, Available Qty, In Stock, Product, Synced At, Stale.
FLS: reps **read only**; only the ERP Integration set edits.

**Report back after Stage 2:** that both are done, and paste the **API names** of
anything you had to name differently from the table above.

---

## Stage 3 — we run a dry read

Nothing for you to do. We point the ERP at the org, run it in dry-run mode, and
send you the summary. Expect roughly:

- **75** products matched to ERP stock, about **3,811** slabs behind them
- **383** ERP design spellings with no product — these are yard typos, ours to fix
- **59** designs held at **30 mm** where Salesforce lists only 20 mm / 12 mm

That last line is a decision for the owner, not for you: the ERP will **not**
create products (a product implies a price-book entry we know nothing about). We
will send a CSV and you create them with Data Loader **if and when he says so** —
Family Quartz Slab, `ERP_SKU__c` = ProductCode. The next run links them by code
with no further change.

---

## Stage 4 — the sample request loop

Only after Stage 3 reads clean.

### 4.1 `Sample_Dispatch__c` — new fields

All **read-only to reps** by FLS, editable only by the ERP Integration set:

| Field | Type |
|---|---|
| `ERP_Request_No__c` | Text(24), External ID + Unique |
| `ERP_Status__c` | Picklist: `New`, `Needs review`, `Stock checked`, `On hold`, `Packed`, `Sent`, `Cancelled` |
| `ERP_Stock_Check__c` | Picklist: `Pending` (default), `Available`, `Partial`, `Not available`, `Needs review` |
| `ERP_Stock_Check_Note__c` | Long Text Area(4000) |
| `ERP_Synced_At__c` | Date/Time |
| `ERP_Packed_At__c` | Date/Time |
| `ERP_Sent_At__c` | Date/Time |
| `ERP_Packed_Items__c` | Long Text Area(4000) |

**One field reps DO edit:** `Stand_Type_Requested__c` — Picklist: `Floor Stand`,
`Wall Display`, `Counter Display`. Shown when Dispatch Type is New Stand. Without
it the ERP cannot tell which stand to check and reserve, and we refuse to guess:
a Floor Stand is the dearest of the three and the easiest to send by accident.

- Page layout: an **ERP** section.
- List view **"Sample requests — ERP view"**: Status, Approval, ERP status, stock
  check, ETA, synced at.
- **Do not add any new value to `Status__c`.** Two existing flows
  (`PCES_Sample_Status_Sync`, `PCES_Log_Sample_Activity`) key off its current
  values and would meet one they do not know.

### 4.2 `Sample_Dispatch_Item__c` — new fields

| Field | Type |
|---|---|
| `ERP_Stock__c` | Lookup(`ERP_Stock__c`), label "ERP stock line", **lookup filter**: `Kind__c` ≠ Slab AND `Retired__c` = false |
| `ERP_Line_Id__c` | Text(40), External ID + Unique |
| `ERP_Available_Qty__c` | Number(6, 0) |
| `ERP_Line_Status__c` | Picklist: `OK`, `Short`, `Needs review` |

Related-list columns: ERP stock line, Quantity, Size, Finish, ERP available.

**Validation rule `ITEMS_LOCKED_AFTER_PACK`** — an item under a request whose
`ERP_Status__c` is Packed or Sent cannot be edited, except by
`$Permission.ERP_Integration`.

### 4.3 `Sample_Stand__c` — one field

`ERP_Stand_Id__c` — Text(40), External ID + Unique. This is the upsert key, so a
retried send updates the same stand instead of creating a duplicate.

Set `Serial_No__c` to **Unique** (recommended). **No change to `Stand_Type__c` or
`Status__c`** — the ERP writes only `Dispatched`, `Installed` and `Retired`,
values that already exist, and writes nothing at all when a stand comes back.

### 4.4 Approval process `PCES Sample Request Approval` — two edits only

**Do not rebuild this.** We checked it live: it already routes only New Stand to
the rep's manager, which is exactly what the owner wants. Entry criteria stay
untouched.

1. Add a **Record Lock action → "Unlock the record"** to the final-approval
   action *and* the final-rejection action. The record is locked from submission
   and nothing currently unlocks it.
2. Make **final rejection also set `Status__c` = Cancelled**.
3. Correct the stale help text on `Approval_Status__c` — it currently claims every
   request routes to a manager. It should read: *"Only a New Stand routes to the
   requesting rep's manager; every other type goes straight to the sampling desk."*

If the owner later wants Stand Top-up approved too, that is **one line** in the
`Needs_Approval` decision inside `PCES_Submit_Sample_Approval` and nowhere else.

### 4.5 Screen flow `PCES_Request_Sample` — two screen additions

- Show `Stand_Type_Requested__c` when Dispatch Type = **New Stand**.
- Show the existing `Sample_Stand__c` lookup when Dispatch Type = **Stand Top-up**.

Leave `Requested_Items__c` as free text. The flow's own description says the
precise item list is the desk's job, and the design depends on that staying true.

### 4.6 Validation rule on `Sample_Dispatch__c`

`NO_CANCEL_AFTER_PACK`:

```
AND(
  ISCHANGED(Status__c),
  ISPICKVAL(Status__c, 'Cancelled'),
  OR(ISPICKVAL(ERP_Status__c, 'Packed'), ISPICKVAL(ERP_Status__c, 'Sent')),
  NOT($Permission.ERP_Integration)
)
```

Error: **"Already packed by the sampling desk — contact them to stop it"**.

No rule is needed to keep reps out of the `ERP_*` fields; field-level security
does that.

### 4.7 `Integration_Log__c`

Add the picklist value **`T8 - Sample request`**, in the existing hyphen style
(hyphen, not an en-dash — match the rows already there).

**Leave the 26 existing `T5 - Sales order` rows exactly as they are.** They are
queued for a middleware that was never built; 24 of them point at Orders that no
longer exist. We surface the count in the ERP so it stops being invisible. If the
owner later asks you to close those 24 as Failed, the wording is *"Order deleted;
no middleware was ever built"* — but **do not do it without his instruction**.

---

## What we need back from you

1. **After Stage 1** — the integration username, which licence type, confirmation
   the permission set is assigned and the Connected App exists. Consumer key and
   secret to the owner directly, not in writing here.
2. **After Stage 2** — confirmation, plus the API name of anything you named
   differently from the tables above.
3. **After Stage 4** — confirmation, and whether the approval unlock worked on a
   test New Stand.
4. **Any time** — if org policy blocks something (client-credentials flow,
   Modify All, creating a custom object), tell us rather than working around it.
   Every one of those has a designed fallback.

## What NOT to do

- Do not create dashboards or reports for this yet. There is nothing to report on
  until `ERP_Stock__c` exists and the ERP has filled it; we will ask afterwards if
  the owner wants them.
- Do not populate `ERP_SKU__c` or any `ERP_*` field by hand. The ERP owns them,
  and a hand-entered value will be overwritten on the next run.
- Do not add values to `Sample_Dispatch__c.Status__c` or `Sample_Stand__c.Status__c`.
- Do not delete `ERP_Stock__c` rows. The ERP marks them retired; a sample request
  line pointing at a deleted row would break a record somebody is looking at.
- Do not put the consumer secret in any document or chat.

---

*The full design, including everything the ERP does on its side, is in
`docs/salesforce-link/DESIGN.md`; what both systems actually contained on
2026-09-14 is in `docs/salesforce-link/DISCOVERY.md`. You do not need either to
do the work above, but they explain every "why" in it.*
