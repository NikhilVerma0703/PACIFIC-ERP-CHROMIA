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
        <span>Page 1 of 2</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ sheet two */
function SheetDepth({ r }: { r: MonthlyReport }) {
  const q = r.quality;
  const faultTop = q.faultsAll.slice(0, 6);
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

      <Section name="What the line ran" note="Slabs per design, from the same hourly rows the day figures count" />
      <table className={`${s.t} ${s.keep}`}>
        <thead><tr>
          <th>Design</th><th className={s.num}>Batches</th><th className={s.num}>Days</th>
          <th className={s.num}>Slabs</th><th className={s.num}>Share</th>
        </tr></thead>
        <tbody>
          {r.mix.map((m) => (
            <tr key={m.design}>
              <td className={s.key}>{m.design}</td>
              <td className={s.num}>{m.batches || DASH}</td>
              <td className={s.num}>{m.days}</td>
              <td className={s.num}>{num(m.made)}</td>
              <td className={s.num}>{share(m.made, r.made)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Section name="Quality across the month"
        note="From polishing and QC over the same window; stations queue, so polished and inspected are different slab sets" />
      <div className={s.pair}>
        <div>
          <table className={`${s.t} ${s.keep}`}>
            <tbody>
              <tr><td className={s.key}>Slabs polished</td><td className={s.num}>{num(q.polishedSlabs)}</td></tr>
              <tr><td className={s.key}>Slabs inspected</td><td className={s.num}>{num(q.inspectedSlabs)}</td></tr>
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
              <tr><td className={s.key}>Top faults</td>
                <td className={`${s.num} ${s.muted}`}>{faultTop.map(([f, n]) => `${f} ${n}`).join(" · ") || DASH}</td></tr>
            </tbody>
          </table>
        </div>
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

      <div className={s.foot}>
        <span>Pacific Surfaces &nbsp;·&nbsp; Monthly Report &nbsp;·&nbsp; {monthLong(r.month)}</span>
        <span>Page 2 of 2</span>
      </div>
    </div>
  );
}

export function MonthlySheets({ r }: { r: MonthlyReport }) {
  return (
    <>
      <SheetMonth r={r} />
      <SheetDepth r={r} />
    </>
  );
}
