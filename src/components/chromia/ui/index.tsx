import { cn } from '@/lib/chromia/utils/cn';
import { label as labelClass } from '@/lib/chromia/ui';

/**
 * Small presentational primitives shared by every screen.
 *
 * Deliberately not a component library — just the handful of shapes this
 * module repeats, so spacing and borders stay identical everywhere.
 */

// ------------------------------------------------------------ page header ---

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  size = 'md',
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: string;
  /** `lg` for a landing screen, where the title is the page's whole identity. */
  size?: 'md' | 'lg';
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-status-active mb-1 text-[11px] font-semibold tracking-[0.18em] uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={cn(
            'truncate font-semibold tracking-tight',
            size === 'lg' ? 'text-[30px] tracking-[-0.025em]' : 'text-xl',
          )}
        >
          {title}
        </h1>
        {description ? <p className="text-muted mt-1 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

// ------------------------------------------------------------------- card ---

export function Card({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={cn('border-line surface rounded-lg border', padded && 'p-5', className)}>
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-8', className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-muted mt-0.5 text-xs">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ badge ---

export type Tone = 'neutral' | 'active' | 'hold' | 'done' | 'recalibration' | 'waste';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'text-muted bg-[color-mix(in_srgb,var(--muted)_12%,transparent)]',
  active: 'text-status-active bg-[color-mix(in_srgb,var(--color-status-active)_12%,transparent)]',
  hold: 'text-status-hold bg-[color-mix(in_srgb,var(--color-status-hold)_14%,transparent)]',
  done: 'text-status-done bg-[color-mix(in_srgb,var(--color-status-done)_13%,transparent)]',
  recalibration:
    'text-status-recalibration bg-[color-mix(in_srgb,var(--color-status-recalibration)_13%,transparent)]',
  waste: 'text-status-waste bg-[color-mix(in_srgb,var(--color-status-waste)_12%,transparent)]',
};

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-status-pending',
  active: 'bg-status-active',
  hold: 'bg-status-hold',
  done: 'bg-status-done',
  recalibration: 'bg-status-recalibration',
  waste: 'bg-status-waste',
};

/** A status pill. Always carries its own text — never colour alone. */
export function Badge({
  children,
  tone = 'neutral',
  dot = true,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASS[tone],
      )}
    >
      {dot ? <span className={cn('inline-block size-1.5 rounded-full', TONE_DOT[tone])} /> : null}
      {children}
    </span>
  );
}

// -------------------------------------------------------------- stat tile ---

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="border-line surface h-full rounded-xl border p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06),0_1px_2px_rgba(16,24,40,0.04)]">
      {/*
       * The label wraps rather than truncating. "Total Sample Cutting Slabs"
       * cut to "Total Sample Cutting Sla…" is a tile whose own name has to be
       * guessed, and the grid equalises the row height anyway, so a second
       * line costs nothing.
       */}
      <div className="flex items-start gap-2">
        <span
          className={cn('mt-[6px] inline-block size-1.5 shrink-0 rounded-full', TONE_DOT[tone])}
        />
        <span className="text-muted text-[11px] leading-[1.35] font-semibold tracking-[0.1em] uppercase">
          {label}
        </span>
      </div>
      <p className="mt-3 text-[30px] leading-none font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {hint ? <p className="text-muted mt-2 text-xs">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------- definition row ---

/** Label above value — used in page headers and summary cards. */
export function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

// ------------------------------------------------------------ empty state ---

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line text-muted rounded-lg border border-dashed px-6 py-12 text-center text-sm">
      {children}
    </div>
  );
}

// ------------------------------------------------------------- form field ---

/**
 * Renders a label, colouring a trailing asterisk red.
 *
 * Labels are written as plain strings ("Batch Number *") so they stay easy to
 * read in the form source; the required marker is styled here rather than at
 * every call site.
 */
function RequiredLabel({ label }: { label: string }) {
  const trimmed = label.trimEnd();
  if (!trimmed.endsWith('*')) return <>{label}</>;

  return (
    <>
      {trimmed.slice(0, -1)}
      <span className="text-status-waste" aria-hidden>
        *
      </span>
      <span className="sr-only">required</span>
    </>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  badge,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  /** Optional pill shown beside the label — e.g. the chosen grade or outcome. */
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex min-h-5 items-center gap-2">
        <label htmlFor={htmlFor} className={labelClass}>
          <RequiredLabel label={label} />
        </label>
        {badge}
      </div>
      {children}
      {hint && !error ? <p className="text-muted text-xs">{hint}</p> : null}
      {error ? <p className="text-status-waste text-xs">{error}</p> : null}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="text-status-waste rounded-md bg-[color-mix(in_srgb,var(--color-status-waste)_8%,transparent)] px-3 py-2 text-sm"
    >
      {message}
    </p>
  );
}
