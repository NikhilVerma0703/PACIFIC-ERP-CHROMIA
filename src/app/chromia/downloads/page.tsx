import type { Metadata } from 'next';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { DispositionBadge, StatusBadge } from '@/components/chromia/ui/status';
import {
  baseColumns,
  baseFields,
  buildExportQuery,
  buildRangeQuery,
  EXPORT_KIND_LABELS,
  GROUP_CLASSES,
  parseExportQuery,
  parseRangeQuery,
  recentMonths,
  resolveRange,
  type BaseField,
} from '@/lib/chromia/exports';
import {
  loadExportRows,
  loadProductionRows,
  type ExportRow,
} from '@/lib/chromia/server/repositories/export-repository';

import { DownloadForm } from './download-form';
import { ProductionForm } from './production-form';
import { API_ROUTES } from '@/lib/chromia/constants/app';

export const metadata: Metadata = { title: 'Downloads' };
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

const { td, tdMuted } = dataTable;

/** Millimetres in the database, centimetres on the register and on screen. */
function cmOf(mm: string | null): string {
  if (mm === null) return '—';
  const parsed = Number(mm);
  return Number.isFinite(parsed) ? String(parsed / 10) : '—';
}

/** Header cell carrying its band colour — mirrors the Excel sheet exactly. */
const th = (group: keyof typeof GROUP_CLASSES) =>
  `${GROUP_CLASSES[group]} px-5 py-3 text-[11px] font-semibold tracking-[0.12em] whitespace-nowrap uppercase`;

/**
 * How each base field is drawn in the preview.
 *
 * Keyed by field rather than written out in order, because the order is not the
 * same on every sheet — Dispatch opens with the production date — and it is read
 * from `baseFields`, the same list the workbook uses. Neither can drift.
 */
const PREVIEW_CELL: Record<
  BaseField,
  { className: string; render: (row: ExportRow) => React.ReactNode }
> = {
  date: {
    className: `${td} font-medium whitespace-nowrap`,
    render: (row) => dateFmt.format(row.date),
  },
  batchNo: { className: `${tdMuted} font-mono`, render: (row) => row.batchNo },
  slabNo: { className: td, render: (row) => <span className="font-mono">{row.slabNo}</span> },
  baseMaterial: { className: td, render: (row) => row.baseMaterial },
  design: { className: tdMuted, render: (row) => row.design ?? '—' },
  thicknessCm: {
    className: `${tdMuted} text-right tabular-nums`,
    render: (row) => cmOf(row.thicknessMm),
  },
  receivedDate: {
    className: `${tdMuted} whitespace-nowrap`,
    render: (row) => dateFmt.format(row.receivedDate),
  },
  inTime: {
    className: tdMuted,
    render: (row) => (row.inTime ? dateTimeFmt.format(row.inTime) : '—'),
  },
  outTime: {
    className: tdMuted,
    render: (row) => (row.outTime ? dateTimeFmt.format(row.outTime) : '—'),
  },
  fullyPrintedDate: {
    className: `${tdMuted} whitespace-nowrap`,
    render: (row) => (row.fullyPrintedDate ? dateFmt.format(row.fullyPrintedDate) : '—'),
  },
  status: {
    className: td,
    render: (row) => <StatusBadge status={row.status} disposition={row.disposition} />,
  },
  disposition: { className: td, render: (row) => <DispositionBadge disposition={row.disposition} /> },
};

/**
 * Downloads — export a movement sheet.
 *
 * Pick a sheet and a period; the table below is a live preview of exactly the
 * rows the workbook will contain, so nobody downloads a file to find out it is
 * empty or covers the wrong month.
 */
