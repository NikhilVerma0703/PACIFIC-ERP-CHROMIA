# ERP team → Salesforce administration: both taken, and four more we found ourselves

**Date:** 16 September 2026
**Re:** your *two things to fix in what you pinned, and one gap we closed*

Both taken, and thank you for the third one — closing the type-change route on
your side removes a whole class of problem rather than making us guard against
it.

You have now caught two defects in the same file of ours, both of which our own
tests were happily green about. So before replying we had that file reviewed
against all three of your reports, adversarially, with every finding attacked
twice. Thirty-four candidates, **four survived, and all four reproduced.** They
are below, because two of them are things we told you we had already done.

---

## 1. Your block list correction — taken, and it was worse than a wrong name

You are right that a list of four spellings nothing uses protects nothing. It is
now a **case-insensitive prefix** — any name beginning `CI_FST__` is refused —
and the test uses your real names: `CI_FST__FST_Visit__c`,
`CI_FST__AdditionVisit__c`, `CI_FST__FST_Beat__c`, `CI_FST__FST_Beat_Customer__c`,
`CI_FST__Beat_Assignment__c`, `CI_FST__Daily_Expense__c`,
`CI_FST__TravelConveyance__c`, `CI_FST__Expense_Category__c`,
`CI_FST__Expense_Limit__c`, `CI_FST__FST_Attendance__c`,
`CI_FST__FST_Attendance_Log__c` and the platform event
`CI_FST__Refresh_Visit_Data__e`.

A prefix cannot drift as objects are added, which a list of names can. And your
point about case is now pinned explicitly: `ci_fst__fst_visit__c` is refused,
because a case-sensitive guard would have passed its test while the real call
went through.

The refusal also runs **before** the allowlist rather than relying on it, so a
seventh entry added carelessly cannot open the field-service app.

## 2. "Not Required" — taken exactly as you described it

`refusePackForApproval` now passes `Not Required` **only when `Approver__c` is
blank**, and asks the question **of every dispatch type**, for the reason you
gave: the type can be changed after the fact, so a failed submission may be
sitting on a request that no longer reads as a stand.

A `Not Required` request with an approver on it is refused with:

> *"This request has an approver but was never submitted — the automatic
> submission failed when it was raised. Ask the rep to submit it for approval, or
> to raise it again."*

The approver is a **required** argument to that function, not an optional one, so
a caller that has not fetched `Approver__c` is stopped by the compiler rather
than getting a silent yes. **Please do grant read on `Approver__c` at Stage 4** —
without it the rule cannot run, and we would rather it fail loudly than default.

## 3. Your `PCES_Sample_No_Change_To_New_Stand` rule

Noted, and it is the better fix — it removes the ambiguity at the source instead
of asking us to infer intent from two fields. Nothing changed on our side.

---

## What our own review then found — including two things we had told you were done

**We told you the ERP would "make no call to any approval endpoint". We had
enforced nothing.** Modify All carries three riders and we had fenced two:
delete, and owner-change. The third was a sentence in a reply to you.

It is the worst of the three by some distance. A delete leaves a hole somebody
notices and sits in the Recycle Bin for fifteen days; an owner change takes a
request off the desk's list and is eventually spotted. **An ERP approval is
invisible and final** — the stand ships, Salesforce records a clean approval
against a manager who never saw it, and the one thing the approval process exists
to guarantee has been skipped with no trace. There is now a `mayApprove()` that
returns false, a forbidden-path list naming `/process/approvals`, and the source
scan that already looked for a DELETE now looks for that too.

**The corrected packing rule was in the wrong document.** `DESIGN.md` is what
Stage 4 will actually be built from, and it still told the implementer to refuse
a New Stand unless Approved — in three separate places — and still asked you for
the Unlock action we withdrew. A superseded rule in a specification outlives a
corrected one in a reply. All three are corrected in place, with the corrections
listed at the head of the document, and `canPack` is now instructed to **call**
the shared rule rather than restate it.

Two more, both in the stock mapping, both reproduced before fixing:

- **A case variant would have hidden 118 real slabs.** We group "stock of this
  design at another thickness" — and we were grouping by the design string while
  matching the product by its code. Since the code strips case and punctuation,
  "Arva White" and "arva white" publish as one code and two strings, and never
  met. With the 20 mm rows typed one way and the 30 mm rows the other, the
  other-thickness note came out empty; once the 20 mm sold out, the product read
  **"No ERP design"** over 118 slabs we hold. Grouped by the code stem now.
- **A sold-out row would have been renamed to its own key, on every run.** The
  zeroing row carried `name: key`, so pushing it would have put the literal
  `SLAB|QZ-ARVAWHITE-20` into the Name a rep searches by. And its hash was never
  compared, so it went out every single run — at ten runs an hour against a
  thousand-call daily budget, a few hundred permanently sold-out lines would
  spend that budget saying nothing. The name is now left alone on a zeroing row,
  and a sold-out line is written once.

None of these would have been caught by our tests, and two of them we had
asserted to you as complete. We would rather tell you than have you find a third.

---

## Where that leaves us

Unchanged, and still waiting on the same one thing:

| | |
|---|---|
| **Owner** | The consumer key and secret |
| **Us** | Stage 3 dry read, filtered to active Quartz Slab products; we send you the summary |
| **You** | Nothing until that summary is with you. Then the sandbox refresh and Stage 4 |

One request for Stage 4 when you get there: **read on `Approver__c`**, as you
offered. It is now load-bearing rather than informational.
