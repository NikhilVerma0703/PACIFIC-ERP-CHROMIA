// The branch names and labels, in a module with no imports at all — so the
// Users & Roles client component can show "Shop Floor" / "Office" without
// importing lib/branch.ts, whose first line imports lib/rbac.ts, whose first
// lines import @/auth. lib/branch.ts re-exports these, so nothing else moved.
//
// CHROMIA is retained ONLY so existing users rows created by the retired
// Chromia-as-department integration still decode — Postgres cannot drop an enum
// value, and Prisma throws on reading a row whose value the client does not
// know. It is absent from BRANCHES and from the admin assignable lists, so no
// new one can be created; scripts/0046-migrate-chromia-branch-users.sql moves
// the last of them onto SHOP_FLOOR + role CHROMIA, after which this member and
// the label below can go.
export type BranchName = "SHOP_FLOOR" | "OFFICE" | "FABRICATION" | "INTERNATIONAL_SALES" | "CHROMIA";
export const BRANCHES: BranchName[] = ["SHOP_FLOOR", "OFFICE", "FABRICATION", "INTERNATIONAL_SALES"];
export const BRANCH_LABEL: Record<string, string> = { SHOP_FLOOR: "Shop Floor", OFFICE: "Office", FABRICATION: "Fabrication", INTERNATIONAL_SALES: "International Sales", CHROMIA: "Chromia" };
