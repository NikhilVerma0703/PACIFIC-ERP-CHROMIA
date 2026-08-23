import { test } from "node:test";
import assert from "node:assert/strict";
import { canSeeSalesRecord, isGlobalSalesDuty } from "../src/lib/sales/ownership.ts";

// The per-id rule for International Sales records, and the lists it mirrors:
// a SALESPERSON sees their own records, a REPORTING_MANAGER their own plus
// their assigned team, SALES_ADMIN / COMMERCIAL / ACCOUNTS everything. The
// per-id routes used to check only that the caller was a sales session.

const sp      = { uid: "sp-a", salesRole: "SALESPERSON" };
const rm      = { uid: "rm-1", salesRole: "REPORTING_MANAGER", managedSpIds: ["sp-a", "sp-b"] };
const rmAlone = { uid: "rm-1", salesRole: "REPORTING_MANAGER", managedSpIds: [] };

test("the three global duties see every record, exactly as the lists treat them", () => {
  for (const duty of ["SALES_ADMIN", "COMMERCIAL", "ACCOUNTS"]) {
    assert.equal(isGlobalSalesDuty(duty), true);
    assert.equal(canSeeSalesRecord({ uid: "anyone", salesRole: duty }, ["sp-z"]), true, `${duty} sees sp-z's record`);
    // ...including records nobody owns yet (an import, a half-finished transfer).
    assert.equal(canSeeSalesRecord({ uid: "anyone", salesRole: duty }, [null]), true, `${duty} sees an unowned record`);
  }
  for (const duty of ["SALESPERSON", "REPORTING_MANAGER", "", null, undefined]) {
    assert.equal(isGlobalSalesDuty(duty), false, `${duty} is not global`);
  }
});

test("a salesperson reaches their own records and nobody else's", () => {
  assert.equal(canSeeSalesRecord(sp, ["sp-a"]), true);
  assert.equal(canSeeSalesRecord(sp, ["sp-b"]), false);
  assert.equal(canSeeSalesRecord(sp, ["rm-1"]), false);
  assert.equal(canSeeSalesRecord(sp, []), false);
});

test("a reporting manager reaches their own and their team's, not the rest of the floor", () => {
  assert.equal(canSeeSalesRecord(rm, ["rm-1"]), true, "own record");
  assert.equal(canSeeSalesRecord(rm, ["sp-a"]), true, "assigned salesperson");
  assert.equal(canSeeSalesRecord(rm, ["sp-b"]), true, "assigned salesperson");
  assert.equal(canSeeSalesRecord(rm, ["sp-c"]), false, "somebody else's team");
  // A manager with no active assignments is scoped like a salesperson — which is
  // also what getAssignedSpIds returns for them: [self].
  assert.equal(canSeeSalesRecord(rmAlone, ["rm-1"]), true);
  assert.equal(canSeeSalesRecord(rmAlone, ["sp-a"]), false);
});

test("assignments count whatever the duty says — the dashboard's rule", () => {
  // lib/sales/dashboardData.ts treats ANY login with active assignments as a
  // manager and lists the team's orders for them, with links. The per-id rule
  // must not refuse a link the dashboard rendered, so the assignment lookup is
  // role-independent.
  const spWithTeam = { uid: "sp-a", salesRole: "SALESPERSON", managedSpIds: ["sp-b"] };
  assert.equal(canSeeSalesRecord(spWithTeam, ["sp-b"]), true);
  assert.equal(canSeeSalesRecord(spWithTeam, ["sp-c"]), false);
});

test("either end of a partially transferred pair is enough", () => {
  // /api/sales/transfer moves an order, a PI or a client one record at a time,
  // so an order can be B's while its PI is still A's. The routes pass BOTH
  // owners (the order's spId and its PIs', or the PI's and its order's), and
  // either grants — so the link from B's order list to A's PI, and from A's PI
  // page to B's order, both still open.
  const a = { uid: "sp-a", salesRole: "SALESPERSON" };
  const b = { uid: "sp-b", salesRole: "SALESPERSON" };
  const orderOwners = ["sp-b", "sp-a"]; // order.spId, pi.spId
  assert.equal(canSeeSalesRecord(a, orderOwners), true);
  assert.equal(canSeeSalesRecord(b, orderOwners), true);
  assert.equal(canSeeSalesRecord({ uid: "sp-c", salesRole: "SALESPERSON" }, orderOwners), false);
});

test("an unowned record is nobody's until an admin transfers it", () => {
  // spId: uid never matches null in the lists either.
  assert.equal(canSeeSalesRecord(sp, [null]), false);
  assert.equal(canSeeSalesRecord(sp, [undefined, ""]), false);
  assert.equal(canSeeSalesRecord(rm, [null]), false);
  // ...and a blank uid grants nothing even against a blank owner.
  assert.equal(canSeeSalesRecord({ uid: "", salesRole: "SALESPERSON" }, [""]), false);
});
