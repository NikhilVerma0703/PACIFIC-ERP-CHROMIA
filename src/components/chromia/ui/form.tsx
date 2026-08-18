import { cn } from '@/lib/chromia/utils/cn';

/**
 * Data-entry presentation kit.
 *
 * The long shop-floor forms (Slab Intake, Operator Entry) share this richer
 * treatment: taller controls, sectioned cards and a step rail. It sits beside
 * the leaner tokens in `lib/ui.ts`, which stay right for filter bars and
 * tables. Everything here is presentational — no field names, values or
 * handlers live in this file.
 */

/** Input, select and date control. Taller and softer than the shared token. */
export const field =
  'border-line surface h-11 w-full rounded-lg border px-3.5 text-[15px] shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-[border-color,box-shadow] outline-none placeholder:text-muted hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-[var(--line)]';

/** Same, for a `select` — reserves room for the native chevron. */
export const selectField = `${field} pr-9`;

export type Accent = 'brand' | 'grade' | 'active';

const ACCENT_BAR: Record<Accent, string> = {
  brand: 'bg-brand-600',
  grade: 'bg-status-recalibration',
  active: 'bg-status-active',
};

const ACCENT_STEP: Record<Accent, string> = {
  brand: 'bg-brand-50 text-brand-700',
  grade:
    'bg-[color-mix(in_srgb,var(--color-status-recalibration)_12%,transparent)] text-status-recalibration',
  active: 'bg-[color-mix(in_srgb,var(--color-status-active)_12%,transparent)] text-status-active',
};

/**
 * A titled panel. The step number sits in its own chip and the accent bar runs
 * down the left edge, which is what separates the QC block from the intake
 * block at a glance without resorting to a different background colour.
 */
export function SectionCard({
  step,
  title,
  accent = 'brand',
  size = 'md',
  actions,
  padded = true,
  children,
}: {
  /** Optional step chip — omit for a plain titled card. */
  step?: string;
  title: string;
  accent?: Accent;
  /**
   * `lg` for a card that heads a whole section of a page rather than one block
   * inside a form — a bigger chip and title so the numbered sections read as
   * the page's structure and not as another panel.
   */
  size?: 'md' | 'lg';
  actions?: React.ReactNode;
  /** Off when the body is a full-bleed table. */
  padded?: boolean;
  children: React.ReactNode;
}) {
  const large = size === 'lg';

  return (
    <section className="border-line surface relative overflow-hidden rounded-xl border shadow-[0_1px_3px_rgba(16,24,40,0.06),0_1px_2px_rgba(16,24,40,0.04)]">
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', ACCENT_BAR[accent])} />

      <header
        className={cn(
          'border-line surface-muted flex flex-wrap items-center gap-3 border-b pr-6 pl-7',
          large ? 'py-5' : 'py-4',
        )}
      >
        {step ? (
          <span
            className={cn(
              'grid shrink-0 place-items-center rounded-md font-semibold tracking-wide tabular-nums',
              large ? 'size-9 rounded-lg text-[14px]' : 'size-7 text-[11px]',
              ACCENT_STEP[accent],
            )}
          >
            {step}
          </span>
        ) : null}
        <h2 className={cn('font-semibold tracking-tight', large ? 'text-[19px]' : 'text-[15px]')}>
          {title}
        </h2>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </header>

      <div className={cn(padded && 'py-6 pr-6 pl-7')}>{children}</div>
    </section>
  );
}

/** Two-column field grid with the generous gutters an ERP form wants. */
export function FieldGrid({
  children,
  columns = 2,
}: {
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <div
      className={cn(
        'grid gap-x-6 gap-y-5',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-3',
      )}
    >
      {children}
    </div>
  );
}

/** Sub-panel for the fields a chosen outcome pulls in. */
export function OutcomePanel({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-line surface-muted rounded-lg border p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <h3 className="text-muted text-[11px] font-semibold tracking-[0.14em] uppercase">
          {title}
        </h3>
        {badge}
      </div>
      {children}
    </div>
  );
}

/** Hairline between logical groups inside one card. */
export function Divider() {
  return <hr className="border-line my-6 border-0 border-t" />;
}

/**
 * Table styling for the data screens.
 *
 * Roomier than the compact `table` token in `lib/ui.ts`: full-bleed inside a
 * `SectionCard`, so it carries no border or radius of its own.
 */
export const dataTable = {
  root: 'w-full text-left text-sm',
  head: 'border-line surface-muted border-b',
  th: 'text-muted px-5 py-3 text-[11px] font-semibold tracking-[0.12em] whitespace-nowrap uppercase',
  row: 'border-line border-b transition-colors last:border-b-0 hover:bg-[var(--surface-muted)]',
  td: 'px-5 py-3.5',
  tdMuted: 'text-muted px-5 py-3.5',
  tdNum: 'px-5 py-3.5 tabular-nums',
} as const;
