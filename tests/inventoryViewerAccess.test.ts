import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Alias-free relative import with an explicit extension: `node --test` resolves
// neither the `@/` alias nor next-auth, which is exactly why the rules live in
// a module of their own. See src/lib/inventory/accessRules.ts.
import {
  hasFgView,
  hasOfficeInventoryAccess,
  canSeeInventoryModule,
  canReadInventory,
  canWriteInventory,
} from "../src/lib/inventory/accessRules.ts";

// THE FINISHED-GOODS VIEW GRANT, pinned from both ends.
//
// The owner, 2026-09-14: "Please add finished good's visibility for
// chromia@thepacific.group, gibin@thepacific.group (full visibility but no edit
// options)". Both logins are LINE_MANAGER off the OFFICE branch — chromia@ on
// CHROMIA, gibin@ on FABRICATION — so the grant is a per-login boolean,
// users.fg_view, and scripts/0083-fg-view-grant.sql is the argument for that.
//
// Two halves of one rule, and the second half is the one that rots.
//
// The first half is arithmetic on a user object and is tested directly below:
// a viewer reads, a viewer does not write, an ordinary line manager gets
// neither, and a login that could already write does not lose it by also being
// handed the flag.
//
// The second half is which gate each route handler actually calls, and no
// amount of testing the rule catches a write route left on the read gate. Those
// handlers cannot be imported here — they pull in Prisma, next-auth and the
// whole App Router — so the second half reads the source, in the style of
// creditNoteRoleGate.test.ts. The table below is exhaustive over every handler
// under /api/inventory, and a new one that is not listed fails rather than
// quietly picking its own gate.

const viewerOnChromia = { role: "LINE_MANAGER", branch: "CHROMIA", fgView: true };
const viewerOnFabrication = { role: "LINE_MANAGER", branch: "FABRICATION", fgView: true };
const lineManager = { role: "LINE_MANAGER", branch: "CHROMIA" };
const accounts = { role: "ACCOUNTS", branch: "OFFICE" };
const accountsWhoAlsoViews = { role: "ACCOUNTS", branch: "OFFICE", fgView: true };
const finance = { role: "FINANCE", branch: "OFFICE" };
const commercial = { role: "COMMERCIAL", branch: "OFFICE" };
const sales = { role: "SALES", branch: "OFFICE" };
const admin = { role: "ADMIN", branch: "SHOP_FLOOR" };

test("a viewer reads finished goods from whatever branch the login sits on", () => {
  for (const viewer of [viewerOnChromia, viewerOnFabrication]) {
    assert.equal(canSeeInventoryModule(viewer), true, `${viewer.branch} must see the module`);
    assert.equal(canReadInventory(viewer), true, `${viewer.branch} must read the slabs surface`);
  }
  // "Any branch" means any, including one created after this was written: the
  // grant is per login, and the branch is not part of the question.
  assert.equal(canReadInventory({ role: "LINE_MANAGER", branch: "A_BRANCH_INVENTED_LATER", fgView: true }), true);
});

test("a viewer changes nothing, on either branch", () => {
  assert.equal(canWriteInventory(viewerOnChromia), false);
  assert.equal(canWriteInventory(viewerOnFabrication), false);
});

test("the flag alone never reaches the write rule, whatever role carries it", () => {
  // The write rule does not mention fgView, and this is the test that says so
  // without reading the implementation: adding the flag to a login changes
  // nothing about whether that login may write.
  for (const role of ["LINE_MANAGER", "INCHARGE", "OPERATOR", "STORE", "MAINTENANCE", "ROBO", "CHROMIA", "SAMPLING", "SALES", ""]) {
    for (const branch of ["SHOP_FLOOR", "FABRICATION", "CHROMIA", "OFFICE"]) {
      assert.equal(
        canWriteInventory({ role, branch, fgView: true }),
        canWriteInventory({ role, branch }),
        `fgView must not change the write answer for ${role || "(blank)"} on ${branch}`,
      );
    }
  }
});

