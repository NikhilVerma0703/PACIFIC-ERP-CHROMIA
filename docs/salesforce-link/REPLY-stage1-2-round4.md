# ERP team → Salesforce administration: agreed, and the recall is recorded as ours

**Date:** 16 September 2026
**Re:** your *approvals will be refused in Salesforce too*

Short reply: everything agreed, nothing outstanding from us. Three things
recorded on our side.

---

## 1. Your approval trigger — good, and we are keeping ours

Thank you for testing it rather than taking our word. That the integration user
really can approve a pending New Stand, and that Salesforce records it cleanly,
is worth knowing rather than inferring.

**Two guards, and neither is redundant** — which is the part we have written into
the code so nobody later removes one as duplication:

| | approve | reject | submit | **recall** |
|---|---|---|---|---|
| Your trigger (watches `Approval_Status__c`) | ✔ | ✔ | ✔ | — |
| Our `/process/approvals` refusal | ✔ | ✔ | ✔ | **✔** |

Your point that **a recall does not change the status**, so your trigger cannot
see it, is now the headline comment on our forbidden-path list, with your name on
the finding. It is also the action whose consequence is worst to unpick: a
recalled request sits at Pending with nothing to resubmit it — the exact state
our packing rule already refuses — and somebody has to notice and ask the rep.

Delete and owner-change stay as agreed: fenced by our code, not by Salesforce.

## 2. The API budget — kept as a fixed ceiling

Understood, and recorded as an instruction rather than a number. `DAILY_CALL_BUDGET`
is now a named constant carrying your figures: the org allows **160,000** a day
and had used about **3,700** when you checked, so our 1,000 is a ceiling we chose
and not one we are near.

The comment says plainly that it is not to be grown into the headroom, and that a
change needing more calls per run is a change to make deliberately by editing
that line — not something to discover later because a loop grew. The designed
cadence uses roughly 900 a day at the very most, and there is a test asserting it
stays inside.

We will keep reading `Sforce-Limit-Info` off every response and skipping the
stock phase when the **org** drops under ten percent remaining. That guards your
limit; the constant guards ours.

## 3. Stage 4 list — matches ours

Your list is now written into `ADMIN-HANDOFF.md` at the head of Stage 4, so the
document you work from and the document we build from say the same thing. The
one item we would underline:

**Read on `Approver__c` is load-bearing, not informational.** Our packing rule
refuses a `Not Required` request that has an approver on it, because that is a
failed submission. Without the field the rule cannot run — and we have made the
approver a required argument so it fails loudly rather than defaulting to a yes.

---

## Where that leaves us

Genuinely unchanged, and still one thing:

| | |
|---|---|
| **Owner** | The consumer key and secret |
| **Us** | Stage 3 dry read, filtered to active Quartz Slab products; we send you the summary |
| **You** | Nothing until that summary is with you. Then the sandbox refresh and Stage 4 |

Four rounds in, you have caught three real defects in our code and we have caught
four more looking for them. That seems a reasonable rate to have found them at,
and a good argument for the dry run being read carefully by both of us before
anything writes.
