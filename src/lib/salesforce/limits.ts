// WHAT THE ERP IS ALLOWED TO DO INSIDE SALESFORCE — the whole of it, in one
// place, so the promises we made to Pacific's Salesforce administrator are
// checkable rather than merely stated.
//
// Two of those promises are load-bearing, and both were raised by the
// administrator in his Stage 1–2 report on 2026-09-16:
//
//  1. THE ERP NEVER DELETES ANYTHING. At Stage 4 the integration user needs
//     Modify All on Sample_Dispatch__c — it is the only permission that can
//     write to a request LOCKED by the approval process, and writing the stock
//     verdict onto a locked Pending stand is the point of the feature: the
//     approver has to read it before deciding. Salesforce's Modify All includes
//     DELETE, and there is no narrower grant that does the job. So the org
//     cannot stop us deleting; only our own code can, and this file plus its
//     test is where it does.
//
//  2. THE FIELD-SERVICE APP IS OUT OF BOUNDS. The integration user's profile
//     (Salesforce API Only System Integrations) grants create and edit on the
//     field-service objects — visits, beats, expenses, attendance, every
//     CI_FST__* object. The ERP has no business there. The administrator told
//     us rather than assuming, and an allowlist is the answer that survives
//     somebody adding a feature later.
//
// Pure and alias-free: `node --test` loads it bare.

/**
 * Every Salesforce object the ERP may WRITE to, and nothing else.
 *
 * Stages are marked because three of these are not granted yet: the sample
 * objects arrive with Stage 4, after a sandbox refresh. A write attempted
 * before then fails on permissions, which is the correct outcome and not a bug
 * to work around.
 */
export const WRITABLE_OBJECTS: readonly string[] = Object.freeze([
  "Product2",            // stage 2 — the five ERP_ fields only
  "ERP_Stock__c",        // stage 2 — the search object the ERP owns outright
  "Integration_Log__c",  // stage 2 — one row per run
  "Sample_Dispatch__c",      // stage 4
  "Sample_Dispatch_Item__c", // stage 4
  "Sample_Stand__c",         // stage 4
]);

/** Objects the ERP may READ but never write. */
export const READABLE_OBJECTS: readonly string[] = Object.freeze([
  "Account",      // Account__r.Name on a request — needs View All (read), asked for 2026-09-16
  "User",         // Approver__r.Name, Requested_By__r.Name — readable org-wide
  "Opportunity",  // the lookup Id only, which needs no grant; listed so the intent is explicit
]);

/**
 * THE FIELD-SERVICE APP, BY PREFIX RATHER THAN BY NAME.
 *
 * This replaces a list of four names I made up. The administrator checked the
 * org on 2026-09-16: `CI_FST__Visit__c`, `CI_FST__Beat__c`,
 * `CI_FST__Expense__c` and `CI_FST__Attendance__c` DO NOT EXIST. The real ones
 * are `CI_FST__FST_Visit__c`, `CI_FST__FST_Beat__c`, `CI_FST__Daily_Expense__c`,
 * `CI_FST__FST_Attendance__c` and twenty-three more, and the integration
 * profile grants create, edit AND DELETE on all 27 plus a platform event.
 *
 * So a block list of guessed spellings blocked nothing at all while reading as
 * though it did — the worst kind of guard. A prefix cannot drift from the org
 * as objects are added, and it needs no list to maintain.
 *
 * CASE-INSENSITIVE, because Salesforce is: `ci_fst__fst_visit__c` names the
 * same object as `CI_FST__FST_Visit__c`, and a case-sensitive test would pass
 * while the real call went through.
 */
export function isFieldServiceObject(sobject: string): boolean {
  return String(sobject ?? "").trim().toLowerCase().startsWith("ci_fst__");
}

/**
 * May the ERP write to this object? Anything not named above is refused here,
 * before a request is built.
 *
 * THE FIELD-SERVICE REFUSAL COMES FIRST, and deliberately outranks the
 * allowlist rather than relying on it. The allowlist is what actually protects
 * those objects today — but it protects them only for as long as nobody adds a
 * seventh entry carelessly, and this makes that particular mistake impossible
 * rather than merely unlikely.
 */
export function mayWrite(sobject: string): boolean {
  const name = String(sobject ?? "").trim();
  if (isFieldServiceObject(name)) return false;
  return WRITABLE_OBJECTS.includes(name);
}

/**
 * THE ERP HAS NO DELETE. Stated as a function rather than an absence so a test
 * can assert it and a future caller has something to trip over: whoever needs a
 * delete has to delete this line first, and then explain why in the commit.
 *
 * Retirement is how this integration removes meaning from a row — Retired__c
 * true, the row left standing — because a sample request line may still point
 * at it, and deleting it would break a record somebody is looking at.
 */
export function mayDelete(_sobject: string): false {
  void _sobject;
  return false;
}

// ── Stage 4: what may be written on a sample request ────────────────────────

/**
 * The only fields the ERP may put in a `Sample_Dispatch__c` payload.
 *
 * `OwnerId` IS DELIBERATELY ABSENT, and that is the administrator's point
 * (2026-09-16): Modify All carries more than Delete. It also lets this user
 * change a record's OWNER, and these requests belong to the PCES Sampling Desk
 * QUEUE. Reassigning one to the integration user would take it off the desk's
 * list silently — the request would simply stop appearing where the people who
 * work it look.
 */
