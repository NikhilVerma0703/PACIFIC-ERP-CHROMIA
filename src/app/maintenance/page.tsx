import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Badge } from "@/components/ui";
import { canRaiseMaintenance, canRespondDowntime, canSeeMaintenanceLog } from "@/lib/rbac";
import { listPmEntries } from "@/lib/preventiveMaintenance";
import { redirect } from "next/navigation";
import { listTickets, PRIORITIES, DOWNTIME_STATUSES } from "@/lib/maintenanceLog";
import { getDowntimeReport } from "@/lib/downtime";
import { getDowntimeResponses, type DowntimeResp } from "@/lib/downtimeResponse";
import { getDelayReclassLog } from "@/lib/delayReclassLog";
import type { ReclassRecord } from "@/lib/delayReclass";
import { photosForRecords } from "@/lib/entryPhoto";
import { buildInbox, inboxWindow, isRealIncident, istDay, INBOX_DEFAULT_DAYS } from "@/lib/maintenanceQueue";
import { MaintenanceBoard } from "./MaintenanceBoard";

export const dynamic = "force-dynamic";

/**
 * The maintenance log — now the ONE inbox for everything maintenance is asked to
 * answer: the tickets somebody raised here, and the downtime incidents the MIS
 * hourly log recorded.
 *
 * WHAT CHANGED, AND WHY IT CONTRADICTS THIS FILE'S OWN PREVIOUS HEADER. This page
 * used to say its point was "the faults that never became a downtime incident",
 * and it ended with a card explaining that stoppages are answered on /mis
 * instead. That was a deliberate decision and it is deliberately overturned
 * here, at the owner's request: pointing at the Breakdown & Deviation Log he
 * asked that "those entries from MIS should also appear in this page and can be
 * responded to from here as well."
 *
 * He is right, and this repo had already written down why. src/lib/maintenanceLog.ts
 * warns that leaving the ticket/response mirror one-way gives "maintenance two
 * inboxes and production two places to look for the same answer — and the one
 * that is staler is the one someone will read." Splitting the two KINDS of work
 * across two PAGES was that same failure one level up: on the day this was
 * reported /maintenance read "Open 0 · Awaiting a first reply 0 · Nothing logged
 * yet" while /mis listed eight unanswered downtime rows. The page written for
 * the Maintenance Manager was telling him he had nothing to do. So this is the
 * completion of that reasoning, not a reversal of it.
 *
 * The arithmetic behind the KPI cards, the zero-minute rule and the
 * one-row-per-fact merge all live in the prisma-free src/lib/maintenanceQueue.ts
 * with tests, because those four numbers are the first thing anyone checks and
 * they must be provable without a database.
 *
 * ON AUDIENCE: the Maintenance Manager, Line Manager and admins — "manager and
 * above, not incharge", on the owner's instruction. The route is gated in
 * src/middleware.ts and again here; canRaiseMaintenance decides the form, and
 * answering is narrower still (canRespondDowntime: Maintenance Manager and
 * admins).
 *
 * No data is hidden that its former audience cannot reach: the same downtime
 * incidents are on /mis, which INCHARGE still opens. What narrowed is the
 * INBOX. A work list is only worth a fitter's walk if the entries are, and
 * everyone who can see a queue treats it as their own. An incharge who finds a
 * fault still has the route that matters — log the stoppage in MIS, and the
 * hour arrives in this queue as an incident.
 */
