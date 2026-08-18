import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { listRecalibrationReasons } from '@/lib/chromia/server/repositories/recalibration-repository';
import { loadSlabForIntake } from '@/lib/chromia/server/repositories/slab-repository';

import { IntakeForm } from './intake-form';

export const metadata: Metadata = { title: 'Slab Intake' };
export const dynamic = 'force-dynamic';

function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Slab intake.
 *
 * Always opened on a slab the operator already started — `?slab=<id>` from the
 * slab number in any table. The register half of the record is already written
 * by then, so this page asks only for the printed date and the QC decision.
 * Without an id, or on a slab that has already been graded, there is nothing
 * to finish, so it points back at the slab list.
 */
export default async function SlabIntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.slab;
  const slabId = Array.isArray(raw) ? raw[0] : raw;

  const [recalibrationReasons, existingSlab] = await Promise.all([
    listRecalibrationReasons(),
    slabId ? loadSlabForIntake(slabId) : Promise.resolve(null),
  ]);

  if (!existingSlab) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Slab intake" />
        <EmptyState>
          Open a slab from the{' '}
          <Link href={APP_ROUTES.slabs} className="text-brand-700 font-medium underline">
            Slabs
          </Link>{' '}
          list to record its QC.
        </EmptyState>
      </div>
    );
  }

  const existing = {
    id: existingSlab.id,
    slabNo: existingSlab.slabNo,
    batchNo: existingSlab.batchNo,
    baseMaterial: existingSlab.baseMaterial,
    designFileName: existingSlab.designFileName,
    thicknessCm: existingSlab.thicknessCm === null ? '' : String(existingSlab.thicknessCm),
    receivedDate: toDateInput(existingSlab.receivedDate),
    fullyPrintedDate: existingSlab.fullyPrintedDate
      ? toDateInput(existingSlab.fullyPrintedDate)
      : '',
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Slab intake — ${existing.slabNo}`} />

      <IntakeForm
        recalibrationReasons={recalibrationReasons}
        today={toDateInput(new Date())}
        existing={existing}
      />
    </div>
  );
}
