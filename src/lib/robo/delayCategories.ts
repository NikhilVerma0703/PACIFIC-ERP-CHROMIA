/**
 * The nine delay groups of the official Pacific delay master list, and the
 * rule for guessing which group a freshly typed code belongs to.
 *
 * Lives in lib rather than inside the entry form because it is plant
 * knowledge, not layout — and because `node --test` can only reach a .ts file
 * (the runner strips types but does not compile JSX).
 */

/** `label` is what the operator picks from when adding a brand-new code from
 *  the entry form; `isRobotSpecific` is the group's default, mirroring the
 *  Delay Codes master page — a code in a robot group asks which machine. */
export const CATEGORY_META: { key: string; label: string; isRobotSpecific: boolean }[] = [
  { key: "ROYMIX",      label: "A — Roy Mixer Delays",  isRobotSpecific: false },
  { key: "LINE",        label: "B — Line Stoppage",     isRobotSpecific: false },
  { key: "DISTRIBUTOR", label: "C — Distributor",       isRobotSpecific: false },
  { key: "LINE_START",  label: "D — Line Start",        isRobotSpecific: false },
  { key: "PRESS",       label: "E — Press Delay",       isRobotSpecific: false },
  { key: "MAINTENANCE", label: "F — Maintenance Delay", isRobotSpecific: true },
  { key: "ROBOT",       label: "G — Robot Delays",      isRobotSpecific: true },
  { key: "GENERAL",     label: "H — General Delays",    isRobotSpecific: true },
  { key: "POWERCUT",    label: "J — Powercut",          isRobotSpecific: false },
];

/** Category display order — matches the printed master list. */
export const CATEGORY_ORDER = CATEGORY_META.map((c) => c.key);

/**
 * Best guess at the group a freshly typed code belongs to, from its prefix
 * the way the master list numbers them: RM1 → Roy Mixer, M9 → Maintenance,
 * C8 → Robot, and so on.
 *
 * RM is checked first because it would otherwise be read as a bare R and fall
 * through to GENERAL. Only a starting point — the operator can change the
 * category before saving, so guessing wrong costs a tap, while not guessing
 * at all costs a decision the operator has no reason to be able to make.
 */
export function guessCategory(code: string): string {
  const c = code.trim().toUpperCase();
  if (/^RM\d/.test(c)) return "ROYMIX";
  const byPrefix: Record<string, string> = {
    L: "LINE", D: "DISTRIBUTOR", S: "LINE_START", P: "PRESS",
    M: "MAINTENANCE", C: "ROBOT", G: "GENERAL", T: "POWERCUT",
  };
  const m = /^([A-Z])\d/.exec(c);
  return (m && byPrefix[m[1]]) || "GENERAL";
}

/** The robot-flag default for a group, used when the operator switches the
 *  category on the new-code panel. Unknown groups are not robot-specific. */
export function defaultRobotSpecific(category: string): boolean {
  return CATEGORY_META.find((c) => c.key === category)?.isRobotSpecific ?? false;
}
