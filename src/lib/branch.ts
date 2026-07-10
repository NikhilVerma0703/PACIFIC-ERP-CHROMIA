// Two ERP branches: Shop Floor (production) and Office (finance/dispatch).
// A user belongs to one branch; ADMIN may sign into either. The effective
// branch for a session is set at login and carried in the JWT.
import { currentUser, rankOf, ROLE_RANK } from "@/lib/rbac";

export type BranchName = "SHOP_FLOOR" | "OFFICE" | "FABRICATION" | "INTERNATIONAL_SALES";
export const BRANCHES: BranchName[] = ["SHOP_FLOOR", "OFFICE", "FABRICATION", "INTERNATIONAL_SALES"];
export const BRANCH_LABEL: Record<string, string> = { SHOP_FLOOR: "Shop Floor", OFFICE: "Office", FABRICATION: "Fabrication", INTERNATIONAL_SALES: "International Sales" };

/** Tables that belong to the Office ERP (finance / dispatch). */
export const OFFICE_MODELS = new Set(["ShippingInvoice", "NazzBhai"]);
// Managed by dedicated flows (upload / assignment) — browsable but not grid-editable.
export const READONLY_TABLES = new Set(["UnassignedRm"]);

/** RM tables the Store Incharge can BROWSE (view-only — store writes go through
 * the dedicated /store flows). Extend as needed. */
export const STORE_MODELS = new Set([
  "Rm", "UnassignedRm", "UsedBags", "ResinStorage", "DailyResinTank", "SupplierMaster",
]);

/** Tables visible to ADMIN only (any branch). */
export const ADMIN_ONLY_TABLES = new Set(["Lab"]);

const roleOf = (u: unknown): string => String((u as { role?: unknown } | null)?.role ?? "");
const branchOf = (u: unknown): BranchName => {
  const b = (u as { branch?: string } | null)?.branch;
  return b === "OFFICE" || b === "FABRICATION" || b === "INTERNATIONAL_SALES" ? b : "SHOP_FLOOR";
};

/** Retired tables — hidden from BOTH branches (finance will be rebuilt from
 * scratch; Change Parameters are redundant now that smart forms clone the
 * previous record). Data stays in the database. */
export const HIDDEN_TABLES = new Set([
  "DebitNote", "Costing", "ConsumablesAndRate", "OpClStock",
  "Inventory", "SlabWiseInventory", "RmAndConsumablesConsumption",
  "SummaryTable", "SlabSegregation",
  "ChangeParametersDistributor", "ChangeParametersKreos", "ChangeParametersOven",
  "ChangeParametersPigment", "ChangeParametersPress", "ChangeParametersRobot",
  "ChangeParametersRoyMixerCycle",
]);

export async function currentBranchName(): Promise<BranchName> {
  return branchOf(await currentUser());
}

/** Can this session's branch WRITE (create/edit) records of this table? */
export async function canWriteModel(model: string): Promise<boolean> {
  if (HIDDEN_TABLES.has(model)) return false;
  const u = await currentUser();
  const role = roleOf(u);
  // Store Incharge: RM tables are view-only in the grid — writes go through /store.
  if (role === "STORE") return false;
  // Sales/Commercial: read-only everywhere outside their inventory scope.
  if (role === "SALES" || role === "COMMERCIAL") return false;
  // ADMIN can edit everything — including store-incharge tables that are
  // read-only for everyone else (UnassignedRm etc.).
  if ((READONLY_TABLES.has(model) || ADMIN_ONLY_TABLES.has(model)) && rankOf(role) < ROLE_RANK.ADMIN) return false;
  return branchOf(u) === "OFFICE" ? OFFICE_MODELS.has(model) : !OFFICE_MODELS.has(model);
}

/** Can this session's branch SEE this table at all?
 * Office sees everything (production data is read-only for them);
 * Shop Floor cannot see office (finance) data. */
export async function canSeeModel(model: string): Promise<boolean> {
  if (HIDDEN_TABLES.has(model)) return false;
  const u = await currentUser();
  const role = roleOf(u);
  if (role === "STORE") return STORE_MODELS.has(model); // Store Incharge: RM tables only
  if (role === "SALES" || role === "COMMERCIAL") return false; // Sales/Commercial: no table access at all
  if (ADMIN_ONLY_TABLES.has(model) && rankOf(role) < ROLE_RANK.ADMIN) return false;
  return branchOf(u) === "OFFICE" ? true : !OFFICE_MODELS.has(model);
}
