/**
 * Shared UI class tokens.
 *
 * One definition per control type, so every form and table in the module looks
 * the same without a component library. Compose with `cn()` when a caller needs
 * to add layout classes.
 */

export const control =
  'border-line surface w-full rounded-md border px-3 py-2 text-sm transition-colors placeholder:text-muted';

export const label = 'text-muted text-xs font-medium';

export const button = {
  primary:
    'bg-brand-600 hover:bg-brand-700 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-55',
  secondary:
    'border-line surface hover:border-line-strong inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55',
  success:
    'bg-status-done inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55',
  danger:
    'bg-status-waste inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55',
  recalibration:
    'bg-status-recalibration inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55',
  ghost:
    'text-muted hover:text-foreground inline-flex items-center justify-center rounded-md px-3 py-2 text-sm transition-colors',
} as const;

export const table = {
  wrapper: 'border-line surface overflow-x-auto rounded-lg border',
  root: 'w-full text-left text-sm',
  head: 'border-line surface-muted text-muted border-b text-xs tracking-wide uppercase',
  th: 'px-4 py-2.5 font-medium whitespace-nowrap',
  row: 'border-line border-b transition-colors last:border-b-0 hover:bg-[var(--surface-muted)]',
  td: 'px-4 py-2.5',
  tdMuted: 'text-muted px-4 py-2.5',
  tdNum: 'px-4 py-2.5 tabular-nums',
  foot: 'border-line-strong surface-muted border-t font-semibold',
} as const;

export const link = 'text-brand-600 hover:text-brand-700 font-medium transition-colors';