export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  // Middleware gates the route; this stops a direct render, the way the other
  // restricted screens do. Either alone is one edit away from being the only
  // thing standing there.
  if (!(await canSeeMaintenanceLog())) redirect("/");

  const sp = await searchParams;
  // The window applies to INCIDENTS only. Tickets are a small hand-raised list
  // and are always shown whole — a fault reported three weeks ago and never
  // answered is exactly the thing a window must not hide.
  const def = inboxWindow(Date.now());
  const from = sp.from?.trim() || def.from;
  const to = sp.to?.trim() || def.to;

  const [canRaise, canAnswer, tickets, pmEntries] = await Promise.all([
    canRaiseMaintenance(),
    canRespondDowntime(),
    listTickets(),
    // The register reads over the same window as the queue; a failed read
    // shows an empty register rather than killing the whole page.
    listPmEntries(from, to).catch(() => []),
  ]);

  // The downtime side, assembled exactly the way /mis assembles it — same
  // report, same response/reclass/photo lookups — so the two screens cannot
  // disagree about a row. Reused wholesale rather than reimplemented: a second
  // query shaped slightly differently is how the two pages start showing
  // different figures for the same hour.
  let report: Awaited<ReturnType<typeof getDowntimeReport>> | null = null;
  let reportError: string | null = null;
  try {
    // allIncidents, DELIBERATELY. Without it getDowntimeReport returns only the
    // first 300 rows of a list sorted OLDEST FIRST — so the 90-day preset would
    // have handed this page the oldest 300 hours of the quarter, counted its KPI
    // cards off them, and shown a maintenance queue with nothing from this week
    // in it (measured 2026-08-14: 992 real incidents in 90 days, 235 of them
    // inside that slice, none from today). It costs no extra query — the report
    // walks every row either way; the flag only decides how many it hands back.
    // The rendering cap moves to buildInbox, which applies it AFTER the queue
    // sort and reports what it dropped.
    report = await getDowntimeReport({ from, to, allIncidents: true });
  } catch {
    reportError = "Could not read the MIS downtime log — the incidents below may be incomplete.";
  }
  // Filtered HERE, before the lookups, so the response/photo/reclass queries and
  // the client payload only ever carry rows that are actually work.
  const incidents = (report?.incidents ?? []).filter(isRealIncident);
  const misIds = incidents.map((i) => i.id);

  const [respMap, reclassMap, photoMap] = await Promise.all([
    getDowntimeResponses(misIds),
    getDelayReclassLog(misIds),
    photosForRecords("Mis", misIds),
  ]);
  // null with incidents present = the LOOKUP failed, not "nobody responded". The
  // same contract /mis honours, and for the same two reasons: a fresh save
  // against an unseen earlier response would overwrite it blind, and the KPI
  // cards would report a queue of work that may already be done. buildInbox is
  // told about it rather than being handed a lying empty map.
  const respFailed = incidents.length > 0 && respMap === null;
  const reclassFailed = incidents.length > 0 && reclassMap === null;
  // ONE role check, two independent gates — copied from /mis deliberately: a
  // broken responses read must not silently disable the correction, or vice versa.
  const canRespond = canAnswer && !respFailed;
  const canReclass = canAnswer && !reclassFailed;

  // Map -> plain object: everything below crosses into a client component.
  const responses: Record<string, DowntimeResp> = {};
  if (respMap) for (const [k, v] of respMap) responses[k] = v;
  const reclass: Record<string, ReclassRecord[]> = {};
  if (reclassMap) for (const [k, v] of reclassMap) reclass[k] = v;
  const photos: Record<string, { id: string; filename: string }[]> = {};
  for (const [k, v] of photoMap) photos[k] = v;

  const { items, counts } = buildInbox({
    tickets,
    incidents,
    responses: respMap ? responses : null,
  });

  // Same preset vocabulary as /mis, so a manager moving between the two pages is
  // not learning two date pickers. The default is Last 7 days rather than /mis's
  // Today — see INBOX_DEFAULT_DAYS for why a queue and a report want different
  // horizons.
  const today = istDay(Date.now());
  const back = (n: number) => inboxWindow(Date.now(), n).from;
  const presets = [
    { label: "Today", f: today, t: today },
    { label: `Last ${INBOX_DEFAULT_DAYS} days`, f: back(INBOX_DEFAULT_DAYS), t: today },
    { label: "Last 30 days", f: back(30), t: today },
    { label: "Last 90 days", f: back(90), t: today },
  ];
  const href = (f: string, t: string) => `/maintenance?from=${f}&to=${t}`;

  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">Maintenance log</h1>
      <p className="mb-5 max-w-3xl text-sm text-gray-500">
        Everything maintenance is asked to answer, in one queue: <b>faults raised here</b> by an incharge — which do not
        need to have stopped the line — and <b>downtime incidents</b> from the MIS hourly log. Both are answered from
        this page, and the answer follows: respond here or on the{" "}
        <Link href="/mis" className="font-medium text-brand hover:underline">downtime log</Link> and both screens show it.
      </p>

      {tickets === null && (
        <Card className="mb-6 border-amber-300 bg-amber-50">
          <p className="text-sm text-amber-900">
            <b>Raised faults are not set up on this deployment yet.</b> The <code className="font-mono text-xs">maintenance_ticket</code>{" "}
            table has not been created — run <code className="font-mono text-xs">scripts/0036-maintenance-ticket.sql</code>. The
            downtime incidents below are unaffected; they live in the MIS log and are still answerable.
          </p>
        </Card>
      )}
      {reportError && (
        <Card className="mb-6 border-amber-300 bg-amber-50">
          <p className="text-sm text-amber-900">⚠ {reportError}</p>
        </Card>
      )}

      {/* THE KPI CARDS ARE THE POINT OF THIS CHANGE. They read 0 across the board
          while eight downtime rows sat unanswered, because they counted tickets
          only. They now count the whole queue, and each one says what is in it —
          an unlabelled number that turned out to be measuring half the work is
          how this bug went unnoticed in the first place. */}
      <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="Open"
          value={String(counts.open)}
          sub={`${counts.openTickets} raised fault(s) · ${counts.openIncidents} downtime incident(s)`}
        />
        <Kpi
          label="Line down"
          value={String(counts.lineDown)}
          sub="open raised faults stopping production"
        />
        <Kpi
          label="Awaiting a first reply"
          value={String(counts.awaiting)}
          sub="open, nobody has responded yet"
          className={counts.awaiting > 0 ? "ring-1 ring-amber-300" : ""}
        />
        <Kpi
          label="In this view"
          value={String(counts.total)}
          sub={`all ${counts.totalTickets} fault(s) + ${counts.totalIncidents} incident(s) ${from} → ${to}`}
        />
      </div>
      <p className="mb-4 text-[11px] text-gray-400">
        &ldquo;Line down&rdquo; counts raised faults only: an MIS hour is a stoppage that has already ended, so it never
        claims production is stopped right now. An incident with a fault raised from it is counted <b>once</b>.
        {counts.hidden > 0 && (
          <span className="text-amber-700">
            {" "}⚠ All {counts.total} are counted above, but only the first {counts.shown} are listed — the queue is
            ordered open-then-urgent-then-oldest, so what is cut is the least pressing. Narrow the window to work the rest.
          </span>
        )}
        {counts.unknown > 0 && (
          <span className="text-amber-700">
            {" "}⚠ {counts.unknown} row(s) are counted in &ldquo;In this view&rdquo; but in none of the other three — their
            saved answer could not be read this load, and a lookup that failed must not be reported as work outstanding
            or as work done.
          </span>
        )}
      </p>

      {/* Window control. Tickets ignore it; incidents do not. Said out loud next
          to the chips, because a manager who assumes it filters everything will
          think an old unanswered fault has disappeared. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">Incidents from</span>
        {presets.map((p) => {
          const active = from === p.f && to === p.t;
          return (
            <Link
              key={p.label}
              href={href(p.f, p.t)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${active ? "bg-brand text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}
            >
              {p.label}
            </Link>
          );
        })}
        <form method="GET" className="flex items-end gap-2">
          <input type="date" name="from" defaultValue={from} className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
          <input type="date" name="to" defaultValue={to} className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
          <button className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-dark">Apply</button>
        </form>
        <span className="text-[11px] text-gray-400">raised faults are always shown in full</span>
      </div>

      {!canRaise && !canAnswer && (
        <Card className="mb-6">
          <p className="text-sm text-gray-500">
            You can read the log. Raising a request needs an incharge; answering one — a fault or a downtime incident —
            needs the Maintenance Manager.
          </p>
        </Card>
      )}

      <MaintenanceBoard
        items={items}
        canRaise={canRaise}
        canAnswer={canAnswer}
        canRespond={canRespond}
        canReclass={canReclass}
        respFailed={respFailed}
        reclassFailed={reclassFailed}
        responses={responses}
        photos={photos}
        reclass={reclass}
        priorities={[...PRIORITIES]}
        statuses={[...DOWNTIME_STATUSES]}
        canFillPreventive={canAnswer}
        pmEntries={pmEntries}
        hidden={counts.hidden}
        total={counts.total}
      />

      {/* REWRITTEN, not left. The card that stood here said "A stoppage that was
          logged in MIS is answered on the downtime log … This page is for
          everything else — the faults that never made it into an hourly row."
          Every clause of that is now false, and a stale explanation on a page
          about staleness would be a poor joke. What follows is the split as it
          actually is. */}
      <Card className="mt-6">
        <H2>What is in this queue</H2>
        <ul className="mt-2 space-y-1.5 text-xs text-gray-500">
          <li>
            <b className="text-gray-700">Raised faults</b> — reported here by an incharge. They need not have stopped
            the line: a bearing starting to sing, a guard that will not latch, an office lamp. They carry a priority and
            an <code className="font-mono">MT-</code> reference.
          </li>
          <li>
            <b className="text-gray-700">Downtime incidents</b> — hours the MIS log recorded a stoppage in. They carry
            no priority, because the hour is already over; what they carry is minutes, a delay type and production&apos;s
            reason. Hours logged with no downtime are not incidents and are not listed here — they are on the{" "}
            <Link href="/mis" className="font-medium text-brand hover:underline">downtime log</Link> with everything else.
          </li>
          <li>
            <b className="text-gray-700">Both are answered in either place.</b> <Badge tone="brand">Two-way</Badge>{" "}
            responding here writes the MIS downtime response, responding on /mis writes the ticket, and an incident with
            a fault raised from it appears as <b>one</b> row showing both — never as two things to answer separately.
          </li>
        </ul>
      </Card>
    </Shell>
  );
}
