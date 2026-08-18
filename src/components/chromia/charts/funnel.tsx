import type { FunnelStep } from '@/lib/chromia/production-summary';

/**
 * The recalibration funnel.
 *
 * Ordered stages, so this is a sequential ramp — one hue, light to dark — not a
 * categorical palette. The steps carry an order, and colouring them by identity
 * would imply they are unrelated categories.
 *
 * The last step is the exception: written-off slabs are a loss, not a further
 * narrowing, so it wears the reserved waste colour and sits below a rule.
 */

/** Brand blue, deepening down the funnel. Monotonic by construction. */
const RAMP = ['#bcdaff', '#8ec3ff', '#59a2ff', '#327dff', '#1547e1'];
const LOSS = '#dc2626';

export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const base = Math.max(1, steps[0]?.count ?? 1);

  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, index) => {
        const isLoss = index === steps.length - 1;
        const width = Math.max(step.count > 0 ? 1.5 : 0, (step.count / base) * 100);

        return (
          <li
            key={step.label}
            className={isLoss ? 'border-line mt-2 border-t pt-4' : undefined}
            title={`${step.label}: ${step.count} slabs (${step.percent}% of received)`}
          >
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3">
              <span className="text-sm font-medium">{step.label}</span>
              <span className="text-sm font-semibold tabular-nums">{step.count}</span>
              <span className="text-muted text-xs tabular-nums">{step.percent}%</span>
              <span className="text-muted ml-auto hidden truncate text-xs sm:inline">
                {step.hint}
              </span>
            </div>

            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${width}%`,
                  background: isLoss ? LOSS : (RAMP[index] ?? RAMP[RAMP.length - 1]),
                }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
