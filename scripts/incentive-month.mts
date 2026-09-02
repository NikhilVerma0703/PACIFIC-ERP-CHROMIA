// Snapshot one month of the shift incentive as JSON — the figures the printed
// notice and the shared page are rendered from, so neither carries a typed
// number.
//
//     npx tsx scripts/incentive-month.mts [YYYY-MM] [out.json]
//
// Defaults to the previous IST month (the one being settled) and writes
// docs/incentive/<month>.json. Read-only against the database: it calls the
// same incentiveMonth() the /scoreboard/incentive page calls, then drops the
// per-slab list (the groups and phantom runs are kept) so the file stays a
// record rather than a dump.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const k of ["DATABASE_URL", "DATABASE_URL_POOLED"]) {
  const m = env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m"));
  if (m && !process.env[k]) process.env[k] = m[1];
}

const { incentiveMonth, currentMonthIST } = await import("../src/lib/incentiveMonth.ts");
const { prisma } = await import("../src/lib/prisma.ts");

const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const month = process.argv[2] && /^\d{4}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : prevMonth(currentMonthIST());
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[3] ?? path.join(here, "..", "docs", "incentive", `${month}.json`);

const m = await incentiveMonth(month);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { slabs, ...outstanding } = m.outstanding;
const snapshot = { ...m, outstanding: { ...outstanding, slabCount: slabs.length } };
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`${month}: counted ${m.pool.counted} · graded ${m.plant.graded} · still to grade ${m.outstanding.real} (of ${m.outstanding.total} claimed-uncounted) · projected ${Math.round(m.projection.projectedReal)} → pool ${m.projection.poolReal}`);
console.log(`written: ${out}`);
await prisma.$disconnect();
