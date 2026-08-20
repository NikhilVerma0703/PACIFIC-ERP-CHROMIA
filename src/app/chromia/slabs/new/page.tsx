import { redirect } from 'next/navigation';

import { APP_ROUTES } from '@/lib/chromia/constants/app';

export const dynamic = 'force-dynamic';

/**
 * The old slab intake page.
 *
 * QC is done on the operator's own screen now, under the entry the slab was
 * booked on — see /chromia/operator. Nothing in the app links here any more
 * (APP_ROUTES.slabIntake moved), but this path has been the destination of
 * every slab number in every table for months, so it stays and forwards rather
 * than 404-ing a bookmark or a link somebody pasted into a message.
 *
 * The query is carried across unchanged: `?slab=<id>` means the same thing on
 * the other side.
 */
export default async function SlabIntakeRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.slab;
  const slabId = Array.isArray(raw) ? raw[0] : raw;

  redirect(slabId ? `${APP_ROUTES.operator}?slab=${encodeURIComponent(slabId)}` : APP_ROUTES.slabs);
}
