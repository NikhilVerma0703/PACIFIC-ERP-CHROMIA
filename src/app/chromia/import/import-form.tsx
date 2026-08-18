'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { Card, Field, FormError, Stat } from '@/components/chromia/ui';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { button, control, link, table } from '@/lib/chromia/ui';
import {
  previewImportAction,
  runImportAction,
  type ImportFormState,
} from '@/lib/chromia/server/actions/import';

const INITIAL_STATE: ImportFormState = {};

export function ImportForm() {
  const [preview, previewAction, previewPending] = useActionState(
    previewImportAction,
    INITIAL_STATE,
  );
  const [result, importAction, importPending] = useActionState(runImportAction, INITIAL_STATE);

  const state = result.summary || result.error ? result : preview;
  const busy = previewPending || importPending;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Register workbook (.xlsx)" htmlFor="file" className="w-72">
              <input
                id="file"
                name="file"
                type="file"
                accept=".xlsx,.xlsm,.xls"
                required
                className={control}
              />
            </Field>

            <Field label="Period label" htmlFor="periodLabel" className="w-48">
              <input
                id="periodLabel"
                name="periodLabel"
                placeholder="May 2026"
                className={control}
              />
            </Field>

            <button
              type="submit"
              formAction={previewAction}
              disabled={busy}
              className={button.secondary}
            >
              {previewPending ? 'Reading…' : 'Preview'}
            </button>

            <button
              type="submit"
              formAction={importAction}
              disabled={busy}
              className={button.primary}
            >
              {importPending ? 'Importing…' : 'Import'}
            </button>
          </div>
        </form>
      </Card>

      <FormError message={state.error} />

      {/* ------------------------------------------------------------ result */}
      {result.summary ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Import complete</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Rows found" value={result.summary.totalRows} />
            <Stat label="Imported" value={result.summary.imported} tone="done" />
            <Stat label="Skipped" value={result.summary.skipped} tone="hold" />
            <Stat
              label="Failed"
              value={result.summary.failed}
              tone={result.summary.failed > 0 ? 'waste' : 'neutral'}
            />
          </div>

          {result.summary.errors.length > 0 ? (
            <details className="mt-4">
              <summary className="text-muted cursor-pointer text-sm">
                {result.summary.errors.length} note
                {result.summary.errors.length === 1 ? '' : 's'}
              </summary>
              <ul className="text-muted mt-2 flex flex-col gap-1 text-xs">
                {result.summary.errors.map((issue) => (
                  <li key={`${issue.sourceRow}-${issue.reason}`}>
                    Row {issue.sourceRow}: {issue.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <Link href={APP_ROUTES.slabs} className={`${link} mt-4 inline-block text-sm`}>
            View imported slabs →
          </Link>
        </Card>
      ) : null}

      {/* ----------------------------------------------------------- preview */}
      {preview.preview && !result.summary ? (
        <Card>
          <h2 className="text-sm font-semibold tracking-tight">
            Preview — {preview.preview.fileName} · sheet &ldquo;{preview.preview.sheetName}&rdquo;
          </h2>
          <p className="text-muted mt-1 mb-4 text-sm">
            {preview.preview.parsedRows} slab row
            {preview.preview.parsedRows === 1 ? '' : 's'} readable · {preview.preview.skipped} blank
            row{preview.preview.skipped === 1 ? '' : 's'} skipped · {preview.preview.issues.length}{' '}
            issue{preview.preview.issues.length === 1 ? '' : 's'}
          </p>

          {preview.preview.duplicates.length > 0 ? (
            <p className="text-status-hold mb-4 text-sm">
              Repeated slab numbers in this sheet: {preview.preview.duplicates.join(', ')} — only
              the first of each will be imported.
            </p>
          ) : null}

          {preview.preview.sample.length > 0 ? (
            <>
              <p className="mb-3 text-sm font-medium">
                A sample of the first {preview.preview.sample.length} row
                {preview.preview.sample.length === 1 ? '' : 's'}, as the module reads them
              </p>

              <div className={table.wrapper}>
                <table className={table.root}>
                  <thead className={table.head}>
                    <tr>
                      <th className={table.th}>Row</th>
                      <th className={table.th}>Batch No.</th>
                      <th className={table.th}>Slab No.</th>
                      <th className={table.th}>Slab Name</th>
                      <th className={table.th}>Design / File Name</th>
                      <th className={table.th}>Date</th>
                      <th className={table.th}>Remark</th>
                      <th className={table.th}>Reads as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.sample.map((row) => (
                      <tr key={row.sourceRow} className={table.row}>
                        <td className={table.tdMuted}>{row.sourceRow}</td>
                        <td className={`${table.tdMuted} font-mono`}>{row.batchNo}</td>
                        <td className={`${table.td} font-mono font-medium`}>{row.slabNo}</td>
                        <td className={table.td}>{row.materialName}</td>
                        <td className={table.tdMuted}>{row.designFile ?? '—'}</td>
                        <td className={table.tdMuted}>{row.receivedDate}</td>
                        <td className={table.tdMuted}>{row.remark ?? '—'}</td>
                        <td className={table.td}>
                          {row.disposition
                            ? row.disposition.replace(/_/g, ' ').toLowerCase()
                            : 'in processing'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {preview.preview.issues.length > 0 ? (
            <details className="mt-4">
              <summary className="text-muted cursor-pointer text-sm">
                {preview.preview.issues.length} row
                {preview.preview.issues.length === 1 ? '' : 's'} that cannot be read
              </summary>
              <ul className="text-muted mt-2 flex flex-col gap-1 text-xs">
                {preview.preview.issues.map((issue) => (
                  <li key={`${issue.sourceRow}-${issue.reason}`}>
                    Row {issue.sourceRow}: {issue.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
