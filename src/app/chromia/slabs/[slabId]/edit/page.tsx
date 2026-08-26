import { redirect } from 'next/navigation';

import { APP_ROUTES } from '@/lib/chromia/constants/app';

export const dynamic = 'force-dynamic';

/**
 * The old dedicated edit page.
 *
 * Editing a slab record now happens on the Operator Entry screen with the QC
 * Section open beneath it, so the whole record — the entry fields and the QC
 * grade/outcome alike — is corrected in one place, on the same record. This
 * route stays and forwards, so a bookmark or a pasted link still lands on the
 * right screen.
 */
export default async function EditSlabRedirect({
  params,
}: {
  params: Promise<{ slabId: string }>;
}) {
  const { slabId } = await params;
  redirect(`${APP_ROUTES.operator}?slab=${encodeURIComponent(slabId)}&edit=1`);
}
