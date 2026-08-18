'use client';

import { useState } from 'react';

import { Field } from '@/components/chromia/ui';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import {
  RANGE_PRESET_LABELS,
  RANGE_PRESETS,
  type MonthOption,
  type RangePreset,
  type RangeQuery,
} from '@/lib/chromia/exports';

interface Props {
  query: RangeQuery;
  months: MonthOption[];
  rowCount: number;
  downloadHref: string;
}

/**
 * Complete production picker.
 *
 * Same five periods as the outcome sheets, but no sheet to choose — this one is
 * everything received in the window, whatever became of it.
 *
 * Its params are prefixed (`pPreset`, `pMonth`, …) because both pickers live on
 * one URL; without the prefix, applying a period here would silently move the
 * outcome sheet below it.
 */
export function ProductionForm({ query, months, rowCount, downloadHref }: Props) {
  const [preset, setPreset] = useState<RangePreset>(query.preset);

  return (
    <div className="mb-6">
      <SectionCard step="01" title="Complete production" accent="active" size="lg">
        <form method="get" className="flex flex-col gap-6">
          <FieldGrid columns={3}>
            <Field label="Period" htmlFor="pPreset">
              <select
                id="pPreset"
                name="pPreset"
                className={selectField}
                value={preset}
                onChange={(event) => setPreset(event.target.value as RangePreset)}
              >
                {RANGE_PRESETS.map((value) => (
                  <option key={value} value={value}>
                    {RANGE_PRESET_LABELS[value]}
                  </option>
                ))}
              </select>
            </Field>

            {preset === 'MONTH' ? (
              <Field label="Month" htmlFor="pMonth">
                <select
                  id="pMonth"
                  name="pMonth"
                  className={selectField}
                  defaultValue={query.month}
                >
                  {months.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {preset === 'CUSTOM' ? (
              <>
                <Field label="From" htmlFor="pFrom">
                  <input
                    id="pFrom"
                    name="pFrom"
                    type="date"
                    defaultValue={query.from}
                    className={field}
                  />
                </Field>
                <Field label="To" htmlFor="pTo">
                  <input
                    id="pTo"
                    name="pTo"
                    type="date"
                    defaultValue={query.to}
                    className={field}
                  />
                </Field>
              </>
            ) : null}
          </FieldGrid>

          <div className="border-line flex flex-wrap items-center gap-3 border-t pt-5">
            <button
              type="submit"
              className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
            >
              Apply
            </button>

            <a
              href={downloadHref}
              aria-disabled={rowCount === 0}
              className={`bg-brand-600 hover:bg-brand-700 ml-auto inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors ${
                rowCount === 0 ? 'pointer-events-none opacity-55' : ''
              }`}
            >
              Download Excel
              {rowCount > 0 ? (
                <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-xs tabular-nums">
                  {rowCount}
                </span>
              ) : null}
            </a>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
