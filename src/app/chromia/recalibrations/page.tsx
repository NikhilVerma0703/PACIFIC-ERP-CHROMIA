import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { SimpleFilterBar } from '@/components/chromia/filter-bar-simple';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { DispositionBadge, GradeBadge, StatusBadge } from '@/components/chromia/ui/status';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import {
  actionFor,
  attemptsUsed,
  daysOut,
  formatDaysOut,
  stageOf,
  statusLabel,
} from '@/lib/chromia/recalibration-flow';
import {
  hasSimpleFilters,
  parseSimpleFilters,
  productionDateRange,
  type RawSearchParams,
} from '@/lib/chromia/simple-filters';
import { link } from '@/lib/chromia/ui';
import { searchRecalibrationRecords } from '@/lib/chromia/server/repositories/recalibration-flow-repository';

export const metadata: Metadata = { title: 'Recalibration' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const { th, td, tdMuted, tdNum } = dataTable;

/** The Status column carries the whole story, so it is coloured by stage. */
const STAGE_CLASS: Record<string, string> = {
  AWAITING_SEND: 'text-status-recalibration font-semibold',
  OUT: 'text-status-hold font-semibold',
  RETURNED: 'text-status-active font-semibold',
  IN_PRODUCTION: 'text-status-active font-medium',
  CLEARED: 'text-status-done font-medium',
  WRITTEN_OFF: 'text-status-waste font-semibold',
};

/**
 * Recalibration.
 *
 * Every slab QC has condemned, and every slab that has ever been away. The
 * first eleven columns are the Slabs history, unchanged, so the in-charge is
 * reading the same row they already know; the last five are the recalibration
 * story the history cannot tell — how many trips this slab has actually made,
 * when it went, when it came back, what it is waiting for, and how long it has
 * been waiting.
 *
 * Attempt is the number of times the slab has physically left the plant. It
 * does not move when QC condemns a slab, because at that moment nothing has
 * happened to it yet: it is put down inside the plant and may sit there for a
 * month. The Status column is what changes then — "Need 2nd Time
 * Recalibration" against an Attempt of 1 is a slab that has been out once,
 * failed again, and is waiting for the next load to go out.
 *
 * Tapping the slab number opens whatever that slab needs next.
 */
export default async function RecalibrationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseSimpleFilters(await searchParams);
  const filtered = hasSimpleFilters(filters);

  // The same three filters Stockyard takes, mapped onto the existing
  // recalibration search: the single production date becomes that whole day's
  // range, which is the shape searchRecalibrationRecords already speaks. With
  // nothing set it returns every record, exactly as the unfiltered list did.
  const { from, to } = productionDateRange(filters);
  const records = await searchRecalibrationRecords({
    batchNo: filters.batchNo,
    slabNo: filters.slabNo,
    baseMaterialId: null,
    designId: null,
    receivedFrom: from,
    receivedTo: to,
  });
  const now = new Date();

  const waiting = records.filter((record) => stageOf(state(record)) === 'AWAITING_SEND').length;
  const away = records.filter((record) => stageOf(state(record)) === 'OUT').length;

  return (
    <>
      <PageHeader
        title="Recalibration"
        description={
          records.length === 0
            ? filtered
              ? 'No recalibration record matches these filters.'
              : 'No slab has been sent for recalibration.'
            : `${waiting} waiting in the plant · ${away} out${filtered ? ' · filtered' : ''}`
        }
      />

      <SimpleFilterBar filters={filters} action={APP_ROUTES.recalibrations} />

      <SectionCard
        title="Recalibration records"
        accent="grade"
        padded={records.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            <span className="text-foreground font-semibold tabular-nums">{records.length}</span>{' '}
            {records.length === 1 ? 'slab' : 'slabs'}
          </span>
        }
      >
        {records.length === 0 ? (
          <EmptyState>
            {filtered
              ? 'No recalibration record matches these filters.'
              : 'Slabs graded C and marked for recalibration at QC appear here automatically.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead className={dataTable.head}>
                <tr>
                  <th className={th}>Production Date</th>
                  <th className={th}>Batch No.</th>
                  <th className={th}>Slab No.</th>
                  <th className={th}>Base Material / Slab Name</th>
                  <th className={th}>File Name / Planned Design</th>
                  <th className={`${th} text-right`}>Thickness (cm)</th>
                  <th className={th}>In-time</th>
                  <th className={th}>Status</th>
                  <th className={th}>Outcome</th>
                  <th className={th}>Grade</th>
                  <th className={th}>Reason</th>
                  <th className={th}>Slab Remarks</th>
                  <th className={`${th} text-right`}>Attempt</th>
                  <th className={th}>Sent Date</th>
                  <th className={th}>Received Date</th>
                  <th className={th}>Status</th>
                  <th className={th}>Days out</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const current = state(record);
                  const stage = stageOf(current);
                  const action = actionFor(current);
                  const ageing = daysOut(current, record.condemnedAt, now);

                  return (
                    <tr key={record.id} className={dataTable.row}>
                      <td className={`${td} font-medium whitespace-nowrap`}>
                        {dateFmt.format(record.receivedDate)}
                      </td>
                      <td className={`${tdMuted} font-mono`}>{record.batch.batchNo}</td>
                      <td className={td}>
                        {action === 'NONE' ? (
                          <span className="font-mono">{record.slabNo}</span>
                        ) : (
                          <Link
                            href={`${APP_ROUTES.recalibrations}/${record.id}`}
                            className={`${link} font-mono`}
                          >
                            {record.slabNo}
                          </Link>
                        )}
                      </td>
                      <td className={td}>{record.baseMaterial.name}</td>
                      <td className={tdMuted}>
                        {record.plannedDesign?.fileName ?? record.plannedDesign?.name ?? '—'}
                      </td>
                      <td className={`${tdNum} text-right`}>
                        {record.thicknessCm === null ? '—' : record.thicknessCm}
                      </td>
                      <td className={`${tdMuted} whitespace-nowrap`}>
                        {record.inTime ? dateTimeFmt.format(record.inTime) : '—'}
                      </td>
                      <td className={td}>
                        <StatusBadge status={record.status} disposition={record.currentDisposition} />
                      </td>
                      <td className={td}>
                        <DispositionBadge disposition={record.currentDisposition} />
                      </td>
                      <td className={td}>
                        <GradeBadge grade={record.currentGrade} />
                      </td>
                      <td className={td}>{record.reason ?? '—'}</td>
                      <td className={`${tdMuted} max-w-[16rem] truncate`} title={record.remarks ?? ''}>
                        {record.remarks ?? '—'}
                      </td>
                      <td className={`${tdNum} text-right font-semibold`}>
                        {attemptsUsed(record.trips)}
                      </td>
                      <td className={`${tdMuted} whitespace-nowrap`}>
                        {record.sentDate ? dateFmt.format(record.sentDate) : '—'}
                      </td>
                      <td className={`${tdMuted} whitespace-nowrap`}>
                        {record.returnedDate ? dateFmt.format(record.returnedDate) : '—'}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <span className={STAGE_CLASS[stage] ?? ''}>
                          {statusLabel(current, record.currentGrade)}
                        </span>
                      </td>
                      <td
                        className={`${tdNum} whitespace-nowrap ${
                          ageing.overdue ? 'text-status-waste font-medium' : 'text-muted'
                        }`}
                      >
                        {formatDaysOut(ageing)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}

/** The shape the rules work on, built from one row. */
function state(record: {
  currentDisposition: string | null;
  status: string;
  trips: { attemptNumber: number; sentDate: Date | null; receivedDate: Date | null; restartedAt: Date | null }[];
}) {
  return {
    disposition: record.currentDisposition,
    writtenOff: record.status === 'WASTE',
    trips: record.trips,
  };
}