test("an ordinary line manager without the grant is refused everywhere", () => {
  assert.equal(canSeeInventoryModule(lineManager), false);
  assert.equal(canReadInventory(lineManager), false);
  assert.equal(canWriteInventory(lineManager), false);
  // Including on the branch the module lives on: the grant is the grant, and
  // being a line manager has never been one.
  assert.equal(canReadInventory({ role: "LINE_MANAGER", branch: "OFFICE" }), false);
});

test("the grant adds and never subtracts — an Accounts login that also views still writes", () => {
  assert.equal(canWriteInventory(accountsWhoAlsoViews), true);
  assert.equal(canReadInventory(accountsWhoAlsoViews), true);
  assert.equal(canSeeInventoryModule(accountsWhoAlsoViews), true);
});

test("nobody who held the module yesterday holds less of it today", () => {
  for (const user of [admin, finance, accounts, commercial]) {
    assert.equal(canSeeInventoryModule(user), true, `${user.role} must still see the module`);
    assert.equal(canReadInventory(user), true, `${user.role} must still read`);
    assert.equal(canWriteInventory(user), true, `${user.role} must still write`);
  }
  // Sales is summary-only and stays exactly that: the summary, and neither of
  // the other two surfaces.
  assert.equal(canSeeInventoryModule(sales), true);
  assert.equal(canReadInventory(sales), false);
  assert.equal(canWriteInventory(sales), false);
  // And handing SALES the flag does not smuggle it onto the slabs table. That
  // refusal predates the grant by a long way; widening it is a separate
  // decision with a different person to ask.
  assert.equal(canReadInventory({ ...sales, fgView: true }), false);
  assert.equal(canWriteInventory({ ...sales, fgView: true }), false);
});

test("a missing or non-boolean flag reads as no grant", () => {
  // A session minted before auth.ts learned to carry the column answers
  // undefined here, and undefined has to mean no.
  assert.equal(hasFgView(undefined), false);
  assert.equal(hasFgView(null), false);
  assert.equal(hasFgView({ role: "LINE_MANAGER" }), false);
  assert.equal(hasFgView({ fgView: false }), false);
  assert.equal(hasFgView({ fgView: "true" }), false);
  assert.equal(hasFgView({ fgView: 1 }), false);
  assert.equal(hasFgView({ fgView: true }), true);
  assert.equal(canReadInventory(null), false);
  assert.equal(canSeeInventoryModule(undefined), false);
});

test("the pre-grant office rule is untouched, and is what the write gate still asks", () => {
  assert.equal(hasOfficeInventoryAccess("ADMIN", "SHOP_FLOOR"), true);
  assert.equal(hasOfficeInventoryAccess("FINANCE", "OFFICE"), true);
  assert.equal(hasOfficeInventoryAccess("ACCOUNTS", "OFFICE"), true);
  assert.equal(hasOfficeInventoryAccess("COMMERCIAL", "OFFICE"), true);
  assert.equal(hasOfficeInventoryAccess("SALES", "OFFICE"), true);
  assert.equal(hasOfficeInventoryAccess("FINANCE", "FABRICATION"), false);
  assert.equal(hasOfficeInventoryAccess("LINE_MANAGER", "OFFICE"), false);
  assert.equal(hasOfficeInventoryAccess("LINE_MANAGER", "CHROMIA"), false);
});

// And which gate each handler calls.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const API = join(ROOT, "src", "app", "api", "inventory");

/** Every handler under /api/inventory, and the gate it must call. The key is
 *  the route file's path relative to /api/inventory plus the HTTP method. */
