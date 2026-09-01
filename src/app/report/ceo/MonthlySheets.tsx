import Link from "next/link";
import type { MonthlyReport } from "@/lib/monthlyReport";
import s from "./report.module.css";

// The monthly view of the CEO report — the same document design, one level up.
// Rendered by /report/ceo when the Monthly toggle is on; every day row is that
// day's own daily report (same assembly, lib/monthlyReport), and the date
// links straight to it.

/* ---------------------------------------------------------------- helpers */
const DASH = "—", NDASH = "–";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export const monthLong = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${y}`;
};
const dayLabel = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  return `${DOW[x.getUTCDay()]} ${x.getUTCDate()}`;
};
const spanLabel = (a: string, b: string) => {
  const s1 = new Date(`${a}T12:00:00Z`), s2 = new Date(`${b}T12:00:00Z`);
  return s1.getTime() === s2.getTime()
    ? `${s1.getUTCDate()} ${MONTHS[s1.getUTCMonth()].slice(0, 3)}`
    : `${s1.getUTCDate()}${NDASH}${s2.getUTCDate()} ${MONTHS[s2.getUTCMonth()].slice(0, 3)}`;
};
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const pct1 = (n: number | null) => (n == null ? DASH : `${n.toFixed(1)}%`);
const share = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : DASH);
const num = (n: number) => n.toLocaleString("en-IN");
const delta = (now: number, then: number, unit = "") => {
  const d = now - then;
  return d === 0 ? "level" : `${d > 0 ? "+" : NDASH}${num(Math.abs(d))}${unit}`;
};

type Day = MonthlyReport["days"][number];

/* The same reading of a day's cause split the daily gives a shift — one rule,
 * so the two views describe the same day in the same words. */
function dayNarrative(d: Day) {
  if (d.hoursLogged === 0) return "Nothing filed";
  if (d.made === 0 && d.target === 0) return "Line silent, or nothing declared";
  if (d.lost === 0) return "Ran clean, no time lost";
  const top = (Object.entries(d.cause) as [string, number][]).sort((a, b) => b[1] - a[1])[0][0];
  if (top === "power") return "Grid power cuts";
  if (top === "cleaning") return d.cause.cleaning >= d.lost * 0.5 ? "Ran clean; time went on planned cleaning" : "Cleaning and changeover took the time";
  if (top === "breakdown") return d.topArea ? `${d.topArea} faults` : "Machine and electrical faults";
  return d.topArea ? `Process delays at the ${d.topArea.toLowerCase()}` : "Process delays";
}

const CAUSE_LABEL: Record<string, [string, string]> = {
  cleaning:  ["Cleaning and batch changeover", "Dry and full cleans, and the clean into the next batch"],
  power:     ["Power cuts from the grid", "Supply lost from the grid; the shifts' own notes place this time here"],
  process:   ["Process delays", "Holds at the press, oven and rubber line, and waiting on material from the mixer"],
  breakdown: ["Machine and electrical breakdowns", "Faults the shifts flagged for maintenance"],
};

/* ------------------------------------------------------------- fragments */
const Section = ({ name, note }: { name: string; note?: string }) => (
  <div className={s.section}>
    <span className={s.sectionName}>{name}</span>
    {note && <span className={s.sectionNote}>{note}</span>}
  </div>
);

const Mast = ({ r }: { r: MonthlyReport }) => (
  <>
    <div className={s.mast}>
      <div>
        <div className={s.wordmark}>PACIFIC SURFACES</div>
        <div className={s.submark}>QUARTZ SURFACES &nbsp;·&nbsp; PRODUCTION PLANT</div>
      </div>
      <div>
        <div className={s.docTitle}>Monthly Production Report</div>
        <div className={s.docDate}>
          {monthLong(r.month)}{r.monthToDate ? ` · to date (${r.daysElapsed} of ${r.daysInMonth} days)` : ""} &nbsp;·&nbsp; days run 06:00 to 06:00
        </div>
      </div>
    </div>
    <hr className={s.mastRule} />
  </>
);

const Kpis = ({ tiles }: { tiles: [string, string][] }) => (
  <div className={s.kpis}>
    {tiles.map(([value, label]) => (
      <div className={s.kpi} key={label}>
        <div className={s.kpiValue}>{value}</div>
        <div className={s.kpiLabel}>{label}</div>
      </div>
    ))}
  </div>
);

/* ------------------------------------------------------------ sheet one */
function SheetMonth({ r }: { r: MonthlyReport }) {
  const soFar = r.monthToDate ? " so far" : "";
  const prevSentence = r.prev && r.prev.made > 0
    ? ` Last month (${monthLong(r.prev.month)}, complete) made ${num(r.prev.made)} at ${pct1(r.prev.pct)}.`
    : "";
  return (
    <div className={s.sheet}>
      <Mast r={r} />
      <Kpis tiles={[
        [num(r.made), `Slabs produced${soFar}`],
        [num(Math.round(r.target)), "Target, summed from the days"],
        [pct1(r.pct), "Achievement"],
        [hm(r.lost), "Time lost"],
        [`${r.daysRun} of ${r.daysElapsed}`, "Days the line ran"],
        [r.topDay ? `${num(r.topDay.made)}` : DASH, r.topDay ? `Best day · ${dayLabel(r.topDay.date)}` : "Best day"],
      ]} />

      <p className={s.prose}>
        {monthLong(r.month)}{soFar} produced <strong>{num(r.made)} slabs</strong> against a summed target
        of <strong>{num(Math.round(r.target))}</strong> — {pct1(r.pct)} of standard — and
        lost <strong>{hm(r.lost)}</strong> to stoppages across {r.daysRun} running
        day{r.daysRun === 1 ? "" : "s"}.{prevSentence} Every day row below is exactly that
        day&rsquo;s own report; the date opens it.
      </p>

      <Section name="Week by week" note="Monday-led weeks, clipped to the month" />
      <table className={`${s.t} ${s.keep}`}>
        <thead><tr>
          <th>Week</th><th className={s.num}>Days run</th><th className={s.num}>Made</th>
          <th className={s.num}>Target</th><th className={s.num}>Achieved</th><th className={s.num}>Lost</th>
        </tr></thead>
        <tbody>
          {r.weeks.map((w) => (
            <tr key={w.start}>
              <td className={s.key}>{spanLabel(w.start, w.end)}</td>
              <td className={s.num}>{w.daysRun} of {w.days}</td>
              <td className={s.num}>{num(w.made)}</td>
              <td className={s.num}>{num(Math.round(w.target))}</td>
              <td className={s.num}>{pct1(w.pct)}</td>
              <td className={s.num}>{w.lost ? `${num(w.lost)} m` : NDASH}</td>
            </tr>
          ))}
          <tr className={s.total}>
            <td>Month{soFar}</td>
            <td className={s.num}>{r.daysRun} of {r.daysElapsed}</td>
            <td className={s.num}>{num(r.made)}</td>
            <td className={s.num}>{num(Math.round(r.target))}</td>
            <td className={s.num}>{pct1(r.pct)}</td>
            <td className={s.num}>{num(r.lost)} m</td>
          </tr>
        </tbody>
      </table>

      <Section name="Day by day" note="Each row is that day's own report — the date opens it. A dash means nothing was filed." />
      <table className={s.t}>
        <thead><tr>
          <th>Day</th><th>Line ran</th><th className={s.num}>Made</th>
          <th className={s.num}>Target</th><th className={s.num}>Achieved</th><th className={s.num}>Lost</th>
          <th>What shaped the day</th>
        </tr></thead>
        <tbody>
          {r.days.map((d) => (
            <tr key={d.date}>
              <td className={s.key}>
                <Link href={`/report/ceo?d=${d.date}`} className={s.dayLink}>{dayLabel(d.date)}</Link>
              </td>
              <td className={s.muted}>{d.lines.join(" · ") || DASH}</td>
              <td className={s.num}>{d.hoursLogged ? num(d.made) : DASH}</td>
              <td className={s.num}>{d.hoursLogged ? num(Math.round(d.target)) : DASH}</td>
              <td className={s.num}>{d.hoursLogged ? pct1(d.pct) : DASH}</td>
              <td className={s.num}>{d.lost ? `${num(d.lost)} m` : NDASH}</td>
              <td className={s.muted}>{dayNarrative(d)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={s.foot}>
        <span>Pacific Surfaces &nbsp;·&nbsp; Monthly Report &nbsp;·&nbsp; {monthLong(r.month)}</span>
        <span>Page 1 of 3</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ sheet two */
function SheetDepth({ r }: { r: MonthlyReport }) {
  const m = r.maintenance;
  const worstArea = m.byArea[0] ?? null;
  return (
    <div className={s.sheet}>
      <Mast r={r} />

      <Section name="Where the month's time went"
        note="Minutes by cause, and how many days each cause touched — spread and spike are different problems" />
      <table className={`${s.t} ${s.keep}`}>
        <thead><tr>
          <th>Cause</th><th>What it covers</th>
          <th className={s.num}>Minutes</th><th className={s.num}>Share</th><th className={s.num}>Days touched</th>
        </tr></thead>
        <tbody>
          {r.causes.filter((c) => c.minutes > 0).sort((a, b) => b.minutes - a.minutes).map((c) => (
            <tr key={c.key}>
              <td className={s.key}>{CAUSE_LABEL[c.key][0]}</td>
              <td className={s.muted}>{CAUSE_LABEL[c.key][1]}</td>
              <td className={s.num}>{num(c.minutes)}</td>
              <td className={s.num}>{share(c.minutes, r.lost)}</td>
              <td className={s.num}>{c.daysAffected} of {r.daysElapsed}</td>
            </tr>
          ))}
          <tr className={s.total}>
            <td colSpan={2}>All stoppages</td>
            <td className={s.num}>{num(r.lost)}</td>
            <td className={s.num}>100%</td>
            <td className={s.num}>{NDASH}</td>
          </tr>
        </tbody>
      </table>

      <Section name="Maintenance across the month"
        note="Summed from each day's own maintenance page — power cuts sit apart, as there: nothing failed in the plant" />
      <p className={s.prose}>
        {m.events === 0 ? (
          <>No machine or electrical breakdown was recorded this month.</>
        ) : (
          <>
            <strong>{m.events} breakdown hour{m.events === 1 ? "" : "s"}</strong> across {m.daysAffected} day{m.daysAffected === 1 ? "" : "s"} cost{" "}
            <strong>{hm(m.minutes)}</strong>
            {worstArea && <> — most of it in the <strong>{worstArea.area}</strong> ({num(worstArea.minutes)} minutes over {worstArea.days} day{worstArea.days === 1 ? "" : "s"})</>}.{" "}
            {m.withRca === 0 ? "No RCA number was raised against any of them." : `${m.withRca} carried an RCA number.`}{" "}
            {m.sparesHours > 0 && `Spares were used in ${m.sparesHours} hour${m.sparesHours === 1 ? "" : "s"}.`}
          </>
        )}{" "}
        {/* The grid is its own fact: power hours are deliberately NOT
            maintenance events, so a month can lose hours to cuts without a
            single machine fault — nested under the breakdown branch, that
            sentence could never print on exactly those months. */}
        {m.power.hours > 0 && <>The grid went down for <strong>{hm(m.power.minutes)}</strong> across {m.power.hours} hour{m.power.hours === 1 ? "" : "s"} on {m.power.days} day{m.power.days === 1 ? "" : "s"}.</>}
      </p>
      {m.byArea.length > 0 && (
        <div className={s.pair}>
          <div style={{ flex: 1.6 }}>
            <table className={`${s.t} ${s.keep}`}>
              <thead><tr>
                <th>Where it failed</th><th className={s.num}>Events</th>
                <th className={s.num}>Minutes</th><th className={s.num}>Share</th><th className={s.num}>Days touched</th>
              </tr></thead>
              <tbody>
                {m.byArea.map((a) => (
                  <tr key={a.area}>
                    <td className={s.key}>{a.area}</td>
                    <td className={s.num}>{a.events}</td>
                    <td className={s.num}>{num(a.minutes)}</td>
                    <td className={s.num}>{share(a.minutes, m.minutes)}</td>
                    <td className={s.num}>{a.days} of {r.daysElapsed}</td>
                  </tr>
                ))}
                <tr className={s.total}>
                  <td>Total breakdowns</td>
                  <td className={s.num}>{m.events}</td>
                  <td className={s.num}>{num(m.minutes)}</td>
                  <td className={s.num}>100%</td>
                  <td className={s.num}>{m.daysAffected}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <table className={`${s.t} ${s.keep}`}>
              <thead><tr><th>Shift</th><th className={s.num}>Events</th><th className={s.num}>Minutes</th></tr></thead>
              <tbody>
                {m.byShift.map((x) => (
                  <tr key={x.shift}>
                    <td className={s.key}>{x.shift}</td>
                    <td className={s.num}>{x.events}</td>
                    <td className={s.num}>{num(x.minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Section name="What the line ran" note="Slabs per design, from the same hourly rows the day figures count" />
      <table className={`${s.t} ${s.keep}`}>
        <thead><tr>
          <th>Design</th><th className={s.num}>Batches</th><th className={s.num}>Days</th>
          <th className={s.num}>Slabs</th><th className={s.num}>Share</th>
        </tr></thead>
        <tbody>
          {r.mix.map((m2) => (
            <tr key={m2.design}>
              <td className={s.key}>{m2.design}</td>
              <td className={s.num}>{m2.batches || DASH}</td>
              <td className={s.num}>{m2.days}</td>
              <td className={s.num}>{num(m2.made)}</td>
              <td className={s.num}>{share(m2.made, r.made)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={s.foot}>
        <span>Pacific Surfaces &nbsp;·&nbsp; Monthly Report &nbsp;·&nbsp; {monthLong(r.month)}</span>
        <span>Page 2 of 3</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- sheet three */
const REWORK_LABEL: Record<string, string> = {
  "Direct Ok": "Passed straight through",
  "RW Required and ongoing": "Rework in progress",
  "Can't be Reworked": "Cannot be reworked",
  "RW Done Ok": "Rework completed",
  "Not recorded": "Not recorded",
};

/* ------------------------------------------------- the unfilled-hours list */
// WHICH SHIFT DID NOT FILE, and the way to fix it from here. Screen only
// (report.module.css hides .gaps in print): this is a worklist for the
// office, not part of the document — the printed page keeps the discipline
// sentence and nothing else. Closed by default, because a sheet that opens
// with its own to-do list unrolled is no longer a sheet; one click opens the
// day-by-day list, one more opens that shift's entry sheet at its first
// missing hour. The Fill column renders only for people who may actually
// fill it — everyone else reads the same facts without a dead button.
const SHIFT_WINDOW: Record<string, string> = { A: "06:00–14:00", B: "14:00–22:00", C: "22:00–06:00" };

function MisGaps({ r, canFill }: { r: MonthlyReport; canFill: boolean }) {
  if (r.gapDays.length === 0) return null;
  const shiftsMissing = r.gapDays.reduce((a, d) => a + d.gaps.length, 0);
  return (
    <details className={s.gaps}>
      <summary className={s.gapsHead}>
        <strong>{num(r.hoursMissing)} hour{r.hoursMissing === 1 ? "" : "s"} never filed</strong>
        <span className={s.gapsCount}>
          · {shiftsMissing} shift{shiftsMissing === 1 ? "" : "s"} across {r.gapDays.length} day{r.gapDays.length === 1 ? "" : "s"}
          {canFill ? " · click to see them, then Fill to enter" : " · click to see them"}
        </span>
      </summary>
      <div className={s.gapsBody}>
        <table className={s.t}>
          <thead><tr>
            <th>Day</th><th>Shift</th><th className={s.num}>Filed</th>
            <th>Hours never filed</th>{canFill && <th />}
          </tr></thead>
          <tbody>
            {r.gapDays.map((d) =>
              d.gaps.map((g, i) => (
                <tr key={`${d.date}-${g.shift}`}>
                  <td className={s.key}>{i === 0 ? dayLabel(d.date) : ""}</td>
                  <td>
                    <span className={s.gapShift}>{g.shift}</span>
                    <span className={s.muted}>{SHIFT_WINDOW[g.shift]}</span>
                  </td>
                  <td className={s.num}>{g.filed} of {g.possible}</td>
                  <td className={s.muted}>{g.hours.join(", ")}</td>
                  {canFill && (
                    <td className={s.num}>
                      {/* straight to the MIS sheet for that shift, parked on
                          the first hour it is missing */}
                      <Link className={s.fillBtn} href={`/entry/mis?date=${d.date}&shift=${g.shift}&hour=${encodeURIComponent(g.hours[0])}`}>
                        Fill
                      </Link>
                    </td>
                  )}
                </tr>
              )))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function SheetQualityMonth({ r, canFill }: { r: MonthlyReport; canFill: boolean }) {
  const q = r.quality;
  const faultTop = q.faultsAll.slice(0, 10);
  return (
    <div className={s.sheet}>
      <Mast r={r} />

      {/* ENTRIES, not slabs — and the label says so. A slab inspected twice
          is two QC entries and one slab, so this table's total and the
          distinct-slab figure below it are different numbers on purpose;
          labelling both "inspected slabs" made the sheet contradict itself. */}
      <Section name="Quality grades" note={`all ${num(q.inspected)} QC entries this month, covering ${num(q.inspectedSlabs)} distinct slabs`} />
      <table className={`${s.t} ${s.keep}`}>
        <thead><tr><th>Grade</th><th className={s.num}>QC entries</th><th className={s.num}>Share</th></tr></thead>
        <tbody>
          {q.grades.map(([g, n]) => (
            <tr key={g}>
              <td className={s.key}>{g}</td>
              <td className={s.num}>{num(n)}</td>
              <td className={s.num}>{share(n, q.inspected)}</td>
            </tr>
          ))}
          <tr className={s.total}>
            <td>Total QC entries</td>
            <td className={s.num}>{num(q.inspected)}</td>
            <td className={s.num}>100%</td>
          </tr>
        </tbody>
      </table>

      <Section name="Quality across the month"
        note="From polishing and QC over the same window; stations queue, so polished and inspected are different slab sets" />
      <div className={s.pair}>
        <div>
          <table className={`${s.t} ${s.keep}`}>
            <tbody>
              <tr><td className={s.key}>Distinct slabs polished</td><td className={s.num}>{num(q.polishedSlabs)}</td></tr>
              <tr><td className={s.key}>Distinct slabs inspected</td><td className={s.num}>{num(q.inspectedSlabs)}</td></tr>
              <tr><td className={s.key}>Pass rate (A or A2, of graded)</td><td className={s.num}>{pct1(q.passRate)}</td></tr>
              <tr><td className={s.key}>Graded A / A2</td><td className={s.num}>{num(q.gradeA)} / {num(q.gradeA2)}</td></tr>
              <tr><td className={s.key}>Held below A2</td><td className={s.num}>{num(q.held)}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <table className={`${s.t} ${s.keep}`}>
            <tbody>
              <tr><td className={s.key}>Open for rework at close</td><td className={s.num}>{num(q.openForRework)}</td></tr>
              <tr><td className={s.key}>Worked and came back good</td><td className={s.num}>{num(q.recovered)}</td></tr>
              <tr><td className={s.key}>Marked for dispatch</td><td className={s.num}>{num(q.toDispatch)}</td></tr>
              <tr><td className={s.key}>Slabs carrying a fault note</td><td className={s.num}>{num(q.faultSlabs)}</td></tr>
              <tr><td className={s.key}>Repolish done / still needed</td>
                <td className={s.num}>{num(q.polishing.repolishDone)} / {num(q.polishing.needsRepolish)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <Section name="The faults of the month" note={`${num(q.faultTotal)} faults across ${num(q.faultSlabs)} slabs — one slab can carry several`} />
      <div className={s.pair}>
        <div style={{ flex: 1.4 }}>
          <table className={`${s.t} ${s.keep}`}>
            <thead><tr><th>Fault</th><th className={s.num}>Recorded</th><th className={s.num}>Share</th></tr></thead>
            <tbody>
              {faultTop.map(([f, n]) => (
                <tr key={f}>
                  <td className={s.key}>{f}</td>
                  <td className={s.num}>{num(n)}</td>
                  <td className={`${s.num} ${s.muted}`}>{share(n, q.faultTotal)}</td>
                </tr>
              ))}
              {q.faultsAll.length > faultTop.length && (
                <tr>
                  <td className={s.muted}>{q.faultsAll.length - faultTop.length} more…</td>
                  <td className={s.num}>{num(q.faultsAll.slice(10).reduce((a, [, n]) => a + n, 0))}</td>
                  <td className={`${s.num} ${s.muted}`}>{share(q.faultsAll.slice(10).reduce((a, [, n]) => a + n, 0), q.faultTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div>
          <table className={`${s.t} ${s.keep}`}>
            <thead><tr><th>Did it need rework?</th><th className={s.num}>Slabs</th></tr></thead>
            <tbody>
              {q.rework.map(([k, n]) => (
                <tr key={k}>
                  <td className={s.key}>{REWORK_LABEL[k] ?? k}</td>
                  <td className={s.num}>{num(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Entries again, matching the denominator the shares divide by. */}
      <Section name="Who did the work" note="the six busiest at each station this month, by entries filed" />
      <div className={s.pair}>
        {([["Polishing operator", "Operator", q.operators, q.polished], ["Quality inspector", "Inspector", q.inspectors, q.inspected]] as const).map(
          ([label, head, rows, total]) => (
            <div key={label}>
              <table className={`${s.t} ${s.keep}`}>
                <thead><tr><th>{head}</th><th className={s.num}>Entries</th><th className={s.num}>Share</th></tr></thead>
                <tbody>
                  {rows.slice(0, 6).map(([k, n]) => (
                    <tr key={k}>
                      <td className={s.key}>{k}</td>
                      <td className={s.num}>{num(n)}</td>
                      <td className={`${s.num} ${s.muted}`}>{share(n, total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>

      <Section name="Against last month" note={r.monthToDate ? "This month is partial; last month is complete — compare rates, not totals" : "Both months complete"} />
      <table className={`${s.t} ${s.keep}`}>
        <thead><tr>
          <th></th><th className={s.num}>Slabs</th><th className={s.num}>Target</th>
          <th className={s.num}>Achieved</th><th className={s.num}>Lost</th><th className={s.num}>Days run</th>
        </tr></thead>
        <tbody>
          <tr>
            <td className={s.key}>{monthLong(r.month)}{r.monthToDate ? " (to date)" : ""}</td>
            <td className={s.num}>{num(r.made)}</td>
            <td className={s.num}>{num(Math.round(r.target))}</td>
            <td className={s.num}>{pct1(r.pct)}</td>
            <td className={s.num}>{hm(r.lost)}</td>
            <td className={s.num}>{r.daysRun}</td>
          </tr>
          {r.prev && (
            <tr>
              <td className={s.key}>{monthLong(r.prev.month)}</td>
              <td className={s.num}>{num(r.prev.made)}</td>
              <td className={s.num}>{num(Math.round(r.prev.target))}</td>
              <td className={s.num}>{pct1(r.prev.pct)}</td>
              <td className={s.num}>{hm(r.prev.lost)}</td>
              <td className={s.num}>{r.prev.daysRun}</td>
            </tr>
          )}
          {r.prev && !r.monthToDate && (
            <tr className={s.total}>
              <td>Change</td>
              <td className={s.num}>{delta(r.made, r.prev.made)}</td>
              <td className={s.num}>{delta(Math.round(r.target), Math.round(r.prev.target))}</td>
              <td className={s.num}>{r.pct != null && r.prev.pct != null ? `${(r.pct - r.prev.pct) >= 0 ? "+" : NDASH}${Math.abs(r.pct - r.prev.pct).toFixed(1)} pts` : DASH}</td>
              <td className={s.num}>{delta(r.lost, r.prev.lost, " m")}</td>
              <td className={s.num}>{delta(r.daysRun, r.prev.daysRun)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <Section name="MIS discipline" note="Of the hours the elapsed days could hold, how many the shifts filed at all" />
      <p className={s.prose}>
        <strong>{num(r.hoursLogged)}</strong> of {num(r.hoursPossible)} possible hourly rows were
        filed ({share(r.hoursLogged, r.hoursPossible)}).{" "}
        {r.zeroDays.length === 0
          ? "Every elapsed day holds at least one entry."
          : <>Nothing at all was filed on <strong>{r.zeroDays.length} day{r.zeroDays.length === 1 ? "" : "s"}</strong>: {r.zeroDays.map(dayLabel).join(", ")} — those days show dashes above, not zeros, because an unfiled day is a gap in the record, not a silent line.</>}
      </p>
      {r.wideHours > 0 && (
        <p className={s.note}>
          <strong>{num(r.wideHours)} hour{r.wideHours === 1 ? "" : "s"} set aside</strong> for an impossible slab
          range — a range wider than 60 slabs in one hour, which the line cannot make, on{" "}
          {r.wideDays.map(dayLabel).join(", ")}. {r.wideHours === 1 ? "It makes" : "They make"} no claim in any
          figure above, the same way the entry form refuses such a range today and the scoreboard already ignores
          one. Correct the range on the MIS row and the {r.wideHours === 1 ? "hour returns" : "hours return"}.
        </p>
      )}
      <MisGaps r={r} canFill={canFill} />

      <div className={s.foot}>
        <span>Pacific Surfaces &nbsp;·&nbsp; Monthly Report &nbsp;·&nbsp; {monthLong(r.month)}</span>
        <span>Page 3 of 3</span>
      </div>
    </div>
  );
}

export function MonthlySheets({ r, canFill = false }: { r: MonthlyReport; canFill?: boolean }) {
  return (
    <>
      <SheetMonth r={r} />
      <SheetDepth r={r} />
      <SheetQualityMonth r={r} canFill={canFill} />
    </>
  );
}
