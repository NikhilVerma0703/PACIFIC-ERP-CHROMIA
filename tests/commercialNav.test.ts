// The Commercial sidebar, pinned desk by desk. The rows come from the AREA
// table (round two, answers 1, 2 and 6) through one pure function, so this file
// is the record of what each of the five people and the dispatch team actually
// sees — and the alarm that goes off if the area table moves under them.
//
// Both modules under test are import-free apart from lib/roles.ts, which is
// what lets node --test load them without Next, React or auth.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commercialAreasFor, areaOfPath, COMMERCIAL_AREAS, COMMERCIAL_HOME,
  commercialActorOf, commercialHomeFor,
  type CommercialArea, type AreaAccess,
} from "../src/lib/commercial/access-rules.ts";
import { commercialNavRows, AREAS_WITHOUT_A_ROW } from "../src/lib/commercial/nav-rules.ts";

const admin = { role: "ADMIN", branch: "SHOP_FLOOR" };
const manager = { role: "COMMERCIAL_MANAGER", branch: "OFFICE" };
const exec = { role: "COMMERCIAL_EXEC", branch: "OFFICE" };
const docs = { role: "COMMERCIAL_DOCS", branch: "OFFICE" };
const logistics = { role: "COMMERCIAL_LOGISTICS", branch: "OFFICE" };
const legacy = { role: "COMMERCIAL", branch: "OFFICE" };
const dispatchChecker = { role: "STORE", branch: "SHOP_FLOOR" };
const finance = { role: "FINANCE", branch: "OFFICE" };

const labels = (user: unknown) => commercialNavRows(commercialAreasFor(user)).map((r) => r.label);

// ───────────────────────────── the six desks ─────────────────────────────────

test("admin: every row, Settings included — but not the planner, which left the module", () => {
  assert.deepEqual(labels(admin), [
    "Overview", "Enquiries", "Orders", "Clients", "Packing Lists", "Dispatch Check",
    "Invoices", "Delivery Challans", "Design codes", "Settings",
  ]);
});

test("Santosh (manager): all access bar the planner and the settings form", () => {
  assert.deepEqual(labels(manager), [
    "Overview", "Enquiries", "Orders", "Clients", "Packing Lists", "Dispatch Check",
    "Invoices", "Delivery Challans", "Design codes",
  ]);
});

test("Setumani (exec): the same screens as the manager — his are the writes inside them", () => {
  // The exec's row list matching the manager's is the point, not an accident:
  // answer 1 gives him everything Raghav has plus the stock check, the PI,
  // packing and the dispatch marking, and what separates the two desks is
  // view-vs-write on enquiries and clients, which is a control on the screen
  // and not a row in the sidebar.
  assert.deepEqual(labels(exec), labels(manager));
  const rows = commercialNavRows(commercialAreasFor(exec));
  assert.equal(rows.find((r) => r.area === "enquiries")?.access, "view");
  assert.equal(rows.find((r) => r.area === "orders")?.access, "write");
});

test("Raghav (docs): the invoice and the papers around it — no enquiries, no dispatch check, no design codes", () => {
  assert.deepEqual(labels(docs), [
    "Overview", "Orders", "Clients", "Packing Lists", "Invoices", "Delivery Challans",
  ]);
});

test("Murali (logistics): the enquiry in, the freight out — no dispatch check", () => {
  assert.deepEqual(labels(logistics), [
    "Overview", "Enquiries", "Orders", "Clients", "Packing Lists",
    "Invoices", "Delivery Challans", "Design codes",
  ]);
});

test("the legacy COMMERCIAL login keeps what it had, minus the planner answer 16 took away", () => {
  assert.deepEqual(labels(legacy), [
    "Overview", "Enquiries", "Orders", "Clients", "Packing Lists", "Dispatch Check",
    "Invoices", "Delivery Challans", "Design codes",
  ]);
});

test("bay 5 (answer 6): one tab, and it is the dispatch check", () => {
  assert.deepEqual(labels(dispatchChecker), ["Dispatch Check"]);
  assert.deepEqual(labels({ role: "LINE_MANAGER", branch: "SHOP_FLOOR" }), ["Dispatch Check"]);
});

test("a dispatch checker on a branch with its own middleware block gets no row", () => {
  // That branch's block runs after the module's and returns, so the page is
  // refused; access-rules answers "not an actor here", and a row would be a
  // visible link to /no-access.
  assert.deepEqual(labels({ role: "LINE_MANAGER", branch: "FABRICATION" }), []);
});

test("nobody else gets a Commercial nav at all", () => {
  for (const u of [finance, { role: "SALES", branch: "OFFICE" }, { role: "OPERATOR", branch: "SHOP_FLOOR" }, null, undefined, {}]) {
    assert.deepEqual(labels(u), [], JSON.stringify(u));
  }
});

// ───────────────────────────── the rules behind them ─────────────────────────

test("answer 16: Settings is the admin's alone", () => {
  for (const u of [manager, exec, docs, logistics, legacy]) {
    assert.equal(labels(u).includes("Settings"), false, String((u as { role: string }).role));
  }
  assert.equal(labels(admin).includes("Settings"), true);
});

