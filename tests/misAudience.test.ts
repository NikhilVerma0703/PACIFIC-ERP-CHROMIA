import { test } from "node:test";
import assert from "node:assert/strict";
import { maySeeMis, storeMayVisit, operatorMayVisit, maintenanceMayVisit } from "../src/lib/routeCaps.ts";

// /api/mis/export serves the SAME downtime log the /mis page shows, and its
// audience is meant to be the page's. It used to refuse only Commercial and
// Sales, while every cap and every branch block hands its login all of /api —
// so operators, the store incharge, fabrication and sales staff could download
// incidents, maintenance responses and photo links from a page they cannot
// open. maySeeMis is the page's audience stated once; these tests pin it to the
// caps that can be checked directly and to the middleware blocks that cannot.

test("everyone who can open /mis can pull its export", () => {
  for (const [role, branch] of [
    ["ADMIN", "SHOP_FLOOR"], ["ADMIN", "OFFICE"], ["ADMIN", "FABRICATION"], ["ADMIN", "INTERNATIONAL_SALES"],
    ["LINE_MANAGER", "SHOP_FLOOR"], ["INCHARGE", "SHOP_FLOOR"],
    ["FINANCE", "OFFICE"], ["ACCOUNTS", "OFFICE"],
    ["MAINTENANCE", "SHOP_FLOOR"], ["MAINTENANCE", "OFFICE"],
  ]) {
    assert.equal(maySeeMis(role, branch), true, `${role} on ${branch} should reach the export`);
  }
  // The one CAPPED role whose allowlist names the page.
  assert.equal(maintenanceMayVisit("/mis"), true);
  assert.equal(maintenanceMayVisit("/api/mis/export"), true);
});

test("the capped shop-floor roles whose allowlists omit /mis are refused", () => {
  assert.equal(storeMayVisit("/mis"), false, "the store cap does not include /mis");
  assert.equal(operatorMayVisit("/mis"), false, "the operator cap does not include /mis");
  for (const role of ["STORE", "OPERATOR", "ROBO", "CHROMIA"]) {
    assert.equal(maySeeMis(role, "SHOP_FLOOR"), false, `${role} must not reach the export`);
  }
});

test("commercial and sales stay refused, as before", () => {
  assert.equal(maySeeMis("COMMERCIAL", "OFFICE"), false);
  assert.equal(maySeeMis("COMMERCIAL_MANAGER", "OFFICE"), false);
  assert.equal(maySeeMis("SALES", "OFFICE"), false);
});

test("departments middleware never lets onto a production page are refused by branch", () => {
  // middleware.ts: `!isAdmin && branch === "FABRICATION"` -> fab pages only;
  // `!isAdmin && branch === "INTERNATIONAL_SALES"` -> /sales only; the Chromia
  // cap -> /chromia only. Their roles are the shared ranks, so the branch is the
  // only thing that says no — and it must say it here too.
  for (const role of ["LINE_MANAGER", "INCHARGE", "OPERATOR"]) {
    assert.equal(maySeeMis(role, "FABRICATION"), false, `fabrication ${role}`);
    assert.equal(maySeeMis(role, "INTERNATIONAL_SALES"), false, `sales ${role}`);
    assert.equal(maySeeMis(role, "CHROMIA"), false, `chromia-branch ${role}`);
  }
});

test("a role added later is not refused by default", () => {
  // Deliberately a DENYLIST, like maySeeMaterialTrace: /mis has no gate of its
  // own, so a new uncapped role reaches the page — and must reach its export.
  assert.equal(maySeeMis("SOMETHING_ADDED_LATER", "SHOP_FLOOR"), true);
});