const EXPECTED: Record<string, "inventoryReadGate" | "inventoryGate" | "summaryGate"> = {
  // Reads. A viewer passes these, which is the whole grant.
  "route.ts GET": "inventoryReadGate",
  "designs/route.ts GET": "inventoryReadGate",
  "events/route.ts GET": "inventoryReadGate",
  "export/route.ts GET": "inventoryReadGate",
  "filters/route.ts GET": "inventoryReadGate",
  "invoice/route.ts GET": "inventoryReadGate",
  "kpi/route.ts GET": "inventoryReadGate",
  "polishing-report/route.ts GET": "inventoryReadGate",
  "slab/route.ts GET": "inventoryReadGate",
  // Writes. A viewer is refused by these, and so is anything added beside them
  // and gated the same way without a thought — that is the direction the split
  // was built in.
  "approve/route.ts POST": "inventoryGate",
  "designs/route.ts POST": "inventoryGate",
  "designs/route.ts DELETE": "inventoryGate",
  "dispatch/route.ts POST": "inventoryGate",
  "location/route.ts POST": "inventoryGate",
  "slab/edit/route.ts POST": "inventoryGate",
  "status/route.ts POST": "inventoryGate",
  // Stock by Design and its two companions: the surface Sales holds, which a
  // viewer reads like any other read.
  "approve/route.ts GET": "summaryGate",
  "batch-quality/route.ts GET": "summaryGate",
  "summary/route.ts GET": "summaryGate",
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Every route.ts under /api/inventory, path relative to that directory, with
 *  forward slashes whatever the platform writes. */
function routeFiles(): string[] {
  return readdirSync(API, { recursive: true, encoding: "utf8" })
    .map((p) => p.split("\\").join("/"))
    .filter((p) => p.endsWith("route.ts"))
    .sort();
}

/** The source of one exported handler — from its own `export async function`
 *  to the next one, or to the end of the file. */
function handlerBody(source: string, method: string): string | null {
  const at = source.indexOf(`export async function ${method}(`);
  if (at === -1) return null;
  const next = source.indexOf("export async function ", at + 1);
  return source.slice(at, next === -1 ? source.length : next);
}

/** The gate a handler calls, read off its own body. */
function gateOf(body: string): string | null {
  const called = ["inventoryReadGate", "inventoryGate", "summaryGate"].filter((g) => body.includes(`await ${g}()`));
  assert.ok(called.length <= 1, `a handler calls more than one inventory gate: ${called.join(", ")}`);
  return called[0] ?? null;
}

test("every /api/inventory handler calls the gate its verb calls for", () => {
  const seen: string[] = [];
  for (const file of routeFiles()) {
    const source = readFileSync(join(API, file), "utf8");
    for (const method of METHODS) {
      const body = handlerBody(source, method);
      if (body === null) continue;
      const key = `${file} ${method}`;
      seen.push(key);
      assert.ok(
        EXPECTED[key],
        `${key} is a new /api/inventory handler and nothing here says which gate it may use. ` +
          "If it changes anything it belongs on inventoryGate; if it only reads, inventoryReadGate. Add it to EXPECTED.",
      );
      assert.equal(gateOf(body), EXPECTED[key], `${key} must call ${EXPECTED[key]}()`);
    }
  }
  // The other direction: a handler listed here that has since been deleted or
  // renamed would otherwise sit in the table forever, pinning nothing.
  assert.deepEqual(seen.sort(), Object.keys(EXPECTED).sort());
});

/** A Prisma call that changes a row, spotted in source text. */
const WRITES = /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany|executeRaw|executeRawUnsafe)\b/;

test("no handler on the read gate writes through Prisma", () => {
  // The read gate's promise is that no handler behind it changes a row of its
  // own. This is the cheap structural half of that promise: it sees only the
  // handler's own body, but it catches the version that actually happens, which
  // is a create or an update typed straight into a handler a viewer can reach.
  // The half it cannot see — a write one call deeper, inside a helper — is the
  // test below, which is there because that is exactly what was found behind
  // this gate on the day it was written.
  for (const [key, gate] of Object.entries(EXPECTED)) {
    if (gate !== "inventoryReadGate") continue;
    const [file, method] = key.split(" ");
    const body = handlerBody(readFileSync(join(API, file), "utf8"), method);
    assert.ok(body, `${key} has gone missing`);
    assert.equal(WRITES.test(body), false, `${key} is on the read gate but looks like it writes`);
  }
});

