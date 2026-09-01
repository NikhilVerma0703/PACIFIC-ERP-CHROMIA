import Link from "next/link";
import { Shell } from "@/components/Shell";
import { getDailyReport, type DailyReport } from "@/lib/dailyReport";
import { MAX_SLABS_PER_HOUR } from "@/lib/shiftScoreMath";
import { getMonthlyReport, currentReportDay, type MonthlyReport } from "@/lib/monthlyReport";
import { isAdmin } from "@/lib/rbac";
import { MonthlySheets, monthLong } from "./MonthlySheets";
import { InfoDot, Explain, Line, Sum } from "./InfoDot";
import { PrintButton } from "./PrintButton";
import { WidthToggle } from "./WidthToggle";
import s from "./report.module.css";

export const dynamic = "force-dynamic";

/* ---------------------------------------------------------------- helpers */
const DASH = "—", NDASH = "–";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const WORDS = ["Zero","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen",
  "Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen","Twenty","Twenty-one","Twenty-two","Twenty-three",
  "Twenty-four","Twenty-five","Twenty-six","Twenty-seven","Twenty-eight","Twenty-nine","Thirty"];

const longDate = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const hmWords = (m: number) => `${Math.floor(m / 60)} hours ${m % 60} minutes`;
const pct1 = (n: number | null) => (n == null ? DASH : `${n.toFixed(1)}%`);
const share = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : DASH);
const pctI = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : DASH);
const opens = (n: number) => WORDS[n] ?? String(n);
const yesterday = () => { const t = new Date(); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };

/* The in-charges' own words, tidied — never invented here. */
const tidy = (t: string) => t.replace(/\s*\n+\s*/g, "; ").replace(/\s{2,}/g, " ").replace(/[.;]\s*$/, "").trim();
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

function hourNarrative(x: DailyReport["hours"][number]) {
  if (x.details) return cap(tidy(x.details));
  const reasons = x.reasons.filter((r) => !/^NO DEVIATION$/i.test(r));
  if (reasons.length) return cap(tidy(reasons.join("; ")).toLowerCase());
  if (x.lost === 0 && x.made != null && x.std != null && x.made >= x.std) return "Ran to target";
  if (x.lost === 0) return "No delay recorded";
  return `${x.area.length ? `${x.area.join(" and ")} stop` : "Stoppage"}; reason not logged`;
}

function shiftNarrative(sh: DailyReport["shifts"][number]) {
  if (sh.lost === 0) return "Ran clean, no time lost";
  const c = { cleaning: 0, power: 0, process: 0, breakdown: 0 };
  const areas = new Map<string, number>();
  for (const x of sh.rows) {
    const isPower = x.reasons.some((r) => /POWER/i.test(r));
    c.cleaning += x.delay.cleaning; c.process += x.delay.process;
    c.power += x.delay.power + (isPower ? x.delay.breakdown : 0);
    c.breakdown += isPower ? 0 : x.delay.breakdown;
    for (const a of x.area) areas.set(a, (areas.get(a) ?? 0) + x.lost);
  }
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  const worst = [...areas].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (top === "power") return "Grid power cuts through the shift";
  if (top === "cleaning") return c.cleaning >= sh.lost * 0.5 ? "Ran clean; time went on planned cleaning" : "Cleaning and changeover took the time";
  if (top === "breakdown") return worst ? `${worst} faults` : "Machine and electrical faults";
  return worst ? `Process delays at the ${worst.toLowerCase()}` : "Process delays";
}

/* ------------------------------------------------------------- fragments */
const Section = ({ name, note }: { name: string; note?: string }) => (
  <div className={s.section}>
    <span className={s.sectionName}>{name}</span>
    {note && <span className={s.sectionNote}>{note}</span>}
  </div>
);

const Mast = ({ title, date }: { title: string; date: string }) => (
  <>
    <div className={s.mast}>
      <div>
        <div className={s.wordmark}>PACIFIC SURFACES</div>
        <div className={s.submark}>QUARTZ SURFACES &nbsp;·&nbsp; PRODUCTION PLANT</div>
      </div>
      <div>
        <div className={s.docTitle}>{title}</div>
        <div className={s.docDate}>{longDate(date)} &nbsp;·&nbsp; 06:00 to 06:00</div>
      </div>
    </div>
    <hr className={s.mastRule} />
  </>
);

const Foot = ({ date, page }: { date: string; page: number }) => (
  <div className={s.foot}>
    <span>Pacific Surfaces &nbsp;·&nbsp; Daily Report &nbsp;·&nbsp; {longDate(date)}</span>
    <span>Page {page} of 3</span>
  </div>
);

const Kpis = ({ tiles }: { tiles: [string, string, React.ReactNode?][] }) => (
  <div className={s.kpis}>
    {tiles.map(([value, label, info]) => (
      <div className={s.kpi} key={label}>
        <div className={s.kpiValue}>{value}{info}</div>
        <div className={s.kpiLabel}>{label}</div>
      </div>
    ))}
  </div>
);

