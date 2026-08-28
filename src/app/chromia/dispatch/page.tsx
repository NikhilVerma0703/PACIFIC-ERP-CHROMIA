import type { Metadata } from 'next';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { SimpleFilterBar } from '@/components/chromia/filter-bar-simple';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { GradeBadge } from '@/components/chromia/ui/status';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import {
  hasSimpleFilters,
  parseSimpleFilters,
  type RawSearchParams,
} from '@/lib/chromia/simple-filters';
import {
  listAwaitingDispatch,
  listDirectDispatches,
} from '@/lib/chromia/server/repositories/dispatch-repository';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';

import { SendForDispatchForm } from './send-form';

export const metadata: Metadata = { title: 'Dispatch' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: PLANT_TIME_ZONE,
});

const { th, td, tdMuted, tdNum } = dataTable;

/**
 * Dispatch.
 *
 * QC decides a Grade A slab will be dispatched, but the slab is usually sent
 * out weeks or months later — sometimes the same day, but rarely at the QC
 * bench. This page holds that gap: the queue on top is every slab QC marked for
 * dispatch that has not actually gone yet, with no dispatch date until it does;
 * the log underneath is what has really been sent. Recording the send here runs
 * the same dispatch logic as everywhere else, so nothing about traceability
 * changes — only *when* the date is captured.
 */
export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseSimpleFilters(await searchParams);
  const filtered = hasSimpleFilters(filters);

  // Filters narrow the queue; the sent log below is history and stays whole,
  // the same way the Stockyard filters its racks and not its release log.
  const [awaiting, dispatched] = await Promise.all([
    listAwaitingDispatch(filtered ? filters : undefined),
    listDirectDispatches(),
  ]);

  return (
    <>
      <PageHeader
        title="Dispatch"
        description={
          awaiting.length === 0
            ? filtered
              ? 'No slabs awaiting dispatch match these filters.'
              : 'No slabs are waiting to be dispatched.'
            : `${awaiting.length} slab${awaiting.length === 1 ? '' : 's'} awaiting dispatch${
                filtered ? ' matching' : ''
              }`
        }
      />

      <SimpleFilterBar filters={filters} action={APP_ROUTES.dispatch} />

      {/* --------------------------------------------------- awaiting queue --- */}
      <div className="mb-6">
        <SectionCard
          title="Awaiting dispatch"
          accent="active"
          padded={awaiting.length === 0}
          actions={
            <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
              <span className="text-foreground font-semibold tabular-nums">{awaiting.length}</span>{' '}
              {awaiting.length === 1 ? 'slab' : 'slabs'}
            </span>
          }
        >
          {awaiting.length === 0 ? (
            <EmptyState>
              {filtered
                ? 'No slab awaiting dispatch matches these filters.'
                : 'Nothing is waiting to be dispatched. Grade a slab A → Dispatch and it appears here.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className={dataTable.root}>
                <thead className={dataTable.head}>
                  <tr>
                    <th className={th}>Dispatch Date</th>
                    <th className={th}>Production Date</th>
                    <th className={th}>Batch No.</th>
                    <th className={th}>Slab No.</th>
                    <th className={th}>Base Material / Slab Name</th>
                    <th className={th}>File Name / Planned Design</th>
                    <th className={`${th} text-right`}>Thickness (cm)</th>
                    <th className={th}>Grade</th>
                    <th className={`${th} text-right`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {awaiting.map((slab) => (
                    <tr key={slab.id} className={dataTable.row}>
                      {/* Empty until it is actually sent — that is the point. */}
                      <td className={tdMuted}>—</td>
                      <td className={`${td} font-medium whitespace-nowrap`}>
                        {dateFmt.format(slab.receivedDate)}
                      </td>
                      <td className={`${tdMuted} font-mono`}>{slab.batch.batchNo}</td>
                      <td className={`${td} font-mono`}>{slab.slabNo}</td>
                      <td className={td}>{slab.baseMaterial.name}</td>
                      <td className={tdMuted}>
                        {slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? '—'}
                      </td>
                      <td className={`${tdNum} text-right`}>
                        {slab.thicknessCm === null ? '—' : slab.thicknessCm}
                      </td>
                      <td className={td}>
                        <GradeBadge grade={slab.currentGrade} />
                      </td>
                      <td className={`${td} text-right`}>
                        <SendForDispatchForm slabId={slab.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ----------------------------------------------------- sent log --- */}
      <SectionCard
        title="Dispatched"
        accent="brand"
        padded={dispatched.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            <span className="text-foreground font-semibold tabular-nums">{dispatched.length}</span>{' '}
            {dispatched.length === 1 ? 'record' : 'records'}
          </span>
        }
      >
        {dispatched.length === 0 ? (
          <EmptyState>No slab has been dispatched from here yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead className={dataTable.head}>
                <tr>
                  <th className={th}>Dispatch Date</th>
                  <th className={th}>Production Date</th>
                  <th className={th}>Batch No.</th>
                  <th className={th}>Slab No.</th>
                  <th className={th}>Base Material / Slab Name</th>
                  <th className={th}>File Name / Planned Design</th>
                  <th className={`${th} text-right`}>Thickness (cm)</th>
                  <th className={th}>Grade</th>
                </tr>
              </thead>
              <tbody>
                {dispatched.map((row) => (
                  <tr key={row.id} className={dataTable.row}>
                    <td className={`${td} font-medium whitespace-nowrap`}>
                      {dateFmt.format(row.dispatchDate)}
                    </td>
                    <td className={`${tdMuted} whitespace-nowrap`}>
                      {dateFmt.format(row.receivedDate)}
                    </td>
                    <td className={`${tdMuted} font-mono`}>{row.batchNo}</td>
                    <td className={`${td} font-mono`}>{row.slabNo}</td>
                    <td className={td}>{row.baseMaterial}</td>
                    <td className={tdMuted}>{row.designFileName ?? '—'}</td>
                    <td className={`${tdNum} text-right`}>
                      {row.thicknessCm === null ? '—' : row.thicknessCm}
                    </td>
                    <td className={td}>
                      <GradeBadge grade={row.grade} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
