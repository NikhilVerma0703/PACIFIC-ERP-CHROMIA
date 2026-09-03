// The shift-incentive tracker as a LOCAL FILE - a companion to the admin page
// at /scoreboard/incentive, for reading off the office computer without a login.
//
//     npx tsx scripts/incentive-tracker.mts [YYYY-MM] [out.html] [--no-open]
//
// A file on this computer that is rebuilt every time it is opened - the Desktop
// launcher "Incentive Tracker.cmd" runs this script, which reads the live
// database, writes the HTML and opens it. Nothing here is served to anyone; the
// file carries no credentials and the database is only reached from this
// machine, through .env. The page on the ERP is the same figures behind the
// admin login.
//
// Everything on the page comes from incentiveMonth() - the same assembly the
// snapshot script and the printable notice use - so the three cannot disagree.
// The HTML is self-contained (inline CSS, system fonts) so it renders with no
// network at all.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(path.join(root, f), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* the other file may carry it */ }
}

const { incentiveMonth, currentMonthIST, STAGES, REAL_STAGES } = await import("../src/lib/incentiveMonth.ts");
const { prisma } = await import("../src/lib/prisma.ts");
const { QUALITY_FLOOR, QUALITY_TARGET, SLOW_STD_MAX } = await import("../src/lib/shiftScoreMath.ts");
type Month = Awaited<ReturnType<typeof incentiveMonth>>;
type Stage = (typeof STAGES)[number];

const args = process.argv.slice(2);
const noOpen = args.includes("--no-open");
const positional = args.filter((a) => !a.startsWith("--"));
const month = positional[0] && /^\d{4}-\d{2}$/.test(positional[0]) ? positional[0] : currentMonthIST();
const out = positional[1] ?? path.join(process.env.USERPROFILE ?? root, "Desktop", "Incentive Tracker", "Incentive-Tracker.html");

/* ------------------------------------------------------------- formatting */
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n));
const half = (n: number) => (Number.isInteger(n) ? fmt(n) : `${fmt(Math.floor(n))}½`);
const inr = (n: number) => "₹" + fmt(n);
const lakh = (n: number) => (n >= 100_000 ? `₹${(n / 100_000).toFixed(n % 100_000 ? 1 : 0)} lakh` : inr(n));
const pct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const istStamp = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ") + " IST";
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const STAGE_LABEL: Record<Stage, string> = {
  "at-qc": "At QC, not graded", "at-polish": "On the polish line", pressed: "Pressed, not at polish yet",
  nowhere: "Never seen at any station", routed: "Routed to CTS / Printing",
};

