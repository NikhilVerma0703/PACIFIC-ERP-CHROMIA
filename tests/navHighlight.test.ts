import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The sidebar's highlight rule, pinned against the thing it actually depends
// on: the shape of the app's routes. Nav.tsx is a client component that imports
// next/navigation, so `node --test` cannot load it — but the rule's premises
// are facts about src/app and about the nav's own href list, and those are what
// rot. Both assertions below are re-derivations of a hand audit, so the audit
// re-runs on every commit instead of ageing inside a comment.
//
// WHY: a comment claimed a whole class of bug was handled. The boundary clause
// in NavLink (`path === href || path.startsWith(href + "/")`) reads as though it
// stopped one nav row lighting another, and it does not — `exact: true` did.
// The next person to hit a double-lit row needs to reach for `exact`, and will
// not if the code looks like it already covers them.

// ---------------------------------------------------------------------------
// The two inputs
// ---------------------------------------------------------------------------

const SKIP = new Set(["node_modules", ".next", ".git"]);

/** Every page route in the App Router, as the path a browser would show. */
function routes(dir = "src/app", out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) routes(full, out);
    else if (name === "page.tsx" || name === "page.ts") {
      const p = dir.replace(/\\/g, "/").replace(/^src\/app/, "").replace(/\/\([^)]*\)/g, "");
      out.push(p === "" ? "/" : p);
    }
  }
  return out;
}

const ROUTES = routes();
// The Commercial rows moved out of Nav.tsx on 2026-09-08: they are built from
// the area table now (nav-rules.commercialNavRows), so the audit reads both
// files. Same reason as before: the hrefs are what rot, wherever they sit.
const NAV = [
  readFileSync("src/components/Nav.tsx", "utf8"),
  readFileSync("src/lib/commercial/nav-rules.ts", "utf8"),
].join("\n");

/** Every href the sidebar can render, with whether its row carries `exact`.
 *  Both spellings appear in Nav.tsx: object items (`{ href: "/x", … }`) and the
 *  handful of bare <NavLink href="/x" …> rows. */
function navHrefs(): { href: string; exact: boolean }[] {
  const found = new Map<string, boolean>();
  for (const line of NAV.split(/\r?\n/)) {
    if (/^\s*(\*|\/\/)/.test(line)) continue;          // a comment quoting a path is not a row
    for (const m of line.matchAll(/href[:=]\s*"(\/[^"]*)"/g)) {
      const exact = /\bexact:\s*true\b/.test(line);
      // A href written twice (e.g. /slab-intake, once per role branch) is
      // `exact` only if EVERY row that draws it says so.
      found.set(m[1], (found.get(m[1]) ?? true) && exact);
    }
  }
  return [...found].map(([href, exact]) => ({ href, exact })).sort((a, b) => a.href.localeCompare(b.href));
}

const HREFS = navHrefs();

test("the fixtures are real — the scan found the app and the nav", () => {
  // If either list comes back tiny the assertions below pass vacuously, which
  // is the failure mode a source-scanning guard actually dies of.
  assert.ok(ROUTES.length > 90, `expected the whole app, found ${ROUTES.length} routes`);
  assert.ok(HREFS.length > 50, `expected the whole sidebar, found ${HREFS.length} hrefs`);
  assert.ok(ROUTES.includes("/scoreboard/incentive") && HREFS.some((h) => h.href === "/scoreboard/incentive"));
});

// ---------------------------------------------------------------------------
// What the boundary clause does
// ---------------------------------------------------------------------------

test("the boundary clause is inert on today's routes — it changes no highlight", () => {
  // NavLink requires the character after a matched href to be "/". That only
  // ever differs from a plain startsWith when a nav href is a prefix of a real
  // path MID-SEGMENT — /report against a future /report-archive. There is no
  // such pair today, which is the honest reading of the clause: a guard for the
  // next href somebody adds, not a fix for anything on screen. When this fails,
  // the clause has started earning its keep — update the comment in Nav.tsx
  // that says it does not, rather than deleting this test.
  const midSegment: string[] = [];
  for (const { href } of HREFS) {
    if (href === "/") continue;                        // matched exactly, never by prefix
    for (const route of ROUTES) {
      if (route !== href && route.startsWith(href) && route[href.length] !== "/") {
        midSegment.push(`${href} -> ${route}`);
      }
    }
  }
  assert.deepEqual(midSegment, []);
});

// ---------------------------------------------------------------------------
// What it does NOT do
// ---------------------------------------------------------------------------

test("a nested nav row still lights its parent unless the parent says exact", () => {
  // The boundary clause does nothing here: /scoreboard/incentive meets
  // /scoreboard AT a boundary, so it matches. `exact: true` on the parent row
  // is the only thing that stops the sidebar bolding two rows at once.
  //
  // This is the pinned inventory of every nav href that is the parent of
  // another nav href. Adding a nested row without `exact` fails this test, and
  // the fix is `exact`, not a cleverer prefix rule.
  const parents = HREFS.filter(({ href }) =>
    HREFS.some((o) => o.href.startsWith(href + "/"))).map((h) => h.href);
  assert.deepEqual(parents, [
    "/fab/supervisor",   // NOT exact, and WRONG: Cut Queue stays lit beside its
                         // four /fab/supervisor/* rows. Left as it is on purpose
                         // — /fab/supervisor/sinks has no row of its own and
                         // needs Cut Queue lit, so a bare `exact` here would
                         // only move the damage. Wants an "exact unless another
                         // row claims the path" rule; nobody has written one.
    "/maintenance",      // exact in MAINTENANCE_TABS, where /maintenance/uptime
                         // is a row beside it. The admin sidebar's own
                         // Maintenance Log row is not exact and does not need to
                         // be: /maintenance/uptime is not a row in that nav, so
                         // lighting the parent is the wanted drill-down.
    "/office",           // never uses this rule — the office arm matches Shop
                         // Floor against SHOP_PATHS instead. Also wrong, and in
                         // the other direction: that arm is a raw startsWith, so
                         // /slab-intake lights Shop Floor via "/slab".
    "/office/commercial", // exact — the Commercial module's Overview row sits
                         // above eight /office/commercial/* rows (scripts/0076).
    "/report",           // exact
    "/robo",             // exact
    "/sales",            // special-cased alongside "/" in NavLink: matched exactly
    "/sampling",         // exact
    "/scoreboard",       // exact — the row this whole rule was written for
  ]);
});

test("every row that must be exact says so", () => {
  // The four above that are neither exact nor deliberately special-cased are
  // named here rather than left to a reader to work out from the list.
  const NOT_EXACT_ON_PURPOSE = new Set(["/fab/supervisor", "/office", "/sales", "/maintenance"]);
  const missing = HREFS.filter(({ href, exact }) =>
    !exact && !NOT_EXACT_ON_PURPOSE.has(href) && HREFS.some((o) => o.href.startsWith(href + "/")));
  assert.deepEqual(missing.map((h) => h.href), [],
    "this nav row is the parent of another nav row, so both light at once — give the parent `exact: true`");
});

test("the highlight never depends on a query string", () => {
  // `path` is usePathname(), which carries no "?" — the /scoreboard row's own
  // comment relies on it, and the arm that tested for one could never fire.
  assert.ok(!/\+\s*"\?"/.test(NAV),
    "Nav.tsx matches on a query string again; usePathname() never returns one, so the arm is dead");
});
