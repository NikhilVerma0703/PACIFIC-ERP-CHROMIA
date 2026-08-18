import { type NextRequest } from 'next/server';

import { DISPOSITION_LABELS } from '@/lib/chromia/constants/process-stages';
import { slabStatusView } from '@/lib/chromia/slab-status-label';
import { chromiaGate } from '@/lib/chromia/access';
import { withErrorHandling } from '@/lib/chromia/api';
import {
  baseColumns,
  baseFields,
  EXPORT_KIND_LABELS,
  exportFileName,
  parseExportQuery,
  resolveRange,
  type BaseField,
  type ExportColumn,
  type ExportKind,
} from '@/lib/chromia/exports';
import { loadExportRows, type ExportRow } from '@/lib/chromia/server/repositories/export-repository';
import { dateOnly, dateTime, localDay, writeStyledWorkbook } from '@/lib/chromia/server/exports/sheet';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One sheet, one outcome, one date range.
 *
 * Grade, cycle, recalibration count, thickness, processing time and remarks are
 * deliberately absent — this is a movement sheet, not the slab's full record.
 * For everything, see the complete-production sheet.
 */
/**
 * The register works in centimetres; the database stores millimetres. Written
 * as a number, not text, so the column can be sorted and totalled in Excel.
 */
function thicknessCm(mm: string | null): number | string {
  if (mm === null) return '';
  const parsed = Number(mm);
  return Number.isFinite(parsed) ? parsed / 10 : '';
}

function baseCells(row: ExportRow): Record<BaseField, string | number> {
  return {
    date: localDay(row.date),
    batchNo: row.batchNo,
    slabNo: row.slabNo,
    baseMaterial: row.baseMaterial,
    design: row.design ?? '',
    thicknessCm: thicknessCm(row.thicknessMm),
    receivedDate: localDay(row.receivedDate),
    inTime: dateTime(row.inTime),
    outTime: dateTime(row.outTime),
    fullyPrintedDate: dateOnly(row.fullyPrintedDate),
    status: slabStatusView(row.status, row.disposition).label,
    disposition: row.disposition ? DISPOSITION_LABELS[row.disposition] : '',
  };
}

/**
 * The values, in whatever order this sheet puts its columns.
 *
 * Read from `baseFields` — the same list the headings come from — so a column
 * cannot end up above the wrong values.
 */
function toValues(row: ExportRow, kind: ExportKind, extraKeys: string[]): (string | number)[] {
  const cells = baseCells(row);

  return [
    ...baseFields(kind).map((field) => cells[field]),
    ...extraKeys.map((key) => {
      const value = row.extra[key];
      return value === null || value === undefined ? '' : value;
    }),
  ];
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Middleware already stopped anyone without the CHROMIA role or an admin
  // rank at the path prefix; this is the second layer, because a route handler
  // that trusts middleware alone is one matcher edit away from being public.
  const gate = await chromiaGate();
  if (!gate.ok) return new Response(gate.status === 401 ? 'Unauthorized' : 'Forbidden', { status: gate.status });

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const query = parseExportQuery(params);
  const range = resolveRange(query);

  const rows = await loadExportRows(query.kind, range);

  // Outcome-specific columns are discovered from the data, so Stock and Sample
  // Cutting bring their own fields without the route knowing about them.
  const extraKeys = Object.keys(rows[0]?.extra ?? {});
  const columns: ExportColumn[] = [
    ...baseColumns(query.kind),
    ...extraKeys.map((label) => ({ label, group: 'outcome' as const, width: 20 })),
  ];

  const buffer = writeStyledWorkbook({
    sheetName: EXPORT_KIND_LABELS[query.kind],
    columns,
    rows: rows.map((row) => toValues(row, query.kind, extraKeys)),
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${exportFileName(query.kind, range)}"`,
      'Cache-Control': 'no-store',
    },
  });
});