// And which call sites, if any, are still on the deprecated (role, branch)
// form — the list the doc block over hasInventoryAccess keeps by path.
//
// That block is not decoration. It is what a maintainer reads to answer "what
// is still un-migrated" and "how much of this module is still closed to a
// viewer", and on 2026-09-14 it went stale on the day it was typed: it named
// src/components/Shell.tsx, which the very same change had just moved to
// hasInventoryAccess(user), and it said a viewer gets no sidebar link, which
// the Nav rows added beside it had just made false. Half of one sentence
// expired and the other half did not, so nothing signalled it. Then /api/photo
// moved over too and the list was wrong a second time, in the other direction.
// A list that is only true on the day it is written sends the next author to
// re-do finished work, or lets them relax something else in the belief that the
// module is more closed than it is.
//
// So the list is pinned to the source it describes and fails both ways: name a
// file there that has already moved, or leave a two-string caller unnamed, and
// this test says which. It is at nothing today, which is the answer that most
// needs holding — an empty list is the one nobody thinks to re-check.

const SRC = join(ROOT, "src");
const ACCESS = readFileSync(join(SRC, "lib", "inventory", "access.ts"), "utf8");

/** Everything documenting hasInventoryAccess: the doc block over the object
 *  overload, the @deprecated note under it, and both signatures. Stops at the
 *  implementation, so the gates' own comments below are not in scope. */
function inventoryAccessDocs(): string {
  const overload = ACCESS.indexOf("export function hasInventoryAccess(user:");
  assert.ok(overload > 0, "the object overload of hasInventoryAccess has been renamed or moved");
  const impl = ACCESS.indexOf("export function hasInventoryAccess(a:");
  assert.ok(impl > overload, "the implementation signature of hasInventoryAccess has been renamed or moved");
  const start = ACCESS.lastIndexOf("/**", overload);
  assert.ok(start !== -1 && start < overload, "the object overload has lost its doc block");
  return ACCESS.slice(start, impl);
}

/** That block as one line: the comment decoration stripped and whitespace runs
 *  collapsed. The prose is hand-wrapped at the margin, so a claim that matters
 *  — the "no sidebar link" one — sits in the raw source with a newline and a
 *  star in the middle of it and slips past anything matching the raw text. A
 *  path can wrap the same way; keep paths whole and this reads them. */
function flatDocs(): string {
  return inventoryAccessDocs()
    .replace(/^[ \t]*\*+[ \t]?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every .ts/.tsx under src/, path relative to the repo root, forward slashes
 *  whatever the platform writes. */
function srcFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .map((p) => p.split("\\").join("/"))
    .filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"))
    .map((p) => `src/${p}`)
    .sort();
}

/** The argument text of every `hasInventoryAccess(` CALL in one file, read by
 *  balancing parentheses rather than by regex: the arguments are themselves
 *  calls and casts, so a pattern that stops at the first `)` misreads them. */
function inventoryAccessCalls(source: string): string[] {
  const NEEDLE = "hasInventoryAccess(";
  const out: string[] = [];
  for (let at = source.indexOf(NEEDLE); at !== -1; at = source.indexOf(NEEDLE, at + 1)) {
    const open = at + NEEDLE.length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) {
        out.push(source.slice(open + 1, i));
        break;
      }
    }
  }
  return out;
}

/** Whether an argument list carries a comma of its own — the two-string form.
 *  A comma inside a cast, an object type or an index is not one. */
function isDeprecatedForm(args: string): boolean {
  let depth = 0;
  for (const c of args) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) return true;
  }
  return false;
}

/** The files still calling the deprecated (role, branch) form. access.ts itself
 *  is skipped: its overload signatures and its implementation signature declare
 *  that form, they do not use it. */
function deprecatedCallers(): string[] {
  return srcFiles()
    .filter((p) => p !== "src/lib/inventory/access.ts")
    .filter((p) => {
      const source = readFileSync(join(ROOT, p), "utf8");
      return source.includes("hasInventoryAccess(") && inventoryAccessCalls(source).some(isDeprecatedForm);
    });
}

