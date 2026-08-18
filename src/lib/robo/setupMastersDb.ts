import { prisma } from "@/lib/prisma";
import { typedMasterNames, type SetupEntryInput } from "@/lib/robo/setupMasters";

/**
 * The database half of the shared production-setup helper — the part that
 * touches Prisma, kept out of setupMasters.ts so the shaping there stays
 * reachable from `node --test`.
 *
 * Ported from ROBO_MODULE 388841f (`src/lib/setup-masters.ts`). Upstream had
 * this logic inline in the create route only; the commit lifted it out so the
 * new in-place edit resolves designs and files master names the same way a
 * create does. That symmetry is the reason it is shared and not copied: a
 * setup edited into a new tool has to leave the tool behind in the master list
 * exactly as saving the setup fresh would.
 */

/**
 * Resolves the design by name, creating it the first time it is used so the
 * operator is never blocked by a design that is not in the master list yet.
 *
 * This is not new behaviour in the ERP — POST /api/robo/batch-recipes has done
 * exactly this inline since the module landed, and the edit path needs a
 * designId for the same reason create does: RoboBatchRecipe.designId is what
 * links a setup to RoboDesign, and the form only ever sends a name.
 */
export async function resolveDesignId(designName?: string | null): Promise<string | null> {
  const name = designName?.trim();
  if (!name) return null;
  const existing = await prisma.roboDesign.findUnique({ where: { name } });
  if (existing) return existing.id;
  const created = await prisma.roboDesign.create({ data: { name } });
  return created.id;
}

/**
 * Anything the setup carries that is not in the master lists yet is added to
 * them, so the next setup can pick it from a dropdown. Matching is by exact
 * name and nothing existing is ever modified.
 *
 * ── Why this is live in the ERP, despite SearchableSelect ─────────────────
 * A previous port pass dismissed this as structurally dead here, reasoning
 * that the ERP's SearchableSelect only ever commits an existing option or its
 * "+ Add" action, and "+ Add" POSTs to the master API before it commits — so
 * by the time a name reaches this route it is already a master row.
 *
 * That is true of the comboboxes and false of the form. `applyDesignPreset` in
 * RoboEntryForm writes toolName / liquidName / powderName straight into the
 * per-machine state from the plant in-charge's reference sheet in
 * design-presets.ts, with no dropdown and no POST in between. Two of those
 * names are not in the Robo masters at all — CALACATTA GOLD gives Roycut-1 the
 * tool "BOAT 120, PAINTING TOOL" (the masters hold "BOAT 120" and "PAINTING
 * TOOL" as separate rows) and BELLAGIO BLUE gives Roycut-2 the powder
 * "P1-TQB, P2-DV4" (not seeded at all). Pick either design and save, and the
 * setup stores a name no dropdown can offer the next shift. This is the code
 * that closes that gap, and 388841f extends it to the edit path where the same
 * preset auto-fill runs again.
 *
 * The program branch is the one part with no UI path into it: programName is
 * only ever set by its combobox, which POSTs through /api/robo/programs first,
 * and no preset fills it. It is kept because the route is reachable without
 * the UI and because three of four typed fields registering is a rule nobody
 * can remember — not because it is exercised today.
 */
export async function registerTypedMasters(
  entries: readonly SetupEntryInput[],
  designId: string | null,
): Promise<void> {
  for (const name of typedMasterNames(entries, (e) => e.toolName)) {
    await prisma.roboTool.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const name of typedMasterNames(entries, (e) => e.liquidName)) {
    await prisma.roboLiquid.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const name of typedMasterNames(entries, (e) => e.powderName)) {
    await prisma.roboPowder.upsert({ where: { name }, update: {}, create: { name } });
  }
  // A program belongs to a design (RoboProgram.designId is required), so it can
  // only be filed once the design is known. A program name already registered
  // under another design stays where it is — the name is globally unique, and
  // re-homing someone else's program is not this route's call to make.
  if (designId) {
    for (const name of typedMasterNames(entries, (e) => e.programName)) {
      const existing = await prisma.roboProgram.findUnique({ where: { name } });
      if (!existing) await prisma.roboProgram.create({ data: { name, designId } });
    }
  }
}
