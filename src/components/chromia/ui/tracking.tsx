import { Badge, type Tone } from '@/components/chromia/ui';
import {
  STAGE_LABELS,
  VERDICT_LABELS,
  type AttemptBudget,
  type TrackingStage,
  type TripVerdict,
} from '@/lib/chromia/recalibration-tracking';
import { cn } from '@/lib/chromia/utils/cn';

/** Each stage wears the colour of what it means, not of where it sits. */
const STAGE_TONE: Record<TrackingStage, Tone> = {
  AWAITING_DESPATCH: 'hold',
  AT_FACILITY: 'recalibration',
  AWAITING_RESTART: 'hold',
  REPROCESSING: 'active',
  AWAITING_QC: 'hold',
  PASSED: 'done',
  WRITTEN_OFF: 'waste',
};

export function StageBadge({ stage }: { stage: TrackingStage }) {
  return <Badge tone={STAGE_TONE[stage]}>{STAGE_LABELS[stage]}</Badge>;
}

const VERDICT_TONE: Record<TripVerdict, Tone> = {
  FIXED: 'done',
  FAILED_AGAIN: 'waste',
  PENDING: 'neutral',
};

export function VerdictBadge({ verdict }: { verdict: TripVerdict }) {
  return (
    <Badge tone={VERDICT_TONE[verdict]} dot={false}>
      {VERDICT_LABELS[verdict]}
    </Badge>
  );
}

/**
 * Attempts as filled and empty dots.
 *
 * Reads at a glance from across the room, which a bare "2/5" does not. The
 * number is written out beside it so colour is never the only signal.
 */
export function AttemptDots({ attempts }: { attempts: AttemptBudget }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="inline-flex gap-1">
        {Array.from({ length: attempts.max }, (_, index) => (
          <span
            key={index}
            className={cn(
              'inline-block size-2 rounded-full',
              index < attempts.used
                ? attempts.exhausted
                  ? 'bg-status-waste'
                  : 'bg-status-recalibration'
                : 'bg-[var(--line-strong)]',
            )}
          />
        ))}
      </span>
      <span className="text-muted text-xs tabular-nums">
        {attempts.used}/{attempts.max}
      </span>
    </span>
  );
}