test("the doc block names exactly the call sites still on the deprecated form", () => {
  const named = [...new Set(flatDocs().match(/src\/[A-Za-z0-9_./[\]-]+\.tsx?/g) ?? [])].sort();
  assert.deepEqual(
    named,
    deprecatedCallers(),
    "The doc block over hasInventoryAccess lists the call sites still passing a role and a branch, " +
      "and it may name those and no other source file. A file named there that has already been " +
      "moved to hasInventoryAccess(user) sends the next maintainer to re-do finished work; a caller " +
      "left unnamed is an under-grant nobody knows to close. Keep each path on one line: a path " +
      "wrapped at the margin is a path this cannot read.",
  );
});

test("the doc block does not call the sidebar link missing while the nav draws it", () => {
  // The other half of the same stale sentence, and the half that misleads about
  // access rather than about workload. Shell passes the user object, so both
  // grant holders get a Finished Goods row — tests/inventoryDashboardView.test.ts
  // pins both arms. The prose here may say that link is absent only while it
  // actually is absent, because "the nav is safe by omission" is exactly the
  // belief somebody widens something else on.
  const NAV = readFileSync(join(SRC, "components", "Nav.tsx"), "utf8");
  assert.ok(NAV.includes('label: "Finished Goods"'), "the nav has lost the Finished Goods row");
  assert.equal(
    /no (?:sidebar link|sidebar entry|nav entry|nav link)/i.test(flatDocs()),
    false,
    "the doc block says a viewer gets no sidebar link, but Nav.tsx draws the Finished Goods row",
  );
});

// AND ONE CALL DEEPER, WHICH IS WHERE THE READ GATE'S PROMISE ACTUALLY BROKE.
//
// The structural test above says so about itself: it reads a handler's own body
// and nothing further. On the day the gate was split, the two handlers a viewer
// actually loads — the slabs list and the KPI strip — each awaited
// sweepExpiredReservations() before reporting, and that helper hands every
// RESERVED slab whose hold has lapsed back to AVAILABLE and logs a slab_event
// for each one. So inventoryReadGate's doc comment promised that nothing behind
// it changes a row while two row-changing calls sat behind it, one hop further
// than anything here looked, and that comment is what the next author placing a
// handler reads instead of the handlers.
//
// The sweep itself stays. The clock picks the rows and not the caller, a viewer
// cannot aim it, every other login triggers the identical writes, and the remedy
// the comment prescribed — move those two handlers back to inventoryGate —
// would revoke the grant the change exists to deliver. What had to stop being
// possible is the SILENCE around it. So this test takes the hop the other one
// cannot: every helper a read-gated handler calls out of a module that changes
// rows anywhere has to be written down below by a person, and a helper written
// down as a write has to be named in inventoryReadGate's own doc comment. A
// second writing helper added behind the read gate fails here until somebody
// decides in writing that it may be there; the sweep quietly dropping out of
// that comment fails here too, because the comment returning to its absolute
// wording IS the defect coming back.

/** Every helper a read-gated handler calls out of a module that changes rows
 *  somewhere, with the verdict a person reached about it. "writes" means it
 *  does change rows and inventoryReadGate's doc comment argues for it by name;
 *  "reads" means somebody read it and it changes nothing — it merely lives in a
 *  module whose other exports do. */
const HELPERS_FROM_WRITING_MODULES: Record<string, "writes" | "reads"> = {
  sweepExpiredReservations: "writes",
};

/** `@/lib/...` resolved to the file it means, or null for an import that is not
 *  one of our library modules (a node package, a component, the alias pointing
 *  somewhere else). */
function libFileFor(spec: string): string | null {
  if (!spec.startsWith("@/lib/")) return null;
  const base = join(SRC, ...spec.slice(2).split("/"));
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(candidate)) return candidate;
  assert.fail(`${spec} no longer resolves under src/ — the library moved and this test can no longer follow it`);
}

/** The named imports of a file as { local name, module specifier }. The local
 *  name is what the handler body calls, so `a as b` is recorded as `b`, and a
 *  `type` import is dropped: it is not a call. */
