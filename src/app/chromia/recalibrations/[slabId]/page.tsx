import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { actionFor, attemptsUsed, ordinal, statusLabel } from '@/lib/chromia/recalibration-flow';
import { toTimeInput } from '@/lib/chromia/operator-register';
import { listRecalibrationReasons } from '@/lib/chromia/server/repositories/recalibration-repository';
import { findRecalibrationRecord } from '@/lib/chromia/server/repositories/recalibration-flow-repository';
import {
  loadBaseMaterialNames,
  loadDesignFileNames,
  loadRecentBatchNos,
} from '@/lib/chromia/server/services/operator-service';

import { IntakeForm } from '../../slabs/new/intake-form';
import { RestartForm } from './restart-form';
import { TripForm } from './trip-form';

export const metadata: Metadata = { title: 'Recalibration' };
export const dynamic = 'force-dynamic';

function toDateInput(date: Date | null): string {
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * One slab's next step.
 *
 * The in-charge taps the same slab number every time, and this decides what
 * that means today: record the trip, restart production, or grade the new
 * pass. Making the *route* constant and the *screen* follow the slab's state
 * is the difference between a workflow somebody can follow and three menu
 * items they have to choose between correctly.
 */
export default async function RecalibrationSlabPage({
  params,
}: {
  params: Promise<{ slabId: string }>;
}) {
  const { slabId } = await params;
  const record = await findRecalibrationRecord(slabId);

  if (!record) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Recalibration" />
        <EmptyState>
          That slab is not in the{' '}
          <Link href={APP_ROUTES.recalibrations} className="text-brand-700 font-medium underline">
            Recalibration
          </Link>{' '}
          list.
        </EmptyState>
      </div>
    );
  }

  const state = {
    disposition: record.currentDisposition,
    writtenOff: record.status === 'WASTE',
    trips: record.trips,
  };

  const action = actionFor(state);
  const used = attemptsUsed(record.trips);
  const designFileName = record.plannedDesign?.fileName ?? record.plannedDesign?.name ?? '';

  // ------------------------------------------------------------ the trip ---
  if (action === 'TRIP') {
    const open = record.trips.find((trip) => trip.receivedDate === null);

    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={`Recalibration — ${record.slabNo}`}
          description={`${ordinal(open?.attemptNumber ?? used + 1)} attempt · ${statusLabel(state)}`}
        />
        <TripForm
          slab={{
            id: record.id,
            slabNo: record.slabNo,
            batchNo: record.batch.batchNo,
            baseMaterial: record.baseMaterial.name,
            designFileName,
            remarks: record.remarks ?? '',
            sentDate: toDateInput(record.sentDate),
            receivedDate: toDateInput(record.returnedDate),
          }}
        />
      </div>
    );
  }

  // ------------------------------------------------- restart production ---
  if (action === 'RESTART') {
    const [baseMaterials, fileNames, batchNos] = await Promise.all([
      loadBaseMaterialNames(),
      loadDesignFileNames(),
      loadRecentBatchNos(),
    ]);
    const now = new Date();

    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title={`AFTER RECALIBRATION ATTEMPT "${used}"`}
          description={`Slab ${record.slabNo} · back on the line for a full production cycle`}
        />
        <RestartForm
          slab={{
            id: record.id,
            slabNo: record.slabNo,
            batchNo: record.batch.batchNo,
            baseMaterial: record.baseMaterial.name,
            designFileName,
            thicknessCm: record.thicknessCm === null ? '' : String(record.thicknessCm),
            receivedDate: toDateInput(record.receivedDate),
          }}
          attempt={used}
          baseMaterials={baseMaterials}
          fileNames={fileNames}
          batchNos={batchNos}
          today={toDateInput(now)}
          nowTime={toTimeInput(now)}
        />
      </div>
    );
  }

  // ------------------------------------------------------------- QC again ---
  if (action === 'QC') {
    const recalibrationReasons = await listRecalibrationReasons();

    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={`Slab intake — ${record.slabNo}`}
          description={`After recalibration attempt ${used}`}
        />
        <IntakeForm
          recalibrationReasons={recalibrationReasons}
          today={toDateInput(new Date())}
          existing={{
            id: record.id,
            slabNo: record.slabNo,
            batchNo: record.batch.batchNo,
            baseMaterial: record.baseMaterial.name,
            designFileName,
            thicknessCm: record.thicknessCm === null ? '' : String(record.thicknessCm),
            receivedDate: toDateInput(record.receivedDate),
            fullyPrintedDate: toDateInput(record.fullyPrintedDate),
          }}
        />
      </div>
    );
  }

  // ------------------------------------------------------- nothing to do ---
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Recalibration — ${record.slabNo}`} description={statusLabel(state, record.currentGrade)} />
      <EmptyState>
        This slab needs nothing from the recalibration desk.{' '}
        <Link href={APP_ROUTES.recalibrations} className="text-brand-700 font-medium underline">
          Back to Recalibration
        </Link>
      </EmptyState>
    </div>
  );
}
