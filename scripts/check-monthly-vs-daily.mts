// Read-only invariant check: a monthly day row equals that day's own daily
// report. Run ad hoc with `npx tsx scripts/check-monthly-vs-daily.mts [YYYY-MM]`.
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const k of ["DATABASE_URL", "DATABASE_URL_POOLED"]) {
  const m = env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m"));
  if (m && !process.env[k]) process.env[k] = m[1];
}

const { getMonthlyReport } = await import("../src/lib/monthlyReport.ts");
const { getDailyReport } = await import("../src/lib/dailyReport.ts");

const month = process.argv[2] ?? new Date(Date.now() + (330 - 360) * 60000).toISOString().slice(0, 7);
const r = await getMonthlyReport(month);
console.log(`${month}${r.monthToDate ? " (to date)" : ""}: made ${r.made}, target ${Math.round(r.target)}, ` +
  `pct ${r.pct?.toFixed(1)}, lost ${r.lost}m, days run ${r.daysRun}/${r.daysElapsed}, zero days ${r.zeroDays.length}`);

// Compare the three busiest days plus one zero day against the daily report.
const sample = [...r.days].sort((a, b) => b.made - a.made).slice(0, 3).map((d) => d.date);
if (r.zeroDays[0]) sample.push(r.zeroDays[0]);
let bad = 0;
for (const date of sample) {
  const daily = await getDailyReport(date);
  const mine = r.days.find((d) => d.date === date)!;
  const same = mine.made === daily.day.made && Math.abs(mine.target - daily.day.target) < 1e-9
    && mine.lost === daily.day.lost && mine.hoursRun === daily.day.hoursRun
    && mine.hoursLogged === daily.day.hoursTotal;
  if (!same) bad++;
  console.log(`${date}: monthly {made ${mine.made}, target ${mine.target}, lost ${mine.lost}, hrs ${mine.hoursLogged}} ` +
    `vs daily {made ${daily.day.made}, target ${daily.day.target}, lost ${daily.day.lost}, hrs ${daily.day.hoursTotal}} ` +
    (same ? "MATCH" : "MISMATCH"));
}
// The month's made must equal the sum of its day rows (mix must too).
const sumDays = r.days.reduce((a, d) => a + d.made, 0);
const sumMix = r.mix.reduce((a, m) => a + m.made, 0);
console.log(`sum(days.made) ${sumDays} vs month.made ${r.made}: ${sumDays === r.made ? "MATCH" : "MISMATCH"}`);
console.log(`sum(mix.made) ${sumMix} vs month.made ${r.made}: ${sumMix === r.made ? "MATCH" : "MISMATCH"}`);
process.exit(bad ? 1 : 0);
