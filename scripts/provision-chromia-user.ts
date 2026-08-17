/**
 * Provision ONE Chromia account — fallback for when no admin login is handy.
 *
 * Chromia is a DEPARTMENT (branch = "CHROMIA"), NOT a new role. It reuses the
 * standard rank hierarchy with Chromia display labels (lib/rbac.ts):
 *     LINE_MANAGER -> "Chromia Manager"     (tier MANAGER)
 *     INCHARGE     -> "Chromia Supervisor"  (tier SUPERVISOR)
 *     OPERATOR     -> "Chromia Machine Operator" (tier EMPLOYEE)
 * Management screens (dashboards, masters, imports) need tier >= SUPERVISOR,
 * i.e. INCHARGE or LINE_MANAGER. OPERATOR only sees the floor stages.
 *
 * Creates exactly one row in "users": the chosen role + branch CHROMIA, active.
 * It never touches any other account — if the email exists it stops, unchanged.
 *
 * Never runs on deploy (build is "prisma generate && next build"). You run it
 * by hand, once.
 *
 * ---------------------------------------------------------------------------
 *   DATABASE_URL="<neon-url>"
 *   CHROMIA_EMAIL="chromia.manager@thepacific.group"
 *   CHROMIA_PASSWORD="<8+ chars you choose>"
 *   CHROMIA_ROLE="LINE_MANAGER"        # or INCHARGE / OPERATOR
 *   CONFIRM_PRODUCTION="yes"
 *   npx tsx scripts/provision-chromia-user.ts
 * Nothing is hardcoded: it refuses to run unless you supply email + password.
 * ---------------------------------------------------------------------------
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const EMAIL    = (process.env.CHROMIA_EMAIL ?? "").trim().toLowerCase();
const PASSWORD = process.env.CHROMIA_PASSWORD ?? "";
const NAME     = process.env.CHROMIA_NAME ?? "Chromia Manager";
const ROLE     = (process.env.CHROMIA_ROLE ?? "LINE_MANAGER").trim().toUpperCase();

// Only the three ranks Chromia uses. Not ADMIN (that would span every dept),
// not the office/sales roles.
const ALLOWED_ROLES = ["LINE_MANAGER", "INCHARGE", "OPERATOR"] as const;
const ROLE_LABEL: Record<string, string> = {
  LINE_MANAGER: "Chromia Manager (tier MANAGER)",
  INCHARGE:     "Chromia Supervisor (tier SUPERVISOR)",
  OPERATOR:     "Chromia Machine Operator (tier EMPLOYEE)",
};

function fail(msg: string): never { console.error("\n  ✖ " + msg + "\n"); process.exit(1); }

async function main(): Promise<void> {
  if (!EMAIL)    fail("CHROMIA_EMAIL is not set. Refusing to invent an address.");
  if (!PASSWORD) fail("CHROMIA_PASSWORD is not set. Refusing to invent a password.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL)) fail(`CHROMIA_EMAIL is not a valid email: ${EMAIL}`);
  if (PASSWORD.length < 8) fail("CHROMIA_PASSWORD must be at least 8 characters.");
  if (!(ALLOWED_ROLES as readonly string[]).includes(ROLE))
    fail(`CHROMIA_ROLE must be one of: ${ALLOWED_ROLES.join(", ")} (got "${ROLE}").`);

  const url = process.env.DATABASE_URL ?? "";
  if (!url) fail("DATABASE_URL is not set.");
  let host = "unknown";
  try { host = new URL(url).hostname; } catch { fail("DATABASE_URL is not a valid URL."); }
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (!isLocal && process.env.CONFIRM_PRODUCTION !== "yes")
    fail(`DATABASE_URL points at "${host}" (not local). Re-run with CONFIRM_PRODUCTION=yes if that is deliberate.`);

  console.log("");
  console.log(`  Target database : ${host}${isLocal ? "  (local)" : "  (REMOTE)"}`);
  console.log(`  Account         : ${EMAIL}`);
  console.log(`  Role / Branch   : ${ROLE} (${ROLE_LABEL[ROLE]}) / CHROMIA`);
  console.log("");

  // Preflight: the production Branch enum must carry 'CHROMIA'. The module was
  // merged recently; if the ALTER TYPE ... ADD VALUE 'CHROMIA' has NOT been run
  // on this database, the insert below fails with an opaque enum error. Say so
  // clearly instead.
  const enumRows = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'Branch' AND e.enumlabel = 'CHROMIA'
    ) AS ok`;
  if (!enumRows[0]?.ok) {
    fail(
      "This database's Branch enum has no 'CHROMIA' value yet.\n" +
      "   The Chromia module code is merged, but the DB enum value is missing.\n" +
      "   Add it first (additive and safe, drops nothing):\n" +
      `   ALTER TYPE "Branch" ADD VALUE IF NOT EXISTS 'CHROMIA';`
    );
  }
  console.log("  ✔ Branch enum contains CHROMIA");

  const existing = await prisma.user.findUnique({
    where:  { email: EMAIL },
    select: { id: true, role: true, branch: true, active: true },
  });
  if (existing) {
    console.log("\n  A user with that email already exists — nothing changed.");
    console.log(`      role=${existing.role}  branch=${existing.branch}  active=${existing.active}`);
    console.log("  Pick a different CHROMIA_EMAIL, or adjust it from /admin/users.\n");
    return;
  }

  const before = await prisma.user.count();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const created = await prisma.user.create({
    data: {
      email: EMAIL,
      name: NAME,
      passwordHash,
      role: ROLE as never,       // LINE_MANAGER | INCHARGE | OPERATOR (all exist in Role enum)
      branch: "CHROMIA" as never, // the department
      active: true,
      // No station: Chromia (like Fabrication) has no shop-floor station column.
    },
    select: { id: true, email: true, role: true, branch: true },
  });
  const after = await prisma.user.count();

  console.log("\n  ✔ Created");
  console.log(`      id      : ${created.id}`);
  console.log(`      email   : ${created.email}`);
  console.log(`      role    : ${created.role}   (${ROLE_LABEL[ROLE]})`);
  console.log(`      branch  : ${created.branch}`);
  console.log(`\n  Users before: ${before}   after: ${after}   (delta ${after - before})`);
  console.log("  No other account was read, modified or deleted.");
  console.log("\n  Sign in at https://erp.pacific-surfaces.com -> the SHOP FLOOR card");
  console.log("  (Chromia has no card of its own; a CHROMIA login uses Shop Floor).");
  console.log("  The account lands on /chromia and is confined to it.\n");
}

main()
  .catch((e: unknown) => { console.error("\n  ✖ " + (e instanceof Error ? e.message : String(e)) + "\n"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