/* ------------------------------------------------------------------ page */
function render(m: Month, prev: Month | null): string {
  const { pool, projection, outstanding, plant, qc } = m;
  const belowFloor = pool.counted < pool.floor;
  const ladderMax = pool.ladder[pool.ladder.length - 1].slabs;
  const at = (n: number) => `${Math.max(0, Math.min(100, (n / ladderMax) * 100)).toFixed(2)}%`;
  const order = [...m.shares.aggregate].sort((a, b) => b.share - a.share).map((s) => s.shift);
  const letter = (s: string) => m.letters.find((l) => l.shift === s)!;
  const shareW = (s: string) => m.shares.weighted.find((x) => x.shift === s)!;
  const shareA = (s: string) => m.shares.aggregate.find((x) => x.shift === s)!;
  const moneyW = (s: string) => m.money.weighted.find((x) => x.shift === s)!;
  const moneyA = (s: string) => m.money.aggregate.find((x) => x.shift === s)!;
  const stageChips = (rec: Record<Stage, number>) => STAGES.filter((s) => rec[s] > 0)
    .map((s) => `<span class="chip ${s}">${fmt(rec[s])} ${esc(STAGE_LABEL[s].toLowerCase())}</span>`).join(" ");

  const verdict = !m.monthEnded
    ? `<div class="verdict info"><div class="vt">Month in progress</div><p>Only shifts that have ended are scored. The running shift appears after it closes.</p></div>`
    : belowFloor
      ? `<div class="verdict ${projection.projectedReal >= pool.floor ? "amber" : "red"}">
           <div class="vt">Not yet payable — ${half(pool.counted)} counted, ${fmt(pool.floor)} needed</div>
           <p>${fmt(outstanding.real)} real slabs are still to grade. At the month's grade share of ${pct(projection.share)} they add about ${fmt(Math.round(projection.addReal))},
           taking the month to <b>${fmt(Math.round(projection.projectedReal))}</b>
           ${projection.projectedReal >= pool.floor
             ? `— over the line, into the <b>${lakh(projection.poolReal)}</b> pool.`
             : `— still short of the floor. The pool is unlocked only by grading, not by projecting.`}
           ${outstanding.byStage.nowhere > 0 ? ` Counting the ${fmt(outstanding.byStage.nowhere)} never-seen numbers as well would say ${fmt(Math.round(projection.projectedAll))}; they are left out because a number no station has seen will not grade.` : ""}</p>
         </div>`
      : `<div class="verdict green"><div class="vt">Pool unlocked — ${lakh(pool.poolNow)} on ${half(pool.counted)} counted slabs</div>
         ${pool.next ? `<p>${fmt(pool.next.slabs - Math.floor(pool.counted))} more counted slabs reach the ${lakh(pool.next.pool)} row.</p>` : ""}</div>`;

  const kpis = [
    ["Counted good slabs", half(pool.counted), `floor ${fmt(pool.floor)} · ${half(plant.credit)} good slabs + ${fmt(plant.slowSlabs)} counted a second time`],
    ["Counted twice", fmt(plant.slowSlabs), `good slabs from hours with a standard of ${SLOW_STD_MAX}/hr or less — each added once more, so +${fmt(plant.slowSlabs)} to the count`],
    ["Pool today", pool.poolNow ? lakh(pool.poolNow) : "—", pool.poolNow ? "unlocked" : `${fmt(pool.floor - Math.floor(pool.counted))} short of the floor`],
    ["Still to grade", fmt(outstanding.real), `${fmt(outstanding.total)} claimed and uncounted · ${fmt(outstanding.byStage.nowhere)} never seen · ${fmt(outstanding.byStage.routed)} routed`],
    ["Projected", fmt(Math.round(projection.projectedReal)), `if the real ones grade at ${pct(projection.share)} → ${projection.poolReal ? lakh(projection.poolReal) : "no pool"}`],
    ["Grade share", pct(plant.rawShare), `${fmt(plant.gradeA)} A · ${fmt(plant.gradeB)} B · ${fmt(plant.gradeC)} rejects of ${fmt(plant.graded)} graded`],
    ["QC pace", qc.avgPerDay7 ? `${fmt(Math.round(qc.avgPerDay7))}/day` : "—", qc.daysToClear != null ? `≈ ${qc.daysToClear} day${qc.daysToClear === 1 ? "" : "s"} to clear the backlog` : "no grading in the last 7 days"],
  ].map(([l, v, s]) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join("");

  const ladder = `
    <div class="bar">
      <div class="fill all" style="width:${at(projection.projectedAll)}" title="Projected including never-seen numbers: ${fmt(Math.round(projection.projectedAll))}"></div>
      <div class="fill real" style="width:${at(projection.projectedReal)}" title="Projected on real slabs: ${fmt(Math.round(projection.projectedReal))}"></div>
      <div class="fill counted" style="width:${at(pool.counted)}" title="Counted: ${half(pool.counted)}"></div>
      ${pool.ladder.map((t) => `<div class="tick" style="left:${at(t.slabs)}"></div>`).join("")}
    </div>
    <div class="ticks">${pool.ladder.map((t) => `<div class="tk" style="left:${at(t.slabs)}"><b>${fmt(t.slabs / 1000)}k</b><span>${lakh(t.pool)}</span></div>`).join("")}</div>
    <div class="legend"><span><i class="sw counted"></i>counted ${half(pool.counted)}</span><span><i class="sw real"></i>projected on real slabs ${fmt(Math.round(projection.projectedReal))}</span><span><i class="sw all"></i>with never-seen numbers ${fmt(Math.round(projection.projectedAll))}</span></div>`;

  const shiftRows = order.map((s, i) => { const l = letter(s); return `
    <tr><td class="name"><span class="rank${i === 0 ? " first" : ""}">${i + 1}</span>Shift ${s}</td>
      <td>${fmt(l.instances)}</td><td class="mut">${l.effectiveShifts.toFixed(1)}</td><td>${fmt(l.claimed)}</td><td>${fmt(l.graded)}</td><td>${fmt(l.ungraded)}</td>
      <td class="mut">${fmt(l.gradeA)} / ${fmt(l.gradeB)} / ${fmt(l.gradeC)}</td><td>${half(l.credit)}</td><td class="mut">${fmt(l.slowSlabs)}</td><td class="strong">${fmt(l.points)}</td>
      <td>${l.pointsPerShift.toFixed(1)}</td><td>${pct(l.rawShare)}</td><td>${pct(l.qualityWeighted, 0)}</td><td>${pct(l.qualityAggregate, 0)}</td>
      <td>${pct(shareW(s).share)}</td><td class="strong">${pct(shareA(s).share)}</td></tr>`; }).join("");

  const moneyRows = order.map((s, i) => { const w = moneyW(s), a = moneyA(s); return `
    <tr><td class="name"><span class="rank${i === 0 ? " first" : ""}">${i + 1}</span>Shift ${s}</td>
      <td>${pct(a.share)} <small>/ ${pct(w.share)}</small></td><td class="pos">${pct(a.pctSalary, 2)} <small>/ ${pct(w.pctSalary, 2)}</small></td>
      ${m.money.roles.map((r) => `<td>${inr(a.bands[r.key])}${Math.round(a.bands[r.key]) !== Math.round(w.bands[r.key]) ? ` <small title="per-shift-average method">/ ${inr(w.bands[r.key])}</small>` : ""}</td>`).join("")}</tr>`; }).join("");

  // THIS TABLE IS A WAITING LIST AND ONLY A WAITING LIST — SO IT FILTERS.
  // outstanding.groups was widened on 2026-09-03 from "design+batch with slabs
  // waiting" to "every design+batch the month CLAIMED", so the admin page could
  // show graded and waiting on one line. Nobody told this table, and it went on
  // rendering every row: on live August 2026 that is 41 rows of which 8 have
  // Waiting 0 and a dash in every stage cell — eight blank lines under a heading
  // that says what is still to come. Worse, `groupRows || "Nothing waiting."`
  // below became unreachable for any month that claimed anything, so a month
  // with a genuinely clear backlog would print a table of zeros instead of
  // saying it was clear. Filtered here rather than in incentiveMonth: the page
  // wants the full population, this page wants the backlog.
  const waitingGroups = outstanding.groups.filter((g) => g.count > 0);
  const groupRows = waitingGroups.map((g) => `
    <tr><td class="name">${esc(g.design)}</td><td class="mut">${esc(g.batch)}</td><td class="strong">${fmt(g.count)}</td><td class="mut">${g.slow ? fmt(g.slow) : "—"}</td>
      ${STAGES.map((s) => `<td class="${g.stages[s] ? s : "dim"}">${g.stages[s] || "—"}</td>`).join("")}
      <td class="mut">${g.share != null ? `${pct(g.share)} on ${fmt(g.graded)}` : g.graded ? `${fmt(g.graded)} graded — too few to say` : "none graded yet"}</td></tr>`).join("");

  const phantom = outstanding.phantomRuns.length ? `
    <div class="phantom"><div class="vt">${fmt(outstanding.byStage.nowhere)} claimed numbers no station has seen — the MIS hours to correct</div>
      <div class="runs">${outstanding.phantomRuns.slice(0, 40).map((r) => `<span class="run"><b>${r.from === r.to ? fmt(r.from) : `${fmt(r.from)}–${fmt(r.to)}`}</b> · ${r.count} · ${esc(r.anchor)} shift ${esc(r.shift)}${r.hour ? ` · ${esc(r.hour)}` : ""}${r.design ? ` · ${esc(r.design)}` : ""}</span>`).join("")}
      ${outstanding.phantomRuns.length > 40 ? `<span class="mut">… and ${outstanding.phantomRuns.length - 40} more runs</span>` : ""}</div></div>` : "";

  const qcMax = Math.max(...qc.perDay.map((d) => d.graded), 1);
  const qcBars = qc.perDay.length ? `<div class="qc">${qc.perDay.map((d) => `<div class="qd"><div class="n">${fmt(d.graded)}</div><div class="b" style="height:${Math.max(2, (d.graded / qcMax) * 72)}px"></div><div class="d">${d.day.slice(5)}</div></div>`).join("")}</div>`
    : `<p class="mut">No grading recorded in the last 14 days.</p>`;

  const waiting = (m.flaggedRows > 0 || m.openDisputes > 0 || m.unattributed > 0) ? `
    <div class="verdict amber"><div class="vt">Entries the scoreboard is still waiting on</div><ul>
      ${m.flaggedRows > 0 ? `<li>${fmt(m.flaggedRows)} MIS hours flagged (too wide, or claimed by two shifts).</li>` : ""}
      ${m.openDisputes > 0 ? `<li>${fmt(m.openDisputes)} slabs claimed by two shifts, awaiting a ruling — they score for nobody until then.</li>` : ""}
      ${m.unattributed > 0 ? `<li>${fmt(m.unattributed)} shift instances filed MIS but named no production incharge.</li>` : ""}</ul></div>` : "";

  const prevLine = prev ? `<p class="mut small">Previous month, ${esc(monthLabel(prev.month))}: ${half(prev.pool.counted)} counted → ${prev.pool.poolNow ? lakh(prev.pool.poolNow) : "no pool"}${prev.outstanding.real ? ` · ${fmt(prev.outstanding.real)} still to grade, projected ${fmt(Math.round(prev.projection.projectedReal))}` : ""}.</p>` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Incentive Tracker — ${esc(monthLabel(m.month))}</title>
<style>
  :root{--ink:#191C1F;--ink2:#4A5157;--ink3:#767D84;--page:#FBFAF8;--card:#fff;--stone:#F1EFEB;--line:#E0DDD7;--line2:#CBC6BE;--go:#0E5C4C;--gosoft:#E4EFEA;--hold:#9C3A26;--holdsoft:#F7E9E4;--amber:#8A5A00;--ambersoft:#FFF3D6;--info:#1F4E79;--infosoft:#E4EDF6}
  *{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:15px/1.55 -apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:22px 22px 70px}
  header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:18px}
  h1{font-size:26px;margin:0;letter-spacing:-.01em}.sub{color:var(--ink3);font-size:13px;margin:4px 0 0}
  h2{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);margin:0 0 10px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:16px 18px;margin:0 0 14px}
  .verdict{border:1px solid var(--line);border-left:5px solid var(--hold);background:var(--card);border-radius:4px;padding:14px 18px;margin:0 0 14px}
  .verdict p,.verdict ul{margin:6px 0 0}.verdict .vt{font-weight:700}
  .verdict.red{border-left-color:var(--hold);background:var(--holdsoft)}.verdict.amber{border-left-color:var(--amber);background:var(--ambersoft)}
  .verdict.green{border-left-color:var(--go);background:var(--gosoft)}.verdict.info{border-left-color:var(--info);background:var(--infosoft)}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden;margin:0 0 14px}
  .kpi{background:var(--card);padding:12px 14px}.kpi .l{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}.kpi .v{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.15;margin:3px 0 2px;font-variant-numeric:tabular-nums}.kpi .s{font-size:11.5px;color:var(--ink3);line-height:1.35}
  .bar{position:relative;height:34px;background:var(--stone);border-radius:6px;overflow:hidden;margin-top:8px}.fill{position:absolute;inset:0 auto 0 0}.fill.all{background:rgba(14,92,76,.12)}.fill.real{background:rgba(14,92,76,.32)}.fill.counted{background:var(--go)}
  .tick{position:absolute;top:0;bottom:0;border-left:1px solid rgba(0,0,0,.35)}.ticks{position:relative;height:36px;font-size:11px;color:var(--ink3);margin-top:4px}.tk{position:absolute;transform:translateX(-50%);text-align:center;line-height:1.25}.tk b{display:block;color:var(--ink2)}
  .legend{display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--ink2);margin-top:6px}.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:middle}.sw.counted{background:var(--go)}.sw.real{background:rgba(14,92,76,.32)}.sw.all{background:rgba(14,92,76,.12)}
  .scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums}th,td{text-align:right;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}th:first-child,td:first-child{text-align:left}
  thead th{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink3);background:var(--stone)}tbody tr:last-child td{border-bottom:0}tr.total td{background:var(--stone);font-weight:700}
  td.name{font-weight:600}td.mut{color:var(--ink3)}td.strong{font-weight:700}td.pos{color:var(--go);font-weight:600}td.dim{color:#c9c4bc}td.nowhere{color:var(--hold);font-weight:600}td.routed{color:var(--amber)}small{color:var(--ink3);font-weight:400}
  .rank{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--stone);border:1px solid var(--line2);font-size:11px;font-weight:700;margin-right:8px;color:var(--ink2)}.rank.first{background:var(--go);border-color:var(--go);color:#fff}
  .chip{display:inline-block;font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--line2);background:var(--stone);margin:0 4px 4px 0}.chip.at-qc{background:var(--gosoft);border-color:var(--go);color:var(--go)}.chip.nowhere{background:var(--holdsoft);border-color:var(--hold);color:var(--hold)}.chip.routed{background:var(--ambersoft);border-color:var(--amber);color:var(--amber)}
  .three{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:10px 0 14px}.three>div{border:1px solid var(--line);border-radius:6px;padding:10px 12px}.three .t{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);margin-bottom:6px}
  .phantom{border:1px solid var(--hold);background:var(--holdsoft);border-radius:6px;padding:12px 14px;margin:0 0 14px}.runs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.run{font-size:12px;background:#fff;border:1px solid var(--line2);border-radius:4px;padding:4px 8px}
  .qc{display:flex;align-items:flex-end;gap:6px;overflow-x:auto;padding-bottom:4px}.qd{display:flex;flex-direction:column;align-items:center;gap:3px;width:46px;flex:0 0 auto;font-size:10px;color:var(--ink3)}.qd .b{width:100%;background:rgba(14,92,76,.6);border-radius:3px 3px 0 0}.qd .n{color:var(--ink2)}
  p.note{font-size:12px;color:var(--ink3);margin:8px 0 0;max-width:110ch}.small{font-size:12.5px}.mut{color:var(--ink3)}
  .foot{font-size:12px;color:var(--ink3);border-top:1px solid var(--line);padding-top:12px;margin-top:20px}
</style></head><body><div class="wrap">
<header><div><h1>Shift incentive — ${esc(monthLabel(m.month))}</h1>
  <p class="sub">Counted good slabs against the ${fmt(pool.floor)} floor, and every claimed slab QC has not graded yet — with where it actually is. Rebuilt from the live database at <b>${esc(istStamp(m.asOf))}</b>; open the launcher again to refresh.</p></div>
  <div class="mut small">Scored ${esc(m.from)} → ${esc(m.scoredTo)}${m.monthEnded ? "" : " · month in progress"}</div></header>
${verdict}
<div class="kpis">${kpis}</div>
<div class="card"><h2>Where the month sits on the ladder</h2>${ladder}</div>
<div class="card"><h2>The three shifts</h2>
  <p class="note" style="margin:0 0 10px">Counted slabs carry both rules: B = ½, reject = 0, and a slab from an hour whose standard is ${SLOW_STD_MAX}/hr or less counts twice. Per shift divides by shifts the line was actually running. Quality is scored between the ${Math.round(QUALITY_FLOOR * 100)}% floor and the ${Math.round(QUALITY_TARGET * 100)}% target, two ways: <b>month share</b> scores the month's whole grade share once (the notice's way — the shares in bold); <b>per-shift avg</b> averages each shift instance's score (the scoreboard's way).</p>
  <div class="scroll"><table><thead><tr><th>Shift</th><th>Shifts</th><th>Running</th><th>Pressed</th><th>Graded</th><th>To grade</th><th>A / B / C</th><th>Good</th><th>Counted twice</th><th>Counted</th><th>Per shift</th><th>Grade share</th><th>Quality<br><small>per-shift avg</small></th><th>Quality<br><small>month share</small></th><th>Share<br><small>per-shift avg</small></th><th>Share<br><small>month share</small></th></tr></thead>
  <tbody>${shiftRows}
  <tr class="total"><td>Plant</td><td>${fmt(plant.instances)}</td><td>${m.letters.reduce((x, l) => x + l.effectiveShifts, 0).toFixed(1)}</td><td>${fmt(plant.claimed)}</td><td>${fmt(plant.graded)}</td><td>${fmt(plant.ungraded)}</td><td>${fmt(plant.gradeA)} / ${fmt(plant.gradeB)} / ${fmt(plant.gradeC)}</td><td>${half(plant.credit)}</td><td>${fmt(plant.slowSlabs)}</td><td>${fmt(plant.points)}</td><td>—</td><td>${pct(plant.rawShare)}</td><td>—</td><td>—</td><td>100%</td><td>100%</td></tr></tbody></table></div></div>
