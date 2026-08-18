'use client';

import { useState } from 'react';

import { Field } from '@/components/chromia/ui';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import {
  EXPORT_KIND_DATE_LABEL,
  EXPORT_KIND_LABELS,
  EXPORT_KINDS,
  RANGE_PRESET_LABELS,
  RANGE_PRESETS,
  type ExportKind,
  type ExportQuery,
  type MonthOption,
  type RangePreset,
} from '@/lib/chromia/exports';

interface Props {
  query: ExportQuery;
  months: MonthOption[];
  /** Rows the current selection would produce — drives the download button. */
  rowCount: number;
  downloadHref: string;
}

const KIND_ACCENT: Record<ExportKind, string> = {
  DISPATCH: 'peer-checked:border-status-done peer-checked:text-status-done',
  STOCK: 'peer-checked:border-status-active peer-checked:text-status-active',
  SAMPLE_CUTTING: 'peer-checked:border-status-hold peer-checked:text-status-hold',
  RECALIBRATION:
    'peer-checked:border-status-recalibration peer-checked:text-status-recalibration',
};

/**
 * Download picker.
 *
 * A plain GET form — the selection lives in the URL, so a chosen sheet is
 * bookmarkable and the preview below always matches what will be downloaded.
 * Only the fields the chosen preset needs are shown; the rest would be noise.
 */
export function DownloadForm({ query, months, rowCount, downloadHref }: Props) {
  const [kind, setKind] = useState<ExportKind>(query.kind);
  const [preset, setPreset] = useState<RangePreset>(query.preset);

  return (
    <div className="mb-6">
      <SectionCard step="02" title="By outcome" accent="grade" size="lg">
        <form method="get" className="flex flex-col gap-6">
          {/* ------------------------------------------------- 1. kind --- */}
          <fieldset>
            <legend className="text-muted mb-3 text-[11px] font-semibold tracking-[0.16em] uppercase">
              Sheet
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {EXPORT_KINDS.map((value) => (
                <label key={value} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="kind"
                    value={value}
                    checked={kind === value}
                    onChange={() => setKind(value)}
                    className="peer sr-only"
                  />
                  <span
                    className={`border-line surface hover:border-line-strong peer-focus-visible:ring-brand-500 block rounded-lg border px-4 py-3.5 text-sm font-medium transition-colors peer-focus-visible:ring-2 ${KIND_ACCENT[value]}`}
                  >
                    {EXPORT_KIND_LABELS[value]}
                    <span className="text-muted mt-0.5 block text-xs font-normal">
                      Filtered on {EXPORT_KIND_DATE_LABEL[value].toLowerCase()}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* ------------------------------------------------ 2. range --- */}
          <fieldset className="border-line border-t pt-5">
            <legend className="text-muted mb-3 text-[11px] font-semibold tracking-[0.16em] uppercase">
              Period
            </legend>

            <FieldGrid columns={3}>
              <Field label="Range" htmlFor="preset">
                <select
                  id="preset"
                  name="preset"
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
                <Field label="Month" htmlFor="month">
                  <select
                    id="month"
                    name="month"
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
                  <Field label="From" htmlFor="from">
                    <input
                      id="from"
                      name="from"
                      type="date"
                      defaultValue={query.from}
                      className={field}
                    />
                  </Field>
                  <Field label="To" htmlFor="to">
                    <input
                      id="to"
                      name="to"
                      type="date"
                      defaultValue={query.to}
                      className={field}
                    />
                  </Field>
                </>
              ) : null}
            </FieldGrid>
          </fieldset>

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
