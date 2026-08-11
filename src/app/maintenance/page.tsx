import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Empty, Badge } from "@/components/ui";
import { canRectify, canRespondDowntime } from "@/lib/rbac";
import { listTickets, isClosed, PRIORITIES, DOWNTIME_STATUSES } from "@/lib/maintenanceLog";
import { MaintenanceBoard } from "./MaintenanceBoard";

export const dynamic = "force-dynamic";

/**
 * The maintenance log.
 *
 * Anything from incharge up raises a fault here; maintenance answers it. The
 * point of the page is the faults that never became a downtime incident — a
 * bearing starting to sing, a guard that will not latch — which previously had
 * nowhere to be written down, because the only route to maintenance was the
 * response attached to an MIS hourly row.
 *
 * A ticket raised FROM an incident stays tied to it in both directions; see
 * src/lib/maintenanceLog.ts. The link is shown on the ticket so a reader can
 * get back to the stoppage it came from.
 */
export default async function MaintenancePage() {
  const [canRaise, canAnswer, tickets] = await Promise.all([
    canRectify(),
    canRespondDowntime(),
    listTickets(),
  ]);

  const open = (tickets ?? []).filter((t) => !isClosed(t.status));
  const lineDown = open.filter((t) => t.priority === "Line down").length;
  const unanswered = open.filter((t) => t.status === "Pending").length;

  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">Maintenance log</h1>
      <p className="mb-5 max-w-3xl text-sm text-gray-500">
        Anything wrong with a machine, a service or the building — raised here by an incharge and answered by
        maintenance. <b>It does not need to have stopped the line.</b> A fault reported while it is still a noise is
        cheaper than the breakdown it turns into. Requests raised from a downtime incident stay linked to it: answering
        in either place updates both.
      </p>

      {tickets === null && (
        <Card className="mb-6 border-amber-300 bg-amber-50">
          <p className="text-sm text-amber-900">
            <b>The maintenance log is not set up on this deployment yet.</b> The table it needs has not been created —
            run <code className="font-mono text-xs">scripts/0036-maintenance-ticket.sql</code>. Nothing below is a
            reading of an empty log.
          </p>
        </Card>
      )}

      {tickets !== null && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Open" value={String(open.length)} sub="not yet resolved" />
            <Kpi label="Line down" value={String(lineDown)} sub="open, stopping production" />
            <Kpi label="Awaiting a first reply" value={String(unanswered)} sub="nobody has responded yet" />
            <Kpi label="Logged in total" value={String(tickets.length)} sub="open and closed" />
          </div>

          {!canRaise && !canAnswer && (
            <Card className="mb-6">
              <p className="text-sm text-gray-500">
                You can read the log. Raising a request needs an incharge; answering one needs the Maintenance Manager.
              </p>
            </Card>
          )}

          <MaintenanceBoard
            tickets={tickets}
            canRaise={canRaise}
            canAnswer={canAnswer}
            priorities={[...PRIORITIES]}
            statuses={[...DOWNTIME_STATUSES]}
          />

          {tickets.length === 0 && (
            <Card className="mt-6">
              <Empty>Nothing logged yet.</Empty>
            </Card>
          )}
        </>
      )}

      <Card className="mt-6">
        <H2>Where downtime responses live</H2>
        <p className="mt-1 text-xs text-gray-500">
          A stoppage that was logged in MIS is answered on the{" "}
          <Link href="/mis" className="font-medium text-brand hover:underline">downtime log</Link>, and that response
          appears here when a request was raised from it. This page is for everything else — the faults that never made
          it into an hourly row. <Badge tone="brand">Two-way</Badge> answering in either place writes the other.
        </p>
      </Card>
    </Shell>
  );
}
