import { type NextRequest } from 'next/server';

import { DISPOSITION_LABELS } from '@/lib/chromia/constants/process-stages';
import { slabStatusView } from '@/lib/chromia/slab-status-label';
import { chromiaGate } from '@/lib/chromia/access';
import { withErrorHandling } from '@/lib/chromia/api';
import {
  parseRangeQuery,
  productionColumns,
  productionFileName,
  resolveRange,
} from '@/lib/chromia/exports';
import { loadProductionRows, type ProductionRow } from '@/lib/chromia/server/repositories/export-repository';
import { dateTime, localDay, writeStyledWorkbook } from '@/lib/chromia/server/exports/sheet';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Complete production for a period — every slab received, whatever happened.
 *
 * The outcome sheets answer "what did we dispatch". This one answers "what did
 * we make", which is a different question and needs no outcome filter at all.
 */
function toValues(row: ProductionRow): (string | number)[] {
  return [
    localDay(row.receivedDate),
    row.batchNo,
    row.slabNo,
    row.baseMaterial,
    row.design ?? '',
    row.thicknessCm ?? '',
    dateTime(row.inTime),
    dateTime(row.outTime),
    slabStatusView(row.status, row.disposition).label,
    row.disposition ? DISPOSITION_LABELS[row.disposition] : '',
    row.recalibrationCount,
    localDay(row.dispatchDate),
    localDay(row.stockDate),
    localDay(row.cutDate),
  ];
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Middleware already stopped anyone without the CHROMIA role or an admin
  // rank at the path prefix; this is the second layer, because a route handler
  // that trusts middleware alone is one matcher edit away from being public.
  const gate = await chromiaGate();
  if (!gate.ok) return new Response(gate.status === 401 ? 'Unauthorized' : 'Forbidden', { status: gate.status });

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const range = resolveRange(parseRangeQuery(params));
  const rows = await loadProductionRows(range);

  const buffer = writeStyledWorkbook({
    sheetName: 'Production',
    columns: productionColumns(),
    rows: rows.map(toValues),
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${productionFileName(range)}"`,
      'Cache-Control': 'no-store',
    },
  });
});
