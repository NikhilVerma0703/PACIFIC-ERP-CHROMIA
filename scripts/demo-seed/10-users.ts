/**
 * DEMO SEED — module 10: users
 * =============================================================================
 * Target: the `pacificdemo` database ONLY. Every person, address and password
 * below is invented. Nothing here is a real Pacific login.
 *
 * `db` is an already-connected PrismaClient pointed at the demo database and is
 * used directly. This file deliberately imports NOTHING — in particular not
 * the app's production Prisma singleton from the lib alias.
 *
 * Writes: User (prisma model `user`, table `users`).
 * Adds to ctx: ctx.users — the logins the database ACTUALLY holds, read back
 * after writing and in the order written, so later modules can hang foreign
 * keys off ctx.users[n].id without one skipped insert here dangling in theirs.
 */

export type Ctx = {
  designs: string[];
  batches: string[];
  users: { id: string; name: string; email: string; role: string }[];
  clients: { id: string; name: string }[];
  now: Date;
  daysAgo: (n: number) => Date;
  [k: string]: any;
};

/**
 * THE DEMO LOGIN'S PASSWORD IS "demo".
 *
 * This is a bcrypt hash of the literal string "demo" at cost 10, generated and
 * verified with the repo's own bcryptjs (the same library src/auth.ts compares
 * with) before being pasted here:
 *
 *     bcrypt.compareSync("demo", DEMO_PASSWORD_HASH) === true
 *
 * NOTE FOR WHOEVER WROTE THE BRIEF: the hash supplied in the module brief
 * ($2a$10$N9qo8uLOickgx2ZMRZoMye...) is the well-known tutorial hash and does
 * NOT verify against "demo" — compareSync returned false for "demo", "secret",
 * "password" and "demo123". Pasting it would have produced a demo login nobody
 * could sign in to, which is the one thing this module must get right, so it
 * was replaced with a hash that actually verifies. Re-check before changing it.
 */
const DEMO_PASSWORD_HASH = "$2a$10$ctYA6W/4msS.Vzk8kIVVd.nmUmH8ZQHp2I44YQ6VeGY992pqKIytK";

/** Role enum, spelled exactly as prisma/schema.prisma declares it. */
const ROLES = new Set([
  "OPERATOR", "INCHARGE", "LINE_MANAGER", "ADMIN", "FINANCE", "ACCOUNTS",
  "SALES", "COMMERCIAL", "STORE", "MAINTENANCE", "ROBO", "CHROMIA",
  "COMMERCIAL_MANAGER", "SAMPLING", "COMMERCIAL_DOCS", "COMMERCIAL_EXEC",
  "COMMERCIAL_LOGISTICS",
]);

/** Branch enum. CHROMIA is retired in the schema and is never used here. */
const BRANCHES = new Set(["SHOP_FLOOR", "OFFICE", "FABRICATION", "INTERNATIONAL_SALES"]);

/** Station enum, spelled exactly as prisma/schema.prisma declares it. Checked
 *  like role and branch are: station is nullable, so an unknown spelling should
 *  cost that one user their station, not fail the whole insert. */
const STATIONS = new Set([
  "PRESS", "OVEN", "JOT", "MIXER", "KREOS", "DISTRIBUTOR", "SILO",
  "POLISH_QC", "POLISH_ENTRY", "CUTTING",
]);

const DEMO_ID = "demo-usr-00";

type Row = {
  id: string;
  email: string;
  name: string;
  role: string;
  branch: string;
  station?: string;
  ageDays: number;      // createdAt = ctx.daysAgo(ageDays)
  fgView?: boolean;
};

/** The login the demo is actually given: demo@pacific.demo / demo */
const DEMO_USER: Row = {
  id: DEMO_ID,
  email: "demo@pacific.demo",
  name: "Demo User",
  role: "ADMIN",
  branch: "OFFICE",
  ageDays: 90,
  fgView: true,
};

/**
 * Eight invented staff, one per role worth showing, spread across branches so
 * the Users & Roles screen has shape. All share the demo password, so any of
 * them can be signed into during a walkthrough.
 */
const STAFF: Row[] = [
  { id: "demo-usr-01", email: "ramesh.kumar@pacific.demo",    name: "Ramesh Kumar",       role: "LINE_MANAGER",       branch: "SHOP_FLOOR",  ageDays: 88 },
  { id: "demo-usr-02", email: "priya.nair@pacific.demo",      name: "Priya Nair",         role: "COMMERCIAL_MANAGER", branch: "OFFICE",      ageDays: 84 },
  { id: "demo-usr-03", email: "arun.subramanian@pacific.demo", name: "Arun Subramanian",  role: "INCHARGE",           branch: "SHOP_FLOOR",  station: "POLISH_QC", ageDays: 76 },
  { id: "demo-usr-04", email: "kavitha.raman@pacific.demo",   name: "Kavitha Raman",      role: "COMMERCIAL",         branch: "OFFICE",      ageDays: 61 },
  { id: "demo-usr-05", email: "suresh.balan@pacific.demo",    name: "Suresh Balan",       role: "OPERATOR",           branch: "SHOP_FLOOR",  station: "PRESS", ageDays: 47 },
  { id: "demo-usr-06", email: "deepa.krishnan@pacific.demo",  name: "Deepa Krishnan",     role: "FINANCE",            branch: "OFFICE",      ageDays: 33 },
  { id: "demo-usr-07", email: "vignesh.iyer@pacific.demo",    name: "Vignesh Iyer",       role: "OPERATOR",           branch: "FABRICATION", station: "CUTTING", ageDays: 19, fgView: true },
  { id: "demo-usr-08", email: "anitha.menon@pacific.demo",    name: "Anitha Menon",       role: "STORE",              branch: "SHOP_FLOOR",  ageDays: 8 },
];

