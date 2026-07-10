// Fields that represent "the person who did this" — auto-filled from the
// logged-in user, never typed. Pure module (safe in client bundles).
export const OPERATOR_FIELDS = new Set(["operator", "calliberator", "inspector", "submittedBy", "assignee", "testedBy", "incharge"]);
