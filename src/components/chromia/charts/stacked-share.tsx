/**
 * Part-to-whole as a horizontal stacked bar.
 *
 * Chosen over a pie deliberately: slices of similar size are far harder to
 * compare as angles than as lengths, and a stacked bar direct-labels cleanly
 * without leader lines. Every segment carries a 2px surface gap so adjacent
 * fills never touch, and the legend beneath repeats the figures so identity is
 * never colour alone.
 */

import { readableInk } from './ink';

export interface ShareSegment {
  label: string;
  count: number;
  percent: number;
  color: string;
}

export function StackedShare({ segments }: { segments: ShareSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) return null;

  return (
    <figure className="m-0">
      <div className="flex h-11 w-full gap-[2px] overflow-hidden rounded-lg">
        {segments.map((segment) => (
          <div
            key={segment.label}
            /*
             * Every segment carries its own figure, so each one is held to the
             * width that figure needs — a 2% share would otherwise be a sliver
             * too narrow to print anything in. The few pixels this borrows from
             * the larger segments cost less than a share nobody can read.
             */
            className="relative grid min-w-[38px] place-items-center transition-opacity hover:opacity-85"
            style={{
              background: segment.color,
              flexGrow: segment.count,
              flexBasis: 0,
            }}
            title={`${segment.label}: ${segment.count} slabs (${segment.percent}%)`}
          >
            <span
              className="text-[11px] font-semibold whitespace-nowrap tabular-nums"
              style={{ color: readableInk(segment.color) }}
            >
              {segment.percent}%
            </span>
          </div>
        ))}
      </div>

      <figcaption className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
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
