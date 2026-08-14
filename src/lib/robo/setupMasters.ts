/**
 * Shaping for a Robo production setup ("batch setup" on the tablet), shared by
 * POST /api/robo/batch-recipes and PATCH /api/robo/batch-recipes/[id].
 *
 * Ported from ROBO_MODULE 388841f (`src/lib/setup-masters.ts`), split in two on
 * the way in: everything here is pure so `node --test` can reach it, and the
 * database half — resolving the design and filing typed names into the master
 * lists — lives next door in setupMastersDb.ts. That is the same separation
 * importRegister.ts already uses: parse and shape in lib, persist in the route.
 *
 * The two routes shaping their rows through one module is the point of the
 * upstream commit. Create and edit that coerce numbers or blank-to-null
 * differently produce setups that read differently depending on which button
 * saved them, and the difference only ever shows up in a report.
 */

/** One machine's settings as they arrive from the batch-setup half of the form. */
export interface SetupEntryInput {
  machineId?: string;
  programName?: string;
  toolName?: string;
  liquidName?: string;
  powderName?: string;
  rollerHeight?: string;
  targetCycleTime?: number | string | null;
}

/** The setup's own fields, as they arrive from the form or a direct API call. */
export interface SetupScalarInput {
  designName?: string | null;
  targetSlabs?: number | string | null;
  thickness?: number | string | null;
  notes?: string | null;
}

/**
 * Does this request body rebuild the per-machine rows, or is it the older
 * notes-only update?
 *
 * PATCH answered only to `notes` before 388841f. No ERP screen sends that any
 * more — RoboEntryForm is the sole caller of this route and it always sends a
 * full setup — but the old contract is kept rather than dropped, because the
 * route is public to anything holding a robo session and because upstream's
 * standalone copy still relies on it. An absent `entries` array therefore has
 * to keep meaning "leave the machines alone": reading it as "no machines were
 * ticked" would silently strip every robot off a running setup. An EMPTY array
 * is a different statement and is honoured as one; the form refuses to save
 * with nothing ticked, so it can only come from a deliberate API call.
 */
export function rebuildsEntries(body: unknown): boolean {
  return Array.isArray((body as { entries?: unknown } | null | undefined)?.entries);
}

/**
 * The distinct, trimmed names one field carries across a setup's entries.
 *
 * Matching against the master lists is by EXACT name, because that is what the
 * `@unique` index on RoboTool / RoboLiquid / RoboPowder / RoboProgram enforces.
 * So this trims (a trailing space is a typo, not a new tool) but deliberately
 * does not fold case: "DISCOTHIN" and "discothin" are two different rows to
 * Postgres, and pretending otherwise here would have the registrar skip a name
 * the database does not actually have.
 */
export function typedMasterNames(
  entries: readonly SetupEntryInput[],
  pick: (e: SetupEntryInput) => string | undefined,
): string[] {
  return Array.from(new Set(entries.map((e) => (pick(e) ?? "").trim()).filter(Boolean)));
}

/**
 * The per-machine rows, shaped for a Prisma nested create.
 *
 * Entries with no machineId are dropped rather than rejected: the row would
 * fail the required FK anyway, and on the PATCH path that failure would land
 * mid-transaction, after the old rows were already deleted.
 *
 * Duplicate machineIds are NOT collapsed. `@@unique([batchRecipeId, machineId])`
 * catches them and the transaction rolls back with nothing lost — which is the
 * right outcome, because de-duplicating here would have to pick a winner and
 * throw one machine's settings away without saying so.
 */
export function entryCreateData(entries: readonly SetupEntryInput[]) {
  return entries
    .filter((e) => e.machineId)
    .map((e) => ({
      machineId:       e.machineId as string,
      programName:     e.programName || null,
      toolName:        e.toolName || null,
      liquidName:      e.liquidName || null,
      powderName:      e.powderName || null,
      rollerHeight:    e.rollerHeight || null,
      targetCycleTime: e.targetCycleTime ? Number(e.targetCycleTime) : null,
    }));
}

/**
 * The setup's own columns. Note what is NOT here: `shiftId`, which create sets
 * once and edit must never touch — moving a setup to another shift would leave
 * every slab logged against it counted under a shift it was not made in.
 * `designId` is resolved asynchronously and is added by the caller.
 */
export function setupScalarData(body: SetupScalarInput) {
  return {
    designName:  body.designName?.trim() || "",
    targetSlabs: body.targetSlabs ? Number(body.targetSlabs) : null,
    thickness:   body.thickness ? Number(body.thickness) : null,
    notes:       body.notes || null,
  };
}
