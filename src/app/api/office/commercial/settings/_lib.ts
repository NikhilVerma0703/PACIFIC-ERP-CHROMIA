// The one view of module settings both settings handlers answer with, so a
// save and a counter change hand the screen exactly the shape a reload gives.
//
// WHY IT MERGES RATHER THAN CALLING loadSettings(). loadSettings is React
// cache()d for the life of a request: called before a write and again after
// it, it returns the value from before. The PUT handler answers with the
// settings it has just stored, so it merges the stored overrides itself.
// previewCounters is peekNext without that trap (and without six round trips)
// — the same pure formatter, fed the settings this request actually wrote.
import { prisma } from "@/lib/prisma";
import { DEFAULT_SETTINGS, mergeSettings, type CommercialSettings } from "@/lib/commercial/settings-defaults";
import { loadOverrides } from "@/lib/commercial/settings";
import { listSequences } from "@/lib/commercial/sequence";
import { diffFromDefaults, previewCounters, type CounterPreview } from "@/lib/commercial/settings-rules";
import type { NumberingKind } from "@/lib/commercial/settings-defaults";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

export interface SequenceRow { key: string; nextValue: number; updatedAt: Date }

export interface SettingsView {
  /** Defaults with the stored overrides laid over them — what documents print from. */
  merged: CommercialSettings;
  /** Only what has been changed; the screen posts this back with its edits. */
  overrides: Record<string, unknown>;
  /** So the screen can show "default: …" beside a changed field without a second call. */
  defaults: CommercialSettings;
  /** Dotted paths where merged differs from defaults. */
  changed: string[];
  sequences: SequenceRow[];
  /** The number each kind would take today, under the key it would take it from. */
  previews: Record<NumberingKind, CounterPreview>;
}

/** Read the counters once and format every preview from them. */
export async function loadSequences(): Promise<SequenceRow[]> {
  return (await listSequences()) as SequenceRow[];
}

/** `overrides` given → the view for settings just written; omitted → read them. */
export async function settingsView(overrides?: Record<string, unknown>, sequences?: SequenceRow[]): Promise<SettingsView> {
  const [stored, seqs] = await Promise.all([
    overrides ? Promise.resolve(overrides) : loadOverrides(),
    sequences ? Promise.resolve(sequences) : loadSequences(),
  ]);
  const merged = mergeSettings(DEFAULT_SETTINGS, stored);
  return {
    merged,
    overrides: stored,
    defaults: DEFAULT_SETTINGS,
    changed: diffFromDefaults(merged),
    sequences: seqs,
    previews: previewCounters(merged, seqs, new Date()),
  };
}

/** The counter's current next value, or null when it has no row yet (which is
 *  every counter until an admin aligns it with Tally, or a document is issued). */
export async function currentNext(key: string): Promise<number | null> {
  const row = await db.commercialSequence.findUnique({ where: { key }, select: { nextValue: true } });
  return row ? Number(row.nextValue) : null;
}
