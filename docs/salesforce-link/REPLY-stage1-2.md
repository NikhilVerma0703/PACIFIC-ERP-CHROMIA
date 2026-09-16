# ERP team → Salesforce administration: answers on Stages 1 and 2

**Date:** 16 September 2026
**Re:** your *Stages 1 and 2* report

Thank you — this is exactly the level of detail we needed, and three things in
it changed what we build. Answers to your two questions first, then one thing we
need you to check before the first run, then what we have changed on our side.

---

## Your point 2 — Modify All includes Delete. Do we still want it?

**Yes, please grant it at Stage 4 — and you are right to have flagged it.**

We cannot avoid it. Modify All is not a convenience here; it is the only
permission that lets the ERP write to a request that is **locked by the approval
process**, and that write is the point of the whole feature: the approving
manager needs to read *"stand and pieces in stock"* on the record **before**
deciding. Normal Edit cannot touch a locked record, and the only other
permission that can is Modify All **Data**, which is strictly worse. There is no
narrower grant that does the job.

So the Delete that rides along is unavoidable, and the honest position is not
"we promise" but "we have made it checkable":

- The ERP will hold **no delete call for `Sample_Dispatch__c`** — or for any
  Salesforce object. A source-level test in our repository asserts it, the same
  way we pin the field rules below, so it fails our build rather than your data.
- Nothing in the design has a reason to delete. When a request is cancelled in
  Salesforce we mark it cancelled in the ERP and move nothing; when a stock line
  stops meaning anything we write `Retired__c` and leave the row standing,
  precisely because a request line may still point at it.

**If you would rather not grant Delete at all**, the cost is specific and we can
live with it: the approver decides without seeing the stock verdict, because we
cannot write to the locked record. Tell us which you prefer — it is your org's
risk posture, not ours.

## Your point 3 — Account and Opportunity reads return nothing

**Account: yes please, View All (read only). Opportunity: not needed.**

- **Account** — we genuinely read it. The request pull selects `Account__r.Name`,
  and at pack time the ERP writes the package out under the account's name, which
  is what the sampling desk and the courier label read. Zero rows here would not
  look like a permission problem; it would look like *"this request has no
  customer"*, and the desk would pack it blind. Please add **View All, read
  only** on Account.
- **Opportunity** — we only store `Opportunity__c`, the lookup's Id, which sits
  on the request record we can already read. Reading a lookup's Id needs no
  access to the object it points at, so **no grant is needed**. If we ever want
  to show the opportunity *name* on the ERP board we will come back and ask; we
  will not add it quietly.

And thank you for the warning about the **Stage 3 dry read** — it does not query
either object. Stage 3 touches `Product2` and `ERP_Stock__c` only, so a zero-row
Account will not appear in it at all, and we will not misread it.

---

## One thing to check before the first run — your validation rule and `ERP_SKU__c`

Your rule `ERP_writes_ERP_fields_only` rejects an ERP change to, among others,
**"SKU"** and **"External ID"**. Our very first run intends to write
**`ERP_SKU__c`** on the ~55 products where it is blank — which is exactly what
your Stage 2 note says you left for us to fill.

`ERP_SKU__c` is both a custom `ERP_` field *and* an External ID *and* has "SKU"
in its name, so the two statements can be read as contradicting each other.
We believe your rule refers to the **standard** fields — `StockKeepingUnit`
("Product SKU") and `ExternalDataSourceId` / the standard external id — and not
to `ERP_SKU__c`. Please confirm.

**If we have that wrong, the first run fails the whole composite call** and takes
every product in the batch with it, so this is worth thirty seconds now rather
than a red run later. If the rule does cover `ERP_SKU__c`, either exclude it, or
tell us and we will stop writing it and match on `ProductCode` alone — the sync
works either way, it simply never fills the blanks.

---

## What we changed on our side because of your report

1. **`ERP_Stock_As_Of__c` is now written.** It was in the specification and in
   your build, and our payload had omitted it. Every product in one run carries
   the same stamp, passed in rather than read from a clock, so two products can
   never disagree about when the yard was counted.
2. **Your validation rule is now pinned in our tests.** A list of the only keys
   a `Product2` payload may carry — `Id` plus the five `ERP_` fields — with a
   test asserting nothing else can appear. Adding a field on our side without
   adding it in Salesforce first now breaks our build instead of your run.
   `ERP_In_Stock__c` is explicitly excluded: it is a formula, and a write to it
   would fail.
3. **We will point at your My Domain**, `https://computing-saas-1373.my.salesforce.com`,
   not `login.salesforce.com`, and not `test.salesforce.com`. Noted that the
   client-credentials flow requires it.
4. **External Client App is fine.** We agree it is Salesforce's replacement for a
   Connected App since Spring '26, not a way around policy, and the
   client-credentials flow with Run-As is what we designed for. Nothing changes
   on our side.

**On your point 1** — noted, and it cuts both ways. Our sync will write to
`Product2`, `ERP_Stock__c` and `Integration_Log__c` only, and at Stage 4 the
three sample objects. **It will never touch a `CI_FST__*` object**, and we are
pinning that as an allowlist in the same test file, so the field-service app is
protected by our code as well as by your intent.

**On your point 5** — the four vestigial `Invoice__c` / `Payment__c` grants: agreed
they are inert. We would still suggest removing them whenever you are next in
that permission set, on the general principle that a grant nobody can explain is
a grant somebody will one day rely on. Not urgent, and not our call.

---

## Where that leaves us

| | |
|---|---|
| **You** | Confirm the `ERP_SKU__c` question above. Add View All (read) on Account. Tell us your decision on Delete. |
| **Owner** | Hands over the consumer key and secret; we set them in our hosting. |
| **Us** | Stage 3 dry read, and we send you the summary. |
| **Then you** | Refresh the sandbox, and we do Stage 4 against it. |

We will not enable anything that writes until you have the Stage 3 summary in
your hands and are content with it.
