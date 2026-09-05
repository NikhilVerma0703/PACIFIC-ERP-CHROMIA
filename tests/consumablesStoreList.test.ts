import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

// THE STORE'S LIST, AS THE SERVER ENFORCES IT. Two pieces of code decide what
// a machine may draw from stock and what the store may add to it:
//
//   logConsumables (src/lib/consumables/quickLog.ts) — the machine-form panel.
//     DECREMENTS real inventory_stock. Must refuse a name the store never set
//     up AND a DIRECT_MATERIAL row (resin, grit, catalyst), before anything is
//     written. Until 2026-09-05 a replayed request naming "Resin : Orson" ran
//     the decrement against the resin row, because the lookup took every row
//     and only the browser dropdown left direct materials out.
//
//   POST /api/consumables/inventory — the store's add-item route. Must trim
//     and collapse the name so the case-insensitive lookup and the unique index
//     on lower("itemName") (scripts/0075) agree, and must turn a lost create
//     race (P2002) into a top-up rather than a 500.
//
// Both are "use server"/route modules that import prisma and the auth gates
// through the "@/" alias, which `node --test` cannot resolve and which would
// open a database if it could. Neither can export a sync predicate to test in
// isolation — a "use server" file may export only async functions. So this
// suite does the one thing that runs the real decision: a module resolve hook
// (node:module registerHooks, sync, Node ≥ 22.15) maps "@/lib/prisma" and the
// gates to recording fakes, maps everything else under "@/" to the real file
// in src/, and then imports the real modules and calls them. A fake that
// records every write is how the "nothing written before the refusal" claim
// is checked rather than read.

const ROOT = resolvePath(fileURLToPath(new URL(".", import.meta.url)), "..");
const src = (rel: string) => pathToFileURL(resolvePath(ROOT, "src", rel)).href;
const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;

// What the fakes hand back. Set per test; read by the stubs through globalThis
// because a data: URL module cannot close over this file's scope.
type G = typeof globalThis & { __fx: { db: unknown; user: unknown; allow: boolean } };
const g = globalThis as G;
g.__fx = { db: {}, user: null, allow: true };

const STUBS: Record<string, string> = {
  "@/lib/prisma": stub(`export const prisma = new Proxy({}, { get: (_, k) => globalThis.__fx.db[k] });`),
  "@/lib/stationAccess": stub(`export const canUseEntryModel = async () => globalThis.__fx.allow;`),
  // The real rank table, so "incharge and above" is tested against the plant's
  // own numbers and not a copy of them.
  "@/lib/rbac": stub(`export { ROLE_RANK, rankOf } from ${JSON.stringify(src("lib/roles.ts"))};
    export const currentUser = async () => globalThis.__fx.user;`),
  "@/lib/consumables/access": stub(`export const consumablesGate = async () => ({ ok: true });`),
};

/** Next's "@/x" alias and its extensionless relative imports, resolved the
 *  way the bundler would: "@/" is src/, and a bare path tries .ts / .tsx. */
function withTsExtension(fileUrl: string): string {
  const p = fileURLToPath(fileUrl);
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (existsSync(p + ext) && !p.endsWith("/")) {
    if (ext === "" && !/\.[cm]?[jt]sx?$/.test(p)) continue;
    return pathToFileURL(p + ext).href;
  }
  return fileUrl;
}

before(() => {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true, format: "module" };
      if (specifier.startsWith("@/")) return { url: withTsExtension(src(specifier.slice(2))), shortCircuit: true };
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
        const abs = new URL(specifier, context.parentURL).href;
        const fixed = withTsExtension(abs);
        if (fixed !== abs) return { url: fixed, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
});

// ---------------------------------------------------------------------------
// logConsumables — the machine-form panel that moves stock
// ---------------------------------------------------------------------------

interface Recorded { tx: number; entries: unknown[]; decrements: unknown[][] }

/** Two rows on the shelf: a consumable, and the resin the mixer weighs. */
const STOCK = [
  { id: "stock-resin", itemName: "Resin : Orson", unit: "KG", category: "DIRECT_MATERIAL" },
  { id: "stock-gloves", itemName: "Gloves", unit: "PCS", category: "PRODUCTION_CONSUMABLE" },
  { id: "stock-grit", itemName: "Quartz Grit : Phenikaa Cristobalite 0.1-0.4MM", unit: "KG", category: "DIRECT_MATERIAL" },
];

