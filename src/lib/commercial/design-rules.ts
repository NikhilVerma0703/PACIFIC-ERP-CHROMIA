// The design master (answers 13 and 20) — the PURE half. What shade a design
// name suggests before anyone has confirmed it, how a customer code is
// normalised, how many hours of cleaning a changeover costs, and which rows a
// seed inserts. Run by tests/commercialDesignCodes.test.ts under node --test.
//
// IMPORT-FREE, deliberately. The design-code routes, the production-request
// routes and the planning board import this; nothing here imports them back.

export const SHADES = ["LIGHT", "MEDIUM", "DARK"] as const;
export type Shade = (typeof SHADES)[number];

/** A shade from a body or a column, or null for anything that is not one. */
export function parseShade(v: unknown): Shade | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return (SHADES as readonly string[]).includes(s) ? (s as Shade) : null;
}

/**
 * The words in a design name that say which end of the palette it sits at.
 * The list is the owner's from DESIGN.md §8 plus the spellings finished goods
 * actually uses ("gray", "statuario", "graphite"). Matched as substrings of
 * the lower-cased name rather than whole words, because the yard writes
 * "Greystone" and "Whitehaven" and a first guess that missed those would be
 * MEDIUM for no reason — the guess is unconfirmed either way, and the editor
 * exists to correct it.
 */
export const LIGHT_WORDS = ["white", "bianco", "carrara", "calacatta", "ivory", "cream", "statuario"] as const;
export const DARK_WORDS = ["black", "nero", "grey", "gray", "charcoal", "dark", "brown", "graphite"] as const;

/**
 * A first-guess shade from the name. A name that says both ("Black & White")
 * says nothing about which end dominates, so it lands in the middle rather
 * than on whichever word happened to be listed first. Blank is MEDIUM too:
 * the queue rule treats an unknown shade as MEDIUM, and the seed must not
 * write a null that the editor then shows as "no guess" beside a guess.
 */
export function guessShade(designName: unknown): Shade {
  const name = typeof designName === "string" ? designName.toLowerCase() : "";
  if (!name.trim()) return "MEDIUM";
  const light = LIGHT_WORDS.some((w) => name.includes(w));
  const dark = DARK_WORDS.some((w) => name.includes(w));
  if (light && !dark) return "LIGHT";
  if (dark && !light) return "DARK";
  return "MEDIUM";
}

/** The customer code as stored: trimmed, upper-cased, null when blank. Two
 *  designs may not share one (the column is unique), and "pes-01" typed on
 *  one row and "PES-01" on another would slip past that as two codes. */
export function normaliseDesignCode(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  return s ? s : null;
}

/** The design name as a key: trimmed, never empty. The column is the primary
 *  key, so a trailing space would make a second master row for one design. */
export function normaliseDesignName(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export interface PlanningSettingsLike {
  cleaningHoursDefault: number;
  cleaningHoursAbrupt: number;
}

/** The hours the settings say, or the owner's 3 / 6 when a setting is not a
 *  positive number — a blank override must not schedule zero hours of cleaning. */
function hours(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** An unknown shade counts as MEDIUM: a design nobody has classified yet is
 *  neither an abrupt jump nor a reason to skip the ordinary clean. */
export function shadeOrMedium(v: unknown): Shade {
  return parseShade(v) ?? "MEDIUM";
}

/** Answer 13: only DARK → LIGHT is abrupt. LIGHT → DARK is the slow direction
 *  the owner asked for; MEDIUM either way is the ordinary changeover. */
export function isAbruptJump(prevShade: unknown, thisShade: unknown): boolean {
  return shadeOrMedium(prevShade) === "DARK" && shadeOrMedium(thisShade) === "LIGHT";
}

/**
 * Cleaning hours for a row given the row before it in the queue: 6 (the
 * abrupt figure) on DARK → LIGHT, else 3. No previous row means the machine
 * is coming off whatever ran last, which the queue does not know — so the
 * ordinary clean, never the abrupt one.
 */
export function cleaningHoursFor(prevShade: unknown, thisShade: unknown, planning?: Partial<PlanningSettingsLike> | null): number {
  const ordinary = hours(planning?.cleaningHoursDefault, 3);
  const abrupt = hours(planning?.cleaningHoursAbrupt, 6);
  if (prevShade === null || prevShade === undefined) return ordinary;
  return isAbruptJump(prevShade, thisShade) ? abrupt : ordinary;
}

export interface DesignCodePatch {
  code?: string | null;
  shade?: Shade | null;
  shadeConfirmed?: boolean;
  notes?: string | null;
}

/**
 * The fields a PUT may change, taken only when the body names them, so a
 * body that sends `{ code: "PES-01" }` does not clear the shade. A shade that
 * is not LIGHT / MEDIUM / DARK is refused rather than stored as null, because
 * "null" in that column means "not yet guessed" and the queue would silently
 * read it as MEDIUM.
 */
export function designCodePatch(body: Record<string, unknown>): { ok: true; patch: DesignCodePatch } | { ok: false; reason: string } {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const patch: DesignCodePatch = {};
  if (has("code")) patch.code = normaliseDesignCode(body.code);
  if (has("shade")) {
    if (body.shade === null || body.shade === "") patch.shade = null;
    else {
      const s = parseShade(body.shade);
      if (!s) return { ok: false, reason: `Shade must be one of ${SHADES.join(", ")}` };
      patch.shade = s;
    }
  }
  if (has("shadeConfirmed")) patch.shadeConfirmed = body.shadeConfirmed === true || body.shadeConfirmed === "true";
  if (has("notes")) {
    const n = body.notes === null || body.notes === undefined ? "" : String(body.notes).trim();
    patch.notes = n ? n : null;
  }
  if (!Object.keys(patch).length) return { ok: false, reason: "Nothing to change" };
  return { ok: true, patch };
}

export interface SeedRow {
  design: string;
  shade: Shade;
  shadeConfirmed: false;
}

/**
 * The master rows a seed inserts: one per distinct finished-goods design name
 * not already in the master, shade guessed, unconfirmed. Names are compared
 * trimmed and case-insensitively in BOTH directions — "Carrara Royale" in the
 * master and "CARRARA ROYALE" in stock are one design, and the seed must not
 * create the second row that the alias table exists to prevent. The first
 * spelling seen is the one written.
 */
export function seedRows(existingDesigns: ReadonlyArray<string | null | undefined>, stockDesigns: ReadonlyArray<string | null | undefined>): SeedRow[] {
  const seen = new Set<string>();
  for (const d of existingDesigns) {
    const s = normaliseDesignName(d);
    if (s) seen.add(s.toLowerCase());
  }
  const out: SeedRow[] = [];
  for (const d of stockDesigns) {
    const s = normaliseDesignName(d);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ design: s, shade: guessShade(s), shadeConfirmed: false });
  }
  return out;
}

/** The master row for a design, matched trimmed and case-insensitively, so a
 *  request raised as "carrara royale" still finds "Carrara Royale"'s shade. */
export function findDesignRow<T extends { design: string }>(rows: ReadonlyArray<T>, design: unknown): T | null {
  const want = (normaliseDesignName(design) ?? "").toLowerCase();
  if (!want) return null;
  return rows.find((r) => r.design.trim().toLowerCase() === want) ?? null;
}
