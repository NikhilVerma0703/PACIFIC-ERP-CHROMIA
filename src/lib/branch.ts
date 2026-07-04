// Two ERP branches: Shop Floor (production) and Office (finance/dispatch).
// A user belongs to one branch; ADMIN may sign into either. The effective
// branch for a session is set at login and carried in the JWT.
import { currentUser, rankOf, ROLE_RANK } from "@/lib/rbac";

export type BranchName = "SHOP_FLOOR" | "OFFICE" | "FABRICATION";
export const BRANCHES: BranchName[] = ["SHOP_FLOOR", "OFFICE", "FABRICATION"];
export const BRANCH_LABEL: Record<string, string> = { SHOP_FLOOR: "Shop Floor", OFFICE: "Office", FABRICATION: "Fabrication" };

/** Tables that belong to the Office ERP (finance / dispatch). */
export const OFFICE_MODELS = new Set(["ShippingInvoice", "NazzBhai"]);
// Managed by dedicated flows (upload / assignment) — browsable but not grid-editable.
export const READONLY_TABLES = new Set(["UnassignedRm"]);

/** RM tables the Store Incharge can BROWSE (view-only — store writes go through
 * the dedicated /store flows). Extend as needed. */
export const STORE_MODELS = new Set([
  "Rm", "UnassignedRm", "UsedBags", "ResinStorage", "DailyResinTank", "SupplierMaster",
]);

/** Retired tables — hidden from BOTH branches (finance will be rebuilt from
 * scratch; Change Parameters are redundant now that smart forms clone the
 * previous record). Data stays in the database. */
/** Tables visible to ADMIN only (any branch). */
export const ADMIN_ONLY_TABLES = new Set(["Lab"]);

async function isAdminSession(): Promise<boolean> {
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rankOf((u as any)?.role as string | undefined) >= ROLE_RANK.ADMIN;
}

async function isSalesSession(): Promise<boolean> {
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ["SALES", "COMMERCIAL"].includes(String((u as any)?.role ?? ""));
}

async function isStoreSession(): Promise<boolean> {
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return String((u as any)?.role ?? "") === "STORE";
}

export const HIDDEN_TABLES = new Set([
  "DebitNote", "Costing", "ConsumablesAndRate", "OpClStock",
  "Inventory", "SlabWiseInventory", "RmAndConsumablesConsumption",
  "SummaryTable", "SlabSegregation",
  "ChangeParametersDistributor", "ChangeParametersKreos", "ChangeParametersOven",
  "ChangeParametersPigment", "ChangeParametersPress", "ChangeParametersRobot",
  "ChangeParametersRoyMixerCycle",
]);

export async function currentBranchName(): Promise<BranchName> {
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = (u as any)?.branch as string | undefined;
  return b === "OFFICE" ? "OFFICE" : b === "FABRICATION" ? "FABRICATION" : "SHOP_FLOOR";
}

/** Can this session's branch WRITE (create/edit) records of this table? */
export async function canWriteModel(model: string): Promise<boolean> {
  if (HIDDEN_TABLES.has(model)) return false;
  // Store Incharge: RM tables are view-only in the grid — writes go through /store.
  if (await isStoreSession()) return false;
  // Sales/Commercial: read-only everywhere outside their inventory scope.
  if (await isSalesSession()) return false;
  // ADMIN can edit everything — including store-incharge tables that are
  // read-only for everyone else (UnassignedRm etc.).
  if (READONLY_TABLES.has(model) && !(await isAdminSession())) return false;
  if (ADMIN_ONLY_TABLES.has(model) && !(await isAdminSession())) return false;
  const b = await currentBranchName();
  return b === "OFFICE" ? OFFICE_MODELS.has(model) : !OFFICE_MODELS.has(model);
}

/** Can this session's branch SEE this table at all?
 * Office sees everything (production data is read-only for them);
 * Shop Floor cannot see office (finance) data. */
export async function canSeeModel(model: string): Promise<boolean> {
  if (HIDDEN_TABLES.has(model)) return false;
  if (await isStoreSession()) return STORE_MODELS.has(model); // Store Incharge: RM tables only
  if (await isSalesSession()) return false; // Sales/Commercial: no table access at all
  if (ADMIN_ONLY_TABLES.has(model) && !(await isAdminSession())) return false;
  const b = await currentBranchName();
  return b === "OFFICE" ? true : !OFFICE_MODELS.has(model);
}
