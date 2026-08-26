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
import { daysBetween } from '@/lib/chromia/utils/dates';
import { listStockedSlabs, listStockReleases } from '@/lib/chromia/server/repositories/stockyard-repository';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';

import { RecalibrateButton } from './recalibrate-button';
import { ReleaseForm } from './release-form';

export const metadata: Metadata = { title: 'Stockyard' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric', timeZone: PLANT_TIME_ZONE, });

const { th, td, tdMuted, tdNum } = dataTable;

function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Stockyard.
 *
 * A slab graded A or B can be stocked instead of dispatched, and a good number
 * of those leave the plant days or weeks later. Until now the module had no
 * place to record that second departure, so a stocked slab stayed "In Stock"
 * for ever and the dispatch it eventually went out on was never counted.
 *
 * This page is that one step, kept deliberately apart from QC and Slab Intake:
 * the racks on top, the release log underneath.
 */
export default async function StockyardPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseSimpleFilters(await searchParams);
  const filtered = hasSimpleFilters(filters);

  // Filters narrow the rack list; the release log below is history and stays
  // whole, the same way Slab Records filters the records and not the summary.
  const [stocked, releases] = await Promise.all([
    listStockedSlabs(filtered ? filters : undefined),
    listStockReleases(),
  ]);

  const now = new Date();
  const today = toDateInput(now);

  return (
    <>
      <PageHeader
        title="Stockyard"
        description={
          stocked.length === 0
            ? filtered
              ? 'No slabs in stock match these filters.'
              : 'No slabs are in stock.'
            : `${stocked.length} slab${stocked.length === 1 ? '' : 's'} in stock${
                filtered ? ' matching' : ''
              }`
        }
      />

      <SimpleFilterBar filters={filters} action={APP_ROUTES.stockyard} />

      {/* ------------------------------------------------------ on the rack --- */}
      <div className="mb-6">
        <SectionCard
          title="In stock"
          accent="active"
          padded={stocked.length === 0}
          actions={
            <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
              <span className="text-foreground font-semibold tabular-nums">{stocked.length}</span>{' '}
              {stocked.length === 1 ? 'slab' : 'slabs'}
            </span>
          }
        >
          {stocked.length === 0 ? (
            <EmptyState>
              {filtered
                ? 'No stocked slab matches these filters.'
                : 'Nothing is on the racks right now.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className={dataTable.root}>
                <thead className={dataTable.head}>
                  <tr>
                    {/* Production Date, not a separate Stock Date: a slab marked
                        Stock at QC is stocked on its production date, so the two
                        are the same day and the register's date is the one shown. */}
                    <th className={th}>Production Date</th>
                    <th className={th}>Batch No.</th>
                    <th className={th}>Slab No.</th>
                    <th className={th}>Base Material / Slab Name</th>
                    <th className={th}>File Name / Planned Design</th>
                    <th className={`${th} text-right`}>Thickness (cm)</th>
                    <th className={th}>Grade</th>
                    <th className={`${th} text-right`}>Days in Stock</th>
                    <th className={`${th} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stocked.map((slab) => (
                    <tr key={slab.id} className={dataTable.row}>
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
                      <td className={`${tdNum} text-right`}>
                        {slab.stockDate === null ? '—' : daysBetween(slab.stockDate, now)}
                      </td>
                      <td className={`${td} text-right`}>
                        {/* Two exits from the rack, side by side: dispatch it,
                            or send it for recalibration. */}
                        <div className="flex items-center justify-end gap-2">
                          <ReleaseForm slabId={slab.id} today={today} />
                          <RecalibrateButton slabId={slab.id} slabNo={slab.slabNo} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* -------------------------------------------------- release log --- */}
      <SectionCard
        title="Dispatched from stock"
        accent="brand"
        padded={releases.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            <span className="text-foreground font-semibold tabular-nums">{releases.length}</span>{' '}
            {releases.length === 1 ? 'record' : 'records'}
          </span>
        }
      >
        {releases.length === 0 ? (
          <EmptyState>No stocked slab has been dispatched yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead className={dataTable.head}>
                <tr>
                  <th className={th}>Dispatch Date</th>
                  <th className={th}>Batch No.</th>
                  <th className={th}>Slab No.</th>
                  <th className={th}>Base Material / Slab Name</th>
                  <th className={th}>File Name / Planned Design</th>
                  <th className={`${th} text-right`}>Thickness (cm)</th>
                  <th className={th}>Grade</th>
                  <th className={th}>Stock Date</th>
                  <th className={`${th} text-right`}>Days in Stock</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((release) => (
                  <tr key={release.id} className={dataTable.row}>
                    <td className={`${td} font-medium whitespace-nowrap`}>
                      {dateFmt.format(release.dispatchDate)}
                    </td>
                    <td className={`${tdMuted} font-mono`}>{release.batchNo}</td>
                    <td className={`${td} font-mono`}>{release.slabNo}</td>
                    <td className={td}>{release.baseMaterial}</td>
                    <td className={tdMuted}>{release.designFileName ?? '—'}</td>
                    <td className={`${tdNum} text-right`}>
                      {release.thicknessCm === null ? '—' : release.thicknessCm}
                    </td>
                    <td className={td}>
                      <GradeBadge grade={release.grade} />
                    </td>
                    <td className={`${tdMuted} whitespace-nowrap`}>
                      {release.stockDate ? dateFmt.format(release.stockDate) : '—'}
                    </td>
                    <td className={`${tdNum} text-right`}>
                      {release.stockDate === null
                        ? '—'
                        : daysBetween(release.stockDate, release.dispatchDate)}
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
