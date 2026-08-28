import type { Metadata } from 'next';

import { StackedShare } from '@/components/chromia/charts/stacked-share';
import { PageHeader, Stat } from '@/components/chromia/ui';
import { SectionCard } from '@/components/chromia/ui/form';
import { loadLiveDashboard } from '@/lib/chromia/server/repositories/dashboard-repository';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/** Small caps rule above a row of tiles. */
function RowHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-foreground mb-3 text-[12px] font-semibold tracking-[0.14em] uppercase">
      {children}
    </h2>
  );
}

/**
 * Production dashboard — the live state of the plant.
 *
 * Three questions, in the order the Chromia in-charge asks them on walking in:
 * how does the plant stand overall, where are its slabs, and what has happened
 * today. Nothing on this page filters, ranks or covers a date range — that work
 * belongs to Slabs, Summary and Downloads. Keeping those out is what lets this
 * screen be read in ten seconds instead of studied.
 *
 * Overall Production and the distribution bar are read from one grouping of
 * the slab's current outcome, so a tile and the bar under it can never
 * disagree.
 */
export default async function DashboardPage() {
  const data = await loadLiveDashboard();
  const { today } = data;

  return (
    <>
      <PageHeader title="Production dashboard" size="lg" />

      {/* ------------------------------------------ 1 · overall production --- */}
      <section className="mb-8">
        <RowHeading>Overall Production</RowHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.overall.map((tile) => (
            <Stat
              key={tile.key}
              label={tile.label}
              value={tile.value}
              tone={tile.tone}
              hint={tile.hint}
            />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ 2 · where they are --- */}
      <section className="mb-8">
        <SectionCard title="Where they are" accent="active">
          {data.outcomes.length === 0 ? (
            <p className="text-muted text-sm">No slabs recorded yet.</p>
          ) : (
            <StackedShare segments={data.outcomes} />
          )}
        </SectionCard>
      </section>

      {/* ------------------------------------------- 3 · today's production --- */}
      <section className="mb-8">
        <RowHeading>Today&rsquo;s Production</RowHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Produced slabs" value={today.received} tone="active" />
          <Stat label="In-Processing" value={today.inProcessing} tone="neutral" />
          <Stat label="Processing completed" value={today.processingDone} tone="done" />
          <Stat label="Quality checks done" value={today.qcDone} tone="hold" />
          <Stat label="Dispatched" value={today.dispatched} tone="done" />
          <Stat label="Stock" value={today.stocked} tone="active" />
          <Stat label="Sample cutting" value={today.sampleCut} tone="hold" />
          <Stat label="Recalibration" value={today.sentForRecalibration} tone="recalibration" />
        </div>
      </section>
    </>
  );
}