export default async function DownloadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Two independent pickers on one URL: the complete-production one namespaces
  // its params with `p` so applying either never disturbs the other.
  const query = parseExportQuery(params);
  const range = resolveRange(query);

  const productionQuery = parseRangeQuery(params, 'p');
  const productionRange = resolveRange(productionQuery);

  const [rows, productionRows] = await Promise.all([
    loadExportRows(query.kind, range),
    loadProductionRows(productionRange),
  ]);

  const downloadHref = `${API_ROUTES.exports}?${buildExportQuery(query)}`;
  const productionHref = `${API_ROUTES.exports}/production?${buildRangeQuery(productionQuery)}`;
  const extraColumns = Object.keys(rows[0]?.extra ?? {});
  // Heading, band colour and order all come from the workbook's own column
  // definitions, so the preview cannot describe a file it is not.
  const fields = baseFields(query.kind);
  const columns = baseColumns(query.kind);
  const months = recentMonths();

  return (
    <>
      <PageHeader eyebrow="Records" title="Downloads" />

      <ProductionForm
        query={productionQuery}
        months={months}
        rowCount={productionRows.length}
        downloadHref={productionHref}
      />

      <SectionCard
        title="Production preview"
        accent="active"
        padded={productionRows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            {dateFmt.format(productionRange.from)} – {dateFmt.format(productionRange.to)} ·{' '}
            <span className="text-foreground font-semibold tabular-nums">
              {productionRows.length}
            </span>{' '}
            {productionRows.length === 1 ? 'slab' : 'slabs'}
          </span>
        }
      >
        {productionRows.length === 0 ? (
          <EmptyState>No slabs were received in this period.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead>
                <tr>
                  <th className={th('identity')}>Production Date</th>
                  <th className={th('identity')}>Batch No.</th>
                  <th className={th('identity')}>Slab No.</th>
                  <th className={th('product')}>Base Material / Slab Name</th>
                  <th className={th('product')}>File Name / Planned Design</th>
                  <th className={`${th('product')} text-right`}>Thickness (cm)</th>
                  <th className={th('timing')}>In-time</th>
                  <th className={th('timing')}>Out-time</th>
                  <th className={th('state')}>Status</th>
                  <th className={th('state')}>Outcome</th>
                  <th className={th('outcome')}>Recal.</th>
                </tr>
              </thead>
              <tbody>
                {productionRows.map((row) => (
                  <tr key={row.slabId} className={dataTable.row}>
                    <td className={`${td} font-medium whitespace-nowrap`}>
                      {dateFmt.format(row.receivedDate)}
                    </td>
                    <td className={`${tdMuted} font-mono`}>{row.batchNo}</td>
                    <td className={td}>
                      <span className="font-mono">{row.slabNo}</span>
                    </td>
                    <td className={td}>{row.baseMaterial}</td>
                    <td className={tdMuted}>{row.design ?? '—'}</td>
                    <td className={`${tdMuted} text-right tabular-nums`}>
                      {row.thicknessCm ?? '—'}
                    </td>
                    <td className={tdMuted}>{row.inTime ? dateTimeFmt.format(row.inTime) : '—'}</td>
                    <td className={tdMuted}>
                      {row.outTime ? dateTimeFmt.format(row.outTime) : '—'}
                    </td>
                    <td className={td}>
                      <StatusBadge status={row.status} disposition={row.disposition} />
                    </td>
                    <td className={td}>
                      <DispositionBadge disposition={row.disposition} />
                    </td>
                    <td className={`${tdMuted} text-right tabular-nums`}>
                      {row.recalibrationCount > 0 ? `${row.recalibrationCount}/5` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="border-line my-8 border-t" />

      <DownloadForm
        query={query}
        months={months}
        rowCount={rows.length}
        downloadHref={downloadHref}
      />

      <SectionCard
        step="03"
        title="Outcome preview"
        accent="grade"
        padded={rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            <span className="text-foreground font-semibold tabular-nums">{rows.length}</span>{' '}
            {rows.length === 1 ? 'record' : 'records'}
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>
            No {EXPORT_KIND_LABELS[query.kind].toLowerCase()} records in this period.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.label} className={th(column.group)}>
                      {column.label}
                    </th>
                  ))}
                  {extraColumns.map((column) => (
                    <th key={column} className={th('outcome')}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.slabId}-${index}`} className={dataTable.row}>
                    {fields.map((field) => (
                      <td key={field} className={PREVIEW_CELL[field].className}>
                        {PREVIEW_CELL[field].render(row)}
                      </td>
                    ))}
                    {extraColumns.map((column) => (
                      <td key={column} className={tdMuted}>
                        {row.extra[column] === null || row.extra[column] === undefined
                          ? '—'
                          : String(row.extra[column])}
                      </td>
                    ))}
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
