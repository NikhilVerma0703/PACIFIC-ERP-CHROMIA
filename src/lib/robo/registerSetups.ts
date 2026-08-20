/**
 * How a slab row in a register workbook is matched to the production setup it
 * was made under.
 *
 * A leaf module with no imports, so `node --test` can reach it — importRegister
 * itself pulls in @/lib/robo/utils and cannot be loaded by the test runner.
 * importRegister re-exports these, so callers need not know where they live.
 */

export function setupKey(date: string, shiftNumber: number, designName: string): string {
  return `${date}|${shiftNumber}|${designName.trim().toUpperCase()}`;
}

/**
 * The design a slab belongs to when its own row does not name one.
 *
 * Our Complete Production download no longer repeats Design Name on every slab
 * line — it belongs to the run, and the Production Setup sheet carries it once
 * per run rather than 500 times. Re-importing that workbook has to still know
 * which setup each slab was produced under, and the second sheet says so: it
 * is keyed by date, shift and design.
 *
 * This answers only when there is NO ambiguity — exactly one design configured
 * for that date and shift. Two designs in one shift is a real thing (a second
 * pour), and guessing between them would attach slabs to the wrong recipe
 * silently, which is worse than importing them with none.
 *
 * Hand-written registers that do name a design on each line are unaffected;
 * the row's own value always wins.
 */
export function soleSetupDesign(
  setups: Record<string, unknown>,
  date: string,
  shiftNumber: number,
): string {
  const prefix = `${date}|${shiftNumber}|`;
  const designs = new Set<string>();
  for (const key of Object.keys(setups)) {
    if (key.startsWith(prefix)) {
      const design = key.slice(prefix.length);
      if (design) designs.add(design);
    }
  }
  return designs.size === 1 ? [...designs][0] : "";
}
