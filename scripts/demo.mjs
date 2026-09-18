// RUN THE APP AGAINST THE DEMO DATABASE.
//
//     npm run demo          → next dev on http://localhost:3000, demo data only
//     npm run demo:seed     → (re)fill the demo database
//
// It reads .env.local, swaps the database name in DATABASE_URL, and hands the
// result to `next dev` as an environment override. The demo connection string
// is therefore NEVER written to a file and never enters the repository — it is
// derived at launch from the credential you already have.
//
// WHY THIS AND NOT A "DEMO MODE" IN THE APP. 334 files import the Prisma
// singleton and there are 282 raw SQL sites. A flag every one of them had to
// honour would leak the first time one was missed, and the person it leaked to
// would be the visitor you were showing the app to. A different database in the
// connection string has nothing to miss: this process holds no credential that
// can reach production.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const DEMO_DB = "pacificdemo";
const PROD_DB = "neondb";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const prod = env.DATABASE_URL;
if (!prod) { console.error("No DATABASE_URL in .env.local"); process.exit(1); }

const demo = prod.replace(`/${PROD_DB}?`, `/${DEMO_DB}?`);
if (demo === prod || !demo.includes(`/${DEMO_DB}?`)) {
  console.error(`Refusing to start: could not point DATABASE_URL at ${DEMO_DB}.`);
  console.error("Check that .env.local's DATABASE_URL still names the production database.");
  process.exit(1);
}

const seed = process.argv.includes("--seed");

// DATABASE_URL_POOLED is cleared deliberately. lib/prisma prefers it when set,
// so leaving a production pooler URL in place would quietly send every query
// back to production while the banner said "demo".
const childEnv = {
  ...process.env,
  DATABASE_URL: demo,
  DATABASE_URL_POOLED: "",
  NEXT_PUBLIC_DEMO: "1",
};

if (seed) {
  console.log(`Seeding ${DEMO_DB} …\n`);
  spawn("npx", ["tsx", "scripts/demo-seed/run.ts"], { stdio: "inherit", env: childEnv, shell: true })
    .on("exit", (c) => process.exit(c ?? 0));
} else {
  console.log("┌──────────────────────────────────────────────────────────┐");
  console.log(`│  DEMO MODE — database: ${DEMO_DB.padEnd(34)}│`);
  console.log("│  Production data is not reachable from this process.     │");
  console.log("│  Sign in as  demo@pacific.demo  /  demo                  │");
  console.log("└──────────────────────────────────────────────────────────┘\n");
  spawn("npx", ["next", "dev"], { stdio: "inherit", env: childEnv, shell: true })
    .on("exit", (c) => process.exit(c ?? 0));
}
