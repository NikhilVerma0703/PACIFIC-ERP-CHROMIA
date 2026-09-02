import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { SlabNo } from '@/components/chromia/ui/slab-no';
import { DispositionBadge, GradeBadge, StatusBadge } from '@/components/chromia/ui/status';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import {
  buildQuery,
  hasActiveFilters,
  pageCount,
  parseSlabFilters,
  type RawSearchParams,
} from '@/lib/chromia/slab-filters';
import { loadFilterOptions, searchSlabs } from '@/lib/chromia/server/repositories/slab-repository';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';

import { FilterBar } from './filter-bar';
import { RowActions } from './row-actions';

export const metadata: Metadata = { title: 'Slab Records' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric', timeZone: PLANT_TIME_ZONE, });

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit', timeZone: PLANT_TIME_ZONE, });

const { th, td, tdMuted, tdNum } = dataTable;

const pageButton =
  'border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]';

export default async function SlabsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseSlabFilters(await searchParams);
  const filtered = hasActiveFilters(filters);

  /*
   * A filtered search shows every match on one page — see searchSlabs. This is
   * a deliberate, temporary simplification for processing old records: an
   * in-charge working through February wants the whole month in front of them,
   * not twelve pages of it. Unfiltered browsing of the entire register stays
   * paged, because that set is unbounded.
   */
  const [{ rows, total }, [baseMaterials, designs]] = await Promise.all([
    searchSlabs(filters, { unpaged: filtered }),
    loadFilterOptions(),
  ]);

  const pages = filtered ? 1 : pageCount(total, filters.pageSize);
  const from = total === 0 ? 0 : filtered ? 1 : (filters.page - 1) * filters.pageSize + 1;
  const to = filtered ? total : Math.min(filters.page * filters.pageSize, total);

  /*
   * The full page URL to return to after QC — this path AND its current
   * filters — carried on every slab link and every Edit link. QC opens on the
   * operator screen; when it saves, the panel comes back to exactly this view,
   * filters intact, so the in-charge working through a filtered month can grade
   * slab after slab without retyping the filter each time. Unfiltered browsing
   * carries the plain /chromia/slabs path, so it returns to the list all the
   * same. See qc-panel.tsx for the return itself.
   */
  const backTo = `${APP_ROUTES.slabs}${filtered ? `?${buildQuery(filters)}` : ''}`;

  return (
    <>
      <PageHeader title="Slab Records" />

      <FilterBar filters={filters} baseMaterials={baseMaterials} designs={designs} />

      <SectionCard
        title="Results"
        padded={rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            {total === 0 ? (
              'No slabs'
            ) : (
              <>
                <span className="text-foreground font-semibold tabular-nums">
                  {from}–{to}
                </span>{' '}
                of <span className="text-foreground font-semibold tabular-nums">{total}</span>
                {filtered ? ' matching' : ''}
              </>
            )}
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>
            {filtered
              ? 'Nothing found. Try widening the filters.'
              : 'Record the first incoming slab to start tracking the line.'}
          </EmptyState>
        ) : (
          <>
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
                    <th className={th}>Slab Remarks</th>
                    <th className={`${th} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((slab) => (
                    <tr key={slab.id} className={dataTable.row}>
                      <td className={`${td} font-medium whitespace-nowrap`}>
                        {dateFmt.format(slab.receivedDate)}
                      </td>
                      <td className={`${tdMuted} font-mono`}>{slab.batch.batchNo}</td>
                      <td className={td}>
                        <SlabNo id={slab.id} status={slab.status} slabNo={slab.slabNo} back={backTo} />
                      </td>
                      <td className={td}>{slab.baseMaterial.name}</td>
                      <td className={tdMuted}>
                        {slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? '—'}
                      </td>
                      <td className={`${tdNum} text-right`}>
                        {slab.thicknessCm === null ? '—' : slab.thicknessCm}
                      </td>
                      <td className={`${tdMuted} whitespace-nowrap`}>
                        {slab.inTime ? dateTimeFmt.format(slab.inTime) : '—'}
                      </td>
                      <td className={td}>
                        <StatusBadge status={slab.status} disposition={slab.currentDisposition} />
                      </td>
                      <td className={td}>
                        <DispositionBadge disposition={slab.currentDisposition} />
                      </td>
                      <td className={td}>
                        <GradeBadge grade={slab.currentGrade} />
                      </td>
                      <td
                        className={`${tdMuted} max-w-[16rem] truncate`}
                        title={slab.remarks ?? ''}
                      >
                        {slab.remarks ?? '—'}
                      </td>
                      <td className={`${td} text-right`}>
                        <RowActions slabId={slab.id} slabNo={slab.slabNo} back={backTo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pages > 1 ? (
              <nav className="border-line surface-muted flex items-center justify-between border-t px-5 py-3.5 text-sm">
                <span className="text-muted">
                  Page <span className="text-foreground font-medium">{filters.page}</span> of{' '}
                  {pages}
                </span>
                <span className="flex gap-2">
                  {filters.page > 1 ? (
                    <Link
                      href={`${APP_ROUTES.slabs}?${buildQuery(filters, { page: filters.page - 1 })}`}
                      className={pageButton}
                    >
                      Previous
                    </Link>
                  ) : null}
                  {filters.page < pages ? (
                    <Link
                      href={`${APP_ROUTES.slabs}?${buildQuery(filters, { page: filters.page + 1 })}`}
                      className={pageButton}
                    >
                      Next
                    </Link>
                  ) : null}
                </span>
              </nav>
            ) : null}
          </>
        )}
      </SectionCard>
    </>
  );
}
