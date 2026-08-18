import Link from 'next/link';

import { Field } from '@/components/chromia/ui';
import { field, selectField, SectionCard } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import {
  ATTEMPT_CHOICES,
  buildQuery,
  type TrackingFilters,
} from '@/lib/chromia/recalibration-tracking-filters';

interface Option {
  id: string;
  name: string;
}

function toInputDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

/**
 * Tracking filters.
 *
 * Deliberately the same shape, spacing and behaviour as Find a slab: the
 * in-charge uses both screens in the same hour, and a filter bar that behaves
 * differently on the second one is a filter bar nobody trusts. A plain GET
 * form, so the search lives in the URL and can be bookmarked or passed on.
 */
export function FilterBar({
  filters,
  baseMaterials,
  designs,
}: {
  filters: TrackingFilters;
  baseMaterials: Option[];
  designs: Option[];
}) {
  return (
    <div className="mb-6">
      <SectionCard title="Track a slab" accent="active">
        {/*
         * Keyed on the current filters. Every control is uncontrolled, so
         * `defaultValue` applies when the input mounts and never again — on a
         * soft navigation React reuses the nodes, and clearing the filters
         * would leave the old choice showing in the dropdowns.
         */}
        <form
          key={buildQuery(filters)}
          method="get"
          action={APP_ROUTES.recalibrationTracking}
          className="flex flex-col gap-5"
        >
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
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

            <Field label="Base Material / Slab Name" htmlFor="baseMaterialId">
              <select
                id="baseMaterialId"
                name="baseMaterialId"
                defaultValue={filters.baseMaterialId ?? ''}
                className={selectField}
              >
                <option value="">Any</option>
                {baseMaterials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="File Name / Planned Design" htmlFor="designId">
              <select
                id="designId"
                name="designId"
                defaultValue={filters.designId ?? ''}
                className={selectField}
              >
                <option value="">Any</option>
                {designs.map((design) => (
                  <option key={design.id} value={design.id}>
                    {design.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Attempt" htmlFor="attempt">
              <select
                id="attempt"
                name="attempt"
                defaultValue={filters.attempt === null ? '' : String(filters.attempt)}
                className={selectField}
              >
                <option value="">Any</option>
                {ATTEMPT_CHOICES.map((attempt) => (
                  <option key={attempt} value={attempt}>
                    {attempt}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Date From" htmlFor="receivedFrom">
              <input
                id="receivedFrom"
                name="receivedFrom"
                type="date"
                defaultValue={toInputDate(filters.receivedFrom)}
                className={field}
              />
            </Field>

            <Field label="Date To" htmlFor="receivedTo">
              <input
                id="receivedTo"
                name="receivedTo"
                type="date"
                defaultValue={toInputDate(filters.receivedTo)}
                className={field}
              />
            </Field>
          </div>

          <div className="border-line flex flex-wrap items-center justify-end gap-3 border-t pt-5">
            <Link
              href={APP_ROUTES.recalibrationTracking}
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
