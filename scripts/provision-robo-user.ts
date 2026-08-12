/**
 * Provision ONE Robo account — fallback only.
 *
 * Use this ONLY if nobody can sign in with an Incharge-or-above Shop Floor
 * account to use /admin/users. The UI is the correct route; this exists for the
 * chicken-and-egg case where no such login is available.
 *
 * What it does:  creates exactly one row in "users" with role ROBO,
 *                branch SHOP_FLOOR, active true.
 * What it never does:  touch, update or delete any other user. If the email
 *                already exists it stops and changes nothing.
 *
 * It is never executed by a deploy. `npm run build` is
 * "prisma generate && next build" — no seed step — so this file can sit in the
 * repo harmlessly. You run it by hand, once.
 *
 * ---------------------------------------------------------------------------
 * Run it against production (from your machine, NOT from Vercel):
 *
 *   PowerShell:
 *     $env:DATABASE_URL="<neon-pooled-url>"
 *     $env:ROBO_EMAIL="robo.incharge@thepacific.group"
 *     $env:ROBO_PASSWORD="<a password you choose, 8+ chars>"
 *     $env:CONFIRM_PRODUCTION="yes"
 *     npx tsx scripts/provision-robo-user.ts
 *
 * Nothing is hardcoded: no default email, no default password. It refuses to
 * run unless you supply both.
 * ---------------------------------------------------------------------------
 */
import { PrismaClient, Role, Branch } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const EMAIL    = (process.env.ROBO_EMAIL ?? "").trim().toLowerCase();
const PASSWORD = process.env.ROBO_PASSWORD ?? "";
const NAME     = process.env.ROBO_NAME ?? "Robo Incharge";

function fail(msg: string): never {
  console.error("\n  ✖ " + msg + "\n");
  process.exit(1);
}

async function main(): Promise<void> {
  // ---- inputs -------------------------------------------------------------
  if (!EMAIL)    fail("ROBO_EMAIL is not set. Refusing to invent an address.");
  if (!PASSWORD) fail("ROBO_PASSWORD is not set. Refusing to invent a password.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL)) fail(`ROBO_EMAIL is not a valid email: ${EMAIL}`);
  // src/app/admin/users/actions.ts enforces the same minimum.
  if (PASSWORD.length < 8) fail("ROBO_PASSWORD must be at least 8 characters.");

  const url = process.env.DATABASE_URL ?? "";
  if (!url) fail("DATABASE_URL is not set.");
  let host = "unknown";
  try { host = new URL(url).hostname; } catch { fail("DATABASE_URL is not a valid URL."); }

  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (!isLocal && process.env.CONFIRM_PRODUCTION !== "yes") {
    fail(
      `DATABASE_URL points at "${host}", which is not local.\n` +
      `   If that is deliberate, re-run with CONFIRM_PRODUCTION=yes.`
    );
  }

  console.log("");
  console.log(`  Target database : ${host}${isLocal ? "  (local)" : "  (REMOTE)"}`);
  console.log(`  Account         : ${EMAIL}`);
  console.log(`  Role / Branch   : ROBO / SHOP_FLOOR`);
  console.log("");

  // ---- preflight: does the DB's Role enum actually carry ROBO? ------------
  // The value was added to Neon out-of-band
  // (docs/PACIFIC-ERP-CONTEXT-2026-08-03.md section 5). If it is missing the
  // insert would fail with an opaque enum error, so check first and say so.
  if (!Role.ROBO) {
    fail("The generated Prisma client has no Role.ROBO — run `npx prisma generate` first.");
  }
  const enumRows = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'Role' AND e.enumlabel = 'ROBO'
    ) AS ok`;
  if (!enumRows[0]?.ok) {
    fail(
      "This database's Role enum has no 'ROBO' value.\n" +
      "   Add it first (additive and safe, it drops nothing):\n" +
      `   ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ROBO';`
    );
  }
  console.log("  ✔ Role enum contains ROBO");

  // ---- refuse to modify anything that already exists ----------------------
  const existing = await prisma.user.findUnique({
    where:  { email: EMAIL },
    select: { id: true, role: true, branch: true, active: true },
  });
  if (existing) {
    console.log("");
    console.log("  A user with that email already exists — nothing has been changed.");
    console.log(`      role=${existing.role}  branch=${existing.branch}  active=${existing.active}`);
    console.log("");
    console.log("  Adjust it from /admin/users (or pick a different ROBO_EMAIL).");
    console.log("  This script will not overwrite an existing account.");
    console.log("");
    return;
  }

  const before = await prisma.user.count();

  // ---- create exactly one row --------------------------------------------
  const passwordHash = await bcrypt.hash(PASSWORD, 10); // same cost as src/lib/users.ts
  const created = await prisma.user.create({
    data: {
      email:        EMAIL,
      name:         NAME,
      passwordHash,
      role:         Role.ROBO,
      branch:       Branch.SHOP_FLOOR,
      active:       true,
      // station stays null on purpose: only OPERATOR needs one
      // (src/app/admin/users/actions.ts), and ROBO is not OPERATOR.
    },
    select: { id: true, email: true, role: true, branch: true, createdAt: true },
  });

  const after = await prisma.user.count();

  console.log("");
  console.log("  ✔ Created");
  console.log(`      id      : ${created.id}`);
  console.log(`      email   : ${created.email}`);
  console.log(`      role    : ${created.role}`);
  console.log(`      branch  : ${created.branch}`);
  console.log("");
  console.log(`  Users before: ${before}   after: ${after}   (delta ${after - before})`);
  console.log("  No other account was read, modified or deleted.");
  console.log("");
  console.log("  Sign in at https://erp.pacific-surfaces.com -> Shop Floor card.");
  console.log("  The account lands on /robo and is confined to it.");
  console.log("");
}

main()
  .catch((e: unknown) => {
    console.error("\n  ✖ " + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
