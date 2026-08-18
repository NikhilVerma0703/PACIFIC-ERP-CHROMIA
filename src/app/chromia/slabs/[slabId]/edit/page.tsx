import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { toDateInput } from '@/lib/chromia/operator-register';
import {
  loadBaseMaterialNames,
  loadDesignFileNames,
  loadRecentBatchNos,
} from '@/lib/chromia/server/services/operator-service';
import { loadSlabRecord } from '@/lib/chromia/server/repositories/slab-record-repository';

import { EditForm } from './edit-form';

export const metadata: Metadata = { title: 'Edit Slab Record' };
export const dynamic = 'force-dynamic';

const pad = (value: number) => `${value}`.padStart(2, '0');

/**
 * A `@db.Date` column comes back at UTC midnight; read locally it would show
 * the day before west of Greenwich. Read back the way it was written.
 */
function dateColumnInput(date: Date | null): string {
  if (!date) return '';
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export default async function EditSlabPage({
  params,
}: {
  params: Promise<{ slabId: string }>;
}) {
  const { slabId } = await params;

  const [record, baseMaterials, fileNames, batchNos] = await Promise.all([
    loadSlabRecord(slabId),
    loadBaseMaterialNames(),
    loadDesignFileNames(),
    loadRecentBatchNos(),
  ]);

  if (!record) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Edit slab record" />
        <EmptyState>
          That slab is no longer in{' '}
          <Link href={APP_ROUTES.slabs} className="text-brand-700 font-medium underline">
            Slab Records
          </Link>
          .
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit slab record — ${record.slabNo}`} size="md" />

      <EditForm
        slab={{
          id: record.id,
          slabNo: record.slabNo,
          batchNo: record.batchNo,
          baseMaterial: record.baseMaterial,
          designFileName: record.designFileName,
          thicknessCm: record.thicknessCm === null ? '' : String(record.thicknessCm),
          receivedDate: toDateInput(record.receivedDate),
          inTime: record.inTime
            ? `${pad(record.inTime.getHours())}:${pad(record.inTime.getMinutes())}`
            : '',
          fullyPrintedDate: dateColumnInput(record.fullyPrintedDate),
          remarks: record.remarks ?? '',
        }}
        baseMaterials={baseMaterials}
        fileNames={fileNames}
        batchNos={batchNos}
      />
    </div>
  );
}