function quickLogDb(): { db: unknown; rec: Recorded } {
  const rec: Recorded = { tx: 0, entries: [], decrements: [] };
  const tx = {
    consumptionEntry: { create: async (a: { data: unknown }) => { rec.entries.push(a.data); return a.data; } },
    $executeRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => { rec.decrements.push(vals); return 1; },
  };
  const db = {
    consumableDepartment: { upsert: async () => ({ id: "dept-press", name: "Press" }) },
    inventoryStock: { findMany: async () => STOCK },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => { rec.tx++; return fn(tx); },
  };
  return { db, rec };
}

async function quickLog() {
  const mod = await import(src("lib/consumables/quickLog.ts"));
  return mod.logConsumables as (model: string, lines: unknown[], ctx?: unknown) => Promise<string>;
}

const asIncharge = () => { g.__fx.user = { name: "Ravi", role: "INCHARGE", branch: "PRODUCTION" }; g.__fx.allow = true; };

test("a consumable the store set up is logged under the shelf's own spelling and decremented once", async () => {
  asIncharge();
  const { db, rec } = quickLogDb(); g.__fx.db = db;
  const log = await quickLog();
  const r = await log("Press", [{ itemName: "gloves", quantity: 4, unit: "kg" }], { batch: "D1425" });
  assert.equal(r, "ok");
  assert.equal(rec.tx, 1);
  assert.equal(rec.entries.length, 1);
  const e = rec.entries[0] as Record<string, unknown>;
  // The stock row's spelling and unit, not the caller's — "gloves"/"kg" typed
  // at the machine would otherwise be a second item in KG on every dashboard.
  assert.equal(e.itemName, "Gloves");
  assert.equal(e.unit, "PCS");
  assert.equal(e.inventoryStockId, "stock-gloves");
  assert.equal(e.source, "floor");
  assert.equal(e.batchKey, "1425");
  assert.deepEqual(rec.decrements, [[4, "stock-gloves"]]);
});

