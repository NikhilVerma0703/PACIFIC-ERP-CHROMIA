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
