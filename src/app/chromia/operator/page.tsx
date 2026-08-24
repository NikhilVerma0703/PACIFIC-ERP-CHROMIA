import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { DispositionBadge, StatusBadge } from '@/components/chromia/ui/status';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { toDateInput, toTimeInput } from '@/lib/chromia/operator-register';
import { needsIntakeQc } from '@/lib/chromia/slab-links';
import { link } from '@/lib/chromia/ui';
import { listRecalibrationReasons } from '@/lib/chromia/server/repositories/recalibration-repository';
import { loadSlabRecord } from '@/lib/chromia/server/repositories/slab-record-repository';
import {
  loadBaseMaterialNames,
  loadDesignFileNames,
  loadRecentBatchNos,
  loadRecentRegister,
} from '@/lib/chromia/server/services/operator-service';

import { EntryForm } from './entry-form';
import { QcPanel } from './qc-panel';

export const metadata: Metadata = { title: 'Operator Entry' };
export const dynamic = 'force-dynamic';

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const { th, td } = dataTable;

const pad = (value: number) => `${value}`.padStart(2, '0');

/** `?slab=` — the one this screen is open on, if any. */
function resolveSlabId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim() !== '' ? value.trim() : null;
}

/** `?date=` if it is a real date, otherwise today. Only seeds the blank form. */
function resolveDay(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return toDateInput(new Date());
}

/**
 * Operator entry — the shop-floor register, digitised.
 *
 * The register shows exactly what the operator entered: S.No., Production Date,
 * Batch No., Slab No., Base Material / Slab Name, File Name / Planned Design,
 * Thickness and In-time. The operator does not record individual stages — the
 * slab goes into Base Primer and comes out three to four hours later.
 *
 * ── ONE SCREEN, TWO JOBS ─────────────────────────────────────────────────
 * QC used to be a page of its own: clicking a slab number left this screen for
 * /chromia/slabs/new, which asked for a printed date nobody was there to know
 * and the quality decision. Both halves of a slab's life now happen here.
 * Opening a slab (`?slab=<id>`) fills the entry fields with what was recorded
 * and puts the QC Section underneath them, so the in-charge sees the run and
 * grades it without navigating.
 *
 * Nothing about the operator's own flow changes: saving an entry still leaves
 * the slab In-Processing, and the grade is still a separate, deliberate act
 * with its own button.
 */
export default async function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const slabId = resolveSlabId(params.slab);
  // The filtered Slab Records view this slab was opened from, if any — carried
  // through so saving its QC returns there instead of the bare list. See
  // slabHref and completeSlabAction.
  const backRaw = Array.isArray(params.back) ? params.back[0] : params.back;
  const back = backRaw && backRaw.trim() !== '' ? backRaw : undefined;

  const [rows, baseMaterials, fileNames, batchNos, selected, recalibrationReasons] =
    await Promise.all([
      loadRecentRegister(),
      loadBaseMaterialNames(),
      loadDesignFileNames(),
      loadRecentBatchNos(),
      slabId ? loadSlabRecord(slabId) : Promise.resolve(null),
      slabId ? listRecalibrationReasons() : Promise.resolve([]),
    ]);

  /* A slab that has already been graded, or is away at the recalibration
     facility, has no QC left to do — its entry is still shown so it can be
     corrected, but the QC section is not offered. Same rule as slabHref, so a
     link that exists always leads to something. */
  const qcOpen = selected !== null && needsIntakeQc(selected.status);

  return (
    <>
      <PageHeader
        eyebrow="Shop floor"
        title="Operator entry"
        description={
          selected
            ? `Slab ${selected.slabNo} — correct the entry, or grade it below`
            : 'Book slabs onto the line'
        }
        actions={
          selected ? (
            <Link
              href={APP_ROUTES.operator}
              className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
            >
              New entry
            </Link>
          ) : null
        }
      />

      {/*
       * `key` per slab, and it is load-bearing. The App Router keeps a
       * segment's React state across a search-param change on purpose — its own
       * words: "search params do not cause state to be lost" — so going from
       * ?slab=A to ?slab=B, or from a half-typed new entry to a slab, would
       * re-render the form with the new id and the OLD field values still in
       * state. The next Save would write one slab's numbers onto another.
       * Keying on the slab makes each one a fresh form.
       */}
      <EntryForm
        key={slabId ?? 'new'}
        baseMaterials={baseMaterials}
        entryDate={resolveDay(params.date)}
        nowTime={toTimeInput(new Date())}
        fileNames={fileNames}
        batchNos={batchNos}
        editing={
          selected
            ? {
                id: selected.id,
                slabNo: selected.slabNo,
                batchNo: selected.batchNo,
                baseMaterial: selected.baseMaterial,
                fileName: selected.designFileName,
                thicknessCm: selected.thicknessCm === null ? '' : String(selected.thicknessCm),
                receivedDate: toDateInput(selected.receivedDate),
                inTime: selected.inTime
                  ? `${pad(selected.inTime.getHours())}:${pad(selected.inTime.getMinutes())}`
                  : '',
                remarks: selected.remarks ?? '',
              }
            : undefined
        }
      />

      {selected ? (
        qcOpen ? (
          <QcPanel
            key={selected.id}
            slabId={selected.id}
            slabNo={selected.slabNo}
            recalibrationReasons={recalibrationReasons}
            today={toDateInput(new Date())}
            back={back}
          />
        ) : (
          <SectionCard title="QC Section" accent="grade" padded>
            <EmptyState>
              Slab {selected.slabNo} has already been graded — its outcome is on{' '}
              <Link href={APP_ROUTES.slabs} className={link}>
                Slab Records
              </Link>
              .
            </EmptyState>
          </SectionCard>
        )
      ) : null}

      <SectionCard
        title="Recent slabs"
        accent="brand"
        padded={rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            last <span className="text-foreground font-semibold tabular-nums">{rows.length}</span>{' '}
            entered
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>Nothing entered yet.</EmptyState>
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
                  {/* The order the rows are in, made visible: without it a list
                      that mixes production dates looks arbitrarily sorted. */}
                  <th className={`${th} text-right`}>Entered</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`${dataTable.row} ${row.id === slabId ? 'bg-[var(--surface-muted)]' : ''}`}
                  >
                    <td className={`${td} text-muted tabular-nums`}>{row.serialNo}</td>
                    <td className={`${td} whitespace-nowrap`}>{dateFmt.format(row.receivedDate)}</td>
                    <td className={`${td} font-mono`}>{row.batchNo}</td>
                    <td className={td}>
                      <Link href={`${APP_ROUTES.operator}?slab=${row.id}`} className={`${link} font-mono`}>
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
                    <td className={`${td} text-muted text-right whitespace-nowrap tabular-nums`}>
                      {dateFmt.format(row.enteredAt)} {timeFmt.format(row.enteredAt)}
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
