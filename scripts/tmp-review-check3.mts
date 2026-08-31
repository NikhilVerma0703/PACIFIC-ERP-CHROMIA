// TEMPORARY read-only check #3: does a row's dateAndTime land it on the report
// day its hour label belongs to? Delete after use.
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const k of ["DATABASE_URL", "DATABASE_URL_POOLED"]) {
  const m = env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m"));
  if (m && !process.env[k]) process.env[k] = m[1];
}
const { prisma } = await import("../src/lib/prisma.ts");
const IST = 330 * 60000;
const rows = (await prisma.mis.findMany({
  where: { dateAndTime: { gte: new Date("2026-06-01T00:30:00Z") } },
  select: { hour: true, dateAndTime: true, importedAt: true, createdTime: true },
})) as unknown as { hour: string | null; dateAndTime: Date | null; importedAt: Date | null; createdTime: Date | null }[];

let off = 0, total = 0;
const hist = new Map<number, number>();
for (const r of rows) {
  if (!r.hour || !r.dateAndTime) continue;
  const h = Number(String(r.hour).slice(0, 2));
  if (!Number.isFinite(h)) continue;
  total++;
  const ist = new Date(r.dateAndTime.getTime() + IST);
  const d = (ist.getUTCHours() - h + 24) % 24; // how far the stamp sits from the hour it reports
  hist.set(d, (hist.get(d) ?? 0) + 1);
  // report day from the stamp
  const rep = new Date(r.dateAndTime.getTime() - 30 * 60000).toISOString().slice(0, 10);
  // report day the hour label implies, given the stamp's IST calendar date
  const cal = ist.toISOString().slice(0, 10);
  const want = h < 6 ? new Date(Date.parse(`${cal}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) : cal;
  if (rep !== want) { off++; if (off <= 10) console.log(`  off: hour=${r.hour} dt=${r.dateAndTime.toISOString()} reportDay=${rep} wantFromLabel=${want} erpEntered=${!r.createdTime}`); }
}
console.log(`rows ${total}, stamp/label report-day disagreements ${off}`);
console.log("offset(stampISThour - labelHour) histogram:", [...hist].sort((a, b) => b[1] - a[1]).slice(0, 8));
await prisma.$disconnect();
