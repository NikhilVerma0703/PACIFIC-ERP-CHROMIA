import Link from 'next/link';

import type { ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { slabHref } from '@/lib/chromia/slab-links';
import { cn } from '@/lib/chromia/utils/cn';
import { link } from '@/lib/chromia/ui';

/**
 * A slab number in a table.
 *
 * It becomes a link only when there is somewhere to go: the intake form that
 * finishes the slab. Once the slab is graded the number is just an identifier,
 * so it is rendered as plain text rather than as a link to nothing.
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
  /** The filter query to return to after QC — see slabHref. */
  back?: string;
}) {
  const href = slabHref(id, status, back);

  if (!href) {
    return <span className={cn('font-mono', className)}>{slabNo}</span>;
  }

  return (
    <Link href={href} className={cn(link, 'font-mono', className)}>
      {slabNo}
    </Link>
  );
}
