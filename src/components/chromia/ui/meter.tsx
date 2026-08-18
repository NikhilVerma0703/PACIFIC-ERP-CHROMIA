import type { Tone } from '@/components/chromia/ui';
import { percent } from '@/lib/chromia/dashboard';

const BAR_TONE: Record<Tone, string> = {
  neutral: 'bg-status-pending',
  active: 'bg-status-active',
  hold: 'bg-status-hold',
  done: 'bg-status-done',
  recalibration: 'bg-status-recalibration',
  waste: 'bg-status-waste',
};

/**
 * Proportional bar with the value always written out beside it.
 *
 * Shared rather than page-local: the dashboard uses it for the grade split,
 * and the Recalibration section will use it for ageing buckets and reason
 * rankings when those move across.
 */
export function Meter({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: Tone;
}) {
  const share = percent(count, total);

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 shrink-0 truncate">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
        <span
          className={`block h-full rounded-full ${BAR_TONE[tone]}`}
          style={{ width: `${count > 0 ? Math.max(share, 2) : 0}%` }}
        />
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums">
        {count}
        <span className="text-muted ml-1.5 text-xs">{share}%</span>
      </span>
    </div>
  );
}