<div class="card"><h2>What it pays${m.money.pool ? ` on the ${lakh(m.money.pool)} pool` : ""}</h2>
  ${!m.money.pool ? `<p class="mut">Nothing to share out — the projection on real slabs does not reach ${fmt(pool.floor)}.</p>` : `
  <p class="note" style="margin:0 0 10px">${belowFloor ? "A planning figure: the pool the real projection reaches, not one the counted total has unlocked. " : ""}Each shift's slice becomes a percentage of salary on a third of the ₹41 lakh bill, and everyone on the shift takes that percentage of their own pay. The main figure is the month-share method; the small one after the slash is the per-shift-average method where it differs.</p>
  <div class="scroll"><table><thead><tr><th>Shift</th><th>Share of pool</th><th>Of own salary</th>${m.money.roles.map((r) => `<th>${esc(r.label)}<br><small>${inr(r.pay)}</small></th>`).join("")}</tr></thead><tbody>${moneyRows}</tbody></table></div>`}</div>
<div class="card"><h2>Claimed, not yet counted — ${fmt(outstanding.total)}</h2>
  <p class="note" style="margin:0 0 10px">Every slab a shift's MIS range claimed that has no A / B / C verdict yet, checked against the press, jot, oven and polish tables. A slab QC routed to CTS or Printing has been through QC and will not grade; a number no station has ever seen was claimed by a mistyped range and will not either.</p>
  <div>${stageChips(outstanding.byStage)}</div>
  <div class="three">${(["A", "B", "C"] as const).map((s) => `<div><div class="t">Shift ${s} · ${fmt(Object.values(outstanding.byLetter[s]).reduce((x, y) => x + y, 0))}</div>${stageChips(outstanding.byLetter[s]) || '<span class="mut small">nothing waiting</span>'}</div>`).join("")}</div>
  ${phantom}
  <p class="note" style="margin:0 0 10px">The ${fmt(waitingGroups.length)} design-and-batch groups with slabs still waiting, of the ${fmt(outstanding.groups.length)} the month claimed. <b>Batch grade share</b> is what THIS design and batch has graded out of the month's own claim, on the payout's scale (A and A2 = 1, B = ½, C = 0), once it has enough graded slabs to mean anything.</p>
  <div class="scroll"><table><thead><tr><th>Design</th><th>Batch</th><th>Waiting</th><th>Counts ×2</th>${STAGES.map((s) => `<th>${esc(STAGE_LABEL[s])}</th>`).join("")}<th>Batch grade share so far</th></tr></thead><tbody>${groupRows || `<tr><td colspan="${5 + STAGES.length}" class="mut">Nothing waiting.</td></tr>`}</tbody></table></div></div>