export const REQUEST_WRITABLE_FIELDS: readonly string[] = Object.freeze([
  "Id",
  "ERP_Request_No__c",
  "ERP_Status__c",
  "ERP_Stock_Check__c",
  "ERP_Stock_Check_Note__c",
  "ERP_Synced_At__c",
  "ERP_Packed_At__c",
  "ERP_Sent_At__c",
  "ERP_Packed_Items__c",
  // The two exceptions the design argues for, and the only non-ERP_ fields
  // this integration ever writes: a guarded Status__c projection, the desk's
  // own ETA and docket, and the stand lookup on a New Stand.
  "Status__c",
  "Blocked_Reason__c",
  "Sample_ETA__c",
  "Courier_Docket__c",
  "Sample_Stand__c",
]);

export function mayWriteRequestField(field: string): boolean {
  return REQUEST_WRITABLE_FIELDS.includes(String(field ?? "").trim());
}

/**
 * MAY THE DESK PACK THIS REQUEST? Asked of the APPROVAL, never of the status or
 * the dispatch type — the administrator's correction on 2026-09-16, and it is
 * a real hole rather than a tidier spelling of the same rule.
 *
 * Salesforce stops the DESK marking a Pending or Rejected request Dispatched,
 * but nothing stops ERP_Status__c moving to Packed: that field is ours. Keying
 * the refusal off `Dispatch_Type__c === "New Stand"` would also miss the case
 * where a request of another type somehow carries an approval, and keying it
 * off Status__c asks a question about where the record is rather than whether
 * anyone has agreed to it.
 *
 * "Not Required" IS NOT ALWAYS A PASS, and that is the administrator's second
 * correction (2026-09-16). It has two quite different meanings, told apart only
 * by whether an APPROVER was stamped:
 *
 *   · Not Required, approver BLANK — nothing to approve. Either the type does
 *     not route (everything but New Stand), or it is a New Stand raised by a
 *     rep with no manager on file, which is the org's deliberate carve-out.
 *     Pack it.
 *   · Not Required, approver FILLED — THE AUTOMATIC SUBMISSION FAILED. An
 *     approver is stamped only on create, the submission runs straight after,
 *     and if it fails the flow logs a Failed row to Integration_Log__c and
 *     SAVES THE REQUEST ANYWAY. Nothing ever submits it again, because that
 *     flow runs only on create. The request sits looking exactly like the
 *     carve-out, and packing it skips a manager's decision that was meant to
 *     happen.
 *
 * ASKED OF EVERY TYPE, not only New Stand, because the dispatch type can be
 * changed after the fact — so a failed submission can be sitting on a request
 * that no longer reads as a stand.
 *
 * AND "Pending" IS A REFUSAL EVEN WHEN NOBODY IS WAITING. A rep can RECALL a
 * pending New Stand; that unlocks the record but leaves Approval_Status__c on
 * Pending with no approval under way and nothing to resubmit it. Stock must not
 * be committed to a request in that state — it may never move again.
 *
 * The approver is a REQUIRED argument rather than an optional one: a caller
 * that has not fetched it must be made to say so by the compiler, not allowed
 * to pass undefined and get a silent yes.
 */
export function refusePackForApproval(
  approvalStatus: string | null | undefined,
  approver: string | null | undefined,
): string | null {
  const s = String(approvalStatus ?? "").trim();
  const hasApprover = Boolean(String(approver ?? "").trim());
  if (s === "Not Required" && hasApprover) {
    return "This request has an approver but was never submitted — the automatic submission failed when it was raised. Ask the rep to submit it for approval, or to raise it again.";
  }
  if (s === "Approved" || s === "Not Required") return null;
  if (s === "Rejected") return "Rejected in Salesforce — this request will not be packed.";
  if (s === "Pending") return "Awaiting approval in Salesforce. If the rep has recalled it, they must submit it again before the desk can pack.";
  return `Approval status is ${s || "not set"} — the desk packs only what is Approved or Not Required.`;
}

/**
 * THE ERP NEVER APPROVES ANYTHING.
 *
 * Modify All carries three riders, not one. Delete is fenced by mayDelete;
 * owner-change by REQUEST_WRITABLE_FIELDS above; and the third — the right to
 * APPROVE a record — had only a sentence in a reply to the administrator
 * saying we would not. A promise in prose is what this file exists to replace.
 *
 * An ERP approval would be the worst of the three failures. A delete leaves a
 * hole somebody notices and sits in the Recycle Bin for fifteen days; an owner
 * change takes a request off the desk's list, which the desk eventually spots.
 * An approval is INVISIBLE and FINAL: the New Stand ships, Salesforce records a
 * clean approval against a manager who never saw it, and the one thing the
 * approval process exists to guarantee has been skipped with no trace that
 * anything went wrong.
 *
 * The ERP's job is to tell the approver what is in stock. Deciding is the
 * manager's.
 */
export function mayApprove(_sobject: string): false {
  void _sobject;
  return false;
}

/**
 * The REST paths this integration is forbidden to call, whatever it is doing.
 * Matched case-insensitively against a request path, since Salesforce is.
 */
export const FORBIDDEN_PATHS: readonly string[] = Object.freeze([
  "/process/approvals",   // approve or reject a record
  "/process/rules",       // fire assignment rules
]);

export function forbiddenPath(path: string): boolean {
  const p = String(path ?? "").toLowerCase();
  return FORBIDDEN_PATHS.some((f) => p.includes(f));
}
