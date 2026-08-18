import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { DispositionBadge, StatusBadge } from '@/components/chromia/ui/status';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { toDateInput, toTimeInput } from '@/lib/chromia/operator-register';
import { link } from '@/lib/chromia/ui';
import {
  loadBaseMaterialNames,
  loadDesignFileNames,
  loadRecentBatchNos,
  loadRegisterForDate,
} from '@/lib/chromia/server/services/operator-service';

import { EntryForm } from './entry-form';

export const metadata: Metadata = { title: 'Operator Entry' };
export const dynamic = 'force-dynamic';

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dayFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const navButton =
  'border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]';

const { th, td } = dataTable;

/** `?date=` if it is a real date, otherwise today. */
function resolveDay(raw: string | string[] | undefined): Date {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function shiftDay(day: Date, days: number): string {
  const copy = new Date(day);
  copy.setDate(copy.getDate() + days);
  return toDateInput(copy);
}

/**
 * Operator entry — the shop-floor register, digitised.
 *
 * The register shows exactly what the operator entered: S.No., Production Date,
 * Batch No., Slab No., Base Material / Slab Name, File Name / Planned Design,
 * Thickness and In-time. The operator does not record individual stages — the slab goes
 * into Base Primer and comes out three to four hours later, and is next looked
 * at during QC, which is the in-charge's screen.
 */
export default async function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const day = resolveDay(params.date);
  const dayValue = toDateInput(day);
  const isToday = dayValue === toDateInput(new Date());

  const [rows, baseMaterials, fileNames, batchNos] = await Promise.all([
    loadRegisterForDate(day),
    loadBaseMaterialNames(),
    loadDesignFileNames(),
    loadRecentBatchNos(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Shop floor"
        title="Operator entry"
        description={dayFmt.format(day)}
        actions={
          <>
            <Link href={`${APP_ROUTES.operator}?date=${shiftDay(day, -1)}`} className={navButton}>
              Previous day
            </Link>
            {isToday ? null : (
              <Link href={APP_ROUTES.operator} className={navButton}>
                Today
              </Link>
            )}
          </>
        }
      />

      <EntryForm
        baseMaterials={baseMaterials}
        entryDate={dayValue}
        nowTime={toTimeInput(new Date())}
        nextSerialNo={rows.length + 1}
        fileNames={fileNames}
        batchNos={batchNos}
      />

      <SectionCard
        title="Today's register"
        accent="brand"
        padded={rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            <span className="text-foreground font-semibold tabular-nums">{rows.length}</span>{' '}
            {rows.length === 1 ? 'entry' : 'entries'}
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>Nothing entered for this day yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead className={dataTable.head}>
                <tr>
                  <th className={`${th} w-20`}>S. No.</th>
                  <th className={th}>Production Date</th>
                  <th className={th}>Batch No.</th>
                  <th className={th}>Slab No.</th>
                  <th className={th}>Base Material / Slab Name</th>
                  <th className={th}>File Name / Planned Design</th>
                  <th className={`${th} text-right`}>Thickness (cm)</th>
                  <th className={`${th} text-right`}>In-time</th>
                  <th className={th}>Status</th>
                  <th className={th}>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={dataTable.row}>
                    <td className={`${td} text-muted tabular-nums`}>{row.serialNo}</td>
                    <td className={`${td} whitespace-nowrap`}>{dateFmt.format(row.receivedDate)}</td>
                    <td className={`${td} font-mono`}>{row.batchNo}</td>
                    <td className={td}>
                      <Link href={`${APP_ROUTES.slabIntake}?slab=${row.id}`} className={`${link} font-mono`}>
                        {row.slabNo}
                      </Link>
                    </td>
                    <td className={td}>{row.baseMaterial}</td>
                    <td className={td}>{row.fileName ?? '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {row.thicknessCm === null ? '—' : row.thicknessCm}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {row.inTime ? timeFmt.format(row.inTime) : '—'}
                    </td>
                    <td className={td}>
                      <StatusBadge status={row.status} disposition={row.currentDisposition} />
                    </td>
                    <td className={td}>
                      <DispositionBadge disposition={row.currentDisposition} />
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
