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
  // THE HEADLINE FIGURE COUNTS CLAIMS, AND SAYS SO WHEN THAT IS NOT THE SLAB
  // COUNT. r.made is the width of every hour's declared range, which is what
  // the day, week, target and achievement arithmetic on this page sums to; it
  // is one MORE than the slabs the plant made whenever an hour re-typed a
  // number its neighbour already used. Labelling it "slabs produced" with no
  // caveat put a figure on page one that the grade columns on page two
  // legitimately cannot reach, and the owner asked which of the two was right.
  // Both are: this tile now names which one it is and prints the other beside
  // it. Page two's Numbers column is the same distinct count, per design.
  const exact = r.made === r.producedSlabs;
  return (
    <div className={s.sheet}>
      <Mast r={r} />
      <Kpis tiles={[
        [num(r.made), exact ? `Slabs produced${soFar}` : `Slabs claimed · ${num(r.producedSlabs)} numbers`],
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
        day{r.daysRun === 1 ? "" : "s"}.{prevSentence}{" "}
        {!exact && (
          <>That {num(r.made)} is what the hours <em>claimed</em>; the ranges they typed cover{" "}
          <strong>{num(r.producedSlabs)}</strong> distinct slab numbers, which is the count page two grades
          and page three totals. Page two names the rows where the two part.{" "}</>
        )}
        {/* THE EXCLUSION THAT USED TO BE PRINTED NOWHERE. An MIS row with no
            hour typed cannot be placed in a shift, so every figure on this
            page leaves it out — and on June 2026 that is 104 slabs whose
            numbers all appear in `press` and `polish_entry`, which the month
            incentive screen counts and the payout pays for. Saying so here,
            on the headline, rather than only in the MIS-discipline note. */}
        {r.unlabelled.slabs > 0 && (
          <>A further <strong>{num(r.unlabelled.slabs)} slabs</strong> sit on {r.unlabelled.declaring} hourly
          row{r.unlabelled.declaring === 1 ? "" : "s"} that carry no hour and so reach no shift: no figure on
          this page counts them. See MIS discipline on page three.{" "}</>
        )}
        Every day row below is exactly that day&rsquo;s own report; the date opens it.
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
  const pg = r.producedGrades;
  // Rows where the hours declared MORE slabs than there are distinct slab
  // numbers to grade — a number typed twice. Named on the page rather than
  // smoothed away: a row whose columns do not add up is exactly what a reader
  // is entitled to have explained, and the fix is a correction on the MIS row,
  // not on this report.
  //
  // AND THE NOTE MUST NAME THE RIGHT FAULT. It used to assert the cause was
  // always the design's own double-typing, which is not true when the number
  // was taken by a DIFFERENT design: June 2026's Carrara Royale reads 79 slabs
  // across 78 distinct numbers, and its own hours typed 79 distinct numbers —
  // slab 144340 was already Taj Aureate's, so its grade sits on Taj Aureate's
  // row (live Neon, 2026-09-03). `contested` is that count, so the sentence can
  // say which of the two happened rather than guessing.
  //
  // AND IT IS TWO FAULTS, NOT ONE. `made - numbered` is not the count of
  // numbers typed twice, and the note asserted that it was. An hour that typed
  // its range as 0 -> 0 declares one slab (slabsDeclared counts the width) and
  // names no slab number at all (walkRange will not walk from zero), so it
  // widens the gap without any number being claimed twice: April 2026's
  // 35-slab gap is thirteen such hours plus twenty-two genuine re-types (live
  // Neon, 2026-09-03). lib/monthlyReport now splits the two, and each row is
  // listed under the fault that actually produced its shortfall.
  const retyped = r.mix.filter((x) => x.claims > x.numbered);
  const unreadable = r.mix.filter((x) => x.unreadable > 0);
  const anyContested = retyped.some((x) => x.contested > 0);
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

      {/* THE HEADING NAMES BOTH HALVES OF THE TABLE. It read "What the line
          ran", which promises an account of the month's production — and then
          six of its eleven columns deliver QC's verdicts so far, one of which
          is a backlog column that on a fresh month holds a seventh of the
          month's slabs. A reader who quotes this block as the month's quality
          is quoting an incomplete inspection. */}
      <Section name="What the line ran, and QC's verdicts so far"
        note="Slabs per design from the same hourly rows the day figures count — and how those very slabs stand in QC today, which for a recent month is not yet finished" />
      {/* .split, not .keep: at 36 designs this table is longer than the room
          left on the page, so "never break" only moves the whole block to the
          next physical sheet. See report.module.css — both classes carry the
          measurement. */}
      <table className={`${s.t} ${s.split} ${s.tight}`}>
        <thead><tr>
          <th>Design</th><th className={s.num}>Batches</th><th className={s.num}>Days</th>
          {/* TWO COUNTS OF ONE ROW'S SLABS, IN THE TABLE AND LABELLED.
              The owner put page one's "6,262 SLABS PRODUCED" beside this
              table's total and asked which was right: the six grade cells summed
              to 6,261. Both are right and they measure different things — Slabs
              is the width of the ranges the hours CLAIMED (and is what the day,
              week and target arithmetic sums to, so it must not change), Numbers
              is the distinct slab numbers those ranges cover (and is what the
              six grade columns partition, because a slab can only be graded
              once). It used to be explained only in the 6.7pt note UNDER the
              table, which the continuation page of a broken table does not
              carry; the reconciling figure belongs in a column. */}
          <th className={s.num}>Slabs<span className={s.colSub}>claimed</span></th>
          <th className={s.num}>Numbers<span className={s.colSub}>distinct</span></th>
          <th className={s.num}>Share</th>
          <th className={s.num}>A</th><th className={s.num}>A2</th>
          <th className={s.num}>B</th><th className={s.num}>C</th>
          <th className={s.num}>Cut</th><th className={s.num}>Not yet</th>
        </tr></thead>
        <tbody>
          {r.mix.map((m2) => (
            <tr key={m2.key}>
              <td className={s.key}>{m2.design}</td>
              <td className={s.num}>{m2.batches || DASH}</td>
              <td className={s.num}>{m2.days}</td>
              <td className={s.num}>{num(m2.made)}</td>
              <td className={s.num}>{m2.numbered ? num(m2.numbered) : NDASH}</td>
              <td className={s.num}>{share(m2.made, r.made)}</td>
              <td className={s.num}>{m2.grades.A || NDASH}</td>
              <td className={s.num}>{m2.grades.A2 || NDASH}</td>
              <td className={s.num}>{m2.grades.B || NDASH}</td>
              <td className={s.num}>{m2.grades.C || NDASH}</td>
              <td className={s.num}>{m2.grades.cut || NDASH}</td>
              <td className={s.num}>{m2.grades.ungraded || NDASH}</td>
            </tr>
          ))}
          {/* The total row is the point of the six grade columns: they add
              DOWN as well as across, because each slab number belongs to
              exactly one design row (lib/monthlyReport partitions them). */}
          <tr className={s.total}>
            <td>All designs</td>
            <td className={s.num}>{NDASH}</td>
            <td className={s.num}>{NDASH}</td>
            <td className={s.num}>{num(r.made)}</td>
            <td className={s.num}>{num(r.producedSlabs)}</td>
            <td className={s.num}>100%</td>
            <td className={s.num}>{num(pg.A)}</td>
            <td className={s.num}>{num(pg.A2)}</td>
            <td className={s.num}>{num(pg.B)}</td>
            <td className={s.num}>{num(pg.C)}</td>
            <td className={s.num}>{pg.cut || NDASH}</td>
            <td className={s.num}>{num(pg.ungraded)}</td>
          </tr>
        </tbody>
      </table>
      <p className={s.note}>
        The six grade columns are the verdicts of <em>those same slabs</em> — the numbers the design&rsquo;s own
        hours declared, looked up in QC whenever it reached them, including after the month closed. They add
        across to <strong>Numbers</strong>, not to Slabs, and down to the total row; Slabs is what the hours
        claimed and is the figure every target and achievement on this report is built on.{" "}
        {/* F5: THE STAMP IS AN ARRIVAL, NOT A GRADING DATE, AND THIS SENTENCE
            USED TO SAY OTHERWISE ("got a verdict only in the month after").
            polish_qc.created_time has been empty on every row written since
            the June 2026 cutover, so for a recent month the only timestamp is
            the Airtable import — August 2026's late rows were imported 1–3
            September for stone pressed up to 31 August, against an in-window
            press-to-import lag of 1 day median (live Neon, 2026-09-03). That
            is pipeline latency crossing a month boundary, not a late verdict.
            A pre-cutover month is the other case: 340 of April 2026's 341 sit
            on a real created_time. The count of the ones with no created_time
            comes from the data, so the sentence tells the truth for both. */}
        {r.producedGradedAfter > 0 && (
          <>The QC row for <strong>{num(r.producedGradedAfter)}</strong> of them arrived only after the month
          closed, and a grade table windowed on the month would show none of those.{" "}
          {r.producedGradedAfterOnImportStamp === 0
            ? "Those rows carry QC's own created_time, so for them that is a grading date."
            : r.producedGradedAfterOnImportStamp === r.producedGradedAfter
              ? "None of them carries a grading time of its own — only the Airtable import stamp, which has been QC's only timestamp since the June 2026 cutover — so this says when the row arrived, not when the slab was judged."
              : `${num(r.producedGradedAfterOnImportStamp)} of them carry no grading time of their own, only the Airtable import stamp, so for those it says when the row arrived and not when the slab was judged.`}{" "}</>
        )}
        <strong>Cut</strong> is a slab routed to cut-to-size or sampling with no verdict
        surviving — neither a pass nor a reject; <strong>Not yet</strong> is a slab QC has not reached, or one
        still recorded &ldquo;Not graded yet&rdquo; — {share(pg.ungraded, pg.slabs)} of the month&rsquo;s slabs
        today, so read this block as QC&rsquo;s progress on the month and not as the month&rsquo;s finished
        quality.
        {/* THE ONE PLACE THIS REPORT AND THE INCENTIVE SCREEN DISAGREE ON PURPOSE.
            Measured 2026-09-03 for August: this table prints B 146 and Cut 25;
            /scoreboard/incentive prints B 171 for the same month, and 171 - 146
            is exactly those 25. Both are right for the question each is asked —
            this one reports what was INSPECTED, so a slab whose verdict was
            destroyed and set to B by decision (scripts/0071, 0072) is not a
            measured B and sits in Cut; the incentive screen reports what is
            PAID, and gradeCredit() pays each of them half a slab like any other
            B. Neither number is wrong and neither can be quietly changed to
            match the other, so each screen names the gap where it prints the
            figure. scripts/verify-grade-columns.mts asserts the difference is
            EXACTLY the cut count, so if it ever drifts one of them is broken. */}
        {pg.cut > 0 && (
          <>
            {" "}The month-incentive screen counts those same{" "}
            <strong>{num(pg.cut)}</strong> cut slabs under <strong>B</strong>, because the payout pays each of
            them half a slab of credit, so its B for {monthLong(r.month)} reads exactly that much higher than
            this table&rsquo;s. Both are right: this table reports what was <em>inspected</em>, that one
            reports what is <em>paid</em>.
          </>
        )}
        {/* TWO NAMED QUANTITIES, BECAUSE THEY ARE TWO DIFFERENT MIS FAULTS AND
            ONLY ONE OF THEM IS A NUMBER TYPED TWICE. Both close the same way —
            correct the range on the row — but a reader told "13 slab numbers
            were claimed twice" about thirteen hours that typed 0 -> 0 goes
            looking for a duplicate that does not exist. */}
        {r.typedTwice > 0 && (
          <>
            {" "}<strong>{num(r.typedTwice)} slab number{r.typedTwice === 1 ? " was" : "s were"} typed
            twice</strong> — {retyped.map((m2) =>
              `${m2.design} claimed ${num(m2.claims)} numbers across ${num(m2.numbered)} distinct ones`
              + (m2.contested > 0
                ? ` (${num(m2.contested)} of them already claimed by ${m2.contestedWith.join(" and ")})`
                : "")).join("; ")}
            {" "}— so Numbers falls short of Slabs by that much on {retyped.length === 1 ? "that row" : "those rows"}.{" "}
            {anyContested
              ? "First claim wins across the whole month, so a number two designs both typed is graded on the row that typed it first, not on the row that lost it."
              : "The gap is one number written on two hours, not a missing slab."}
          </>
        )}
        {r.unreadableSlabs > 0 && (
          <>
            {" "}A further <strong>{num(r.unreadableSlabs)} slab{r.unreadableSlabs === 1 ? "" : "s"}</strong>{" "}
            {r.unreadableSlabs === 1 ? "sits" : "sit"} on {r.unreadableHours}{" "}
            hour{r.unreadableHours === 1 ? "" : "s"} whose slab range cannot be a slab number — a range
            starting at or below zero, which counts a width but names nothing QC can be asked
            about ({unreadable.map((m2) => `${m2.design} ${num(m2.unreadable)}`).join("; ")}).
            No number was claimed twice there; the numbers were never typed.
          </>
        )}
        {(r.typedTwice > 0 || r.unreadableSlabs > 0) && <> Correct the range on the MIS row and the two columns meet.</>}
      </p>

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

/* The produced-slab grade table, in GRADE ORDER rather than by size — it sits
 * beside a table sorted by count, and the CEO reads the pair across. A fixed
 * order also means the four grades stay in the order the plant says them (A,
 * A2, B, C) with the two non-verdicts after, exactly as the mix columns on
 * sheet two, so the same six numbers are in the same six places on both pages. */
const PRODUCED_ROWS: [string, (g: MonthlyReport["producedGrades"]) => number][] = [
  ["A", (g) => g.A],
  ["A2", (g) => g.A2],
  ["B", (g) => g.B],
  ["C (reject)", (g) => g.C],
  ["Cut to size / sample", (g) => g.cut],
  ["Not graded yet", (g) => g.ungraded],
];

/* The raw grade keys getQuality tallies, said the way the produced table says
 * them, so the two tables side by side name one thing one way. "CTS" is the
 * bucket key lib/dailyReport's gradeOf folds every no-verdict row into — the
 * legacy 'CTS'/'SAMPLE' grade write and the 'B' scripts/0071 and 0072 decided
 * rather than measured — and "cut to size" is what it means on the floor.
 * Labels only: the numbers are getQuality's, untouched. */
const GRADE_LABEL: Record<string, string> = {
  "C (Reject)": "C (reject)",
  CTS: "Cut to size / sample",
};

function SheetQualityMonth({ r, canFill }: { r: MonthlyReport; canFill: boolean }) {
  const q = r.quality;
  const pg = r.producedGrades;
  // A or A2 over the four real grades — the SAME shape as getQuality's
  // passRate, with the non-verdicts out of both sides, so the two rates the
  // note prints side by side are comparable. Its denominator is the month's
  // own slabs; getQuality's is every entry filed in the month.
  const producedGraded = pg.A + pg.A2 + pg.B + pg.C;
  const producedRate = producedGraded ? (100 * (pg.A + pg.A2)) / producedGraded : null;
  const faultTop = q.faultsAll.slice(0, 10);
  // WHETHER THERE IS A RIGHT-HAND TABLE AT ALL.
  // getQuality windows polish_qc on importedAt — the Airtable sync stamp,
  // which is the only timestamp still moving (created_time stops dead at
  // 8 June 2026 across the whole table, measured on live Neon 2026-09-03) —
  // and every pre-cutover row was imported in June 2026. So for any month that
  // closed before the cutover, `inspected` is 0: April 2026 rendered the
  // right-hand table with no rows and a total of 0, an em-dash for the
  // all-entries pass rate in the middle of a sentence, "Every one of them was
  // for a slab this month declared" about stone that does not exist, and "341
  // … absent from the right" against an empty table. Those months are
  // reachable: page.tsx clamps ?m= at the top and not at the bottom. The pair
  // degrades to the one table that CAN be read, plus a sentence saying why.
  const hasEntries = q.inspected > 0;
  return (
    <div className={s.sheet}>
      <Mast r={r} />

      {/* THE TWO POPULATIONS, SIDE BY SIDE — the whole reason the owner asked
          for this. QC does not grade a month's stone inside that month: it
          clears a backlog from earlier batches while the month's own last
          slabs are still queued. So "the grades this month" is two different
          questions with two different answers, and printing only the right
          hand one (which is all this sheet used to carry) tells the CEO the
          month's quality using other months' stone. Measured on live Neon
          2026-09-03 for August 2026: 6,390 QC entries were filed in the month,
          of which 5,390 were for slabs August declared and 1,000 were not —
          939 of those placed in another month's MIS and 61 placed in no MIS
          range at all, which is why the note below says "cannot be placed"
          rather than the "stone from earlier batches" it used to assert. 348
          of August's own slabs got their verdict only in September. Pass rate
          94.7% on the month's own slabs, 93.8% across every entry filed.
          NOTHING IS DOUBLE-COUNTED BETWEEN THEM: they are two denominators,
          each with its own total row, and neither is a subtotal of the other.
          The prose beneath states the overlap in slabs so nobody has to add
          the two totals together to find out.
          The right-hand table counts ENTRIES, not slabs, and its label says
          so — a slab inspected twice is two QC entries and one slab. */}
      <Section name="Quality grades"
        note={hasEntries
          ? "two populations, and they are not the same slabs — the month's own stone on the left, everything QC touched this month on the right; quote the left one for this month's quality"
          : "the month's own stone, graded whenever QC reached it — no QC entry falls in this month's own window, so there is nothing to set beside it"} />
      <div className={s.pair}>
        <div>
          {/* "by distinct slab number", said in the label and again in the
              total row. The KPI tile on page one and the Slabs column on page
              two both count what the hours CLAIMED (r.made); this table can
              only count numbers it can look up, and for August 2026 those are
              6,262 and 6,261 — two figures one word apart on one document is
              how a reader concludes the report cannot add up. */}
          <div className={s.subLabel}>
            {hasEntries ? "★ Quote this one · " : ""}Slabs {monthLong(r.month)} produced · by distinct slab
            number, graded whenever QC reached them
          </div>
          <table className={`${s.t} ${s.keep}`}>
            <thead><tr><th>Grade</th><th className={s.num}>Slabs</th><th className={s.num}>Share</th></tr></thead>
            <tbody>
              {PRODUCED_ROWS.map(([label, n]) => (
                <tr key={label}>
                  <td className={s.key}>{label}</td>
                  <td className={s.num}>{num(n(pg))}</td>
                  <td className={s.num}>{share(n(pg), pg.slabs)}</td>
                </tr>
              ))}
              <tr className={s.total}>
                <td>Distinct slab numbers</td>
                <td className={s.num}>{num(pg.slabs)}</td>
                <td className={s.num}>100%</td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* .pair splits its children evenly, so the surviving table would
            stretch across the whole sheet on its own and read as a different,
            wider table from the one every other month prints. The spacer keeps
            its half; the note beneath says what is missing and why. */}
        {!hasEntries && <div aria-hidden="true" />}
        {hasEntries && (
          <div>
            <div className={s.subLabel}>All QC entries filed this month · any month&rsquo;s stone</div>
            <table className={`${s.t} ${s.keep}`}>
              <thead><tr><th>Grade</th><th className={s.num}>QC entries</th><th className={s.num}>Share</th></tr></thead>
              <tbody>
                {q.grades.map(([g, n]) => (
                  <tr key={g}>
                    <td className={s.key}>{GRADE_LABEL[g] ?? g}</td>
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
          </div>
        )}
      </div>
      <p className={s.note}>
        {/* F7: ONE IMPERATIVE SENTENCE, FIRST. The two tables are the same
            width, the same styling and adjacent, and the right-hand one
            carries the familiar headline pass rate — which makes the wrong
            table the sticky one. The month's quality is the month's own stone;
            the other table is QC's workload, most of it other months'. */}
        {hasEntries && (
          <><strong>For {monthLong(r.month)}&rsquo;s quality, quote the left-hand table.</strong> It is this
          month&rsquo;s own stone. The right-hand one is QC&rsquo;s workload in the month, this month&rsquo;s
          slabs and other months&rsquo; mixed together, and the two totals cover different stone and must not
          be added together.{" "}</>
        )}
        {r.made === r.producedSlabs ? (
          <>{monthLong(r.month)} pressed <strong>{num(r.made)} slabs</strong>, every one a distinct number.</>
        ) : (
          <>{monthLong(r.month)}&rsquo;s hours claimed <strong>{num(r.made)} slabs</strong> across{" "}
          <strong>{num(r.producedSlabs)} distinct slab numbers</strong> — page one&rsquo;s figures band counts
          the claims, this table the numbers, and page two prints both as Slabs and Numbers with the rows where
          they part.</>
        )}{" "}
        {/* F6: no right-hand table, so nothing may be said about one. */}
        {hasEntries ? (
          <>QC filed <strong>{num(q.inspected)} entries</strong> in the same window, covering{" "}
          {num(q.inspectedSlabs)} distinct slabs.{" "}
          {r.qcEntriesElsewhere + r.qcEntriesUnplaced === 0 ? (
            <>Every one of them was for a slab this month declared.</>
          ) : (
            /* F4: "in no MIS range at all" was false. The bucket now means
               what it can prove — no range this report will WALK covers the
               number — which includes numbers that sit only inside a range
               refused as impossibly wide (all 14 of August 2026's are inside
               ranges 10,015 to 1,227,644 slabs wide, live Neon 2026-09-03). */
            <>Only <strong>{num(r.qcEntriesOnOwnSlabs)}</strong> were for slabs this month declared; of the
            other {num(r.qcEntriesElsewhere + r.qcEntriesUnplaced)}, {num(r.qcEntriesElsewhere)} carry a number
            some MIS hour declared — another month&rsquo;s, or an hour of this month that reached no
            shift — and {num(r.qcEntriesUnplaced)} sit in no MIS range this report can read: either no range
            names them, or the only range that does is one it refuses as impossibly wide.</>
          )}{" "}
          {r.producedGradedAfter > 0 && (
            <>Going the other way, the QC row for {num(r.producedGradedAfter)} of the month&rsquo;s own slabs
            arrived only after the month closed — counted on the left, absent from the right.{" "}</>
          )}</>
        ) : (
          <>No QC entry falls in this month&rsquo;s own window, so there is no second table to set beside it.
          Polishing and QC are windowed on their Airtable import stamp — created_time stops dead at 8 June
          2026 across the whole table (live Neon, 2026-09-03), leaving the import stamp the only timestamp
          still moving — and every row imported before that cutover carries a June 2026 stamp. A month that
          closed earlier therefore has no entries of its own, and the sections below read empty for the same
          reason. The table above still stands: it looks its slabs up BY NUMBER, whenever QC reached them.{" "}
          {r.producedGradedAfter > 0 && (
            <>The QC row for {num(r.producedGradedAfter)} of them arrived after the month closed.{" "}</>
          )}</>
        )}
        {pg.ungraded > 0 && <>{num(pg.ungraded)} of the month&rsquo;s slabs carry no verdict yet. </>}
        Pass rate is <strong>{pct1(producedRate)}</strong> on the month&rsquo;s own slabs
        {hasEntries && <> against <strong>{pct1(q.passRate)}</strong> across every entry filed</>}; A or A2
        over A+A2+B+C, with cut-to-size and sampling out of each side
        {hasEntries && <>, so the two are comparable</>}.
      </p>

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
      {/* F2: THE EXCLUSION THAT WAS PRINTED NOWHERE.
          An MIS row whose `hour` cell is blank cannot be placed in a shift, so
          the day figure (assembleDay sums the three shifts) drops it, and with
          it every slab it declared. That is not a rounding matter: measured on
          live Neon 2026-09-03, June 2026 has 11 such rows carrying 104 slabs
          whose numbers ALL appear in `press` and in `polish_entry` — real
          production, which /scoreboard/incentive counts and the payout pays
          for — so the report said June made 2,471 across 2,467 numbers when
          the plant's own MIS declares 2,575 across 2,544. July has 3 rows and
          19 slabs; August has none. Printed here beside the impossible-range
          note, on the same principle: an hour this report sets aside is an
          hour it must name. Folding them into `made` would move a historical
          production figure and an achievement percentage — the owner's call,
          not this page's. */}
      {r.unlabelled.slabs > 0 && (
        <p className={s.note}>
          <strong>{num(r.unlabelled.slabs)} slab{r.unlabelled.slabs === 1 ? "" : "s"} declared on{" "}
          {r.unlabelled.declaring} hourly row{r.unlabelled.declaring === 1 ? "" : "s"} with no hour typed</strong>{" "}
          — on {r.unlabelled.days.map(dayLabel).join(", ")}
          {r.unlabelled.hours > r.unlabelled.declaring
            && `, out of ${r.unlabelled.hours} rows this month that carry no hour at all`}. A row with no hour
          reaches no shift, so no figure on this report counts it: the {num(r.made)} slabs on page one
          and {r.unlabelled.slabs} more make {num(r.made + r.unlabelled.slabs)} that the sheets declare
          between them. The stone is real — those slab numbers are in the press and polishing records, and the
          month-incentive screen pays for them. Type the hour on {r.unlabelled.declaring === 1 ? "that row" : "those rows"}{" "}
          and they join every figure above; until then this report is short by that much and says so here
          rather than anywhere else.
        </p>
      )}
      {r.wideHours > 0 && (
        <p className={s.note}>
          <strong>{num(r.wideHours)} hour{r.wideHours === 1 ? "" : "s"} set aside</strong> for an impossible slab
          range — wider than 60 slabs in one hour, which the line cannot make, or ending before it starts — on{" "}
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
