import type { Metadata } from 'next';

import { EmptyState, PageHeader, Section } from '@/components/chromia/ui';
import { actorNames } from '@/lib/chromia/actors';
import { prisma } from '@/lib/chromia/db';
import { table } from '@/lib/chromia/ui';

import { ImportForm } from './import-form';

export const metadata: Metadata = { title: 'Import' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default async function ImportPage() {
  const history = await prisma.chromiaImportBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  // Who ran it: an ERP user id on the row, resolved to a name here because the
  // chromia_* tables hold no foreign key into users. See lib/chromia/actors.ts.
  const importers = await actorNames(history.map((run) => run.importedById));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Import production register" />

      <ImportForm />

      <Section title="Previous imports" className="mt-8">
        {history.length === 0 ? (
          <EmptyState>Nothing imported yet.</EmptyState>
        ) : (
          <div className={table.wrapper}>
            <table className={table.root}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>File</th>
                  <th className={table.th}>Period</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Rows</th>
                  <th className={table.th}>Imported</th>
                  <th className={table.th}>Skipped</th>
                  <th className={table.th}>Failed</th>
                  <th className={table.th}>When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((run) => (
                  <tr key={run.id} className={table.row}>
                    <td className={`${table.td} font-medium`}>{run.sourceFile}</td>
                    <td className={table.tdMuted}>{run.periodLabel ?? '—'}</td>
                    <td className={table.tdMuted}>{run.status.toLowerCase()}</td>
                    <td className={table.tdNum}>{run.totalRows}</td>
                    <td className={table.tdNum}>{run.importedRows}</td>
                    <td className={table.tdNum}>{run.skippedRows}</td>
                    <td className={table.tdNum}>{run.failedRows}</td>
                    <td className={table.tdMuted}>
                      {dateFmt.format(run.createdAt)}
                      {run.importedById ? ` · ${importers.get(run.importedById) ?? 'Unknown'}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