<div class="card"><h2>QC grading, last 14 days</h2><p class="note" style="margin:0 0 10px">Slabs given an A / B / C verdict per production day, whatever month they were pressed in. The backlog clears at this pace or not at all.</p>${qcBars}</div>
${waiting}
${prevLine}
<div class="foot">Assumes the ₹41 lakh production salary bill (112 people, still marked provisional in the notice) is split equally across the three shifts. The ladder is read as steps — ${fmt(pool.ladder[0].slabs)} to ${fmt(pool.ladder[1].slabs - 1)} pays the ${lakh(pool.ladder[0].pool)} row. Any lost-time accident in a shift removes that shift's incentive for the month; nothing here checks for one. Real stages that can still earn: ${REAL_STAGES.map((s) => STAGE_LABEL[s].toLowerCase()).join(", ")}.</div>
</div></body></html>`;
}

/* ------------------------------------------------------------------ main */
try {
  const [m, prev] = await Promise.all([
    incentiveMonth(month),
    incentiveMonth(shiftMonth(month, -1)).catch(() => null),
  ]);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, render(m, prev), "utf8");
  console.log(`${month}: counted ${m.pool.counted} · still to grade ${m.outstanding.real} · projected ${Math.round(m.projection.projectedReal)} → pool ${m.projection.poolReal}`);
  console.log(`written: ${out}`);
  if (!noOpen && process.platform === "win32") {
    // `start` is a cmd built-in; the empty "" is the window title it expects.
    spawn("cmd", ["/c", "start", "", out], { detached: true, stdio: "ignore" }).unref();
  }
} finally {
  await prisma.$disconnect();
}