export async function seed(db: any, ctx: Ctx): Promise<void> {
  const daysAgo = typeof ctx?.daysAgo === "function" ? ctx.daysAgo : (n: number) => new Date(Date.now() - n * 86400000);

  const toData = (r: Row, createdById: string | null) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    passwordHash: DEMO_PASSWORD_HASH,
    role: ROLES.has(r.role) ? r.role : "OPERATOR",
    branch: BRANCHES.has(r.branch) ? r.branch : "SHOP_FLOOR",
    station: r.station && STATIONS.has(r.station) ? r.station : null,
    active: true,
    sessionVersion: 1,
    fgView: r.fgView ?? false,
    createdById,
    createdAt: daysAgo(r.ageDays),
  });

  // --- users, pass 1: THE DEMO LOGIN ---------------------------------------
  // Written on its own, before anything else, for two reasons: it is the row
  // the whole demo hangs on, so a failure further down must not take it with
  // it; and it is the parent of every createdById below.
  let demoOk = false;
  try {
    await db.user.createMany({ data: [toData(DEMO_USER, null)], skipDuplicates: true });
  } catch (e) {
    console.warn("  [users] skipped:", (e as Error).message);
  }
  // A call that did not throw is not the same as a row that exists:
  // skipDuplicates silently drops the insert if some row already holds this
  // email under a different id, and every staff row below points createdById at
  // DEMO_ID. Ask the database instead of trusting the call.
  try {
    demoOk = Boolean(await db.user.findUnique({ where: { id: DEMO_ID }, select: { id: true } }));
  } catch (e) {
    console.warn("  [users] demo-login check skipped:", (e as Error).message);
  }

  // --- users, pass 2: THE STAFF --------------------------------------------
  // createdById points at the demo login, which pass 1 has already committed.
  try {
    await db.user.createMany({
      data: STAFF.map((r) => toData(r, demoOk ? DEMO_ID : null)),
      skipDuplicates: true,
    });
  } catch (e) {
    console.warn("  [users] skipped:", (e as Error).message);
  }

  // --- users, pass 3: anything the harness pre-loaded into ctx.users --------
  // If ctx.users arrived already populated, those ids may be referenced by a
  // later module, so give every one of them a real row rather than a dangling
  // foreign key. Emails already written above are skipped; role and branch are
  // coerced to the enum so one bad string cannot fail the insert.
  const preloaded: any[] = Array.isArray(ctx?.users) ? ctx.users : [];
  const mine = new Set([DEMO_USER, ...STAFF].map((r) => r.email.toLowerCase()));
  const extras = preloaded
    .filter((u) => u && typeof u.email === "string" && !mine.has(u.email.toLowerCase()))
    .map((u, i) => ({
      id: typeof u.id === "string" && u.id ? u.id : `demo-usr-x${i}`,
      email: u.email,
      name: typeof u.name === "string" ? u.name : null,
      passwordHash: DEMO_PASSWORD_HASH,
      role: ROLES.has(u.role) ? u.role : "OPERATOR",
      branch: BRANCHES.has(u.branch) ? u.branch : "SHOP_FLOOR",
      active: true,
      createdById: demoOk ? DEMO_ID : null,
      createdAt: daysAgo(70 - (i % 60)),
    }));
  if (extras.length) {
    try {
      await db.user.createMany({ data: extras, skipDuplicates: true });
    } catch (e) {
      console.warn("  [users] skipped:", (e as Error).message);
    }
  }

  // --- hand the real rows to later modules ---------------------------------
  // READ BACK rather than publish the list above. Every insert here is wrapped
  // in try/catch, so any of them may have been swallowed — and 20-catalogue,
  // 60-fab and 70-sampling all hang columns off ctx.users[n].id. Publishing an
  // id whose row never landed turns one skipped table here into a failed table
  // in each of them; publishing nothing makes those modules write null, which
  // is what their `users.length ? … : null` fallbacks are for. Same rule
  // 70-sampling states for its own catalogue reads.
  const wanted = [DEMO_USER, ...STAFF]
    .map((r) => ({ id: r.id, email: r.email }))
    .concat(extras.map((u) => ({ id: u.id, email: u.email })));
  const order = new Map(wanted.map((r, i) => [r.id, i]));
  try {
    const rows: { id: string; name: string | null; email: string; role: unknown }[] =
      await db.user.findMany({
        where: { id: { in: wanted.map((r) => r.id) } },
        select: { id: true, name: true, email: true, role: true },
      });
    ctx.users = rows
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((u) => ({ id: u.id, name: u.name ?? u.email, email: u.email, role: String(u.role) }));
  } catch (e) {
    console.warn("  [users] read-back skipped:", (e as Error).message);
    ctx.users = [];
  }

  const missing = wanted.length - ctx.users.length;
  if (missing > 0) console.warn(`  [users] ${missing} login(s) did not land — later modules will write null instead`);
  console.log(`  [users] ${ctx.users.length} logins (demo@pacific.demo / demo)`);
}