test("a DIRECT_MATERIAL row is 'not on the store's list' — refused by name, and nothing is written", async () => {
  asIncharge();
  const { db, rec } = quickLogDb(); g.__fx.db = db;
  const log = await quickLog();
  // Exactly the replay the review demonstrated: the row exists, the panel
  // never offers it, and a request naming it must not reach the decrement.
  const r = await log("Press", [{ itemName: "Resin : Orson", quantity: 25, unit: "KG" }], { batch: "1425" });
  assert.match(r, /not on the store's list/);
  assert.match(r, /Resin : Orson/);
  assert.equal(rec.tx, 0, "the transaction must not open for a direct material");
  assert.deepEqual(rec.entries, []);
  assert.deepEqual(rec.decrements, [], "the resin row must not be decremented");
  // Case does not smuggle it through either.
  const r2 = await log("Press", [{ itemName: "resin : orson", quantity: 1, unit: "KG" }], { batch: "1425" });
  assert.match(r2, /not on the store's list/);
  assert.equal(rec.tx, 0);
});

test("one bad line refuses the whole request — the good line is not written either", async () => {
  asIncharge();
  const { db, rec } = quickLogDb(); g.__fx.db = db;
  const log = await quickLog();
  const r = await log("Press", [
    { itemName: "Gloves", quantity: 2, unit: "PCS" },
    { itemName: "Quartz Grit : Phenikaa Cristobalite 0.1-0.4MM", quantity: 500, unit: "KG" },
    { itemName: "Emery Paper", quantity: 3, unit: "PCS" },
  ], { batch: "1425" });
  assert.match(r, /not on the store's list/);
  // Both offenders are named, the good line is not.
  assert.match(r, /Quartz Grit : Phenikaa Cristobalite 0\.1-0\.4MM/);
  assert.match(r, /Emery Paper/);
  assert.doesNotMatch(r, /Gloves/);
  assert.equal(rec.tx, 0);
  assert.deepEqual(rec.decrements, []);
});

test("no batch, no write — the line would be readable by nothing", async () => {
  asIncharge();
  const { db, rec } = quickLogDb(); g.__fx.db = db;
  const log = await quickLog();
  const r = await log("Press", [{ itemName: "Gloves", quantity: 1, unit: "PCS" }], { batch: "  " });
  assert.match(r, /batch/i);
  assert.equal(rec.tx, 0);
});

test("the gates still stand in front of the list: operator rank, fab branch, unknown form", async () => {
  const { db, rec } = quickLogDb(); g.__fx.db = db;
  const log = await quickLog();
  g.__fx.user = { name: "Op", role: "OPERATOR", branch: "PRODUCTION" }; g.__fx.allow = true;
  assert.match(await log("Press", [{ itemName: "Gloves", quantity: 1, unit: "PCS" }], { batch: "1" }), /incharges/);
  g.__fx.user = { name: "Fab", role: "INCHARGE", branch: "FABRICATION" };
  assert.match(await log("Press", [{ itemName: "Gloves", quantity: 1, unit: "PCS" }], { batch: "1" }), /fabrication/i);
  asIncharge();
  assert.match(await log("NotAForm", [{ itemName: "Gloves", quantity: 1, unit: "PCS" }], { batch: "1" }), /no consumables department/);
  g.__fx.allow = false;
  assert.match(await log("Press", [{ itemName: "Gloves", quantity: 1, unit: "PCS" }], { batch: "1" }), /Not allowed/);
  assert.equal(rec.tx, 0);
});

// ---------------------------------------------------------------------------
// POST /api/consumables/inventory — the store's add-item route
// ---------------------------------------------------------------------------

interface RouteRec {
  findFirstNames: string[];
  created: Record<string, unknown>[];
  updated: { where: unknown; data: Record<string, unknown> }[];
  receipts: Record<string, unknown>[];
}

/** `findFirst` answers from the queue in order (so a race can say "nothing"
 *  first and "the winner" second); `create` throws whatever `createThrows` holds. */
function routeDb(opts: { findFirst: Array<Record<string, unknown> | null>; createThrows?: unknown }) {
  const rec: RouteRec = { findFirstNames: [], created: [], updated: [], receipts: [] };
  const answers = [...opts.findFirst];
  const tx = {
    inventoryStock: {
      create: async (a: { data: Record<string, unknown> }) => {
        if (opts.createThrows) throw opts.createThrows;
        const row = { id: "new-1", ...a.data };
        rec.created.push(row);
        return row;
      },
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        rec.updated.push(a);
        return { id: a.where.id, itemName: "Gloves", unit: "PCS", currentStock: 30, minStock: 5 };
      },
    },
    inventoryEntry: { create: async (a: { data: Record<string, unknown> }) => { rec.receipts.push(a.data); return a.data; } },
  };
  const db = {
    inventoryStock: {
      findFirst: async (a: { where: { itemName: { equals: string } } }) => {
        rec.findFirstNames.push(a.where.itemName.equals);
        return answers.length ? answers.shift() : null;
      },
    },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { db, rec };
}

async function post(body: unknown) {
  const mod = await import(src("app/api/consumables/inventory/route.ts"));
  const res: Response = await mod.POST(new Request("http://erp.local/api/consumables/inventory", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

test("the name is trimmed and its whitespace collapsed BEFORE the lookup, so lookup and index agree", async () => {
  const { db, rec } = routeDb({ findFirst: [null] }); g.__fx.db = db;
  const r = await post({ itemName: "  Gloves   Nitrile ", category: "PRODUCTION_CONSUMABLE", unit: "PCS", currentStock: 10 });
  assert.equal(r.status, 201);
  // lower('Gloves ') <> lower('Gloves'): an untrimmed name would pass both the
  // findFirst and the lower("itemName") index and make a second row.
  assert.deepEqual(rec.findFirstNames, ["Gloves Nitrile"]);
  assert.equal(rec.created[0]?.itemName, "Gloves Nitrile");
  assert.equal(r.json.itemName, "Gloves Nitrile");
});

test("a name that is only whitespace is a missing name, not a row called ' '", async () => {
  const { db, rec } = routeDb({ findFirst: [null] }); g.__fx.db = db;
  const r = await post({ itemName: "   ", category: "PRODUCTION_CONSUMABLE", unit: "PCS", currentStock: 10 });
  assert.equal(r.status, 400);
  assert.deepEqual(rec.findFirstNames, []);
  assert.deepEqual(rec.created, []);
});

test("losing the create race (P2002) tops up the winner's row instead of answering 500", async () => {
  const winner = { id: "won-7", itemName: "Gloves", unit: "PCS", currentStock: 20, minStock: 5 };
  // First read: nobody has it. The create then trips the lower("itemName")
  // index because another clerk got there first. Second read: the winner.
  const { db, rec } = routeDb({ findFirst: [null, winner], createThrows: Object.assign(new Error("Unique constraint failed"), { code: "P2002" }) });
  g.__fx.db = db;
  const r = await post({ itemName: "gloves", category: "PRODUCTION_CONSUMABLE", unit: "BOX", currentStock: 10 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.toppedUp, true);
  assert.equal(r.json.received, 10);
  assert.deepEqual(rec.findFirstNames, ["gloves", "gloves"]);
  assert.equal(rec.created.length, 0);
  assert.equal(rec.updated.length, 1);
  assert.deepEqual(rec.updated[0].where, { id: "won-7" });
  // An increment, not a set: the winner's own receipt must survive.
  assert.deepEqual(rec.updated[0].data.currentStock, { increment: 10 });
  // The receipt is logged in the shelf's unit, not the loser's "BOX".
  assert.equal(rec.receipts.length, 1);
  assert.equal(rec.receipts[0].unit, "PCS");
  assert.equal(rec.receipts[0].inventoryStockId, "won-7");
});

test("the raw Postgres 23505 is treated the same as P2002", async () => {
  const winner = { id: "won-8", itemName: "Gloves", unit: "PCS", currentStock: 20, minStock: 5 };
  const { db, rec } = routeDb({ findFirst: [null, winner], createThrows: Object.assign(new Error("dup"), { code: "23505" }) });
  g.__fx.db = db;
  const r = await post({ itemName: "Gloves", category: "PRODUCTION_CONSUMABLE", unit: "PCS", currentStock: 3 });
  assert.equal(r.status, 200);
  assert.equal(rec.updated.length, 1);
});

test("any other failure of the create is still a 500, and a P2002 with no row to top up is too", async () => {
  const boom = Object.assign(new Error("connection reset"), { code: "P1017" });
  const a = routeDb({ findFirst: [null, null], createThrows: boom }); g.__fx.db = a.db;
  const r1 = await post({ itemName: "Gloves", category: "PRODUCTION_CONSUMABLE", unit: "PCS", currentStock: 3 });
  assert.equal(r1.status, 500);
  assert.deepEqual(a.rec.findFirstNames, ["Gloves"], "a non-unique error must not trigger the re-read");
  assert.equal(a.rec.updated.length, 0);
  // P2002 but the re-read finds nothing (index hit on something the lookup
  // cannot see): surface it rather than invent a top-up target.
  const b = routeDb({ findFirst: [null, null], createThrows: Object.assign(new Error("dup"), { code: "P2002" }) }); g.__fx.db = b.db;
  const r2 = await post({ itemName: "Gloves", category: "PRODUCTION_CONSUMABLE", unit: "PCS", currentStock: 3 });
  assert.equal(r2.status, 500);
  assert.equal(b.rec.updated.length, 0);
});

test("the ordinary top-up path is unchanged: an existing shelf receives, category is not required", async () => {
  const existing = { id: "old-1", itemName: "Gloves", unit: "PCS", currentStock: 20, minStock: 5 };
  const { db, rec } = routeDb({ findFirst: [existing] }); g.__fx.db = db;
  const r = await post({ itemName: "Gloves", unit: "PCS", currentStock: 10, minStock: "" });
  assert.equal(r.status, 200);
  assert.equal(r.json.toppedUp, true);
  assert.deepEqual(rec.updated[0].data, { currentStock: { increment: 10 } }, "a blank minStock box must not clear the threshold");
  assert.equal(rec.created.length, 0);
});