test("PRODUCTION PLANNING HAS LEFT THE MODULE — no Commercial row, not even the admin's", () => {
  // It was "Production Queue" here until 2026-09-17, admin-only under answer
  // 16. It is its own Office tab now (/office/production-planning), so a row in
  // the Commercial sidebar would point out of the module the sidebar is for.
  // WHO may plan did not change — that is still the `planning` area, now read
  // through lib/production-plan/access-rules by both middleware and the page.
  for (const u of [admin, manager, exec, docs, logistics, legacy]) {
    const l = labels(u);
    assert.equal(l.includes("Production Queue"), false, String((u as { role: string }).role));
    assert.equal(l.includes("Production Planning"), false, String((u as { role: string }).role));
  }
  for (const u of [admin, manager, exec, docs, logistics, legacy]) {
    assert.equal(commercialNavRows(commercialAreasFor(u)).some((r) => r.area === "planning"), false);
  }
});

test("a row needs WRITE to appear only where the screen has no read-only use", () => {
  // designCodes is `view` for three desks and still gets its row: looking a
  // code up is the whole point of the read-only master (round two, answer 15).
  const readOnlyDesignCodes = { ...commercialAreasFor(admin), designCodes: "view" as AreaAccess };
  assert.equal(commercialNavRows(readOnlyDesignCodes).some((r) => r.area === "designCodes"), true);
  // settings is the one that does not: a `view` on it would be a row leading to
  // a page whose every control is refused. (planning used to be the second such
  // row; it has no row at all now — see the test above.)
  assert.equal(commercialNavRows({ ...commercialAreasFor(admin), settings: "view" as AreaAccess }).some((r) => r.area === "settings"), false);
});

test("the areas with no row of their own, and the one that is different", () => {
  // checklist, proforma and stock are TABS on an order, reached through Orders.
  // planning is not: it left the module for its own Office tab on 2026-09-17,
  // so it is rowless for a different reason and this test says which.
  assert.deepEqual([...AREAS_WITHOUT_A_ROW].sort(), ["checklist", "planning", "proforma", "stock"]);
});

test("every row is a real path of the area it claims, and Overview alone matches exactly", () => {
  const rows = commercialNavRows(commercialAreasFor(admin));
  for (const r of rows) assert.equal(areaOfPath(r.href), r.area, r.href);
  assert.deepEqual(rows.filter((r) => r.exact).map((r) => r.href), ["/office/commercial"]);
  for (const r of rows) if (!r.exact) assert.equal(r.href.startsWith("/office/commercial/"), true, r.href);
});

test("every area is either a row or deliberately not one — a new area cannot go unnoticed", () => {
  const rowAreas = new Set(commercialNavRows(commercialAreasFor(admin)).map((r) => r.area));
  for (const a of COMMERCIAL_AREAS) {
    assert.equal(rowAreas.has(a) || AREAS_WITHOUT_A_ROW.includes(a), true, a);
  }
});

test("fails closed: an unknown or empty area map yields no rows", () => {
  assert.deepEqual(commercialNavRows(null), []);
  assert.deepEqual(commercialNavRows(undefined), []);
  assert.deepEqual(commercialNavRows({} as Record<CommercialArea, AreaAccess>), []);
});

// ───────────────────── where each login LANDS (answer 6) ─────────────────────
// app/login/actions.ts reads commercialHomeFor after a successful sign-in. The
// arm around it used to be isCommercialRole, which knows only the five
// COMMERCIAL_* roles — so bay 5, which signs in as STORE or LINE_MANAGER, was
// the one desk whose landing page answer 6 changed and the one desk that never
// reached the call. These pin the rule that arm now asks.

test("answer 6: a login with no overview lands on the one tab it has", () => {
  for (const u of [dispatchChecker, { role: "LINE_MANAGER", branch: "SHOP_FLOOR" }, { role: "STORE", branch: "OFFICE" }]) {
    assert.equal(commercialActorOf(u), "DISPATCH_CHECKER", JSON.stringify(u));
    assert.equal(commercialHomeFor(u), "/office/commercial/dispatch-check", JSON.stringify(u));
    // ...and it is the href of the one row that login gets, not a second copy
    // of the path kept by hand.
    assert.deepEqual(commercialNavRows(commercialAreasFor(u)).map((r) => r.href), [commercialHomeFor(u)]);
  }
});

test("every desk with an overview lands on the module home", () => {
  for (const u of [admin, manager, exec, docs, logistics, legacy]) {
    assert.equal(commercialHomeFor(u), COMMERCIAL_HOME, String((u as { role: string }).role));
  }
});

test("nobody is landed on a screen their own area table refuses", () => {
  for (const u of [admin, manager, exec, docs, logistics, legacy, dispatchChecker]) {
    const home = commercialHomeFor(u);
    const area = areaOfPath(home);
    assert.notEqual(area, null, home);
    assert.notEqual(commercialAreasFor(u)[area as CommercialArea], "none", `${JSON.stringify(u)} -> ${home}`);
  }
});

test("commercialHomeFor is not itself the admission test — the caller must ask commercialActorOf", () => {
  // It answers the module home for a login the module does not admit at all,
  // which is a sane default for a Commercial role and a WRONG redirect for
  // anybody else. That is why login/actions.ts redirects a non-Commercial role
  // only when this returns something OTHER than the module home, and only when
  // commercialActorOf calls it a dispatch checker.
  for (const u of [finance, { role: "LINE_MANAGER", branch: "FABRICATION" }, { role: "OPERATOR", branch: "SHOP_FLOOR" }, null]) {
    assert.equal(commercialActorOf(u), null, JSON.stringify(u));
    assert.equal(commercialHomeFor(u), COMMERCIAL_HOME, JSON.stringify(u));
  }
});