/* ------------------------------------------------------------ page one */
function SheetProduction({ r }: { r: DailyReport }) {
  const { day, shifts, hours, cause } = r;
  // The standard is set on each hour's MIS entry from that hour's cycle time,
  // so it can change through the day — grouping by it is the only honest way
  // to show the target's arithmetic. (The tooltip once printed "hours × the
  // first hour's standard", which named a product the target never was:
  // 21 × 11 = 231 beside a target of 255.)
  // Standards are Float in the schema and cycle-time-derived, so a fractional
  // one is representable; group and print at two decimals or the first 10.1
  // typed on an MIS row puts "30.299999999999997" into the CEO's working
  // (and 11 vs 11.000001 would split into two lines).
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // Only rows that reach a shift: day.target is summed via the three shifts,
  // and a row with no hour label has shift null and contributes nothing — a
  // tooltip line for it would over-sum the printed total by exactly its std.
  const stdGroups = (() => {
    const m = new Map<number, number>();
    for (const x of hours) if (x.shift != null && x.made != null && x.std != null && x.std > 0) m.set(r2(x.std), (m.get(r2(x.std)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  })();
  // Declared hours with no standard set contribute zero to the target; if any
  // exist the tooltip must say so or its lines will not add up to the total.
  const declaredNoStd = hours.filter((x) => x.shift != null && x.made != null && !(x.std != null && x.std > 0)).length;
  const stdRange = stdGroups.length === 0 ? null
    : stdGroups.length === 1 ? `${stdGroups[0][0]}`
    : `${stdGroups[stdGroups.length - 1][0]}–${stdGroups[0][0]}`;
  // One flat "Target is X an hour" is honest only when every declared hour
  // actually carries X — a single std group WITH no-std hours still has hours
  // targeting zero, which the flat claim would paper over. Keep this wording
  // in step with scripts/make-daily-report-pdf.mjs (same line, same rule).
  const stdNote =
    (stdGroups.length > 1
      ? `Each hour carries its own target (${stdRange} an hour this day)`
      : `Target is ${stdRange ?? DASH} slabs an hour`) +
    (declaredNoStd > 0
      ? `; ${declaredNoStd} declared hour${declaredNoStd === 1 ? "" : "s"} carr${declaredNoStd === 1 ? "ies" : "y"} no standard and count${declaredNoStd === 1 ? "s" : ""} zero`
      : "");
  const designs = [...new Set(hours.map((x) => (x.batch && x.design ? `${x.batch}, ${x.design}` : null)).filter(Boolean))] as string[];
  // "Carried no output at all" must not also count the hours the sentence
  // below reports as SET ASIDE — a wide-range hour has made == null for a
  // different reason, and counting it in both had the page report one hour
  // twice, under two different explanations.
  const blank = hours.filter((x) => x.made == null && !x.wideRange).length;
  const ranked = [...shifts].filter((x) => x.pct != null).sort((a, b) => b.pct! - a.pct!);
  const best = ranked[0] ?? null, worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const causes = ([
    ["Cleaning and batch changeover", cause.cleaning, "Dry and full cleans, and the clean into the next batch"],
    ["Power cuts from the grid", cause.power, "Supply lost from the grid; the shift's own notes place this time here"],
    ["Process delays", cause.process, "Holds at the press, oven and rubber line, and waiting on material from the mixer"],
    ["Machine and electrical breakdowns", cause.breakdown, "Distributor, oven and electrical faults"],
  ] as [string, number, string][]).filter((c) => c[1] > 0).sort((a, b) => b[1] - a[1]);
  const noReason = hours.filter((x) => x.lost > 0 && x.reasons.filter((y) => !/NO DEVIATION/i.test(y)).length === 0);

  return (
    <div className={s.sheet}>
      <Mast title="Daily Production Report" date={r.date} />
      <Kpis tiles={[
        [String(day.made), "Slabs produced"],
        [String(r2(day.target)), "Target for the day",
          <InfoDot key="t" label="the target">
            {stdGroups.map(([rate, n]) => (
              <Line key={rate} of={`${n} hour${n === 1 ? "" : "s"} at ${rate} an hour`} is={String(r2(n * rate))} />
            ))}
            {declaredNoStd > 0 && <Line of={`${declaredNoStd} declared hour${declaredNoStd === 1 ? "" : "s"} with no standard set`} is="0" />}
            <Line of="Hours with no output declared" is={`${day.hoursTotal - day.hoursRun} (left out)`} />
            <Sum of="Sum of each hour's own standard" is={String(r2(day.target))} />
            <span style={{ display: "block", marginTop: 6, opacity: 0.8 }}>
              The standard comes from each hour&rsquo;s own MIS entry (its cycle time), so it can change
              through the day. An hour that declared nothing is left out rather than counted as a miss.
            </span>
          </InfoDot>],
        [pct1(day.pct), "Achievement",
          <InfoDot key="a" label="achievement">
            <Line of="Slabs produced" is={String(day.made)} />
            <Line of="Target for those hours" is={String(r2(day.target))} />
            <Sum of={`${day.made} ÷ ${day.target}`} is={pct1(day.pct)} />
          </InfoDot>],
        [hm(day.lost), "Time lost"],
        [`${day.hoursRun} of ${day.hoursTotal}`, "Hours the line ran"],
      ]} />

      <p className={s.prose}>
        The plant produced <strong>{day.made} slabs against a target of {day.target}</strong>, {day.pct?.toFixed(1)} per
        cent of standard rate, and lost <strong>{day.lost} minutes</strong> {DASH} {hmWords(day.lost)} of the
        twenty-four {DASH} to stoppages. The line ran <strong>{designs.join(" and ")}</strong>.{" "}
        {blank > 0 && `${blank === 1 ? "One hour" : `${opens(blank)} hours`} carried no output at all and ${blank === 1 ? "is" : "are"} shown as such; ${blank === 1 ? "it is" : "they are"} left out of the target rather than counted as misses. `}
        {day.wideHours > 0 && <><strong>{day.wideHours === 1 ? "One hour was" : `${opens(day.wideHours)} hours were`} set aside</strong>: the slab range typed on {day.wideHours === 1 ? "it" : "them"} is wider than {MAX_SLABS_PER_HOUR} slabs, which the line cannot make in an hour, so {day.wideHours === 1 ? "it makes" : "they make"} no claim here — the same rule the entry form and the scoreboard already apply. Correct the range on the MIS row and the {day.wideHours === 1 ? "hour" : "hours"} returns. </>}
        {best && worst && <>{best.letter} shift ran best at {best.pct?.toFixed(1)} per cent; {worst.letter} shift ran worst at {worst.pct?.toFixed(1)} per cent.</>}
        {best && !worst && <>Only {best.letter} shift declared output, at {best.pct?.toFixed(1)} per cent.</>}
      </p>

      <Section name="Shift by shift" />
      <table className={s.t}>
        <thead><tr>
          <th>Shift</th><th>Hours (IST)</th><th>In-charge</th>
          <th className={s.num}>Slabs</th><th className={s.num}>Target</th>
          <th className={s.num}>Achieved</th><th className={s.num}>Lost</th><th>What shaped the shift</th>
        </tr></thead>
        <tbody>
          {shifts.map((x) => (
            <tr key={x.letter}>
              <td className={s.key}>{x.letter}</td><td>{x.label}</td><td>{x.incharge ?? DASH}</td>
              <td className={s.num}>{x.made}</td><td className={s.num}>{x.target}</td>
              <td className={s.num}>{pct1(x.pct)}</td><td className={s.num}>{x.lost} m</td>
              <td className={s.muted}>{shiftNarrative(x)}</td>
            </tr>
          ))}
          <tr className={s.total}>
            <td>Day</td><td>24 hours</td><td>All three</td>
            <td className={s.num}>{day.made}</td><td className={s.num}>{day.target}</td>
            <td className={s.num}>{pct1(day.pct)}</td><td className={s.num}>{day.lost} m</td>
            <td>Time lost equals {((100 * day.lost) / 1440).toFixed(1)}% of the day</td>
          </tr>
        </tbody>
      </table>

      <Section name="Hour by hour" note={`${stdNote}. A dash means the line produced nothing that hour.`} />
      <table className={s.t}>
        <thead><tr>
          <th>Hour</th><th>Batch and design</th><th className={s.num}>Made</th>
          <th className={s.num}>Target</th><th className={s.num}>Lost</th><th>What happened</th>
        </tr></thead>
        <tbody>
          {hours.map((x) => (
            <tr key={x.hour}>
              <td className={s.key}>{x.hour}</td>
              <td>{[x.batch, x.design].filter(Boolean).join("  ")}</td>
              <td className={s.num}>{x.made ?? DASH}</td>
              <td className={s.num}>{x.made == null ? DASH : x.std ?? DASH}</td>
              <td className={s.num}>{x.lost ? `${x.lost} m` : NDASH}</td>
              <td className={s.muted}>{hourNarrative(x)}</td>
            </tr>
          ))}
          <tr className={s.total}>
            <td>Day</td><td>{designs.map((d) => d.split(",")[0]).join(" / ")}</td>
            <td className={s.num}>{day.made}</td><td className={s.num}>{day.target}</td>
            <td className={s.num}>{day.lost} m</td>
            <td>{day.onTarget} hours ran to target with no time lost</td>
          </tr>
        </tbody>
      </table>

      <Section name="Where the time went" note={`${day.lost} minutes lost, ranked by cost`} />
      <table className={s.t}>
        <thead><tr><th>Cause</th><th className={s.num}>Minutes</th><th className={s.num}>Share</th><th>What it was</th></tr></thead>
        <tbody>
          {causes.map(([name, mins, what]) => (
            <tr key={name}><td className={s.key}>{name}</td><td className={s.num}>{mins}</td>
              <td className={s.num}>{pctI(mins, day.lost)}</td><td className={s.muted}>{what}</td></tr>
          ))}
          <tr className={s.total}>
            <td>Total time lost</td><td className={s.num}>{day.lost}</td><td className={s.num}>100%</td>
            <td>{hmWords(day.lost)}, or {((100 * day.lost) / 1440).toFixed(1)}% of the twenty-four hour day</td>
          </tr>
        </tbody>
      </table>

      {r.reclassified > 0 && (
        <p className={s.note}>
          {r.reclassified} minutes booked to machine breakdown on the log are shown above under power cuts, where the
          shift&apos;s own written notes place them.
          {noReason.length > 0 && ` ${noReason.reduce((a, x) => a + x.lost, 0)} minutes across ${noReason.length} hours were logged with no reason given.`}
        </p>
      )}
      <p className={s.note}>
        The figures on this page come from the hourly shift log signed by the production in-charges; the press
        station&apos;s own entries for this day have not been entered into the system.
      </p>
      <p className={s.hint}>On screen, any figure with a dotted underline opens its own working when clicked, as does the &quot;i&quot; beside the headline numbers. Neither is shown on the printed sheet.</p>
      <Foot date={r.date} page={1} />
    </div>
  );
}

/* ------------------------------------------------------------ page two */
const REWORK_LABEL: Record<string, string> = {
  "Direct Ok": "Passed straight through",
  "RW Required and ongoing": "Rework in progress",
  "Can't be Reworked": "Cannot be reworked",
  "RW Done Ok": "Rework completed",
  "Not recorded": "Not recorded",
};

function gradeMeaning(g: string, n: number, dispatched: number) {
  if (g === "A") return "First quality, passed";
  if (g === "C (Reject)") return "Rejected";
  if (g === "Not graded yet") return "Still in process, grade pending";
  if (g === "A2") return `Passed at the second tier; ${dispatched} of the ${n} cleared for dispatch`;
  if (g === "B") return `Downgraded and held back; ${dispatched === 0 ? "none" : dispatched} cleared for dispatch`;
  return "No grade on the record";
}

function SheetQuality({ r }: { r: DailyReport }) {
  const q = r.quality;
  const p = q.polishing;
  // NAMED BY THE QUESTION EACH COLUMN ANSWERS.
  // These rows used to read "passed", which invited them to be compared with
  // the 133 that passed inspection. They are not the same slabs and not the
  // same question: seven slabs that cleared the polishing line were graded B
  // or C afterwards.
  const cleared = p.noRepolish + p.passedAfter;
  const polishRows: [React.ReactNode, number, string][] = [
    [
      <Explain key="c" label="the cleared figure" tip={<>
        <span className={s.hoverTitle}>Cleared the polishing line</span>
        Two values of the QC record&apos;s <b>repolish status</b>, both meaning the slab came off the line good.
        <Line of="Direct Ok — needed no polish" is={String(p.noRepolish)} />
        <Line of="Polish Ok — good after a polish" is={String(p.passedAfter)} />
        <Sum of="Cleared" is={String(cleared)} />
        <span className={s.hoverField}>Field: polish_qc.repolish_status</span>
      </>}>Cleared the polishing line</Explain>,
      cleared, "cleared",
    ],
    ["Repolish done", p.repolishDone, "rd"],
    ["Still needs repolishing", p.needsRepolish, "nr"],
    ["Not recorded", p.notRecorded, "nrec"],
  ];
  const half = Math.ceil(q.faultsAll.length / 2);
  const faultCol = (rows: [string, number][], total: number, withTotal: boolean) => (
    <table className={s.t}>
      <thead><tr><th>Fault</th><th className={s.num}>Recorded</th><th className={s.num}>Share</th></tr></thead>
      <tbody>
        {rows.map(([f, n]) => (
          <tr key={f}><td className={s.key}>{f}</td><td className={s.num}>{n}</td><td className={`${s.num} ${s.muted}`}>{share(n, total)}</td></tr>
        ))}
        {withTotal && <tr className={s.total}><td>Total</td><td className={s.num}>{total}</td><td className={s.num}>100%</td></tr>}
      </tbody>
    </table>
  );

  return (
    <div className={s.sheet}>
      <Mast title="Polishing and Quality" date={r.date} />
      <Kpis tiles={[
        [String(q.polished), "Slabs polished",
          <InfoDot key="s" label="the polished count">
            Slabs that came off the polishing line today. {q.slabsInBoth} of them were also
            inspected today; {q.polishedNotInspected} await inspection at the QC station.
            {q.polished !== q.polishedSlabs &&
              ` The headline counts ${q.polished} entries, covering ${q.polishedSlabs} distinct slabs.`}
          </InfoDot>],
        [String(q.inspected), "Slabs inspected",
          <InfoDot key="i" label="the inspected count">
            Slabs quality-checked today, including ones polished on earlier days. {q.slabsInBoth} were
            polished today as well; {q.inspectedNotPolished} came to inspection from the earlier backlog.
            {q.inspected !== q.inspectedSlabs &&
              ` The headline counts ${q.inspected} entries, covering ${q.inspectedSlabs} distinct slabs.`}
          </InfoDot>],
        [String(q.passed), "Passed inspection"],
        [pct1(q.passRate), "Pass rate, graded slabs",
          <InfoDot key="p" label="the pass rate">
            <Line of="Graded A" is={String(q.gradeA)} />
            <Line of="Graded A2" is={String(q.gradeA2)} />
            <Line of="Passed (A + A2)" is={String(q.passed)} />
            <Line of="Graded B or C" is={String(q.held)} />
            <Line of="Carrying a final grade" is={String(q.graded)} />
            <Sum of={`${q.passed} ÷ ${q.graded}`} is={pct1(q.passRate)} />
            <span style={{ display: "block", marginTop: 6, opacity: 0.8 }}>
              The {q.ungraded} slabs still being graded are excluded from both sides, so a slab
              that has not been judged yet cannot count as a pass or a failure.
            </span>
          </InfoDot>],
        [String(q.openForRework), "Open for rework",
          <InfoDot key="o" label="open for rework">
            <Line of="Still needs repolishing" is={String(p.needsRepolish)} />
            <Line of="Rework in progress" is={String(q.rework.find(([k]) => k === "RW Required and ongoing")?.[1] ?? 0)} />
            <Line of="Counted in both" is={`−${p.needsRepolish + (q.rework.find(([k]) => k === "RW Required and ongoing")?.[1] ?? 0) - q.openForRework}`} />
            <Sum of="Distinct slabs still open" is={String(q.openForRework)} />
          </InfoDot>],
        [String(q.recovered), "Recovered after rework",
          <InfoDot key="rec" label="recovered after rework">
            <span style={{ display: "block", marginBottom: 6, opacity: 0.85 }}>
              Slabs that were not right, were worked, and then were {DASH} the mirror of
              the figure to its left.
            </span>
            <Line of="Repolish done" is={String(q.recoveredRepolish)} />
            <Line of="Rework done, came back OK" is={String(q.recoveredRework)} />
            <Line of="Counted in both" is={`−${q.recoveredRepolish + q.recoveredRework - q.recovered}`} />
            <Sum of="Distinct slabs recovered" is={String(q.recovered)} />
            <span style={{ display: "block", marginTop: 6, opacity: 0.8 }}>
              A slab that was merely ungraded and is later graded good is not counted:
              the grade is overwritten in place and keeps no history, so nothing records
              that it was ever ungraded.
            </span>
          </InfoDot>],
      ]} />

      <p className={s.prose}>
        {q.polished} slabs went through the polishing line and {q.inspected} were inspected. Of the{" "}
        <strong>{q.graded} slabs that carry a final grade, {q.passed} passed</strong> {DASH} a pass rate
        of {q.passRate?.toFixed(1)} per cent. {opens(q.held)} {q.held === 1 ? "was" : "were"} downgraded or rejected.
        A further <strong>{q.ungraded} are still being graded</strong> and are not counted either way.{" "}
        {opens(q.openForRework)} slabs remain open for repolishing or rework, and {q.toDispatch} of the {q.inspected} are
        already flagged to go to dispatch, all of them grade A or A2.
      </p>

      <Section name="Quality grades" note={`all ${q.inspected} slabs inspected during the day`} />
      <table className={s.t}>
        <thead><tr><th>Grade</th><th className={s.num}>Slabs</th><th className={s.num}>Share</th><th>What it means</th></tr></thead>
        <tbody>
          {q.grades.map(([g, n]) => (
            <tr key={g}><td className={s.key}>{g}</td><td className={s.num}>{n}</td>
              <td className={s.num}>{share(n, q.inspected)}</td>
              <td className={s.muted}>{gradeMeaning(g, n, (q.dispatchByGrade as Record<string, number>)[g] ?? 0)}</td></tr>
          ))}
          <tr className={s.total}><td>Total inspected</td><td className={s.num}>{q.inspected}</td><td className={s.num}>100%</td>
            <td>{q.passed} passed, {q.held} held or rejected, {q.ungraded} still to be graded</td></tr>
        </tbody>
      </table>

      <Section name="What still needs work" />
      <div className={s.pair}>
        <div>
          <div className={s.subLabel}>Polishing outcome</div>
          <table className={s.t}>
            <thead><tr><th>Did it need repolishing?</th><th className={s.num}>Slabs</th><th className={s.num}>Share</th></tr></thead>
            <tbody>
              {polishRows.filter(([, n]) => n > 0).map(([k, n, id]) => (
                <tr key={id}><td className={s.key}>{k}</td><td className={s.num}>{n}</td><td className={`${s.num} ${s.muted}`}>{share(n, q.inspected)}</td></tr>
              ))}
              <tr className={s.total}><td>Total</td><td className={s.num}>{q.inspected}</td><td className={s.num}>100%</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <div className={s.subLabel}>Rework</div>
          <table className={s.t}>
            <thead><tr><th>Did it need rework?</th><th className={s.num}>Slabs</th><th className={s.num}>Share</th></tr></thead>
            <tbody>
              {q.rework.map(([k, n]) => (
                <tr key={k}>
                  <td className={s.key}>
                    {k === "Direct Ok" ? (
                      <Explain label="passed straight through" tip={<>
                        <span className={s.hoverTitle}>Passed straight through</span>
                        Slabs that never needed rework {DASH} a different question from the {q.passed} that
                        passed inspection, and a different set of slabs.
                        {q.reworkClearByGrade.map(([g, c]) => <Line key={g} of={`Graded ${g}`} is={String(c)} />)}
                        <Sum of="Needed no rework" is={String(n)} />
                        <span className={s.hoverField}>Field: polish_qc.rw_status = &quot;Direct Ok&quot;</span>
                      </>}>{REWORK_LABEL[k] ?? k}</Explain>
                    ) : (REWORK_LABEL[k] ?? k)}
                  </td>
                  <td className={s.num}>{n}</td><td className={`${s.num} ${s.muted}`}>{share(n, q.inspected)}</td>
                </tr>
              ))}
              <tr className={s.total}><td>Total</td><td className={s.num}>{q.inspected}</td><td className={s.num}>100%</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className={s.note}>
        These two columns and the {q.passed} that passed inspection are three different questions about the same{" "}
        {q.inspected} slabs {DASH} what grade QC gave it, whether it needed repolishing, and whether it needed rework.
        A slab can clear one and fail another, so the totals are not meant to agree.
      </p>

      <Section name="The faults that caused it" note="left, every fault recorded; right, only those on downgraded and rejected slabs" />
      <div className={s.pair}>
        <div style={{ flex: 2 }}>
          <div className={s.subLabel}>All faults</div>
          <div className={s.pair}>
            {faultCol(q.faultsAll.slice(0, half), q.faultTotal, false)}
            {faultCol(q.faultsAll.slice(half), q.faultTotal, true)}
          </div>
        </div>
        <div>
          <div className={s.subLabel}>B and C grades only</div>
          {faultCol(q.faultsBC, q.bcFaultTotal, true)}
        </div>
      </div>
      <p className={s.note}>
        {q.faultTotal} faults across {q.faultSlabs} of the {q.inspected} slabs inspected, {q.faultSlabsMulti} of them
        carrying more than one; the other {q.inspected - q.faultSlabs} were logged with no fault at all. On the right,
        the {q.bcFaultTotal} faults on the {q.bcSlabs} slabs graded B or C.
      </p>

      <Section name="Who did the work" />
      <div className={s.pair}>
        {([["Polishing operator", "Operator", q.operators, q.polished], ["Quality inspector", "Inspector", q.inspectors, q.inspected]] as const).map(
          ([label, head, rows, total]) => (
            <div key={label}>
              <div className={s.subLabel}>{label}</div>
              <table className={s.t}>
                <thead><tr><th>{head}</th><th className={s.num}>Slabs</th><th className={s.num}>Share</th><th>Shift</th></tr></thead>
                <tbody>
                  {rows.map(([k, n, sh]) => (
                    <tr key={k}><td className={s.key}>{k}</td><td className={s.num}>{n}</td>
                      <td className={s.num}>{share(n, total)}</td><td className={s.muted}>{sh}</td></tr>
                  ))}
                  <tr className={s.total}><td>Total</td><td className={s.num}>{total}</td><td className={s.num}>100%</td><td /></tr>
                </tbody>
              </table>
            </div>
          ))}
      </div>

      <Section name="What was polished" note={`${q.polished} slabs, and how each design was graded`} />
      <div className={s.pair}>
        <div style={{ flex: 2.4 }}>
          <table className={s.t}>
            <thead><tr><th>Design</th><th>Batch</th><th className={s.num}>Slabs</th><th className={s.num}>A</th>
              <th className={s.num}>A2</th><th className={s.num}>B</th><th className={s.num}>C</th>
              <th className={s.num}>Ungraded</th><th>Face</th></tr></thead>
            <tbody>
              {q.designs.map((d) => (
                <tr key={d.design ?? "-"}>
                  <td className={s.key}>{d.design ?? DASH}</td>
                  <td>{[...d.batches].sort().reverse()[0] ?? DASH}</td>
                  <td className={s.num}>{d.slabs}</td><td className={s.num}>{d.A}</td><td className={s.num}>{d.A2}</td>
                  <td className={s.num}>{d.B}</td><td className={s.num}>{d.C}</td>
                  <td className={`${s.num} ${s.muted}`}>{d.ungraded}</td><td className={s.muted}>{d.face ?? DASH}</td>
                </tr>
              ))}
              <tr className={s.total}>
                <td>Total</td><td />
                <td className={s.num}>{q.polished}</td>
                <td className={s.num}>{q.designs.reduce((a, d) => a + d.A, 0)}</td>
                <td className={s.num}>{q.designs.reduce((a, d) => a + d.A2, 0)}</td>
                <td className={s.num}>{q.designs.reduce((a, d) => a + d.B, 0)}</td>
                <td className={s.num}>{q.designs.reduce((a, d) => a + d.C, 0)}</td>
                <td className={s.num}>{q.designs.reduce((a, d) => a + d.ungraded, 0)}</td><td />
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <table className={s.t}>
            <thead><tr><th>Thickness</th><th className={s.num}>Slabs</th><th className={s.num}>Share</th></tr></thead>
            <tbody>
              {q.thickness.map(([k, n]) => (
                <tr key={k}><td className={s.key}>{k}</td><td className={s.num}>{n}</td><td className={`${s.num} ${s.muted}`}>{share(n, q.polished)}</td></tr>
              ))}
              <tr className={s.total}><td>Total</td><td className={s.num}>{q.polished}</td><td className={s.num}>100%</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className={s.note}>
        &quot;Ungraded&quot; covers slabs still awaiting a grade and slabs with no QC record yet, so these counts differ
        from the grade table {DASH} that counts the {q.inspected} inspected, a different set from the {q.polished}{" "}
        polished. Polishing runs behind the press, so this page is not the same slabs as page one.
      </p>
      <p className={s.hint}>On screen, any figure with a dotted underline opens its own working when clicked, as does the &quot;i&quot; beside the headline numbers. Neither is shown on the printed sheet.</p>
      <Foot date={r.date} page={2} />
    </div>
  );
}

/* ---------------------------------------------------------- page three */
function SheetMaintenance({ r }: { r: DailyReport }) {
  const m = r.maintenance;
  const worst = m.byArea[0];
  const longest = [...m.events].sort((a, b) => b.delay.breakdown - a.delay.breakdown)[0];

  return (
    <div className={s.sheet}>
      <Mast title="Maintenance" date={r.date} />
      <Kpis tiles={[
        [String(m.events.length), "Breakdown events"],
        [`${m.minutes} m`, "Time lost to breakdowns",
          <InfoDot key="m" label="breakdown time">
            {m.byArea.map((a) => <Line key={a.area} of={a.area} is={`${a.minutes} m`} />)}
            <Sum of="Total" is={`${m.minutes} m`} />
            <span style={{ display: "block", marginTop: 6, opacity: 0.8 }}>
              Matches the breakdown row on page one. Hours whose notes say the supply was lost are
              counted as power cuts there and here, not as machine faults.
            </span>
          </InfoDot>],
        [String(m.byArea.length), "Areas affected"],
        [String(m.withRca), "RCA numbers raised"],
        [String(m.spares.length), "Hours that used spares"],
      ]} />

      <p className={s.prose}>
        {m.events.length === 0 ? (
          <>No machine or electrical breakdown was recorded on this day.</>
        ) : (
          <>
            {m.events.length} {m.events.length === 1 ? "hour" : "hours"} were flagged as a machine or electrical
            breakdown, costing <strong>{m.minutes} minutes</strong>
            {worst && <> {DASH} most of it in the <strong>{worst.area}</strong> ({worst.minutes} minutes across {worst.events} {worst.events === 1 ? "hour" : "hours"})</>}.
            {longest && longest.delay.breakdown > 0 && <> The single longest stop was the {longest.hour} hour at {longest.delay.breakdown} minutes.</>}
            {m.withRca === 0 && <> No RCA number was raised against any of them.</>}
          </>
        )}
      </p>

      {m.events.length > 0 && (
        <>
          <Section name="Every breakdown, hour by hour" />
          <table className={s.t}>
            <thead><tr>
              <th>Hour</th><th>Shift</th><th>Area</th><th className={s.num}>Lost</th>
              <th>What happened</th><th>Spares used</th><th className={s.num}>RCA</th>
            </tr></thead>
            <tbody>
              {m.events.map((x) => (
                <tr key={x.hour}>
                  <td className={s.key}>{x.hour}</td><td>{x.shift ?? DASH}</td>
                  <td>{x.area.length ? x.area.join(" / ") : DASH}</td>
                  <td className={s.num}>{x.delay.breakdown ? `${x.delay.breakdown} m` : NDASH}</td>
                  <td className={s.muted}>{x.details ? cap(tidy(x.details)) : DASH}</td>
                  <td className={s.muted}>{x.spares ?? DASH}</td>
                  <td className={`${s.num} ${s.muted}`}>{x.rca ?? DASH}</td>
                </tr>
              ))}
              <tr className={s.total}>
                <td>Total</td><td /><td>{m.byArea.length} areas</td>
                <td className={s.num}>{m.minutes} m</td>
                <td>{m.spares.length ? `Spares used in ${m.spares.length} of ${m.events.length} hours` : "No spares recorded"}</td>
                <td /><td className={s.num}>{m.withRca}</td>
              </tr>
            </tbody>
          </table>

          <Section name="Where it failed" />
          <div className={s.pair}>
            <div>
              <div className={s.subLabel}>By area</div>
              <table className={s.t}>
                <thead><tr><th>Area</th><th className={s.num}>Events</th><th className={s.num}>Minutes</th><th>Hours</th></tr></thead>
                <tbody>
                  {m.byArea.map((a) => (
                    <tr key={a.area}><td className={s.key}>{a.area}</td><td className={s.num}>{a.events}</td>
                      <td className={s.num}>{a.minutes}</td><td className={s.muted}>{a.hours.join(", ")}</td></tr>
                  ))}
                  <tr className={s.total}><td>Total</td><td className={s.num}>{m.byArea.reduce((a, x) => a + x.events, 0)}</td>
                    <td className={s.num}>{m.minutes}</td><td /></tr>
                </tbody>
              </table>
            </div>
            <div>
              <div className={s.subLabel}>By shift</div>
              <table className={s.t}>
                <thead><tr><th>Shift</th><th className={s.num}>Events</th><th className={s.num}>Minutes</th><th>Production in-charge</th></tr></thead>
                <tbody>
                  {m.byShift.map((x) => (
                    <tr key={x.shift}><td className={s.key}>{x.shift}</td><td className={s.num}>{x.events}</td>
                      <td className={s.num}>{x.minutes}</td>
                      <td className={s.muted}>{r.shifts.find((sh) => sh.letter === x.shift)?.incharge ?? DASH}</td></tr>
                  ))}
                  <tr className={s.total}><td>Total</td><td className={s.num}>{m.events.length}</td>
                    <td className={s.num}>{m.minutes}</td><td /></tr>
                </tbody>
              </table>
            </div>
          </div>

          <Section name="Who was on" />
          <table className={s.t}>
            <thead><tr><th>Trade</th><th>Named on the log</th><th>Covering</th></tr></thead>
            <tbody>
              <tr><td className={s.key}>Electrical</td><td>{m.electrical.join(", ") || DASH}</td>
                <td className={s.muted}>Named on every hour of the day</td></tr>
              <tr><td className={s.key}>Mechanical</td><td>{m.mechanical.join(", ") || DASH}</td>
                <td className={s.muted}>Named on every hour of the day</td></tr>
            </tbody>
          </table>
        </>
      )}

      {m.powerCuts.rows.length > 0 && (
        <>
          <Section name="Power cuts from the grid" />
          <p className={s.prose}>
            The grid went down in {m.powerCuts.rows.length} {m.powerCuts.rows.length === 1 ? "hour" : "hours"}, costing{" "}
            <strong>{m.powerCuts.minutes} minutes</strong>. These are not maintenance events {DASH} nothing failed in the
            plant {DASH} so they sit apart from the breakdown tables above and match the power-cut row on page one.
          </p>
          <table className={s.t}>
            <thead><tr>
              <th>Hour</th><th>Shift</th><th className={s.num}>Lost</th><th>What the log says</th>
            </tr></thead>
            <tbody>
              {m.powerCuts.rows.map((x) => (
                <tr key={x.hour}>
                  <td className={s.key}>{x.hour}</td><td>{x.shift ?? DASH}</td>
                  <td className={s.num}>{x.minutes ? `${x.minutes} m` : NDASH}</td>
                  <td className={s.muted}>{x.reasonsSayPower
                    ? (x.note ? cap(tidy(x.note)) : x.reasons.filter((rr) => /POWER/i.test(rr)).join(", ") || DASH)
                    : <>Minutes entered in the hour{"’"}s power-out column{x.alsoMachineFault && <> {DASH} the same hour{"’"}s machine stop is listed above</>}</>}</td>
                </tr>
              ))}
              <tr className={s.total}>
                <td>Total</td><td /><td className={s.num}>{m.powerCuts.minutes} m</td>
                <td>Booked to power on page one, not to maintenance</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <p className={s.note}>
        This page is built from the maintenance fields on the hourly shift log {DASH} the area of the problem, the
        breakdown flag, spares used and the RCA number. The maintenance ticket system holds no entries at all, for this
        day or any other, so nothing here comes from it. Until tickets are raised, an RCA column of dashes means the
        analysis was never recorded, not that the cause was obvious.
      </p>
      <p className={s.hint}>On screen, any figure with a dotted underline opens its own working when clicked, as does the &quot;i&quot; beside the headline numbers. Neither is shown on the printed sheet.</p>
      <Foot date={r.date} page={3} />
    </div>
  );
}

/* --------------------------------------------------------------- the page */
// ONE report page, two grains. ?d=YYYY-MM-DD (or nothing) is the daily report
// it has always been; ?m=YYYY-MM or ?view=monthly is the month, in the same
// document design — every day row of which links back to the daily view.
export default async function CeoReportPage({ searchParams }: { searchParams: Promise<{ d?: string; m?: string; view?: string }> }) {
  const { d, m, view } = await searchParams;
  // A REAL month number — \d{2} alone admits "2025-13", which passes the
  // string clamp and then reports a database outage for what is a bad URL.
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  const monthly = view === "monthly" || (!!m && MONTH_RE.test(m));

  const thisMonth = currentReportDay().slice(0, 7);
  const month = m && MONTH_RE.test(m) && m <= thisMonth ? m : thisMonth;
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : yesterday();

  let report: DailyReport | null = null;
  let monthReport: MonthlyReport | null = null;
  let error: string | null = null;
  try {
    if (monthly) monthReport = await getMonthlyReport(month);
    else report = await getDailyReport(date);
  } catch {
    error = "Could not read the database.";
  }

  // Only an admin gets the Fill buttons on the unfilled-hours list — the rest
  // of that panel (which shift, which hours) is a fact everyone reading this
  // report should see; entering a shift's sheet for it is not.
  const canFill = monthly && (await isAdmin());

  const seg = "px-3 py-1.5 text-sm";
  const segOn = `${seg} bg-brand font-medium text-white`;
  const segOff = `${seg} bg-white text-gray-700 hover:bg-gray-50`;

  return (
    <Shell>
      <div className={s.doc}>
        <form method="GET" className={s.bar}>
          {/* The grain toggle — plain links, so Back and bookmarks behave. */}
          <div className="flex overflow-hidden rounded-md border border-gray-300">
            <Link href="/report/ceo" className={monthly ? segOff : segOn}>Daily</Link>
            <Link href="/report/ceo?view=monthly" className={monthly ? segOn : segOff}>Monthly</Link>
          </div>
          <label className="text-sm font-medium text-gray-700" htmlFor={monthly ? "m" : "d"}>Report for</label>
          {/* keeps the monthly grain even if the month box is submitted empty */}
          {monthly && <input type="hidden" name="view" value="monthly" />}
          {monthly ? (
            <input
              type="month" id="m" name="m" defaultValue={month} max={thisMonth}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          ) : (
            /* max is TODAY's report day, not yesterday: the monthly view links
               every day row here, the in-progress one included, and a default
               past max leaves the input constraint-invalid with Show dead. */
            <input
              type="date" id="d" name="d" defaultValue={date} max={currentReportDay()}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          )}
          <button className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
            Show
          </button>
          <span className="flex-1" />
          <WidthToggle />
          <PrintButton />
        </form>

        {error && <p className="mx-auto max-w-xl text-sm text-red-600">{error}</p>}

        {!monthly && report && report.hours.length === 0 && (
          <p className="mx-auto max-w-xl text-sm text-gray-600">
            No shift log was entered for {longDate(date)}, so there is nothing to report for that day.
          </p>
        )}
        {!monthly && report && report.hours.length > 0 && (
          <div className={s.scroller}>
            <SheetProduction r={report} />
            <SheetQuality r={report} />
            <SheetMaintenance r={report} />
          </div>
        )}

        {monthly && monthReport && monthReport.daysLogged === 0 && (
          <p className="mx-auto max-w-xl text-sm text-gray-600">
            No shift log was entered in {monthLong(month)}, so there is nothing to report for that month.
          </p>
        )}
        {monthly && monthReport && monthReport.daysLogged > 0 && (
          <div className={s.scroller}>
            <MonthlySheets r={monthReport} canFill={canFill} />
          </div>
        )}
      </div>
    </Shell>
  );
}
