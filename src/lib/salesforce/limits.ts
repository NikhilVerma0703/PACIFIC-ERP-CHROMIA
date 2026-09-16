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
 * May the ERP write to this object? Anything not named above is refused here,
 * before a request is built — including every CI_FST__* field-service object,
 * which the integration user's profile would otherwise permit.
 */
export function mayWrite(sobject: string): boolean {
  return WRITABLE_OBJECTS.includes(String(sobject ?? "").trim());
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
 * "Not Required" is a pass, not a gap: it is what the org stamps on every type
 * that does not route, which is every type but New Stand.
 *
 * AND "Pending" IS A REFUSAL EVEN WHEN NOBODY IS WAITING. A rep can RECALL a
 * pending New Stand; that unlocks the record but leaves Approval_Status__c on
 * Pending with no approval under way and nothing to resubmit it. Stock must not
 * be committed to a request in that state — it may never move again.
 */
export function refusePackForApproval(approvalStatus: string | null | undefined): string | null {
  const s = String(approvalStatus ?? "").trim();
  if (s === "Approved" || s === "Not Required") return null;
  if (s === "Rejected") return "Rejected in Salesforce — this request will not be packed.";
  if (s === "Pending") return "Awaiting approval in Salesforce. If the rep has recalled it, they must submit it again before the desk can pack.";
  return `Approval status is ${s || "not set"} — the desk packs only what is Approved or Not Required.`;
}
