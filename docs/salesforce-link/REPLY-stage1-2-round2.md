# ERP team → Salesforce administration: all five taken, and one correction accepted

**Date:** 16 September 2026
**Re:** your *your answers, and one thing to change before the first run*

Every point is taken. Four of them changed code on our side today, and one of
them would have failed our first run outright — thank you for counting the org
rather than trusting our number.

---

## §2 — the 283 products. This is the one that mattered

We had the filter in the right place and **only** in the right place: the WHERE
clause of a query string. Your note made it plain that is not good enough,
because the failure is silent in one direction and total in the other.

It is now a tested rule rather than a query string:

- `isSellableProduct()` — active **and** family exactly `Quartz Slab`.
- `productPayloads()` applies it **itself** and drops everything else, rather
  than trusting its caller to have written the query correctly. A future
  refactor that loosens the SOQL no longer reaches your product master.
- Tests pin all three of your groups by name: the **inactive twin** sharing a
  code with an active product, the **30 older ones** with no family, and — the
  trap we would have walked into — that **a blank `ERP_SKU__c` does not make a
  code fallback safe**, because all 55 inactive copies are blank too.

Your last sentence is the one we have written into the code comment, because it
is the reason the filter is load-bearing rather than tidy: *"Salesforce won't
catch a write to the wrong product."* All three `ERP_Match__c` values being
available on every record type means a wrong match saves cleanly and nobody ever
sees an error.

## §1 — `ERP_SKU__c` confirmed, and the two field limits

Thank you for testing the save rather than reading the rule off the page. Both
limits are now enforced on our side rather than hoped for:

- `ERP_Other_Thickness_Stock__c` is clamped to 255 characters. It cannot
  realistically get near it — four thicknesses exist, so three siblings is the
  most it can ever hold — but a silent truncation is cheaper than a red batch,
  and the cost of being wrong is asymmetric.
- `ERP_Match__c` has only ever been its three values; there is now a test saying
  so, so a fourth cannot be introduced by accident.
- `ExternalDataSourceId` is not in our payload and is now on the excluded list
  with a note pointing at your warning.

## §3 — Account, and your correction to our reasoning

Thank you for granting it, and **we will select `Account__r.Name` and nothing
else.** Your point about the other fields the grant opens — phone, billing and
shipping addresses, description, GSTIN, credit limit, payment terms — is well
made, and we will ask before adding any account field.

**You corrected us and you are right.** We said reading `Opportunity__c` needs no
access to Opportunity. A lookup field is readable only with Read on the object it
points at; we are relying on the Read you already have, not on it being
unnecessary. Our reply said the wrong thing for the right conclusion, which is
worse than saying nothing — recorded so nobody repeats it.

Your finding about `Account__r.Name` resolving *before* the grant is exactly the
kind of thing that would have bitten us in six months: it worked only while an
org setting stayed off. With View All it no longer depends on that setting, which
is why the grant was the right answer rather than a convenience.

## §4 — Modify All, and the two extra things to pin

Both pinned, and both were things we had not thought about:

- **`OwnerId` is now explicitly excluded** from the request payload allowlist,
  with your reason in the comment. Reassigning a request off the PCES Sampling
  Desk queue would take it off the desk's list **silently** — the request would
  simply stop appearing where the people who work it look, with no error
  anywhere. That is a worse failure than a delete, which at least leaves a hole
  somebody notices.
- **No call to any approval endpoint.** An ERP approval would skip the manager's
  decision on a New Stand, which is the one thing the approval exists to
  guarantee.
- **The cascade is noted.** Deleting a request would take its item lines
  (master-detail) and its approval history with it. That the integration user
  cannot hard-delete, so a stray delete lands in the Recycle Bin for 15 days, is
  a comfort and not a defence — our `mayDelete()` returns false for everything
  and a test scans the whole Salesforce folder for an HTTP DELETE.

## §5 — your correction to our handoff, accepted

**We were wrong and the handoff is corrected.** Item 4.4.1 said a request is
locked from submission and nothing unlocks it, and asked you to add an unlock
action. You read the live process: `finalApprovalRecordLock` and
`finalRejectionRecordLock` are both **false**. The item is struck out in
`ADMIN-HANDOFF.md` with your finding in its place. **Please do not add an unlock
action.** Item 2 stands.

**"Pack from `Approval_Status__c`, not from `Status__c` or Dispatch Type"** — taken,
and it closed a real hole rather than restating our rule more neatly. Our design
refused a New Stand unless approved; yours asks the question that actually
matters, because **`ERP_Status__c` is ours** and Salesforce does not police it.
`refusePackForApproval()` now passes only `Approved` or `Not Required`, and every
other value — including blank, absent and unrecognised — is a refusal with a
sentence the desk can act on.

**The recalled request is pinned separately**, because it is the subtle one: a
recall unlocks the record but leaves `Approval_Status__c` on Pending with no
approval under way and nothing to resubmit it. Our refusal message for Pending
names the recall explicitly, so the desk asks the rep to submit again rather than
waiting on an approval that will never arrive. We will not commit stock to it.

Noted too that **only a New Stand can be locked**, and only when the rep had a
manager on file at creation — that matches what we built. And thank you for
correcting the three places that still claim every request routes.

## §6 — the old grants, and your correction

Thank you for removing them. And thank you for correcting your own first report:
the profile grants **Delete** on the `CI_FST__` objects as well as create and
edit. Our block list is pinned and stays pinned — there is a test asserting that
`CI_FST__Visit__c`, `CI_FST__Beat__c`, `CI_FST__Expense__c` and
`CI_FST__Attendance__c` are all refused before a request is built, alongside an
allowlist of the six objects we may write at all.

---

## Where that leaves us

| | |
|---|---|
| **Owner** | The consumer key and secret. Everything else on our side is ready and waiting on them. |
| **Us** | Stage 3 dry read, filtered to active Quartz Slab products, and we send you the summary. |
| **You** | Nothing until that summary is in your hands. Then the sandbox refresh and Stage 4. |

Nothing of ours writes until you have read the Stage 3 summary and are content
with it — including the `ERP_SKU__c` fill, which is a write like any other.
