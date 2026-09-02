import Link from 'next/link';

import type { ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { slabHref } from '@/lib/chromia/slab-links';
import { cn } from '@/lib/chromia/utils/cn';

/**
 * A slab number in a table.
 *
 * It becomes a link only when there is somewhere to go — the QC screen that
 * finishes the slab — and while it is unfinished it is marked so it cannot be
 * mistaken for a completed one: a status-blue dot and a blue mono number,
 * against the plain grey number of a slab whose work is done. So a glance down
 * the column separates "still in processing" from "graded and gone" without
 * reading the Status column at all. Once graded, the number is just an
 * identifier, rendered as plain text.
 */
export function SlabNo({
  id,
  status,
  slabNo,
  className,
  back,
}: {
  id: string;
  status: SlabStatus;
  slabNo: string;
  className?: string;
  /** The full page URL (with filters) to return to after QC — see slabHref. */
  back?: string;
}) {
  const href = slabHref(id, status, back);

  if (!href) {
    return <span className={cn('font-mono', className)}>{slabNo}</span>;
  }

  return (
    <Link
      href={href}
      title="Still in processing — click to grade"
      className={cn(
        'text-status-active inline-flex items-center gap-1.5 font-mono font-semibold hover:underline',
        className,
      )}
    >
      <span className="bg-status-active inline-block size-1.5 shrink-0 rounded-full" aria-hidden />
      {slabNo}
    </Link>
  );
}