function namedImports(source: string): { local: string; spec: string }[] {
  const out: { local: string; spec: string }[] = [];
  for (const m of source.matchAll(/import\s+\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
    for (const piece of m[1].split(",")) {
      const local = piece.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
      if (/^[A-Za-z_$][\w$]*$/.test(local)) out.push({ local, spec: m[2] });
    }
  }
  return out;
}

/** Whether this handler calls `name(` itself. An indexOf walk and not a
 *  pattern: the character before the name has to be a boundary, so a longer
 *  identifier that merely ends in the same letters is not read as a call to
 *  this one. */
function callsHelper(body: string, name: string): boolean {
  const WORDY = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$.";
  for (let at = body.indexOf(name); at !== -1; at = body.indexOf(name, at + 1)) {
    if (at > 0 && WORDY.includes(body[at - 1])) continue;
    if (body.slice(at + name.length).trimStart().startsWith("(")) return true;
  }
  return false;
}

/** inventoryReadGate's own doc comment — the place a sanctioned write has to be
 *  named, and the place the next author will look. */
function readGateDoc(): string {
  const at = ACCESS.indexOf("export async function inventoryReadGate(");
  assert.ok(at > 0, "inventoryReadGate has been renamed or has left src/lib/inventory/access.ts");
  const start = ACCESS.lastIndexOf("/**", at);
  assert.ok(start !== -1, "inventoryReadGate has lost its doc comment");
  const doc = ACCESS.slice(start, at);
  assert.ok(doc.trimEnd().endsWith("*/"), "inventoryReadGate has lost its doc comment");
  return doc;
}

test("a write behind the read gate is one a person sanctioned, and is named at the gate", () => {
  const doc = readGateDoc();
  const seen: string[] = [];
  for (const [key, gate] of Object.entries(EXPECTED)) {
    if (gate !== "inventoryReadGate") continue;
    const [file, method] = key.split(" ");
    const source = readFileSync(join(API, file), "utf8");
    const body = handlerBody(source, method);
    assert.ok(body, `${key} has gone missing`);
    for (const { local, spec } of namedImports(source)) {
      // Imports are per FILE and handlers are per method — designs/route.ts has
      // a read handler and two write handlers sharing one import list — so the
      // question is what THIS handler calls, not what the file imports.
      if (!callsHelper(body, local)) continue;
      const lib = libFileFor(spec);
      // Module granularity, deliberately coarse in the safe direction: if
      // nothing in that module changes a row then neither does this helper, and
      // if something does, a person decides which of the two it is.
      if (!lib || !WRITES.test(readFileSync(lib, "utf8"))) continue;
      seen.push(local);
      assert.ok(
        HELPERS_FROM_WRITING_MODULES[local],
        `${key} calls ${local}() out of ${spec}, a module that changes rows, and nothing here says whether ` +
          `that call writes. Read it. If it only reads, record it as "reads". If it writes, it is a second ` +
          `exception to the read gate's promise and needs the argument the sweep has: record it as "writes" ` +
          "and say in inventoryReadGate's doc comment why a view-grant login may trigger it.",
      );
      if (HELPERS_FROM_WRITING_MODULES[local] === "writes") {
        assert.ok(
          doc.includes(local),
          `${local}() changes rows behind inventoryReadGate and the gate's own doc comment does not name it. ` +
            "That comment is the whole account of what a view-grant login can set off, and an unqualified " +
            "promise there is worse than no promise: the next author places a handler on the strength of it.",
        );
      }
    }
  }
  // The other direction, as with EXPECTED: a name recorded here that no
  // read-gated handler reaches any more is a sanction nobody asked for, and it
  // would sit in the table outliving the reason it was granted.
  assert.deepEqual(
    [...new Set(seen)].sort(),
    Object.keys(HELPERS_FROM_WRITING_MODULES).sort(),
    "the helpers recorded here and the helpers the read-gated handlers actually call have drifted apart",
  );
});
