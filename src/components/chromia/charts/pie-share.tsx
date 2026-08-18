import { readableInk } from './ink';
import type { ShareSegment } from './stacked-share';

/**
 * Part-to-whole as a pie.
 *
 * A pie earns its place only when the question is "roughly how is this split"
 * and there are few enough slices to tell apart — five or six outcomes, read at
 * a glance. It is not asked to support close comparisons: the legend beneath
 * carries every count and share, so anyone who needs to compare two similar
 * slices reads the numbers instead of squinting at angles.
 *
 * Every slice shows its figure. A wide slice carries it inside; a sliver too
 * narrow to hold text gets the figure outside on a leader line, because a slice
 * with no number is a slice the reader has to go hunting for.
 */

const RADIUS = 100;
/** Room around the circle for the leader lines and their labels. */
const PADDING = 62;
const CENTRE = RADIUS + PADDING;
const SIZE = CENTRE * 2;

/** Below this share the figure cannot fit inside its own slice. */
const INSIDE_MIN_PERCENT = 8;

/** Leader-line geometry, as multiples of the radius / in flat pixels. */
const ELBOW = RADIUS * 1.08;
const LEG = 14;
/** Two outside labels closer than this would overlap. */
const MIN_LABEL_GAP = 15;

function polar(angle: number, radius: number) {
  // Start at twelve o'clock and sweep clockwise, the way a person reads a pie.
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: CENTRE + radius * Math.cos(radians), y: CENTRE + radius * Math.sin(radians) };
}

/** A slice of the circle, as an SVG path. */
function slicePath(startAngle: number, endAngle: number): string {
  const from = polar(startAngle, RADIUS);
  const to = polar(endAngle, RADIUS);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return `M ${CENTRE} ${CENTRE} L ${from.x} ${from.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${to.x} ${to.y} Z`;
}

interface Slice {
  segment: ShareSegment;
  start: number;
  end: number;
}

interface OutsideLabel {
  segment: ShareSegment;
  /** Where the leader line leaves the slice. */
  anchor: { x: number; y: number };
  elbow: { x: number; y: number };
  textX: number;
  textY: number;
  side: 'left' | 'right';
}

/**
 * Place the figures that will not fit inside their slice.
 *
 * Each one leaves its slice along its own mid-angle, turns once, and ends in a
 * short horizontal leg. Labels on the same side are then pushed apart so two
 * slivers next to each other cannot print on top of one another.
 */
function buildOutsideLabels(slices: Slice[]): OutsideLabel[] {
  const labels = slices
    .filter(({ segment }) => segment.percent < INSIDE_MIN_PERCENT)
    .map(({ segment, start, end }) => {
      const mid = (start + end) / 2;
      const side: 'left' | 'right' = mid > 180 ? 'left' : 'right';
      const elbow = polar(mid, ELBOW);

      return {
        segment,
        anchor: polar(mid, RADIUS * 0.96),
        elbow,
        textX: elbow.x + (side === 'right' ? LEG : -LEG),
        textY: elbow.y,
        side,
      };
    });

  for (const side of ['left', 'right'] as const) {
    const column = labels.filter((label) => label.side === side).sort((a, b) => a.textY - b.textY);
    for (let index = 1; index < column.length; index += 1) {
      const previous = column[index - 1];
      const current = column[index];
      if (!previous || !current) continue;
      if (current.textY - previous.textY < MIN_LABEL_GAP) {
        current.textY = previous.textY + MIN_LABEL_GAP;
      }
    }
  }

  return labels;
}

export function PieShare({ segments }: { segments: ShareSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) return null;

  let angle = 0;
  const slices: Slice[] = segments.map((segment) => {
    const start = angle;
    const sweep = (segment.count / total) * 360;
    angle += sweep;
    return { segment, start, end: start + sweep };
  });

  const whole = slices.length === 1;
  const outside = whole ? [] : buildOutsideLabels(slices);

  return (
    <figure className="m-0">
      <div className="flex justify-center">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-full max-w-[324px]"
          role="img"
          aria-label={segments.map((s) => `${s.label} ${s.percent}%`).join(', ')}
        >
          {slices.map(({ segment, start, end }) =>
            /*
             * One outcome accounting for everything cannot be drawn as an arc —
             * a 360° sweep starts and ends at the same point and collapses. It
             * is a circle.
             */
            whole ? (
              <circle key={segment.label} cx={CENTRE} cy={CENTRE} r={RADIUS} fill={segment.color} />
            ) : (
              <path
                key={segment.label}
                d={slicePath(start, end)}
                fill={segment.color}
                stroke="var(--surface)"
                strokeWidth={2}
                className="transition-opacity hover:opacity-85"
              >
                <title>{`${segment.label}: ${segment.count} slabs (${segment.percent}%)`}</title>
              </path>
            ),
          )}

          {/* ------------------------------------------- figures inside --- */}
          {slices.map(({ segment, start, end }) => {
            if (!whole && segment.percent < INSIDE_MIN_PERCENT) return null;
            const point = whole
              ? { x: CENTRE, y: CENTRE }
              : polar((start + end) / 2, RADIUS * 0.62);

            return (
              <text
                key={`${segment.label}-inside`}
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={readableInk(segment.color)}
                className="text-[12px] font-semibold tabular-nums"
                style={{ pointerEvents: 'none' }}
              >
                {segment.percent}%
              </text>
            );
          })}

          {/* ---------------------------------- figures on leader lines --- */}
          {outside.map((label) => (
            <g key={`${label.segment.label}-outside`} style={{ pointerEvents: 'none' }}>
              <polyline
                points={`${label.anchor.x},${label.anchor.y} ${label.elbow.x},${label.elbow.y} ${label.textX},${label.textY}`}
                fill="none"
                stroke={label.segment.color}
                strokeWidth={1.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <text
                x={label.textX + (label.side === 'right' ? 4 : -4)}
                y={label.textY}
                textAnchor={label.side === 'right' ? 'start' : 'end'}
                dominantBaseline="central"
                fill="var(--foreground)"
                className="text-[12px] font-semibold tabular-nums"
              >
                {label.segment.percent}%
              </text>
            </g>
          ))}
        </svg>
      </div>

      <figcaption className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2">
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-2 text-xs">
            <span
              className="inline-block size-3 shrink-0 rounded-sm ring-1 ring-black/5"
              style={{ background: segment.color }}
            />
            <span className="text-muted">{segment.label}</span>
            <span className="font-semibold tabular-nums">{segment.count}</span>
            <span className="text-muted tabular-nums">({segment.percent}%)</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
