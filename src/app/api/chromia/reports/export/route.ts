import { type NextRequest } from 'next/server';
import * as XLSX from 'xlsx';

import { chromiaGate } from '@/lib/chromia/access';
import { withErrorHandling } from '@/lib/chromia/api';
import { parseRange } from '@/lib/chromia/reports';
import { loadReports } from '@/lib/chromia/server/repositories/report-repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Excel export of the production reports.
 *
 * One workbook, four sheets — the same figures the /reports screen shows,
 * so a printed report and the screen can never disagree.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  // Middleware already stopped anyone without the CHROMIA role or an admin
  // rank at the path prefix; this is the second layer, because a route handler
  // that trusts middleware alone is one matcher edit away from being public.
  const gate = await chromiaGate();
  if (!gate.ok) return new Response(gate.status === 401 ? 'Unauthorized' : 'Forbidden', { status: gate.status });

  const params = request.nextUrl.searchParams;
  const range = parseRange(params.get('from') ?? '', params.get('to') ?? '');
  const report = await loadReports(range);

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      report.daily.map((row) => ({
        Date: row.day,
        'Slabs received': row.received,
        'Processing completed': row.processingCompleted,
        'Quality checks': row.qualityChecks,
        Dispatched: row.dispatched,
        'Sent for recalibration': row.sentForRecalibration,
      })),
    ),
    'Daily production',
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      report.byMaterial.map((row) => ({
        Material: row.name,
        'Grade A': row.a,
        'Grade B': row.b,
        'Grade C': row.c,
        Total: row.total,
        'Grade A %': row.aPercent,
        'Grade C %': row.cPercent,
      })),
    ),
    'Grade by material',
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      report.byDesign.map((row) => ({
        Design: row.name,
        'Grade A': row.a,
        'Grade B': row.b,
        'Grade C': row.c,
        Total: row.total,
        'Grade A %': row.aPercent,
        'Grade C %': row.cPercent,
      })),
    ),
    'Grade by design',
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      report.byReason.map((row) => ({
        Reason: row.reason,
        Sent: row.sent,
        Returned: row.returned,
        Outstanding: row.outstanding,
        'Average turnaround (days)': row.averageTurnaroundDays ?? '',
      })),
    ),
    'Recalibration by reason',
  );

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const from = range.from.toISOString().slice(0, 10);
  const to = range.to.toISOString().slice(0, 10);
  const fileName = `chromia-report_${from}_to_${to}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
});
