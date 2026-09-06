// Module settings — the server half: read the 'global' row, lay it over the
// defaults, write overrides back. Cached per request (React cache) so a PDF
// that asks for the company master and the bank does one read.
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SETTINGS, mergeSettings, type CommercialSettings } from "./settings-defaults";

export { DEFAULT_SETTINGS, mergeSettings };
export type { CommercialSettings };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

/** Defaults with the saved overrides applied. Never throws: a missing row or a
 *  read error yields the defaults, and the caller logs nothing it cannot act on. */
export const loadSettings = cache(async (): Promise<CommercialSettings> => {
  try {
    const row = await db.commercialSetting.findUnique({ where: { id: "global" }, select: { data: true } });
    return mergeSettings(DEFAULT_SETTINGS, row?.data ?? {});
  } catch {
    return DEFAULT_SETTINGS;
  }
});

/** The raw overrides, for the settings screen to show what has been changed. */
export async function loadOverrides(): Promise<Record<string, unknown>> {
  const row = await db.commercialSetting.findUnique({ where: { id: "global" }, select: { data: true } });
  return (row?.data as Record<string, unknown> | null) ?? {};
}

/** Replace the overrides. The screen sends the whole override object it was
 *  given plus its edits, so partial saves cannot drop a section. */
export async function saveOverrides(data: Record<string, unknown>, byId: string | null): Promise<CommercialSettings> {
  await db.commercialSetting.upsert({
    where: { id: "global" },
    update: { data, updatedById: byId },
    create: { id: "global", data, updatedById: byId },
  });
  return mergeSettings(DEFAULT_SETTINGS, data);
}
