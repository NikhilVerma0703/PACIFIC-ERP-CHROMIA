import Link from 'next/link';

import { Field } from '@/components/chromia/ui';
import { field, SectionCard } from '@/components/chromia/ui/form';
import { buildSimpleQuery, type SimpleFilters } from '@/lib/chromia/simple-filters';

function toInputDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

/**
 * The three-field filter bar for Stockyard and Recalibration.
 *
 * Deliberately the same shape and behaviour as "Find a slab": a plain GET form
 * whose state lives in the URL, so a search is bookmarkable and needs no client
 * JavaScript, and a filter bar that behaves the same on every screen is one the
 * in-charge trusts. `action` is the page it submits to; everything else is
 * identical between the two.
 */
export function SimpleFilterBar({
  filters,
  action,
  title = 'Find a slab',
}: {
  filters: SimpleFilters;
  action: string;
  title?: string;
}) {
  return (
    <div className="mb-6">
      <SectionCard title={title} accent="active">
        {/*
         * Keyed on the current filters. Every control is uncontrolled, so
         * `defaultValue` applies when the input mounts and never again — on a
         * soft navigation React reuses the nodes, and clearing the filters would
         * otherwise leave the old values showing in the fields.
         */}
        <form key={buildSimpleQuery(filters)} method="get" action={action} className="flex flex-col gap-5">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Production Date" htmlFor="productionDate">
              <input
                id="productionDate"
                name="productionDate"
                type="date"
                defaultValue={toInputDate(filters.productionDate)}
                className={field}
              />
            </Field>

            <Field label="Batch No." htmlFor="batchNo">
              <input
                id="batchNo"
                name="batchNo"
                defaultValue={filters.batchNo}
                placeholder="1245"
                className={`${field} font-mono`}
              />
            </Field>

            <Field label="Slab No." htmlFor="slabNo">
              <input
                id="slabNo"
                name="slabNo"
                defaultValue={filters.slabNo}
                placeholder="85477"
                className={`${field} font-mono`}
              />
            </Field>
          </div>

          <div className="border-line flex flex-wrap items-center justify-end gap-3 border-t pt-5">
            <Link
              href={action}
              className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
            >
              Clear filters
            </Link>
            <button
              type="submit"
              className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors"
            >
              Search
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
